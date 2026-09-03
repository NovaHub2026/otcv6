import { describe, expect, it } from 'vitest';
import {
  bucketEnd,
  durationMillis,
  epochMillis,
  foldTicks,
  logPrice,
  timeframe,
  type Tick,
} from '@otc/core';
import { settle } from './settle.js';
import type { Contract } from './contract.js';

/**
 * A candle's close and the price a contract settles on at the candle's end are
 * the same tick — except when the engine prints exactly on the boundary.
 *
 * ADR-0017, from LAB-SPECIFICATION-AUDIT-001 LA-02. The chart's bucket is
 * `[start, end)` and the settlement lookup is `priceAtOrBefore(end)`, so a tick
 * at `end` is the next candle's open and this contract's expiry price. Both
 * rules are right and they are different; this pins the relationship so it is
 * a property rather than a surprise. Measured on the shipped engine, the
 * exception is one 1m candle in 471 (BTC/USD) to 1,163 (EUR/USD).
 */
const tf = timeframe('1m');
const t0 = epochMillis(1_776_000_000_000); // a 1m boundary
const end = bucketEnd(t0, tf);

const tick = (instant: number, sequence: number, price: number): Tick => ({
  instant: epochMillis(instant),
  sequence,
  price: logPrice(price),
});

/** A contract entered one second into the candle and expiring exactly at its end. */
const contract: Contract = {
  id: 'boundary',
  assetId: 'eurusd',
  direction: 'up',
  stake: 100,
  entryInstant: epochMillis(t0 + 1_000),
  horizonMs: durationMillis(end - (t0 + 1_000)),
  payoutRatio: 0.85,
};

function recordOf(ticks: readonly Tick[]) {
  return {
    instants: Float64Array.from(ticks.map((t) => t.instant)),
    prices: Int32Array.from(ticks.map((t) => t.price)),
  };
}

describe('candle close against the price in force at its end (ADR-0017)', () => {
  it('is the same tick when nothing prints on the boundary', () => {
    const ticks = [
      tick(t0 + 1_000, 1, 100),
      tick(t0 + 30_000, 2, 105),
      tick(t0 + 59_990, 3, 110),
      tick(end + 4_000, 4, 121),
    ];
    const [candle] = foldTicks(tf, ticks);
    const settlement = settle(contract, recordOf(ticks));
    expect(candle!.close).toBe(110);
    expect(settlement.expiryPrice).toBe(candle!.close);
    expect(settlement.expiryIndex).toBe(2);
  });

  it('differs by exactly the boundary tick when one prints, and that tick opens the next candle', () => {
    const ticks = [
      tick(t0 + 1_000, 1, 100),
      tick(t0 + 30_000, 2, 105),
      tick(t0 + 59_990, 3, 110),
      tick(end, 4, 120), // exactly on the boundary millisecond
      tick(end + 5_000, 5, 121),
    ];
    const [closing, next] = foldTicks(tf, ticks);
    const settlement = settle(contract, recordOf(ticks));
    // The chart: the boundary tick belongs to the next candle.
    expect(closing!.close).toBe(110);
    expect(next!.openInstant).toBe(end);
    expect(next!.open).toBe(120);
    // Settlement: the price in force at the expiry instant is that tick.
    expect(settlement.expiryPrice).toBe(120);
    expect(settlement.expiryIndex).toBe(3);
    // And the difference is that one tick and nothing else.
    expect(settlement.expiryPrice).toBe(next!.open);
    expect(settlement.expiryPrice).not.toBe(closing!.close);
  });
});
