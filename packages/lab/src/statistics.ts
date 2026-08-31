import { exp, ln } from '@otc/core';
import type { RandomSource } from '@otc/core';

/**
 * Statistical core for the attack battery.
 *
 * Uses the substrate's portable `exp`/`ln` rather than the platform's, so a
 * reported p-value is the same on every machine. The battery is analysis rather
 * than generation, so this is not strictly required by INV-009 — but evidence
 * that changes between machines is awkward to defend, and it was free.
 */

/**
 * Standard normal CDF, via a Chebyshev-fitted complementary error function.
 * Relative accuracy about 1.2e-7, which is far below any threshold a verdict
 * turns on. p-values smaller than roughly 1e-15 are reported as 0 and should be
 * read as "overwhelming" rather than as an exact figure.
 */
export function normalCdf(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const tau =
    t *
    exp(
      -x * x -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  const erfc = z >= 0 ? tau : 2 - tau;
  return 1 - 0.5 * erfc;
}

/** Two-sided tail mass beyond |z|. */
export function twoSidedPValue(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

const ACKLAM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
  -3.066479806614716e1, 2.506628277459239,
];
const ACKLAM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
  -1.328068155288572e1,
];
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
];
const ACKLAM_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const LOW = 0.02425;

/**
 * Inverse standard normal CDF, by Acklam's rational approximation.
 *
 * Relative accuracy about 1.15e-9, which is far tighter than any threshold a
 * verdict turns on.
 *
 * A Halley refinement step was tried and removed: it polishes against
 * {@link normalCdf}, whose own accuracy is only about 1.2e-7, so refining
 * against it made the result an order of magnitude *worse* — and pushed
 * `normalQuantile(0.5)` off exact zero. A refinement cannot be more accurate
 * than the function it refines against.
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return Number.NEGATIVE_INFINITY;
    if (p === 1) return Number.POSITIVE_INFINITY;
    throw new RangeError(`Probability must lie in [0, 1], received ${p}.`);
  }

  let x: number;
  if (p < LOW) {
    const q = Math.sqrt(-2 * ln(p));
    x =
      (((((ACKLAM_C[0]! * q + ACKLAM_C[1]!) * q + ACKLAM_C[2]!) * q + ACKLAM_C[3]!) * q +
        ACKLAM_C[4]!) *
        q +
        ACKLAM_C[5]!) /
      ((((ACKLAM_D[0]! * q + ACKLAM_D[1]!) * q + ACKLAM_D[2]!) * q + ACKLAM_D[3]!) * q + 1);
  } else if (p <= 1 - LOW) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((ACKLAM_A[0]! * r + ACKLAM_A[1]!) * r + ACKLAM_A[2]!) * r + ACKLAM_A[3]!) * r +
        ACKLAM_A[4]!) *
        r +
        ACKLAM_A[5]!) *
        q) /
      (((((ACKLAM_B[0]! * r + ACKLAM_B[1]!) * r + ACKLAM_B[2]!) * r + ACKLAM_B[3]!) * r +
        ACKLAM_B[4]!) *
        r +
        1);
  } else {
    const q = Math.sqrt(-2 * ln(1 - p));
    x =
      -(
        ((((ACKLAM_C[0]! * q + ACKLAM_C[1]!) * q + ACKLAM_C[2]!) * q + ACKLAM_C[3]!) * q +
          ACKLAM_C[4]!) *
          q +
        ACKLAM_C[5]!
      ) /
      ((((ACKLAM_D[0]! * q + ACKLAM_D[1]!) * q + ACKLAM_D[2]!) * q + ACKLAM_D[3]!) * q + 1);
  }

  return x;
}

export interface ProportionTest {
  readonly successes: number;
  readonly trials: number;
  readonly proportion: number;
  readonly z: number;
  readonly pValue: number;
  readonly standardError: number;
}

/** Two-sided test of an observed proportion against `p0`, default a fair coin. */
export function binomialProportionTest(
  successes: number,
  trials: number,
  p0 = 0.5,
): ProportionTest {
  if (!Number.isInteger(trials) || trials < 0) {
    throw new RangeError(`Trials must be a non-negative integer, received ${trials}.`);
  }
  if (!Number.isInteger(successes) || successes < 0 || successes > trials) {
    throw new RangeError(`Successes must be an integer in [0, ${trials}], received ${successes}.`);
  }
  if (!(p0 > 0 && p0 < 1)) {
    throw new RangeError(`p0 must lie in (0, 1), received ${p0}.`);
  }
  if (trials === 0) {
    return {
      successes,
      trials,
      proportion: p0,
      z: 0,
      pValue: 1,
      standardError: Number.POSITIVE_INFINITY,
    };
  }
  const proportion = successes / trials;
  const standardError = Math.sqrt((p0 * (1 - p0)) / trials);
  const z = (proportion - p0) / standardError;
  return { successes, trials, proportion, z, pValue: twoSidedPValue(z), standardError };
}

export interface BenjaminiHochbergResult {
  /** Indices of the rejected hypotheses, in the order given. */
  readonly rejected: readonly number[];
  /** Largest p-value declared significant, or null when none was. */
  readonly threshold: number | null;
  readonly falseDiscoveryRate: number;
  readonly tested: number;
}

/**
 * Benjamini–Hochberg step-up procedure.
 *
 * The battery conditions on hundreds of bins, so an uncorrected worst-bin rule
 * would find "leaks" in a perfectly fair market roughly every run. Controlling
 * the false discovery rate is what makes a worst-bin gate usable at all — and a
 * worst-bin gate is what is wanted, because a pooled mean averages a local leak
 * away to nothing.
 */
export function benjaminiHochberg(
  pValues: readonly number[],
  falseDiscoveryRate: number,
): BenjaminiHochbergResult {
  if (!(falseDiscoveryRate > 0 && falseDiscoveryRate <= 1)) {
    throw new RangeError(
      `False discovery rate must lie in (0, 1], received ${falseDiscoveryRate}.`,
    );
  }
  for (const p of pValues) {
    if (!(p >= 0 && p <= 1)) {
      throw new RangeError(`p-values must lie in [0, 1], received ${p}.`);
    }
  }
  const m = pValues.length;
  if (m === 0) {
    return { rejected: [], threshold: null, falseDiscoveryRate, tested: 0 };
  }
  const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => pValues[a]! - pValues[b]!);
  let largestK = -1;
  for (let k = 0; k < m; k += 1) {
    if (pValues[order[k]!]! <= ((k + 1) / m) * falseDiscoveryRate) largestK = k;
  }
  if (largestK < 0) {
    return { rejected: [], threshold: null, falseDiscoveryRate, tested: m };
  }
  const rejected = order.slice(0, largestK + 1).sort((a, b) => a - b);
  return {
    rejected,
    threshold: pValues[order[largestK]!]!,
    falseDiscoveryRate,
    tested: m,
  };
}

export interface BootstrapResult {
  readonly mean: number;
  readonly standardError: number;
  readonly lower95: number;
  readonly upper95: number;
  readonly replicates: number;
  readonly blockSize: number;
}

/**
 * Moving-block bootstrap for the mean of a dependent series.
 *
 * Resampling whole blocks preserves the local dependence that makes the i.i.d.
 * standard error wrong. Where the battery must use overlapping windows — because
 * a 15-minute horizon simply does not yield many independent samples — this is
 * what keeps the reported interval honest.
 */
export function movingBlockBootstrap(
  values: Float64Array,
  blockSize: number,
  replicates: number,
  stream: RandomSource,
): BootstrapResult {
  const n = values.length;
  if (n === 0) throw new RangeError('Cannot bootstrap an empty sample.');
  if (!Number.isInteger(blockSize) || blockSize <= 0 || blockSize > n) {
    throw new RangeError(`Block size must be an integer in [1, ${n}], received ${blockSize}.`);
  }
  if (!Number.isInteger(replicates) || replicates <= 0) {
    throw new RangeError(`Replicates must be a positive integer, received ${replicates}.`);
  }

  const blocks = Math.ceil(n / blockSize);
  const starts = n - blockSize + 1;
  const means = new Float64Array(replicates);

  for (let r = 0; r < replicates; r += 1) {
    let total = 0;
    let count = 0;
    for (let b = 0; b < blocks; b += 1) {
      const start = stream.nextBoundedUint32(starts);
      for (let i = 0; i < blockSize && count < n; i += 1) {
        total += values[start + i]!;
        count += 1;
      }
    }
    means[r] = total / count;
  }

  let mean = 0;
  for (let r = 0; r < replicates; r += 1) mean += means[r]!;
  mean /= replicates;
  let variance = 0;
  for (let r = 0; r < replicates; r += 1) {
    const d = means[r]! - mean;
    variance += d * d;
  }
  variance /= Math.max(1, replicates - 1);

  const sorted = Float64Array.from(means).sort();
  const quantile = (q: number): number =>
    sorted[Math.min(replicates - 1, Math.floor(q * replicates))]!;
  return {
    mean,
    standardError: Math.sqrt(variance),
    lower95: quantile(0.025),
    upper95: quantile(0.975),
    replicates,
    blockSize,
  };
}

/**
 * Smallest true deviation from a fair coin that a test of `trials` samples would
 * detect, as a proportion. Computed, never asserted: a verdict of "no edge" is
 * meaningless without the sensitivity that produced it.
 */
export function minimumDetectableEffect(trials: number, alpha = 0.05, power = 0.8): number {
  if (!Number.isInteger(trials) || trials <= 0) {
    throw new RangeError(`Trials must be a positive integer, received ${trials}.`);
  }
  if (!(alpha > 0 && alpha < 1))
    throw new RangeError(`alpha must lie in (0, 1), received ${alpha}.`);
  if (!(power > 0 && power < 1))
    throw new RangeError(`power must lie in (0, 1), received ${power}.`);
  const zAlpha = normalQuantile(1 - alpha / 2);
  const zPower = normalQuantile(power);
  return (zAlpha + zPower) * Math.sqrt(0.25 / trials);
}

/** Samples needed to detect a given deviation from a fair coin. */
export function samplesForEffect(effect: number, alpha = 0.05, power = 0.8): number {
  if (!(effect > 0 && effect < 0.5)) {
    throw new RangeError(`Effect must lie in (0, 0.5), received ${effect}.`);
  }
  const zAlpha = normalQuantile(1 - alpha / 2);
  const zPower = normalQuantile(power);
  const zSum = zAlpha + zPower;
  return Math.ceil((0.25 * zSum * zSum) / (effect * effect));
}
