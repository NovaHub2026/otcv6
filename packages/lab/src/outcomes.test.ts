import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  logPrice,
  MasterKeyring,
  type InstrumentSpec,
  type Tick,
} from '@otc/core';
import { BINARY_HORIZONS } from './horizons.js';
import { datasetFromTicks, type ObserverDataset } from './observer.js';
import { defaultStrideMs, PHASE_SWEEP_OFFSET_MS, sampleOutcomes, upRate } from './outcomes.js';
import { buildFeatureFrame } from './attacks/frame.js';
import { familiesOfKind } from './attacks/registry.js';

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
    expect(sampling.strideMs).toBe(60_000 + PHASE_SWEEP_OFFSET_MS);
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

describe('the look-ahead rule, on ticks whose answer is known in advance (a4-03)', () => {
  /**
   * Thirteen ticks, ten seconds apart. Thirty-second contracts opened on the
   * clock at 0, 30, 60 and 90 s enter at ticks 0, 3, 6 and 9 and settle at
   * ticks 3, 6, 9 and 12. Every index is fixed by construction, so nothing here
   * is derived from the code under test.
   *
   * **Out-of-band audit, a4-03.** The two tests above pin the entry *index* and
   * the ordering of the expiry index; neither pins which *price* an outcome is
   * computed from. The auditor planted `prices[entryIndex - 1]` as the entry
   * price — the forward window then includes the conditioning tick's own move,
   * the exact shape of the PH-1 z > 1000 bug — and fifty-nine unit tests passed.
   * The project's founding cautionary tale had no guard in the layer that runs
   * on every subphase; only the three-minute statistical files would have seen
   * it, and only in the direction that produces alarming numbers.
   */
  const PRICES = [100, 101, 99, 100, 102, 98, 100, 100, 103, 97, 100, 101, 99];
  const SPACING_MS = 10_000;
  const THIRTY_SECONDS = durationMillis(30_000);
  /** Entries on the horizon itself, so the fourth contract still fits the data. */
  const ON_THE_HORIZON = { strideMs: 30_000 };

  function handBuilt(
    prices: readonly number[],
    instantOf: (index: number) => number = (index) => START + index * SPACING_MS,
  ): ObserverDataset {
    return datasetFromTicks(
      instrument,
      prices.map((price, index) => ({
        instant: epochMillis(instantOf(index)),
        sequence: index + 1,
        price: logPrice(price),
      })),
    );
  }

  it('enters at the tick that sets the entry price and settles at the last tick at or before expiry', () => {
    const sampling = sampleOutcomes(handBuilt(PRICES), THIRTY_SECONDS, ON_THE_HORIZON);
    expect([...sampling.entryIndices]).toEqual([0, 3, 6, 9]);
    // 100 -> 100 tie, 100 -> 100 tie, 100 -> 97 down, 97 -> 99 up.
    expect([...sampling.outcomes]).toEqual([0, 0, -1, 1]);
    expect(sampling.up).toBe(1);
    expect(sampling.down).toBe(1);
    expect(sampling.ties).toBe(2);
  });

  it('moves with the entry tick and not with its predecessor', () => {
    // Lower the entry tick of the third contract (index 6) from 100 to 96: that
    // contract now settles up (97 > 96), and the second, which expires on that
    // same tick, settles down (96 < 100).
    const entryMoved = [...PRICES];
    entryMoved[6] = 96;
    expect([
      ...sampleOutcomes(handBuilt(entryMoved), THIRTY_SECONDS, ON_THE_HORIZON).outcomes,
    ]).toEqual([0, -1, 1, 1]);

    // Move the tick *before* that entry (index 5) instead. No contract enters or
    // settles there, so nothing may change — the planted `prices[entryIndex - 1]`
    // would have settled the third contract against it.
    const predecessorMoved = [...PRICES];
    predecessorMoved[5] = 90;
    expect([
      ...sampleOutcomes(handBuilt(predecessorMoved), THIRTY_SECONDS, ON_THE_HORIZON).outcomes,
    ]).toEqual([0, 0, -1, 1]);
  });

  it('counts a tick exactly at the expiry instant, and not one a millisecond later', () => {
    // Tick 9 (price 97) sits on the expiry of the third contract and the entry
    // of the fourth. Shift it by one millisecond either way.
    const shifted = (byMs: number): ObserverDataset =>
      handBuilt(PRICES, (index) => START + index * SPACING_MS + (index === 9 ? byMs : 0));

    // A millisecond early is still at-or-before: nothing changes.
    expect([...sampleOutcomes(shifted(-1), THIRTY_SECONDS, ON_THE_HORIZON).outcomes]).toEqual([
      0, 0, -1, 1,
    ]);

    // A millisecond late: the third contract settles on tick 8 instead (103 >
    // 100, up), and the fourth enters on tick 8 too, settling down on tick 12.
    const late = sampleOutcomes(shifted(1), THIRTY_SECONDS, ON_THE_HORIZON);
    expect([...late.entryIndices]).toEqual([0, 3, 6, 8]);
    expect([...late.outcomes]).toEqual([0, 0, 1, -1]);
  });
});

describe('every sample agrees with a linear scan of the record (a4-03)', () => {
  /**
   * A forty-thousand-tick walk with flats and irregular arrivals, so entries fall
   * between ticks and ties occur. For every horizon the product sells and both
   * entry modes, the entry index, the expiry index and the outcome are recomputed
   * by a forward scan that shares nothing with `priceAtOrBefore`.
   */
  const TICKS = 40_000;

  function walkWithFlats(): ObserverDataset {
    const stream = MasterKeyring.forTesting('outcomes-linear-scan').derive({
      env: 'test',
      asset: 'walk',
      purpose: 'ticks',
      keyEpoch: 0,
    });
    const ticks: Tick[] = [];
    let instant = START;
    let price = 0;
    for (let i = 0; i < TICKS; i += 1) {
      instant += 1 + stream.nextBoundedUint32(3_000);
      // -1, 0 or +1: a third of the ticks are flat, so ties happen.
      price += stream.nextBoundedUint32(3) - 1;
      ticks.push({ instant: epochMillis(instant), sequence: i + 1, price: logPrice(price) });
    }
    return datasetFromTicks(instrument, ticks);
  }

  const dataset = walkWithFlats();

  /** Last index whose instant is at or before `t`, scanning forward from a cursor. */
  function scanTo(cursor: number, t: number): number {
    let index = cursor;
    while (index + 1 < dataset.tickCount && dataset.instants[index + 1]! <= t) index += 1;
    return index;
  }

  const cases = BINARY_HORIZONS.flatMap((horizon) =>
    (['clock', 'tick'] as const).map((mode) => [horizon.label, mode, horizon.durationMs] as const),
  );

  it.each(cases)('at %s, entering on the %s grid', (_label, entryMode, horizonMs) => {
    const sampling = sampleOutcomes(dataset, horizonMs, { entryMode });
    expect(sampling.entryIndices.length).toBeGreaterThan(10);

    // Counted inside the loop and asserted once after it: a failure then names
    // how many samples disagree rather than stopping at the first.
    const disagreements: string[] = [];
    let entryCursor = 0;
    let expiryCursor = 0;
    let decided = 0;
    for (let s = 0; s < sampling.entryIndices.length; s += 1) {
      const t = sampling.entryInstants[s]!;
      const entry = scanTo(entryCursor, t);
      const expiry = scanTo(expiryCursor, t + horizonMs);
      entryCursor = entry;
      expiryCursor = expiry;
      const outcome = Math.sign(dataset.prices[expiry]! - dataset.prices[entry]!);
      if (sampling.entryIndices[s] !== entry) {
        disagreements.push(`sample ${s}: entry index ${sampling.entryIndices[s]} != ${entry}`);
      }
      if (sampling.outcomes[s] !== outcome) {
        disagreements.push(`sample ${s}: outcome ${sampling.outcomes[s]} != ${outcome}`);
      }
      if (outcome !== 0) {
        decided += 1;
        // A decided outcome must come from a strictly later tick than the entry,
        // at or before the expiry instant.
        if (expiry <= entry || dataset.instants[expiry]! <= t) {
          disagreements.push(`sample ${s}: expiry index ${expiry} is not after entry ${entry}`);
        }
        if (dataset.instants[expiry]! > t + horizonMs) {
          disagreements.push(`sample ${s}: expiry tick is after the expiry instant`);
        }
      }
    }
    expect(disagreements).toEqual([]);
    expect(decided).toBe(sampling.decided);
  });
});

describe('the clock grid sweeps every phase of every temporal grid (a4-02)', () => {
  /**
   * Every grid a temporal family conditions on, in milliseconds: the sixths of a
   * minute and of an hour, the quarters of the 15-minute grid, and the three
   * block sizes of the digest families.
   */
  const TEMPORAL_GRIDS_MS = [15_000, 60_000, 225_000, 300_000, 600_000, 900_000, 3_600_000];
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

  it('uses a stride coprime to every grid on the one-second lattice, at every horizon', () => {
    // The arithmetic behind the sweep, asserted rather than trusted: with the
    // stride and the grid sharing no factor beyond the second, the phase
    // `k * stride mod grid` walks every residue before repeating.
    const shared: string[] = [];
    for (const horizon of BINARY_HORIZONS) {
      for (const grid of TEMPORAL_GRIDS_MS) {
        if (gcd(defaultStrideMs(horizon.durationMs), grid) !== 1_000) {
          shared.push(`${horizon.label} against a ${grid / 1000}s grid`);
        }
      }
    }
    expect(shared).toEqual([]);
    // And the old default — the horizon itself — shares the whole minute with
    // every horizon that divides it, which is the aliasing the offset removes.
    expect(gcd(60_000, 60_000)).toBe(60_000);
  });

  /** Forty-five days at one tick every thirty seconds: 1.2 sweeps of the slowest grid at 15 m. */
  const DAYS = 45;
  const TICK_MS = 30_000;
  const dataset = datasetFromTicks(
    instrument,
    Array.from({ length: (DAYS * 86_400_000) / TICK_MS }, (_, i) => ({
      instant: epochMillis(START + i * TICK_MS),
      sequence: i + 1,
      price: logPrice(i % 7),
    })),
  );
  const frame = buildFeatureFrame(dataset);
  const temporal = familiesOfKind('temporal');

  function occupancy(
    family: (typeof temporal)[number],
    entryIndices: Int32Array,
    entryInstants: Float64Array,
  ): number[] {
    const counts = new Array<number>(family.buckets).fill(0);
    for (let s = 0; s < entryIndices.length; s += 1) {
      const bucket = family.bucket(frame, entryIndices[s]!, epochMillis(entryInstants[s]!));
      if (bucket >= 0) counts[bucket]! += 1;
    }
    return counts;
  }

  it.each(BINARY_HORIZONS.map((h) => [h.label, h.durationMs] as const))(
    'at %s every temporal bucket receives entries, and the sixths of the minute receive equal shares',
    (_label, horizonMs) => {
      const sampling = sampleOutcomes(dataset, horizonMs);
      const empty: string[] = [];
      const uneven: string[] = [];
      for (const family of temporal) {
        const counts = occupancy(family, sampling.entryIndices, sampling.entryInstants);
        counts.forEach((count, bucket) => {
          if (count === 0) empty.push(`${family.name} bucket ${bucket}`);
        });
        if (family.name === 'second-of-minute') {
          // The minute is swept in sixty entries, so its sixths are equal to
          // within a cycle at every horizon — this is the family the audit
          // found testing one phase in six.
          const share = 1 / family.buckets;
          counts.forEach((count, bucket) => {
            const observed = count / sampling.entryIndices.length;
            if (Math.abs(observed - share) > 0.2 * share) {
              uneven.push(`${family.name} bucket ${bucket}: ${observed.toFixed(3)}`);
            }
          });
        }
      }
      expect(empty).toEqual([]);
      expect(uneven).toEqual([]);
    },
  );

  it('with the horizon itself as the stride, a one-minute contract sees one sixth of the minute', () => {
    // The control for the test above: the aliasing the offset exists to
    // remove, reproduced on demand so the sweep assertion is known to have
    // teeth.
    const aliased = sampleOutcomes(dataset, MINUTE, { strideMs: 60_000 });
    const family = temporal.find((f) => f.name === 'second-of-minute')!;
    const counts = occupancy(family, aliased.entryIndices, aliased.entryInstants);
    expect(counts.filter((count) => count > 0)).toHaveLength(1);
  });
});
