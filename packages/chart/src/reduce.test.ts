// Invariant evidence: INV-004 (timeframe observer independence).
import { describe, expect, it } from 'vitest';
import { epochMillis } from '@otc/core/browser';
import { reduceToColumns, windowExtremes } from './reduce.js';

/** A deterministic jagged path: this must never depend on a lucky draw. */
function path(count: number): { instants: Float64Array; prices: Int32Array } {
  const instants = new Float64Array(count);
  const prices = new Int32Array(count);
  let value = 0;
  for (let i = 0; i < count; i += 1) {
    value += Math.round(Math.sin(i * 2.399) * 40) + Math.round(Math.cos(i * 0.77) * 9);
    instants[i] = 1_000_000 + i * 250;
    prices[i] = value;
  }
  return { instants, prices };
}

const FROM = epochMillis(1_000_000);

describe('the reduction never invents a price', () => {
  it('draws exactly the observed values of each slice, recomputed independently', () => {
    // Set membership is too weak here, and an earlier version of this test used
    // it: with 20,000 ticks the observed price set is dense, so an interpolated
    // value lands on *some* traded price often enough that planting an averaging
    // defect did not fail the test written to catch it.
    //
    // The exact property is that each column's four values are the first,
    // maximum, minimum and last of the ticks inside its own time range —
    // recomputed here straight from the record, not from the reduction.
    const { instants, prices } = path(20_000);
    const to = epochMillis(instants[instants.length - 1]! + 1);

    for (const columns of [37, 400, 1_600]) {
      const reduced = reduceToColumns(instants, prices, { from: FROM, to, columns });
      expect(reduced.length).toBeGreaterThan(1);
      for (const column of reduced) {
        const inside: number[] = [];
        for (let i = 0; i < instants.length; i += 1) {
          if (instants[i]! >= column.fromInstant && instants[i]! < column.toInstant) {
            inside.push(prices[i]!);
          }
        }
        expect(inside.length, 'column claims ticks it does not contain').toBe(column.tickCount);
        expect(column.open, 'open is not the first observed price of the slice').toBe(inside[0]);
        expect(column.close, 'close is not the last observed price of the slice').toBe(
          inside[inside.length - 1],
        );
        expect(column.high).toBe(Math.max(...inside));
        expect(column.low).toBe(Math.min(...inside));
      }
    }
  });

  it('never emits a column for a slice with no ticks', () => {
    // A flat bar across an empty period asserts a trade that did not happen.
    const instants = new Float64Array([1_000_000, 1_000_100, 1_900_000, 1_900_100]);
    const prices = Int32Array.from([10, 20, 30, 40]);
    const reduced = reduceToColumns(instants, prices, {
      from: FROM,
      to: epochMillis(2_000_000),
      columns: 10,
    });
    // Ticks occupy the first and last tenths only; the eight empty slices in
    // between must simply not exist.
    expect(reduced).toHaveLength(2);
    for (const column of reduced) expect(column.tickCount).toBeGreaterThan(0);
  });
});

describe('the reduction never hides an extreme', () => {
  it('preserves the window high and low at every resolution', () => {
    // Taking the first tick per column, or every Nth, loses spikes — and a spike
    // is usually what the viewer is looking at.
    const { instants, prices } = path(50_000);
    const to = epochMillis(instants[instants.length - 1]! + 1);
    const truth = windowExtremes(instants, prices, FROM, to)!;

    for (const columns of [1, 13, 200, 800, 5_000]) {
      const reduced = reduceToColumns(instants, prices, { from: FROM, to, columns });
      const high = Math.max(...reduced.map((c) => c.high));
      const low = Math.min(...reduced.map((c) => c.low));
      expect(high, `high lost at ${columns} columns`).toBe(truth.high);
      expect(low, `low lost at ${columns} columns`).toBe(truth.low);
    }
  });

  it('accounts for every tick in the window exactly once', () => {
    const { instants, prices } = path(30_000);
    const to = epochMillis(instants[instants.length - 1]! + 1);
    const truth = windowExtremes(instants, prices, FROM, to)!;
    for (const columns of [7, 512, 3_000]) {
      const reduced = reduceToColumns(instants, prices, { from: FROM, to, columns });
      const counted = reduced.reduce((sum, c) => sum + c.tickCount, 0);
      expect(counted, `${columns} columns dropped or double-counted ticks`).toBe(truth.count);
    }
  });

  it('keeps a lone spike that a sampling reduction would discard', () => {
    // Constructed so naive sampling provably fails: 5,000 flat ticks with one
    // spike in the middle, reduced to 10 columns.
    const instants = new Float64Array(5_000);
    const prices = new Int32Array(5_000);
    for (let i = 0; i < 5_000; i += 1) {
      instants[i] = 1_000_000 + i * 100;
      prices[i] = 100;
    }
    // Deliberately NOT on a sampling boundary: index 2,500 would be hit by an
    // every-500th sampler, and the control below would then pass for the wrong
    // reason. The first version of this test made exactly that mistake.
    prices[2_537] = 999_999;

    const reduced = reduceToColumns(instants, prices, {
      from: FROM,
      to: epochMillis(1_000_000 + 5_000 * 100),
      columns: 10,
    });
    expect(Math.max(...reduced.map((c) => c.high))).toBe(999_999);

    // The control: every-Nth sampling misses it, which is what makes this a real
    // property rather than a restatement of the implementation.
    const sampled: number[] = [];
    for (let i = 0; i < 5_000; i += 500) sampled.push(prices[i]!);
    expect(Math.max(...sampled)).toBe(100);
  });
});

describe('open and close are the ends of the slice, not of the data', () => {
  it('carries the first and last observed price of each column', () => {
    const { instants, prices } = path(4_000);
    const to = epochMillis(instants[instants.length - 1]! + 1);
    const reduced = reduceToColumns(instants, prices, { from: FROM, to, columns: 8 });
    expect(reduced.length).toBeGreaterThan(1);
    expect(reduced[0]!.open).toBe(prices[0]);
    expect(reduced[reduced.length - 1]!.close).toBe(prices[prices.length - 1]);
    for (const column of reduced) {
      expect(column.high).toBeGreaterThanOrEqual(column.open);
      expect(column.high).toBeGreaterThanOrEqual(column.close);
      expect(column.low).toBeLessThanOrEqual(column.open);
      expect(column.low).toBeLessThanOrEqual(column.close);
    }
  });

  it('is contiguous: each column ends where the next begins', () => {
    const { instants, prices } = path(10_000);
    const to = epochMillis(instants[instants.length - 1]! + 1);
    const reduced = reduceToColumns(instants, prices, { from: FROM, to, columns: 64 });
    for (let i = 1; i < reduced.length; i += 1) {
      expect(reduced[i]!.fromInstant).toBeGreaterThanOrEqual(reduced[i - 1]!.toInstant);
    }
  });
});

describe('changing the resolution does not change the market (INV-004)', () => {
  it('agrees with itself across resolutions on what happened', () => {
    // The rendered analogue of timeframe independence: a viewer who zooms must
    // not be shown a different market, only a coarser view of the same one.
    const { instants, prices } = path(40_000);
    const to = epochMillis(instants[instants.length - 1]! + 1);
    const coarse = reduceToColumns(instants, prices, { from: FROM, to, columns: 20 });
    const fine = reduceToColumns(instants, prices, { from: FROM, to, columns: 2_000 });

    for (const column of coarse) {
      const inside = fine.filter(
        (f) => f.fromInstant >= column.fromInstant && f.toInstant <= column.toInstant,
      );
      if (inside.length === 0) continue;
      expect(Math.max(...inside.map((f) => f.high))).toBe(column.high);
      expect(Math.min(...inside.map((f) => f.low))).toBe(column.low);
    }
  });
});

describe('it refuses nonsense rather than guessing', () => {
  it('rejects an empty or inverted window', () => {
    const { instants, prices } = path(100);
    expect(() => reduceToColumns(instants, prices, { from: FROM, to: FROM, columns: 10 })).toThrow(
      RangeError,
    );
    expect(() =>
      reduceToColumns(instants, prices, { from: epochMillis(2_000_000), to: FROM, columns: 10 }),
    ).toThrow(RangeError);
  });

  it('rejects a nonsensical column count', () => {
    const { instants, prices } = path(100);
    const to = epochMillis(1_100_000);
    expect(() => reduceToColumns(instants, prices, { from: FROM, to, columns: 0 })).toThrow(
      RangeError,
    );
  });

  it('returns nothing for a window with no data', () => {
    const { instants, prices } = path(100);
    expect(
      reduceToColumns(instants, prices, {
        from: epochMillis(9_000_000),
        to: epochMillis(9_100_000),
        columns: 10,
      }),
    ).toEqual([]);
  });
});
