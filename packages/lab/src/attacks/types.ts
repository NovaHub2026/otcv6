import type { EpochMillis } from '@otc/core';
import type { FeatureFrame } from './frame.js';

/**
 * How an attack conditions on the market.
 *
 * The taxonomy exists because the blind spot it names is real and measured.
 * Every conventional battery for a synthetic market conditions on
 * translation-invariant features — returns, volatility, candle shapes, run
 * lengths — and none of those is a proxy for absolute price modulo a cell
 * width. PH-1's `levelAnchoredVolatility` fixture sits at P(up) = 0.500
 * unconditionally and leaks at z = −7.6 once conditioned on price level.
 *
 * Classifying families makes the question "what does this battery *not*
 * condition on?" answerable by reading the registry, and a test asserts that
 * every kind is represented.
 */
export type FeatureKind =
  /** Depends only on price differences: invariant to shifting the whole path. */
  | 'translation-invariant'
  /** Depends on wall-clock phase. */
  | 'temporal'
  /** Depends on the absolute price level. */
  | 'level-anchored'
  /** A fitted model over engineered features. */
  | 'learned';

export const FEATURE_KINDS: readonly FeatureKind[] = [
  'translation-invariant',
  'temporal',
  'level-anchored',
  'learned',
];

/** Returned by `bucket` to mean "this entry is not classifiable; skip it". */
export const SKIP_BUCKET = -1;

export interface AttackFamily {
  readonly name: string;
  readonly description: string;
  readonly featureKind: FeatureKind;
  /** What the attacker conditions on, in words. Appears in the report. */
  readonly conditioning: string;
  readonly buckets: number;

  /**
   * Whether the fit depends on the contract horizon.
   *
   * A learned predictor's target is "did this horizon resolve up", so it must be
   * refitted per horizon. Threshold-based families do not care, and refitting
   * them eight times would be wasted work.
   */
  readonly horizonDependent?: boolean;

  /**
   * Fit thresholds or parameters.
   *
   * **May read only frame values at indices `0 .. trainingEndIndex`.** Fitting on the
   * data an attack is then scored against is an in-sample result, and with a
   * free choice of threshold over hundreds of bins that manufactures findings
   * from noise.
   */
  fit?(frame: FeatureFrame, trainingEndIndex: number, horizonMs: number): void;

  /**
   * Bucket for an entry.
   *
   * **May read only frame values at indices `0 .. entryIndex`.** At the moment of entry
   * that tick has already happened, so it is fair game; anything later is the
   * outcome. Return {@link SKIP_BUCKET} when the entry cannot be classified.
   */
  bucket(frame: FeatureFrame, entryIndex: number, entryInstant: EpochMillis): number;
}
