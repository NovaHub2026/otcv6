import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, logPrice, type InstrumentSpec, type Tick } from '@otc/core';
import { datasetFromTicks } from './observer.js';
import { sampleOutcomes, upRate } from './outcomes.js';

const instrument: InstrumentSpec = {
  id: 'out-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const START = 1_776_000_000_000;

/** One tick per second, price rising by one step per tick. */
function risingTicks(count: number): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    instant: epochMillis(START + i * 1_000),
    sequence: i + 1,
    price: logPrice(i),
  }));
}

/** One tick per second, price never moving: every outcome is a tie. */
function flatTicks(count: number): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    instant: epochMillis(START + i * 1_000),
    sequence: i + 1,
    price: logPrice(0),
  }));
}

const MINUTE = durationMillis(60_000);

describe('wall-clock horizons', () => {
  it('measures the outcome over elapsed time, not a tick count', () => {
    // Two datasets with the same price path but different tick rates must give
    // the same 60-second outcome. A tick-count horizon would not.
    const slow = datasetFromTicks(instrument, risingTicks(600));
    const dense = datasetFromTicks(
      instrument,
      Array.from({ length: 6_000 }, (_, i) => ({
        instant: epochMillis(START + i * 100),
        sequence: i + 1,
        price: logPrice(Math.floor(i / 10)),
      })),
    );
    const a = sampleOutcomes(slow, MINUTE);
    const b = sampleOutcomes(dense, MINUTE);
    expect(upRate(a)).toBe(1);
    expect(upRate(b)).toBe(1);
    expect(a.decided).toBe(b.decided);
  });

  it('detects a monotone rise as all-up', () => {
    const dataset = datasetFromTicks(instrument, risingTicks(1_200));
    const sampling = sampleOutcomes(dataset, MINUTE);
    expect(sampling.up).toBe(sampling.decided);
    expect(sampling.down).toBe(0);
    expect(upRate(sampling)).toBe(1);
  });

  it('counts a flat market entirely as ties', () => {
    const dataset = datasetFromTicks(instrument, flatTicks(1_200));
    const sampling = sampleOutcomes(dataset, MINUTE);
    expect(sampling.decided).toBe(0);
    expect(sampling.ties).toBeGreaterThan(15);
    // Ties are void and refunded, so they decide nothing either way.
    expect(upRate(sampling)).toBe(0.5);
  });
});

describe('sampling geometry', () => {
  const dataset = datasetFromTicks(instrument, risingTicks(3_600));

  it('is non-overlapping by default', () => {
    const sampling = sampleOutcomes(dataset, MINUTE);
    expect(sampling.strideMs).toBe(60_000);
    expect(sampling.overlapping).toBe(false);
    for (let i = 1; i < sampling.entryInstants.length; i += 1) {
      expect(sampling.entryInstants[i]! - sampling.entryInstants[i - 1]!).toBeGreaterThanOrEqual(
        60_000,
      );
    }
  });

  it('flags overlap when asked for it', () => {
    const sampling = sampleOutcomes(dataset, MINUTE, { strideMs: 1_000 });
    expect(sampling.overlapping).toBe(true);
    expect(sampling.decided).toBeGreaterThan(3_000);
  });

  it('never samples an expiry beyond the data', () => {
    const sampling = sampleOutcomes(dataset, MINUTE);
    const last = sampling.entryInstants[sampling.entryInstants.length - 1]!;
    expect(last + 60_000).toBeLessThanOrEqual(dataset.lastInstant);
  });

  it('reports what it skipped', () => {
    const sampling = sampleOutcomes(dataset, MINUTE);
    expect(sampling.skipped.beyondLastTick).toBeGreaterThan(0);
    expect(sampling.skipped.beforeFirstTick).toBe(0);
  });

  it('reports when a cap binds, rather than silently truncating', () => {
    // A truncated run that presents as complete coverage is the same failure as
    // a look-ahead bug, one level up.
    const sampling = sampleOutcomes(dataset, MINUTE, { maxSamples: 5 });
    expect(sampling.entryIndices).toHaveLength(5);
    expect(sampling.skipped.overCap).toBeGreaterThan(0);
  });

  it('honours a warm-up span', () => {
    const sampling = sampleOutcomes(dataset, MINUTE, { warmupMs: 600_000 });
    expect(sampling.entryInstants[0]).toBeGreaterThanOrEqual(dataset.firstInstant + 600_000);
  });

  it('supports entries on the tick grid', () => {
    const sampling = sampleOutcomes(dataset, MINUTE, { entryMode: 'tick' });
    expect(sampling.entryMode).toBe('tick');
    for (const index of sampling.entryIndices) {
      expect(dataset.instants[index]).toBe(
        sampling.entryInstants[sampling.entryIndices.indexOf(index)],
      );
    }
  });

  it('rejects malformed parameters', () => {
    expect(() => sampleOutcomes(dataset, durationMillis(1), { strideMs: 0 })).toThrow(RangeError);
    expect(() => sampleOutcomes(dataset, durationMillis(1), { warmupMs: -1 })).toThrow(RangeError);
    expect(() => sampleOutcomes(dataset, -1 as never)).toThrow(RangeError);
  });
});

describe('the look-ahead rule', () => {
  it('reports an entry index whose tick is at or before the entry instant', () => {
    // A feature may read prices[0..entryIndex] inclusive: at the moment of
    // entry, that tick has already happened. Anything later is the answer.
    const dataset = datasetFromTicks(instrument, risingTicks(3_600));
    const sampling = sampleOutcomes(dataset, MINUTE);
    for (let i = 0; i < sampling.entryIndices.length; i += 1) {
      const index = sampling.entryIndices[i]!;
      expect(dataset.instants[index]!).toBeLessThanOrEqual(sampling.entryInstants[i]!);
      if (index + 1 < dataset.tickCount) {
        expect(dataset.instants[index + 1]!).toBeGreaterThan(sampling.entryInstants[i]!);
      }
    }
  });

  it('takes the expiry price strictly after the entry instant', () => {
    const dataset = datasetFromTicks(instrument, risingTicks(3_600));
    const sampling = sampleOutcomes(dataset, MINUTE);
    for (let i = 0; i < sampling.entryInstants.length; i += 1) {
      const entryInstant = sampling.entryInstants[i]!;
      const expiry = dataset.priceAt(epochMillis(entryInstant + 60_000))!;
      const entry = dataset.priceAt(epochMillis(entryInstant))!;
      expect(expiry.index).toBeGreaterThan(entry.index);
    }
  });
});
