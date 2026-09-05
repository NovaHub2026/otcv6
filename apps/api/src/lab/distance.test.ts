import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import {
  distanceUnitFrom,
  LabDistances,
  medianCandleRange,
  MIN_RECORD_MINUTES,
  MEASUREMENT_SPAN_MS,
  recordWindow,
} from './distance.js';

const tick = (sequence: number, instant: number, price: number): Tick => ({
  sequence,
  instant: epochMillis(instant),
  price: logPrice(price),
});

describe('the distance unit', () => {
  it('counts a minute with no ticks as a complete minute of range zero (PH-27.1)', () => {
    // A quiet minute is a candle with no range, not a minute that did not
    // happen: dropping it from the median biased the distance unit upward on
    // every quiet market, and undercounted how much record the unit rests on.
    const base = 1_776_000_000_000;
    const t = (instant: number, price: number): Tick => ({
      sequence: instant,
      instant: epochMillis(base + instant),
      price: logPrice(price),
    });
    const ticks = [
      t(-1_000, 0),
      t(1_000, 0),
      t(2_000, 80), // minute 0: range 80
      // minute 1: nothing
      t(121_000, 80),
      t(122_000, 100), // minute 2: range 20
      t(181_000, 100), // minute 3 (partial, dropped)
    ];
    expect(medianCandleRange(ticks)).toEqual({ range: 20, minutes: 3, tradedMinutes: 2 });
  });

  it('a window is enough record only when enough minutes traded, whatever the span (CA9 a5-03)', () => {
    // Two ticks twenty-eight minutes apart span twenty-seven complete minutes
    // and traded in none of them; PH-27.1's quiet-minute count read that as a
    // whole record and let the unit be measured on nothing.
    const base = 1_776_000_000_000;
    const t = (instant: number, price: number): Tick => ({
      sequence: instant,
      instant: epochMillis(base + instant),
      price: logPrice(price),
    });
    const sparse = [t(60_000, 0), t(28 * 60_000 + 1, 80)];
    expect(medianCandleRange(sparse).minutes).toBeGreaterThanOrEqual(MIN_RECORD_MINUTES);
    expect(medianCandleRange(sparse).tradedMinutes).toBe(0);
    expect(recordWindow(sparse, base + 29 * 60_000)).toEqual([]);
  });

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
    expect(medianCandleRange(ticks)).toEqual({ range: 80, minutes: 3, tradedMinutes: 3 });
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

describe('which half hour the unit was cut from (Cycle Audit 8, a5)', () => {
  const now = 1_776_000_000_000;
  /** A minute of ticks whose range is `range`, starting at `start`. */
  const minute = (start: number, range: number, sequence: number): Tick[] => [
    tick(sequence, start + 1_000, 0),
    tick(sequence + 1, start + 30_000, range),
    tick(sequence + 2, start + 50_000, 0),
  ];
  const half = (from: number, range: number, sequence: number): Tick[] =>
    Array.from({ length: 30 }, (_, i) => minute(from + i * 60_000, range, sequence + i * 3)).flat();

  it('takes the record window from the instants, not from what retention happens to hold', () => {
    // The retained window is a tick count, so the market time it covers depends
    // on the tempo (PH-24.17). The measurement must not.
    const ticks = [
      ...half(now - 4 * MEASUREMENT_SPAN_MS, 40, 1),
      ...half(now - 30 * 60_000, 40, 1000),
    ];
    const window = recordWindow(ticks, now);
    expect(window).toHaveLength(90);
    expect(window[0]!.instant).toBeGreaterThanOrEqual(now - MEASUREMENT_SPAN_MS);
    expect(window[window.length - 1]!.instant).toBeLessThanOrEqual(now);
    expect(recordWindow([], now)).toEqual([]);
  });

  it('gives nothing back when the record is too short to hold a median', () => {
    // A market minutes old, or one whose retained window was evicted: three
    // complete minutes is not a half hour, and the caller has to know that
    // rather than be handed a unit cut from three candles.
    const thin = [minute(now - 240_000, 40, 1), minute(now - 180_000, 40, 4)].flat();
    expect(recordWindow(thin, now)).toEqual([]);
  });

  it('says whether it measured the record or a fork, from the ticks themselves', () => {
    const past = distanceUnitFrom(ASSET_CATALOGUE[0]!, 0, half(now - 30 * 60_000, 40, 1), now);
    const future = distanceUnitFrom(ASSET_CATALOGUE[0]!, 0, half(now, 40, 1), now);
    expect(past.basis).toBe('record');
    expect(future.basis).toBe('fork');
    // Nothing to measure is nothing to claim about; the unit falls back to one step.
    expect(distanceUnitFrom(ASSET_CATALOGUE[0]!, 0, [], now).basis).toBe('record');
  });

  it('cuts a different unit from a quiet half hour than from a violent one', () => {
    // Why the basis matters rather than being bookkeeping: this is the same
    // market, half an hour apart, and «+3 unidades» means four times as much
    // price on one side of `now` as on the other.
    const quiet = distanceUnitFrom(ASSET_CATALOGUE[0]!, 0, half(now - 30 * 60_000, 40, 1), now);
    const violent = distanceUnitFrom(ASSET_CATALOGUE[0]!, 0, half(now, 160, 1), now);
    expect(quiet.unitSteps).toBe(10);
    expect(violent.unitSteps).toBe(40);
    expect(quiet.minutes).toBe(violent.minutes);
  });
});
