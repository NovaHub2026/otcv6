import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type InstrumentSpec, type Tick } from '@otc/core';
import { datasetFromTicks } from '../observer.js';
import {
  buildFeatureFrame,
  EFFICIENCY_WINDOW,
  lastCompletedMinute as frameMinute,
  RANGE_WINDOW,
  RUN_CAP,
  VOLATILITY_WINDOW,
} from './frame.js';
import {
  efficiencyRatio,
  lastCompletedMinute as naiveMinute,
  positionInRange,
  realizedVolatility,
  runLength,
  previousMoveSign,
} from './features.js';

/**
 * The rolling implementations are an optimisation of the naive ones in
 * `features.ts`. An optimisation that changes an answer is a defect, and sliding
 * windows are exactly where that happens, so the two are compared directly.
 */

const instrument: InstrumentSpec = {
  id: 'frame-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

function ticks(count: number): Tick[] {
  const stream = MasterKeyring.forTesting('frame-spec').derive({
    env: 'test',
    asset: 'frame',
    purpose: 'walk',
    keyEpoch: 0,
  });
  const out: Tick[] = [];
  let price = 0;
  let instant = 1_776_000_000_000;
  for (let i = 0; i < count; i += 1) {
    instant += 1 + stream.nextBoundedUint32(2_000);
    // Includes flat ticks, which is where run-length logic breaks if it is wrong.
    price += stream.nextBoundedUint32(9) - 4;
    out.push({ instant: epochMillis(instant), sequence: i + 1, price: logPrice(price) });
  }
  return out;
}

const list = ticks(30_000);
const dataset = datasetFromTicks(instrument, list);
const frame = buildFeatureFrame(dataset);

describe('rolling features match the naive implementations', () => {
  it('volatility', () => {
    let compared = 0;
    for (let i = 0; i < dataset.tickCount; i += 1) {
      const naive = realizedVolatility(dataset, i, VOLATILITY_WINDOW);
      if (i < VOLATILITY_WINDOW) {
        expect(Number.isNaN(frame.volatility[i]!)).toBe(true);
        continue;
      }
      expect(frame.volatility[i]!).toBeCloseTo(naive!, 4);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(29_000);
  });

  it('efficiency ratio', () => {
    let compared = 0;
    for (let i = EFFICIENCY_WINDOW; i < dataset.tickCount; i += 1) {
      const naive = efficiencyRatio(dataset, i, EFFICIENCY_WINDOW);
      if (naive === null) {
        expect(Number.isNaN(frame.efficiency[i]!)).toBe(true);
        continue;
      }
      expect(frame.efficiency[i]!, `index ${i}`).toBeCloseTo(naive, 5);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(28_000);
  });

  it('range position, which uses monotonic deques for the sliding extrema', () => {
    let compared = 0;
    for (let i = RANGE_WINDOW; i < dataset.tickCount; i += 1) {
      const naive = positionInRange(dataset, i, RANGE_WINDOW);
      if (naive === null) {
        expect(Number.isNaN(frame.rangePosition[i]!)).toBe(true);
        continue;
      }
      expect(frame.rangePosition[i]!, `index ${i}`).toBeCloseTo(naive, 5);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(28_000);
  });

  it('signed run length, including flat ticks', () => {
    let flatSeen = 0;
    for (let i = 1; i < dataset.tickCount; i += 1) {
      const length = runLength(dataset, i, RUN_CAP);
      const direction = previousMoveSign(dataset, i);
      const expected = direction === -1 ? 0 : (direction === 1 ? 1 : -1) * length;
      if (expected === 0) flatSeen += 1;
      expect(frame.signedRun[i]!, `index ${i}`).toBe(expected);
    }
    expect(flatSeen).toBeGreaterThan(100);
  });

  it('last completed minute', () => {
    let compared = 0;
    let nulls = 0;
    for (let i = 0; i < dataset.tickCount; i += 37) {
      const instant = epochMillis(dataset.instants[i]!);
      const naive = naiveMinute(dataset, i, instant);
      const rolling = frameMinute(frame, instant);
      if (naive === null) {
        nulls += 1;
        continue;
      }
      expect(rolling, `index ${i}`).toEqual(naive);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(500);
    expect(nulls).toBeLessThan(compared);
  });
});

describe('the frame never looks ahead', () => {
  it('depends only on prices up to each index', () => {
    // Truncating the dataset must not change any feature at a surviving index.
    // If a rolling accumulator ever read forward, this would catch it.
    const cut = 12_000;
    const truncated = buildFeatureFrame(datasetFromTicks(instrument, list.slice(0, cut)));
    for (let i = 0; i < cut; i += 1) {
      if (Number.isNaN(frame.volatility[i]!)) {
        expect(Number.isNaN(truncated.volatility[i]!)).toBe(true);
      } else {
        expect(truncated.volatility[i]!, `volatility at ${i}`).toBe(frame.volatility[i]!);
      }
      expect(truncated.signedRun[i]!, `run at ${i}`).toBe(frame.signedRun[i]!);
    }
  });
});

describe('frame construction is linear', () => {
  it('handles a large dataset quickly', () => {
    const big = datasetFromTicks(instrument, ticks(200_000));
    const started = process.hrtime.bigint();
    const built = buildFeatureFrame(big);
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    expect(built.volatility).toHaveLength(200_000);
    // Generous: the point is that it is linear, not that it hits a target.
    expect(seconds).toBeLessThan(5);
  });
});
