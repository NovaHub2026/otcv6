import { minimumDetectableEffect } from './statistics.js';

/**
 * How far a repeated measurement departs from the independence its error bar
 * assumes.
 *
 * ## Why this exists
 *
 * Every "clean" verdict in this project is quoted with a **minimum detectable
 * effect** computed as `(z_alpha + z_power) * sqrt(0.25 / n)`. That formula
 * assumes `n` independent trials. If the trials are dependent, the true sampling
 * variance is larger, the real floor is coarser than the quoted one, and every
 * verdict overstates its own sensitivity.
 *
 * This is not hypothetical here. PH-10 measured the realised lattice tie rate at
 * roughly **four times** its binomial variance, because whether a horizon settles
 * at the money depends on the volatility level and volatility is autocorrelated
 * over days. The same reasoning applied to the direction test would invalidate
 * every floor the project quotes.
 *
 * ## Why direction is different, and why it still gets measured
 *
 * ADR-0003 gives `P(up) = 1/2` **exactly**, under every public conditioning,
 * whatever the volatility. Clustering changes how *far* a window moves, never
 * which way. Non-overlapping direction outcomes should therefore be independent
 * fair coins even though almost nothing else about this market is independent.
 *
 * That is an argument. This is the measurement, and it is capable of
 * contradicting the argument — {@link designEffect} is calibrated in
 * `dependence.test.ts` against a series constructed to be overdispersed, and in
 * `detectionPower.stat.test.ts` against the tie rate, which is known to be.
 *
 * ## The estimator
 *
 * Run the measurement as `R` independent replicates of `n` trials each. Under
 * independence the variance of a replicate's proportion is `p(1 - p) / n`.
 * Compare that with the variance actually observed across replicates. Their
 * ratio is the design effect: 1 means the error bar is honest, 4 means the
 * effective sample size is a quarter of the nominal one.
 *
 * ## What it cannot see, and this is not a small caveat
 *
 * **Cycle Audit 4, Material 3.** A component shared by *every* replicate is
 * removed by the sample variance `Σ(pᵢ − p̄)²` **by construction**. Measured
 * against planted dependence at R = 100, n = 105,000:
 *
 * | Planted structure                    | This reads | True inflation of the pooled z |
 * | ------------------------------------ | ---------- | ------------------------------ |
 * | Independent per-replicate rates       | 1.42       | 1.42 (correct)                 |
 * | Run-wide common component (τ = 0.0005) | **1.000**  | **11.6**                       |
 *
 * So sharing across replicates makes the reading *lower*, not higher. Any claim
 * that measuring across contiguous segments of one path is "the more
 * conservative" choice is backwards, and `horizonCoverage.ts` said exactly that
 * until this audit.
 *
 * This matters more than a generic caveat, because the mode it cannot see is
 * **the path-displacement channel PH-11.2 builds its `pathBiasZ` column
 * around**. The instrument validating the error bar is blind to the mechanism
 * the same phase says dominates.
 *
 * `dependence.test.ts` calibrates only against a beta-binomial with independent
 * per-replicate rates — the mode this *can* see. There is no positive control
 * for the mode it cannot, and constructing one would require replicates that are
 * not independent, which is a different instrument.
 *
 * ## What to do about it
 *
 * Use this to license an error bar **only** against dependence at lags shorter
 * than a replicate. For a run-wide component, measure the pooled statistic's
 * variance across genuinely independent runs instead — which is what PH-11.1's
 * 40-independent-run configuration does, and what Cycle Audit 4 did at ten times
 * the resolution to confirm the direction design effect really is 1.
 */
export interface DesignEffectResult {
  readonly replicates: number;
  readonly samplesPerReplicate: number;
  /** Grand mean of the replicate proportions. */
  readonly mean: number;
  /** Variance of the replicate proportions, with Bessel's correction. */
  readonly observedVariance: number;
  /** `p(1 - p) / n`: what independence would predict. */
  readonly independentVariance: number;
  /** observed / independent. 1 means the i.i.d. error bar is honest. */
  readonly designEffect: number;
  /**
   * Relative standard error of the ratio itself, `sqrt(2 / (R - 1))`.
   *
   * Quoted because a design effect is a variance estimate and variance estimates
   * are noisy: at 20 replicates the ratio carries a ±32% relative error, so 1.14
   * and 1.00 are the same reading. Reporting the ratio without this invites
   * exactly the overconfidence the whole function exists to prevent.
   */
  readonly relativeStandardError: number;
  /** Nominal count divided by the design effect. */
  readonly effectiveSampleSize: number;
}

export function designEffect(
  proportions: readonly number[],
  samplesPerReplicate: number,
): DesignEffectResult {
  const replicates = proportions.length;
  if (replicates < 3) {
    throw new RangeError(`A design effect needs at least 3 replicates, received ${replicates}.`);
  }
  if (!Number.isInteger(samplesPerReplicate) || samplesPerReplicate <= 0) {
    throw new RangeError(
      `Samples per replicate must be a positive integer, received ${samplesPerReplicate}.`,
    );
  }
  for (const p of proportions) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new RangeError(`Every proportion must lie in [0, 1], received ${p}.`);
    }
  }

  let mean = 0;
  for (const p of proportions) mean += p;
  mean /= replicates;

  let observedVariance = 0;
  for (const p of proportions) observedVariance += (p - mean) * (p - mean);
  observedVariance /= replicates - 1;

  const independentVariance = (mean * (1 - mean)) / samplesPerReplicate;
  if (independentVariance === 0) {
    throw new RangeError(
      'Every replicate landed at 0 or 1, so independence predicts zero variance and the ' +
        'ratio is undefined. This is a degenerate measurement, not a design effect.',
    );
  }

  const ratio = observedVariance / independentVariance;
  return {
    replicates,
    samplesPerReplicate,
    mean,
    observedVariance,
    independentVariance,
    designEffect: ratio,
    relativeStandardError: Math.sqrt(2 / (replicates - 1)),
    effectiveSampleSize: (replicates * samplesPerReplicate) / Math.max(ratio, 1),
  };
}

/**
 * The minimum detectable effect a dependent sample actually achieves.
 *
 * `minimumDetectableEffect` answers the question for independent trials. Dividing
 * the sample size by a measured design effect answers it for the sample you have,
 * which is the number a verdict should quote.
 *
 * The design effect is floored at 1: a measured value below 1 means the replicates
 * came out *less* variable than independence predicts, which is sampling noise
 * rather than a licence to claim more sensitivity than the trials support.
 */
export function minimumDetectableEffectUnderDependence(
  trials: number,
  measuredDesignEffect: number,
  alpha = 0.05,
  power = 0.8,
): number {
  if (!Number.isFinite(measuredDesignEffect) || measuredDesignEffect <= 0) {
    throw new RangeError(
      `Design effect must be finite and positive, received ${measuredDesignEffect}.`,
    );
  }
  const effective = Math.floor(trials / Math.max(measuredDesignEffect, 1));
  if (effective < 1) {
    throw new RangeError(
      `A design effect of ${measuredDesignEffect} leaves fewer than one effective trial ` +
        `out of ${trials}. The sample carries no information at this dependence.`,
    );
  }
  return minimumDetectableEffect(effective, alpha, power);
}
