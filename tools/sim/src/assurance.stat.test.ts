// Invariant evidence: INV-009 (reproducible settlement), INV-002 (shared market).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, logPrice, MasterKeyring, type Tick } from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine } from '@otc/engine';
import {
  buildObserverDataset,
  journalFingerprint,
  journalPriceAt,
  JournalError,
  readJournal,
  runBatteryAsync,
  withheldFamilies,
  writeJournal,
  type TickJournal,
} from '@otc/lab';
import { settle, type Contract } from '@otc/trading';

/**
 * Assurance a counterparty can recompute.
 *
 * Every verification before this one ran inside a process that also held the
 * master key, so "reproducible" meant "reproducible by the operator" — which is
 * exactly the reproducibility a sceptical counterparty has no reason to accept.
 *
 * These tests derive a verdict and a settlement from a **published journal
 * alone**: instants, prices and sequence numbers, with no key, no cursor, no
 * latent state and no configuration. That is what a trader could have recorded
 * for themselves.
 */

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('assurance');
const ASSET = ASSET_CATALOGUE[0]!;
const TICKS = 400_000;

function generate(): Tick[] {
  const engine = createMarketEngine({
    config: configFor(ASSET),
    keyring,
    environment: 'simulation',
    start: { instant: GENESIS, price: logPrice(0) },
    maxTicks: TICKS,
  });
  const ticks: Tick[] = [];
  for (;;) {
    const tick = engine.next();
    if (tick === null) break;
    ticks.push(tick);
  }
  return ticks;
}

function journalOf(ticks: readonly Tick[]): TickJournal {
  return {
    instrumentId: ASSET.instrument.id,
    logQuantum: ASSET.instrument.logQuantum,
    ticks,
  };
}

describe('a verdict is derivable from the published record alone', () => {
  const ticks = generate();
  const journal = journalOf(ticks);
  const text = writeJournal(journal);

  it('round-trips exactly', () => {
    const restored = readJournal(text);
    expect(restored.ticks).toHaveLength(ticks.length);
    expect(restored.ticks).toEqual(ticks);
    expect(journalFingerprint(restored)).toBe(journalFingerprint(journal));
  });

  it('settles identically to the operator, with no key present', async () => {
    // The property that matters commercially. A counterparty holding only the
    // journal must reach the operator's answer, or every dispute is a matter of
    // trust rather than arithmetic.
    const restored = readJournal(text);
    const dataset = await buildObserverDataset({
      source: {
        instrument: ASSET.instrument,
        next: (() => {
          let i = 0;
          return () => (i < ticks.length ? ticks[i++]! : null);
        })(),
      },
      maxTicks: ticks.length,
    });

    let compared = 0;
    for (let i = 5_000; i < ticks.length - 60_000; i += 9_973) {
      const contract: Contract = {
        id: `c${i}`,
        assetId: ASSET.instrument.id,
        direction: i % 2 === 0 ? 'up' : 'down',
        stake: 100,
        entryInstant: ticks[i]!.instant,
        horizonMs: durationMillis(30_000),
        payoutRatio: 0.85,
      };
      const operator = settle(contract, { instants: dataset.instants, prices: dataset.prices });
      // The counterparty resolves both ends from the journal, with no engine.
      const entry = journalPriceAt(restored, contract.entryInstant)!;
      const expiry = journalPriceAt(
        restored,
        epochMillis(contract.entryInstant + contract.horizonMs),
      )!;
      expect(entry.price, `entry disagreed at ${i}`).toBe(operator.entryPrice);
      expect(expiry.price, `expiry disagreed at ${i}`).toBe(operator.expiryPrice);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(30);
  }, 900_000);

  it('reaches the same battery verdict as the operator', async () => {
    // The assurance claim in full: a party with the journal and the open-source
    // laboratory can re-derive the unexploitability verdict themselves.
    const restored = readJournal(text);
    const dataset = await buildObserverDataset({
      source: {
        instrument: ASSET.instrument,
        next: (() => {
          let i = 0;
          return () => (i < restored.ticks.length ? restored.ticks[i++]! : null);
        })(),
      },
      maxTicks: restored.ticks.length,
    });

    const verdict = await runBatteryAsync(dataset, {
      families: withheldFamilies({ sequenceModulus: 7 }),
      trainingFraction: 0.3,
    });

    console.info(
      `assurance: ${verdict.coverage.hypothesesTested} hypotheses from the journal alone, ` +
        `${verdict.clean ? 'CLEAN' : 'EXPLOITABLE'}, fingerprint ${journalFingerprint(restored)}`,
    );
    expect(verdict.coverage.hypothesesTested).toBeGreaterThan(10);
    expect(verdict.clean).toBe(true);
  }, 900_000);
});

describe('the journal refuses a record that cannot settle a dispute', () => {
  const ticks = generate().slice(0, 5_000);
  const text = writeJournal(journalOf(ticks));

  it('refuses a gap rather than filling it', () => {
    // Filling a gap would invent prices; tolerating one would let a dispute be
    // resolved against a record that never happened.
    const lines = text.split('\n');
    lines.splice(2_000, 5);
    expect(() => readJournal(lines.join('\n'))).toThrow(JournalError);
  });

  it('refuses a truncated line', () => {
    const lines = text.split('\n');
    lines[1_500] = lines[1_500]!.slice(0, 8);
    expect(() => readJournal(lines.join('\n'))).toThrow(/truncated|not JSON/);
  });

  it('refuses a header that disagrees with the body', () => {
    const lines = text.split('\n');
    const header = JSON.parse(lines[0]!) as Record<string, unknown>;
    lines[0] = JSON.stringify({ ...header, ticks: 999_999 });
    expect(() => readJournal(lines.join('\n'))).toThrow(/header claims/);
  });

  it('refuses something that is not a journal at all', () => {
    expect(() => readJournal('')).toThrow(JournalError);
    expect(() => readJournal('{"kind":"something-else"}')).toThrow(/not a tick journal/);
    expect(() => readJournal('not json')).toThrow(/header is not JSON/);
  });

  it('notices when two parties hold different records', () => {
    const mine = journalOf(ticks);
    const theirs = journalOf([
      ...ticks.slice(0, 100),
      { ...ticks[100]!, price: logPrice(ticks[100]!.price + 1) },
      ...ticks.slice(101),
    ]);
    expect(journalFingerprint(theirs)).not.toBe(journalFingerprint(mine));
  });
});
