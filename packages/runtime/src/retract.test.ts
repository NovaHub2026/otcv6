import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, logPrice, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine } from '@otc/engine';
import { HostedMarket } from './hosted.js';

/**
 * PH-24.13 §2: the drawn, unpublished tick can be retracted, and only that.
 */
const asset = ASSET_CATALOGUE[0]!;
const START = epochMillis(1_776_000_000_000);

/** Advance in steps inside the catch-up bound. */
function advance(clock: SteppableClock, market: HostedMarket, ms: number) {
  const published = [];
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, 10_000);
    clock.advance(durationMillis(step));
    published.push(...market.advance());
    left -= step;
  }
  return published;
}

function hosted(retractable: boolean) {
  const clock = new SteppableClock(START);
  const engine = createMarketEngine({
    config: configFor(asset),
    keyring: MasterKeyring.fromSecret('retract-spec', new Uint8Array(32).fill(23)),
    environment: 'simulation',
    start: { instant: START, price: logPrice(0) },
  });
  const market = new HostedMarket({ engine, clock, retractable });
  return { clock, market };
}

describe('retractPending', () => {
  it('retracts only the unpublished tick, and the redraw repeats its sequence and magnitude', () => {
    const { clock, market } = hosted(true);
    const published = advance(clock, market, 30_000);
    expect(published.length).toBeGreaterThan(0);
    const pending = market.pending!;
    const last = published[published.length - 1]!;
    expect(pending.sequence).toBe(last.sequence + 1);
    expect(market.retractPending()).toBe(true);
    expect(market.pending).toBeNull();
    // Nothing published changed; the engine stands after the last published tick.
    expect(market.snapshotEngine().sequence).toBe(last.sequence);
    // The redraw spends the same keystream positions: same sequence, same magnitude
    // (the sign is the keystream's again, so the step is identical here).
    market.prime();
    const redrawn = market.pending!;
    expect(redrawn.sequence).toBe(pending.sequence);
    expect(redrawn.price).toBe(pending.price);
    expect(redrawn.instant).toBe(pending.instant);
    // Retracting twice is nothing: the pre-draw state was consumed by the redraw... unless kept again.
    expect(market.retractPending()).toBe(true);
    expect(market.retractPending()).toBe(false);
  });

  it('refuses when not built retractable, when nothing is pending, and for a pending tick inherited across a restart', () => {
    const plain = hosted(false);
    advance(plain.clock, plain.market, 30_000);
    expect(plain.market.pending).not.toBeNull();
    expect(plain.market.retractPending()).toBe(false);

    const { clock, market } = hosted(true);
    expect(market.retractPending()).toBe(false);
    advance(clock, market, 30_000);
    const inherited = market.pending!;
    const engine = createMarketEngine({
      config: configFor(asset),
      keyring: MasterKeyring.fromSecret('retract-spec', new Uint8Array(32).fill(23)),
      environment: 'simulation',
      start: { instant: START, price: logPrice(0) },
    });
    engine.restore(market.snapshotEngine());
    const resumed = new HostedMarket({
      engine,
      clock,
      retractable: true,
      resumePending: inherited,
    });
    expect(resumed.pending).toEqual(inherited);
    expect(resumed.retractPending()).toBe(false);
  });
});
