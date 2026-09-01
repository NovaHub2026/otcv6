// Invariant evidence: INV-001 (economic independence).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, logPrice, MasterKeyring, type Tick } from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine } from '@otc/engine';
import { ExposureBook, type Contract } from '@otc/trading';

/**
 * A venue that refuses trades generates the same market as one that does not.
 *
 * ## Why this test is the point of PH-13.3
 *
 * Every cycle before this one could rely on the venue having **no economic state
 * to leak**. PH-13 creates some: net exposure per settlement event is, by
 * construction, the number that says which resolution costs the operator money.
 *
 * PH-6 established INV-001 by showing identical ticks between a quiet market and
 * one under heavy adversarial trading. That demonstration assumed trading could
 * only *add* contracts. This one is stronger in the way that matters now: the
 * venue is **making decisions based on exposure** — accepting some trades,
 * refusing others — and the market must still be bit-identical.
 *
 * ## Why it cannot be a vocabulary check
 *
 * Cycle Audit 4 (M-4) defeated the vocabulary scan with neutral naming: a
 * module-level channel written from `settle.ts` and read into the engine through
 * an alias table, naming no economic term at all. Only a behavioural test caught
 * the ungated version.
 *
 * So this compares bytes.
 */

const GENESIS = 1_776_000_000_000;
const TICKS = 60_000;

function drive(assetIndex: number, onTick: (tick: Tick) => void): Tick[] {
  const asset = ASSET_CATALOGUE[assetIndex]!;
  const engine = createMarketEngine({
    config: configFor(asset),
    keyring: MasterKeyring.forTesting(`limiter-blindness-${asset.definition.id}`),
    environment: 'simulation',
    start: { instant: epochMillis(GENESIS), price: logPrice(0) },
    maxTicks: TICKS,
  });
  const produced: Tick[] = [];
  for (;;) {
    const tick = engine.next();
    if (tick === null) break;
    produced.push(tick);
    onTick(tick);
  }
  return produced;
}

describe('an enforcing venue produces the same market as a passive one', () => {
  it.each(ASSET_CATALOGUE.map((a, i) => [a.definition.id, i] as const))(
    '%s is bit-identical with the limiter enforcing',
    (id, index) => {
      // Passive: nobody trades, nothing is evaluated.
      const quiet = drive(index, () => {});

      // Enforcing: an adversary pushes one settlement event as hard as it can,
      // the limiter refuses most of it, and every decision reads exposure — the
      // quantity INV-001 says the price path must never see.
      // Incremental: `admit` on a plain array recomputes the whole book every
      // call, which is O(n) per admission. PH-13.3 found that the way
      // performance defects should be found — a test that could not finish.
      const book = new ExposureBook();
      let accepted = 0;
      let refused = 0;
      const policy = { maxEventExposure: 500 };

      const traded = drive(index, (tick) => {
        // A contract per tick, all crowding the same expiry window: the
        // adversarial shape, and the one the limiter exists for.
        const candidate: Contract = {
          id: `t${tick.sequence}`,
          assetId: id,
          direction: tick.sequence % 3 === 0 ? 'down' : 'up',
          stake: 100,
          entryInstant: epochMillis(GENESIS),
          horizonMs: durationMillis(30_000),
          payoutRatio: 0.99,
        };
        const decision = book.admit(candidate, policy);
        if (decision.accepted) {
          book.add(candidate);
          accepted += 1;
        } else {
          refused += 1;
        }
      });

      // The limiter must have actually been exercised, in both directions. A
      // blindness demonstration against a limiter that never refused anything
      // would prove nothing.
      expect(accepted, `${id}: nothing accepted`).toBeGreaterThan(10);
      expect(refused, `${id}: nothing refused`).toBeGreaterThan(100);
      expect(book.peakExposure(), `${id}: limit not held`).toBeLessThanOrEqual(
        policy.maxEventExposure,
      );

      expect(traded.length).toBe(quiet.length);
      expect(traded, `${id}: enforcement changed the market`).toEqual(quiet);
    },
  );
});

describe('the demonstration can fail', () => {
  it('detects a market that differs by one lattice step', () => {
    // Teeth. A comparison that passed on any input would make every assertion
    // above vacuous — the defect this project has found seven times.
    const quiet = drive(0, () => {});
    const tampered = quiet.map((tick, i) =>
      i === 500 ? { ...tick, price: logPrice(tick.price + 1) } : tick,
    );
    expect(tampered).not.toEqual(quiet);
  });
});
