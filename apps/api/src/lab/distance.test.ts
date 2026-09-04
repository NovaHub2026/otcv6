import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { distanceUnitFrom, LabDistances, medianCandleRange } from './distance.js';

const tick = (sequence: number, instant: number, price: number): Tick => ({
  sequence,
  instant: epochMillis(instant),
  price: logPrice(price),
});

describe('the distance unit', () => {
  it('is a quarter of the median complete-minute range, at least one step, priced at the level', () => {
    const base = 1_776_000_000_000;
    const ticks: Tick[] = [
      tick(1, base - 1, 0), // partial minute, dropped
      tick(2, base + 1_000, 0),
      tick(3, base + 2_000, 80), // minute 1: range 80
      tick(4, base + 61_000, 0),
      tick(5, base + 62_000, 40), // minute 2: range 40
      tick(6, base + 121_000, 0),
      // Minute 3's range is far from the others so that a mean (173) and the median (80)
      // cannot be confused: the first plant against this test survived on a symmetric fixture.
      tick(7, base + 122_000, 400), // minute 3: range 400
      tick(8, base + 181_000, 0), // partial, dropped
    ];
    expect(medianCandleRange(ticks)).toEqual({ range: 80, minutes: 3 });
    const unit = distanceUnitFrom(ASSET_CATALOGUE[0]!, 0, ticks, base);
    expect(unit.unitSteps).toBe(20);
    expect(unit.candleRangeSteps).toBe(80);
    expect(Number(unit.unitPrice)).toBeGreaterThan(0);
    expect(distanceUnitFrom(ASSET_CATALOGUE[0]!, 0, [], base).unitSteps).toBe(1);
  });

  it('caches per market for its lifetime and no longer', () => {
    const cache = new LabDistances(1_000);
    const unit = distanceUnitFrom(ASSET_CATALOGUE[0]!, 0, [], 10);
    expect(cache.cached('eurusd', 10)).toBeNull();
    cache.remember('eurusd', unit);
    expect(cache.cached('eurusd', 500)).toBe(unit);
    expect(cache.cached('eurusd', 1_100)).toBeNull();
  });
});
