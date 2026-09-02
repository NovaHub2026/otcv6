import type { EpochMillis } from '@otc/core';
import { bucketByThresholds, priceModulo, quantileThresholds } from './features.js';
import { lastCompletedMinute, RUN_CAP, type FeatureFrame } from './frame.js';
import { SKIP_BUCKET, type AttackFamily, type FeatureKind } from './types.js';

/** Convenience constructor for a stateless family. */
function family(
  name: string,
  featureKind: FeatureKind,
  conditioning: string,
  description: string,
  buckets: number,
  bucket: (frame: FeatureFrame, entryIndex: number, entryInstant: EpochMillis) => number,
): AttackFamily {
  return { name, featureKind, conditioning, description, buckets, bucket };
}

/** A family whose bucket boundaries are quantiles fitted on the training split. */
class QuantileFamily implements AttackFamily {
  #thresholds: number[] = [];

  constructor(
    readonly name: string,
    readonly featureKind: FeatureKind,
    readonly conditioning: string,
    readonly description: string,
    readonly buckets: number,
    private readonly value: (frame: FeatureFrame, index: number) => number,
  ) {}

  fit(frame: FeatureFrame, trainingEndIndex: number): void {
    const sample: number[] = [];
    // Strided so fitting stays cheap on long histories. The quantiles of a
    // strided sample match those of the whole to far better than a bucket
    // boundary needs.
    const stride = Math.max(1, Math.floor(trainingEndIndex / 200_000));
    for (let i = 0; i <= trainingEndIndex; i += stride) {
      const v = this.value(frame, i);
      if (Number.isFinite(v)) sample.push(v);
    }
    this.#thresholds = quantileThresholds(sample, this.buckets);
  }

  bucket(frame: FeatureFrame, entryIndex: number): number {
    if (this.#thresholds.length !== this.buckets - 1) return SKIP_BUCKET;
    const v = this.value(frame, entryIndex);
    if (!Number.isFinite(v)) return SKIP_BUCKET;
    return bucketByThresholds(v, this.#thresholds);
  }
}

// ---------------------------------------------------------------------------
// Translation-invariant families.
// These are what a conventional battery consists of. Necessary, and provably
// insufficient on their own.
// ---------------------------------------------------------------------------

const TRANSLATION_INVARIANT: AttackFamily[] = [
  family(
    'previous-move',
    'translation-invariant',
    'sign of the most recent tick change',
    'The simplest tradeable signal, and the one that catches bid-ask bounce and sign persistence.',
    2,
    (frame, i) => {
      const run = frame.signedRun[i]!;
      return run === 0 ? SKIP_BUCKET : run > 0 ? 1 : 0;
    },
  ),
  family(
    'trailing-return-sign-30',
    'translation-invariant',
    'sign of the price change over the last 30 ticks',
    'Momentum at a span comparable to the shortest contract.',
    2,
    (frame, i) => {
      if (i < 30) return SKIP_BUCKET;
      const change = frame.prices[i]! - frame.prices[i - 30]!;
      return change === 0 ? SKIP_BUCKET : change > 0 ? 1 : 0;
    },
  ),
  family(
    'run-length',
    'translation-invariant',
    'length of the current same-signed run, by direction',
    'Catches any rule of the form "reverse after N moves in one direction".',
    6,
    (frame, i) => {
      const run = frame.signedRun[i]!;
      if (run === 0) return SKIP_BUCKET;
      const length = Math.abs(run);
      const lengthBucket = length <= 1 ? 0 : length <= 3 ? 1 : 2;
      return run > 0 ? lengthBucket : 3 + lengthBucket;
    },
  ),
  new QuantileFamily(
    'volatility-state',
    'translation-invariant',
    'trailing realized volatility quintile',
    'Catches any coupling between the volatility state and future direction.',
    5,
    (frame, i) => frame.volatility[i]!,
  ),
  family(
    'candle-direction',
    'translation-invariant',
    'direction of the last completed one-minute candle',
    'The signal a chartist reads first.',
    3,
    (frame, _i, t) => {
      const candle = lastCompletedMinute(frame, t);
      if (candle === null) return SKIP_BUCKET;
      return candle.close > candle.open ? 0 : candle.close < candle.open ? 1 : 2;
    },
  ),
  family(
    'candle-morphology',
    'translation-invariant',
    'body-to-range ratio of the last completed minute, by direction',
    'Distinguishes doji-like bars from full-bodied ones; catches morphology-linked rules.',
    6,
    (frame, _i, t) => {
      const candle = lastCompletedMinute(frame, t);
      if (candle === null) return SKIP_BUCKET;
      const range = candle.high - candle.low;
      if (range === 0) return SKIP_BUCKET;
      const body = Math.abs(candle.close - candle.open) / range;
      const shape = body < 0.2 ? 0 : body < 0.6 ? 1 : 2;
      return candle.close >= candle.open ? shape : 3 + shape;
    },
  ),
  new QuantileFamily(
    'position-in-range',
    'translation-invariant',
    'position within the trailing 240-tick high-low range, by quintile',
    'Catches support and resistance behaviour defined relative to recent extremes.',
    5,
    (frame, i) => frame.rangePosition[i]!,
  ),
  new QuantileFamily(
    'efficiency-ratio',
    'translation-invariant',
    'directional efficiency of the last 60 ticks, by quintile',
    'Separates trending from consolidating stretches; catches trend-continuation rules.',
    5,
    (frame, i) => frame.efficiency[i]!,
  ),
];

// ---------------------------------------------------------------------------
// Temporal families. Invisible to any price-only feature.
// ---------------------------------------------------------------------------

const TEMPORAL: AttackFamily[] = [
  family(
    'second-of-minute',
    'temporal',
    'which sixth of the minute the entry falls in',
    'Catches anything phase-locked to the clock, including candle-boundary effects.',
    6,
    (_frame, _i, t) => Math.min(5, Math.floor((((t % 60_000) + 60_000) % 60_000) / 10_000)),
  ),
  family(
    'minute-of-hour',
    'temporal',
    'which sixth of the hour the entry falls in',
    'Catches slower scheduled structure.',
    6,
    (_frame, _i, t) =>
      Math.min(5, Math.floor((((t % 3_600_000) + 3_600_000) % 3_600_000) / 600_000)),
  ),
  family(
    'horizon-grid-phase',
    'temporal',
    'entry phase relative to a 15-minute grid',
    'Catches structure aligned to the longest contract boundary.',
    4,
    (_frame, _i, t) => Math.min(3, Math.floor((((t % 900_000) + 900_000) % 900_000) / 225_000)),
  ),
  /**
   * **Cycle Audit 6, CA6-04.** Every temporal family above conditions on the
   * clock's *phase* — where in a minute, an hour, a 15-minute grid. None
   * conditions on the clock's **identity**.
   *
   * An auditor built a record whose direction inside each 60-second block is a
   * bit of `splitmix32(blockIndex)` — public arithmetic anyone can recompute —
   * and paid an observer **+1.4% per trade**, 3.8x the profitability threshold
   * this laboratory exports. The full battery returned 70 hypotheses, **zero**
   * exploitable, worst z = 2.26, and `runStandingAssurance` signed `clean`.
   *
   * These three families close that class: a pseudorandom function of the block
   * index at three block sizes. They cannot close the *general* case — an
   * adversary may key on any public function, and no finite battery enumerates
   * them all — which is why `standing.ts` now says what `clean` means and does
   * not mean.
   */
  ...[15_000, 60_000, 300_000].map((blockMs) =>
    family(
      `block-index-digest-${blockMs / 1000}s`,
      'temporal',
      `a hash of which ${blockMs / 1000}-second block the entry falls in`,
      'Catches direction keyed to the identity of a clock block rather than its phase.',
      8,
      (_frame, _i, t) => digestBucket(Math.floor(t / blockMs), 8),
    ),
  ),
];

/**
 * A pseudorandom bucket for an integer, computed the way an adversary would.
 *
 * `splitmix32`'s finalizer: integer arithmetic only, identical on every engine,
 * and cheap. It is here rather than in the kernel because it is an *attacker's*
 * function — nothing that generates prices may use it, and `guardrails.test.ts`
 * would refuse it there.
 */
function digestBucket(value: number, buckets: number): number {
  let x = value | 0;
  x = (x + 0x9e37_79b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0_aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a_2d97);
  x = x ^ (x >>> 15);
  return (x >>> 0) % buckets;
}

// ---------------------------------------------------------------------------
// Level-anchored families.
//
// The blind spot. Every family above is invariant to shifting the whole price
// path, so none of them can see a mechanism keyed to the absolute price. PH-1's
// levelAnchoredVolatility fixture is invisible to all of them.
// ---------------------------------------------------------------------------

/** Candidate cell widths, in lattice steps, swept for periodic level structure. */
export const SWEPT_CELL_WIDTHS: readonly number[] = [500, 1_000, 2_000, 4_000, 8_000, 16_000];

const LEVEL_ANCHORED: AttackFamily[] = [
  new QuantileFamily(
    'absolute-price-level',
    'level-anchored',
    'absolute canonical price, by quintile of the training range',
    'Catches any mechanism that behaves differently at different price levels.',
    5,
    (frame, i) => frame.prices[i]!,
  ),
  ...SWEPT_CELL_WIDTHS.map((cell) =>
    family(
      `price-modulo-${cell}`,
      'level-anchored',
      `which half of a ${cell}-step price cell the entry sits in`,
      'Sweeps candidate periodic level structure. Two buckets rather than many: a ' +
        'volatility trough at the cell boundary and a peak at its centre make the median ' +
        'drift toward whichever boundary is nearer, and two buckets aligned to that ' +
        'mechanism have far more power than eight arbitrary ones.',
      2,
      (frame, i) => (priceModulo(frame.prices[i]!, cell) * 2 < cell ? 0 : 1),
    ),
  ),
  family(
    'price-modulo-quantum',
    'level-anchored',
    'canonical price modulo small multiples of the quote quantum',
    'Catches quantisation and round-number effects at the finest scale.',
    5,
    (frame, i) => priceModulo(frame.prices[i]!, 5),
  ),
];

export const ATTACK_FAMILIES: readonly AttackFamily[] = Object.freeze([
  ...TRANSLATION_INVARIANT,
  ...TEMPORAL,
  ...LEVEL_ANCHORED,
]);

export function familyByName(name: string): AttackFamily {
  const found = ATTACK_FAMILIES.find((f) => f.name === name);
  if (found === undefined) {
    throw new RangeError(`Unknown attack family ${JSON.stringify(name)}.`);
  }
  return found;
}

/** Families of a given kind, for coverage assertions and for reporting. */
export function familiesOfKind(kind: FeatureKind): readonly AttackFamily[] {
  return ATTACK_FAMILIES.filter((f) => f.featureKind === kind);
}

export { RUN_CAP };
