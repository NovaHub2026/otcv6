import { exp, ln, pow } from '../math/portable.js';
import type { RandomSource } from '../entropy/stream.js';

/**
 * Distribution samplers over a deterministic stream.
 *
 * Every sampler here is **stateless**: a pure function of the stream position,
 * with nothing cached between calls.
 *
 * That rules out the usual optimisation in the polar and Box–Muller methods,
 * which produce two normal variates and keep one for next time. A cached variate
 * is hidden state that does not appear in `position()`, so a snapshot would omit
 * it and replay would silently diverge — exactly the class of bug this project
 * can least afford, in the layer where it would be hardest to notice. The second
 * variate is discarded instead. The cost is about a factor of two in normal
 * generation against an entropy layer that delivers 26M draws per second, which
 * is five orders of magnitude more than a realistic tick rate needs.
 *
 * Rejection sampling makes the number of draws variable. That is harmless and in
 * fact required: the cursor records the exact position reached, so replay
 * consumes the same draws in the same order.
 *
 * All transcendental work goes through the portable `exp`/`ln`, never `Math`.
 */

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite, received ${value}.`);
  }
}

/** Uniform on `[min, max)`. */
export function uniform(stream: RandomSource, min: number, max: number): number {
  assertFinite('min', min);
  assertFinite('max', max);
  if (min > max) {
    throw new RangeError(`Expected min <= max, received min=${min}, max=${max}.`);
  }
  return min + (max - min) * stream.nextFloat64();
}

/** Uniform on `[-1, 1)`. */
export function uniformSymmetric(stream: RandomSource): number {
  return 2 * stream.nextFloat64() - 1;
}

export function bernoulli(stream: RandomSource, probability: number): boolean {
  if (!(probability >= 0 && probability <= 1)) {
    throw new RangeError(`Probability must be in [0, 1], received ${probability}.`);
  }
  return stream.nextFloat64() < probability;
}

/**
 * Index drawn in proportion to `weights`.
 *
 * Linear scan rather than an alias table: weight vectors in this system are
 * short, and a linear scan consumes exactly one draw regardless of the outcome,
 * which keeps cursor arithmetic simple to reason about during replay.
 */
export function categorical(stream: RandomSource, weights: readonly number[]): number {
  if (weights.length === 0) {
    throw new RangeError('Categorical weights must not be empty.');
  }
  let total = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i]!;
    if (!Number.isFinite(w) || w < 0) {
      throw new RangeError(
        `Categorical weight at index ${i} must be finite and non-negative, received ${w}.`,
      );
    }
    total += w;
  }
  if (total <= 0) {
    throw new RangeError('Categorical weights must sum to a positive value.');
  }

  const target = stream.nextFloat64() * total;
  let cumulative = 0;
  for (let i = 0; i < weights.length; i += 1) {
    cumulative += weights[i]!;
    if (target < cumulative) return i;
  }
  // Reachable only through floating-point accumulation at the very top of the
  // range; the last positive-weight index is the correct answer there.
  for (let i = weights.length - 1; i >= 0; i -= 1) {
    if (weights[i]! > 0) return i;
  }
  /* c8 ignore next */
  throw new RangeError('Categorical weights must sum to a positive value.');
}

/**
 * Standard normal, by the Marsaglia polar method.
 *
 * Draws `u, v` uniform on `[-1, 1)` and accepts when `0 < u² + v² < 1`
 * (probability π/4 ≈ 0.785). Uses `ln` and `sqrt` only — no trigonometry — which
 * is why the kernel does not need portable `sin`/`cos`.
 */
export function standardNormal(stream: RandomSource): number {
  for (;;) {
    const u = uniformSymmetric(stream);
    const v = uniformSymmetric(stream);
    const s = u * u + v * v;
    if (s > 0 && s < 1) {
      return u * Math.sqrt((-2 * ln(s)) / s);
    }
  }
}

export function normal(stream: RandomSource, mean: number, stdDev: number): number {
  assertFinite('mean', mean);
  if (!(stdDev >= 0) || !Number.isFinite(stdDev)) {
    throw new RangeError(`Standard deviation must be finite and non-negative, received ${stdDev}.`);
  }
  return mean + stdDev * standardNormal(stream);
}

/** Exponential with the given rate (inverse mean). */
export function exponential(stream: RandomSource, rate: number): number {
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new RangeError(`Rate must be finite and positive, received ${rate}.`);
  }
  // 1 - u lies in (0, 1], so the logarithm can never be -Infinity.
  return -ln(1 - stream.nextFloat64()) / rate;
}

/**
 * Gamma with the given shape and scale, by Marsaglia–Tsang.
 *
 * For `shape < 1` the standard boost is applied: `G(a) = G(a+1) · U^(1/a)`.
 */
export function gamma(stream: RandomSource, shape: number, scale: number): number {
  if (!(shape > 0) || !Number.isFinite(shape)) {
    throw new RangeError(`Shape must be finite and positive, received ${shape}.`);
  }
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new RangeError(`Scale must be finite and positive, received ${scale}.`);
  }

  if (shape < 1) {
    const boosted = gamma(stream, shape + 1, scale);
    let u = stream.nextFloat64();
    if (u === 0) u = Number.MIN_VALUE;
    return boosted * pow(u, 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = standardNormal(stream);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = stream.nextFloat64();
    const xSquared = x * x;
    if (u < 1 - 0.0331 * xSquared * xSquared) {
      return d * v * scale;
    }
    if (ln(u) < 0.5 * xSquared + d * (1 - v + ln(v))) {
      return d * v * scale;
    }
  }
}

export function chiSquared(stream: RandomSource, degreesOfFreedom: number): number {
  if (!(degreesOfFreedom > 0) || !Number.isFinite(degreesOfFreedom)) {
    throw new RangeError(
      `Degrees of freedom must be finite and positive, received ${degreesOfFreedom}.`,
    );
  }
  return gamma(stream, degreesOfFreedom / 2, 2);
}

/**
 * Student-t. The canonical heavy-tailed building block: `t_ν` has finite
 * variance only for `ν > 2` and finite kurtosis only for `ν > 4`, which is how
 * the market model will be able to produce genuinely fat tails rather than
 * merely large Gaussian draws.
 */
export function studentT(stream: RandomSource, degreesOfFreedom: number): number {
  if (!(degreesOfFreedom > 0) || !Number.isFinite(degreesOfFreedom)) {
    throw new RangeError(
      `Degrees of freedom must be finite and positive, received ${degreesOfFreedom}.`,
    );
  }
  const z = standardNormal(stream);
  const w = chiSquared(stream, degreesOfFreedom);
  return z / Math.sqrt(w / degreesOfFreedom);
}

/** Log-normal with the given log-space mean and standard deviation. */
export function logNormal(stream: RandomSource, logMean: number, logStdDev: number): number {
  return exp(normal(stream, logMean, logStdDev));
}
