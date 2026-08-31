// Invariant evidence: INV-004 (timeframe observer independence).
import { describe, expect, it } from 'vitest';
import { epochMillis, MAX_EPOCH_MILLIS, type EpochMillis } from './instant.js';
import {
  allTimeframes,
  bucketEnd,
  bucketIndex,
  bucketStart,
  isCoarserOrEqual,
  isTimeframeId,
  nestingFactor,
  nests,
  timeframe,
  TIMEFRAME_IDS,
} from './timeframe.js';

const TFS = allTimeframes();

/** Deterministic instants spanning ordinary and adversarial positions. */
function sampleInstants(): EpochMillis[] {
  const anchors = [
    0,
    1,
    999,
    1_000,
    86_399_999,
    86_400_000, // exact day boundary
    1_776_000_000_000,
    1_776_000_000_001,
    1_776_000_000_000 - 1,
    1_800_000_000_000,
  ];
  const generated: number[] = [];
  let state = 123_456_789;
  for (let i = 0; i < 400; i += 1) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    generated.push(1_700_000_000_000 + (state % 100_000_000));
  }
  return [...anchors, ...generated].map(epochMillis);
}

describe('timeframe catalogue', () => {
  it('is ordered strictly from finest to coarsest', () => {
    for (let i = 1; i < TFS.length; i += 1) {
      expect(TFS[i]!.durationMs).toBeGreaterThan(TFS[i - 1]!.durationMs);
    }
  });

  it('forms a divisibility chain: each duration divides the next', () => {
    for (let i = 1; i < TFS.length; i += 1) {
      expect(TFS[i]!.durationMs % TFS[i - 1]!.durationMs, `${TFS[i]!.id} / ${TFS[i - 1]!.id}`).toBe(
        0,
      );
    }
  });

  it('nests across every ordered pair, not merely adjacent ones', () => {
    for (let i = 0; i < TFS.length; i += 1) {
      for (let j = i; j < TFS.length; j += 1) {
        expect(nests(TFS[i]!, TFS[j]!), `${TFS[i]!.id} in ${TFS[j]!.id}`).toBe(true);
        expect(nestingFactor(TFS[i]!, TFS[j]!)).toBe(TFS[j]!.durationMs / TFS[i]!.durationMs);
      }
    }
  });

  it('exposes every declared id', () => {
    expect(TFS.map((t) => t.id)).toEqual([...TIMEFRAME_IDS]);
    for (const id of TIMEFRAME_IDS) expect(timeframe(id).id).toBe(id);
  });

  it('recognises only declared ids', () => {
    expect(isTimeframeId('1m')).toBe(true);
    for (const bad of ['1w', '1M', '2m', '', '60s', '1S']) expect(isTimeframeId(bad)).toBe(false);
  });

  it('has frozen, immutable descriptors', () => {
    expect(Object.isFrozen(timeframe('1m'))).toBe(true);
    expect(timeframe('1m')).toBe(timeframe('1m'));
  });

  it('excludes week and month, whose lengths do not divide a fixed grid', () => {
    expect(TIMEFRAME_IDS).not.toContain('1w');
    expect(TIMEFRAME_IDS).not.toContain('1M');
  });
});

describe('bucket alignment', () => {
  const instants = sampleInstants();

  it('is idempotent', () => {
    for (const tf of TFS) {
      for (const t of instants) {
        const start = bucketStart(t, tf);
        expect(bucketStart(start, tf)).toBe(start);
      }
    }
  });

  it('places the instant inside its own bucket', () => {
    for (const tf of TFS) {
      for (const t of instants) {
        expect(bucketStart(t, tf)).toBeLessThanOrEqual(t);
        expect(bucketEnd(t, tf)).toBeGreaterThan(t);
        expect(bucketEnd(t, tf) - bucketStart(t, tf)).toBe(tf.durationMs);
      }
    }
  });

  it('is aligned to the Unix epoch', () => {
    for (const tf of TFS) {
      for (const t of instants) {
        expect(bucketStart(t, tf) % tf.durationMs).toBe(0);
      }
    }
  });

  it('nests exactly: coarsening a fine bucket start equals coarsening the instant', () => {
    // This is the structural precondition for INV-004. If it ever fails, a
    // higher timeframe stops being a pure view over the same tick stream.
    for (let i = 0; i < TFS.length; i += 1) {
      for (let j = i; j < TFS.length; j += 1) {
        const fine = TFS[i]!;
        const coarse = TFS[j]!;
        for (const t of instants) {
          expect(
            bucketStart(bucketStart(t, fine), coarse),
            `${fine.id} -> ${coarse.id} at ${t}`,
          ).toBe(bucketStart(t, coarse));
        }
      }
    }
  });

  it('covers a coarse bucket with exactly nestingFactor fine buckets', () => {
    const t = epochMillis(1_776_123_456_789);
    for (let i = 0; i < TFS.length; i += 1) {
      for (let j = i; j < TFS.length; j += 1) {
        const fine = TFS[i]!;
        const coarse = TFS[j]!;
        const start = bucketStart(t, coarse);
        const factor = nestingFactor(fine, coarse);
        const distinct = new Set<number>();
        for (let k = 0; k < factor; k += 1) {
          distinct.add(bucketStart(epochMillis(start + k * fine.durationMs), fine));
        }
        expect(distinct.size).toBe(factor);
      }
    }
  });

  it('indexes buckets consistently with their start', () => {
    for (const tf of TFS) {
      for (const t of sampleInstants()) {
        expect(bucketIndex(t, tf) * tf.durationMs).toBe(bucketStart(t, tf));
      }
    }
  });

  it('stays exact at the top of the representable range', () => {
    const near = epochMillis(MAX_EPOCH_MILLIS - 1);
    for (const tf of TFS) {
      expect(Number.isSafeInteger(bucketStart(near, tf))).toBe(true);
      expect(bucketStart(near, tf) % tf.durationMs).toBe(0);
    }
  });
});

describe('timeframe ordering helpers', () => {
  it('compares coarseness', () => {
    expect(isCoarserOrEqual(timeframe('1h'), timeframe('1m'))).toBe(true);
    expect(isCoarserOrEqual(timeframe('1m'), timeframe('1m'))).toBe(true);
    expect(isCoarserOrEqual(timeframe('1m'), timeframe('1h'))).toBe(false);
  });

  it('refuses a nesting factor for a pair that does not nest', () => {
    // Every declared pair nests, so this is checked with a synthetic timeframe.
    const synthetic = { id: '1m' as const, durationMs: 7_000 as never };
    expect(() => nestingFactor(synthetic, timeframe('1m'))).toThrow(RangeError);
  });
});
