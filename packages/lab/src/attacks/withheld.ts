import { bucketByThresholds, quantileThresholds } from './features.js';
import type { FeatureFrame } from './frame.js';
import { SKIP_BUCKET, type AttackFamily } from './types.js';

/**
 * Attack families deliberately withheld from all engine tuning.
 *
 * ## Why these exist at all
 *
 * Every family in the main registry was available while PH-3 shaped the market
 * process, which is exactly how it should have been used — the phase ran a
 * generate → attack → diagnose → correct loop. But it has a consequence worth
 * stating plainly: **a clean verdict from those families is no longer
 * independent evidence.** They are the families the engine was shaped to
 * survive.
 *
 * PH-2 measured that failure mode directly. A conventional battery — 354
 * hypotheses across translation-invariant and temporal families — returned
 * *clean* on an engine whose volatility was keyed to the price level. The
 * families that would have caught it did not exist yet.
 *
 * So these four condition on quantities no prior family used and no tuning
 * decision ever considered. Their value is entirely that no engine decision has
 * been made with them in view, which means it can be destroyed by using them
 * that way. **If one of these finds an edge, that is a finding for the record
 * and a problem for the next cycle — not a target to tune against.**
 */
export const WITHHELD_FAMILY_NAMES = [
  'wh-arrival-gap',
  'wh-sequence-residue',
  'wh-seam-proximity',
  'wh-cross-asset',
] as const;

/**
 * Inter-arrival time.
 *
 * The temporal families condition on wall-clock *phase* — second of minute,
 * minute of hour, position on the horizon grid. None has ever conditioned on the
 * gap since the previous tick, which is the one quantity the Hawkes process
 * directly controls and therefore the most plausible place for timing structure
 * to reach direction.
 */
class ArrivalGapFamily implements AttackFamily {
  readonly name = 'wh-arrival-gap';
  readonly featureKind = 'temporal' as const;
  readonly conditioning = 'milliseconds since the previous tick, bucketed by training quantile';
  readonly description =
    'Withheld. The Hawkes process sets inter-arrival time directly; if timing reached the sign, this is where it would show.';
  readonly buckets = 8;
  #thresholds: number[] = [];

  #gap(frame: FeatureFrame, index: number): number {
    if (index < 1) return Number.NaN;
    return frame.instants[index]! - frame.instants[index - 1]!;
  }

  fit(frame: FeatureFrame, trainingEndIndex: number): void {
    const sample: number[] = [];
    const stride = Math.max(1, Math.floor(trainingEndIndex / 200_000));
    for (let i = 1; i <= trainingEndIndex; i += stride) {
      const gap = this.#gap(frame, i);
      if (Number.isFinite(gap)) sample.push(gap);
    }
    this.#thresholds = quantileThresholds(sample, this.buckets);
  }

  bucket(frame: FeatureFrame, entryIndex: number): number {
    if (this.#thresholds.length !== this.buckets - 1) return SKIP_BUCKET;
    const gap = this.#gap(frame, entryIndex);
    if (!Number.isFinite(gap)) return SKIP_BUCKET;
    return bucketByThresholds(gap, this.#thresholds);
  }
}

/**
 * Low-order residue of the tick sequence number.
 *
 * Trivially clean under the theorem and never checked. It is included precisely
 * because it is the kind of thing a counter-addressed generator could plausibly
 * leak: the sign stream is indexed by a counter, and if any part of the pipeline
 * folded that index into a decision, a residue class would show it.
 */
function sequenceResidue(modulus: number): AttackFamily {
  return {
    name: 'wh-sequence-residue',
    featureKind: 'temporal',
    conditioning: `tick sequence number modulo ${modulus}`,
    description:
      'Withheld. The sign stream is counter-addressed; a residue class would expose any leak of that index into the decision.',
    buckets: modulus,
    bucket(_frame, entryIndex): number {
      return entryIndex % modulus;
    },
  };
}

/**
 * Distance from a restart seam.
 *
 * Seams did not exist until PH-5 and have never been attacked. A seam abandons
 * latent state and restarts beyond leased keystream, so if anything about the
 * restart were predictable, the ticks either side of one are where it would be.
 *
 * `seamIndices` are supplied by the caller because the frame does not carry
 * them: a seam is a runtime event, not a property of the tick record.
 */
/**
 * Radius in ticks, and it has to be large.
 *
 * The battery evaluates non-overlapping contracts, so a 260,000-tick history
 * yields only a few thousand entries. A narrow seam window puts every bucket
 * below the 500-sample floor and the family silently tests nothing — which is
 * exactly what the first calibration run measured: zero hypotheses, and a clean
 * verdict that meant nothing.
 */
function seamProximity(seamIndices: readonly number[], radius = 20_000): AttackFamily {
  const sorted = [...seamIndices].sort((a, b) => a - b);
  return {
    name: 'wh-seam-proximity',
    featureKind: 'temporal',
    conditioning: `signed distance in ticks from the nearest restart seam, within ${radius}`,
    description:
      'Withheld. A seam abandons latent state and restarts beyond leased keystream; predictable restart behaviour would appear here.',
    buckets: 8,
    bucket(_frame, entryIndex): number {
      if (sorted.length === 0) return SKIP_BUCKET;
      let nearest = Number.POSITIVE_INFINITY;
      for (const seam of sorted) {
        const distance = entryIndex - seam;
        if (Math.abs(distance) < Math.abs(nearest)) nearest = distance;
      }
      if (!Number.isFinite(nearest) || Math.abs(nearest) > radius) return SKIP_BUCKET;
      // Four buckets either side of the seam, so "just before" and "just after"
      // are never averaged together.
      const magnitude = Math.min(3, Math.floor((Math.abs(nearest) * 4) / radius));
      return nearest < 0 ? magnitude : 4 + magnitude;
    },
  };
}

/**
 * Another asset's recent movement.
 *
 * Structurally impossible: assets hold separate keys and separate streams, and
 * `Venue` shares a clock and nothing else. It has never been attacked, and it is
 * the family that would catch a shared-state leak of exactly the kind Cycle
 * Audit 2 planted by hand — a global that one market writes and another reads.
 *
 * The reference series is supplied by the caller, aligned by instant.
 */
function crossAsset(reference: {
  instants: Float64Array;
  prices: Int32Array;
  lookbackMs: number;
}): AttackFamily {
  const { instants, prices, lookbackMs } = reference;

  /** Signed move of the reference asset over the lookback, at this instant. */
  const referenceMove = (instant: number): number => {
    if (instants.length < 2) return Number.NaN;
    let hi = -1;
    let lo = 0;
    let high = instants.length - 1;
    // Last reference tick at or before `instant`.
    while (lo <= high) {
      const mid = (lo + high) >>> 1;
      if (instants[mid]! <= instant) {
        hi = mid;
        lo = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (hi < 1) return Number.NaN;
    const target = instant - lookbackMs;
    let from = hi;
    while (from > 0 && instants[from - 1]! >= target) from -= 1;
    if (from === hi) return Number.NaN;
    return prices[hi]! - prices[from]!;
  };

  return {
    name: 'wh-cross-asset',
    featureKind: 'translation-invariant',
    conditioning: `sign and magnitude of a second asset's move over the previous ${lookbackMs} ms`,
    description:
      'Withheld. Assets hold separate keys and separate streams; this is the family that would catch a shared-state leak between markets.',
    buckets: 6,
    bucket(frame, entryIndex, entryInstant): number {
      const move = referenceMove(entryInstant);
      if (!Number.isFinite(move)) return SKIP_BUCKET;
      // Direction of the other asset, crossed with whether it moved much.
      const magnitude = Math.abs(move);
      const size = magnitude === 0 ? 0 : magnitude < 50 ? 1 : 2;
      return (move >= 0 ? 0 : 3) + size;
    },
  };
}

export interface WithheldOptions {
  /** Tick indices at which a restart seam occurred, if any. */
  readonly seamIndices?: readonly number[];
  /** A second asset's series, for the cross-asset family. */
  readonly reference?: { instants: Float64Array; prices: Int32Array; lookbackMs?: number };
  /** Modulus for the sequence-residue family. */
  readonly sequenceModulus?: number;
}

/**
 * Build the withheld families for a dataset.
 *
 * Families whose inputs are unavailable are simply omitted rather than included
 * in a form that always skips — a family that can never bucket anything inflates
 * the count of hypotheses tested without testing anything.
 */
export function withheldFamilies(options: WithheldOptions = {}): AttackFamily[] {
  const families: AttackFamily[] = [
    new ArrivalGapFamily(),
    sequenceResidue(options.sequenceModulus ?? 7),
  ];
  if (options.seamIndices !== undefined && options.seamIndices.length > 0) {
    families.push(seamProximity(options.seamIndices));
  }
  if (options.reference !== undefined) {
    families.push(
      crossAsset({
        instants: options.reference.instants,
        prices: options.reference.prices,
        lookbackMs: options.reference.lookbackMs ?? 30_000,
      }),
    );
  }
  return families;
}
