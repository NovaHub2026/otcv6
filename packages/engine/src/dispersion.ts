import { exp } from '@otc/core';
import type { CalibrationEvidence } from './asset.js';
import type { PersonalityTraits } from './personality.js';

/**
 * How far a price wanders, and why that is the only budget an operator gets.
 *
 * ## The quantity
 *
 * The process is an exact martingale (ADR-0003), so the expected price at any
 * future instant *is* the current price. Nothing accumulates a direction. What
 * accumulates is **dispersion**: the spread of where the price might be, growing
 * as the square root of elapsed time.
 *
 * [`CYCLE-6-DRIFT.md`](../../../docs/evidence/CYCLE-6-DRIFT.md) measured this the
 * expensive way — a hundred 90-day replicates per asset — and found every median
 * a small fraction of that asset's own spread: four of the five within half a
 * percent of zero, and btcusd at +1.5% against a 75.6% dispersion, which is
 * 0.02σ. The spread itself runs from 1.7% to 75.6%. Those two facts are the
 * whole story: there is no drift to cap, and the spread is what "volatile" means
 * rather than a defect beside it.
 *
 * (The "within half a percent on **all five**" this used to say was contradicted
 * by the table it cited — Cycle Audit 6, CA6-38.)
 *
 * ## Why a price ceiling is not available
 *
 * The obvious way to stop an asset reaching four times its reference price is to
 * bound it. Near such a bound `P(down) > P(up)`, which is a deterministic
 * directional rule — INV-006 — and the easiest exploit this system could
 * contain: an observer reads the public price, sees it near the ceiling, and
 * sells. It would be a leak visible to anyone with a chart.
 *
 * So the budget is set at **authoring** time, where it is blind to price and
 * outcome, by choosing how fast the asset diffuses. An asset that ends a quarter
 * at four times its reference is then not a failure of a guard; it is an asset
 * whose family said it could.
 *
 * ## The extrapolation
 *
 * Signs are independent fair coins, so returns are uncorrelated at every lag and
 * variance is additive in time. A ten-day calibration therefore fixes the rate,
 * and the rate fixes every window — which is why nothing here has to simulate a
 * quarter to budget one.
 */

/**
 * Turnovers of the slowest volatility component a dispersion fit needs.
 *
 * Measured on `spx`, whose cascade remembers for 44 hours, against a 30-day
 * reference and five seeds per span:
 *
 * **Cycle Audit 6, CA6-15/CA6-16, re-measured properly.** The first version of
 * this table reported the observed *min–max of five seeds* and read it as a
 * bound. Range grows with sample size: five draws from a 16%-sd distribution
 * span about ±25% by construction, and the stable statistic — the standard
 * deviation — was never quoted. An auditor re-derived it with 24 seeds per span
 * on three assets with very different memories:
 *
 * | turnovers | spx geo-sd | inside ±30% | xauusd | gbpjpy |
 * | --------- | ---------- | ----------- | ------ | ------ |
 * | 1         | 19.1%      | 21/24       |        |        |
 * | 2         | 18.5%      | 22/24       |        |        |
 * | 4         | 16.2%      | 21/24       | 18/24  | 20/24  |
 * | 8         | 11.7%      | 23/24       |        |        |
 * | 16        | 7.9%       | **24/24**   | 24/24  |        |
 * | 32        | 5.4%       | 24/24       |        | 24/24  |
 *
 * Four turnovers leaves a 16–34% standard deviation and puts three to six seeds
 * of twenty-four outside ±30%. **Sixteen** is where all three assets reach
 * 24/24, and the constant was roughly four times too small.
 *
 * The claim that "the error is variance, not bias" was also false, and in the
 * direction that matters. The medians do not wander: they sit below one and
 * climb monotonically — 0.68, 0.74, 0.77 for xauusd at half, two and four
 * turnovers — because a mean of squares over few independent volatility epochs
 * is strongly right-skewed. Since the rescale factor is `budget / measured`, a
 * median asset fitted at four turnovers **overshot its declared budget by about
 * 14%**, which is the mechanism behind PH-17.2's own acceptance median of 1.156.
 *
 * This is B-002 in a fourth guise: a long run is one realisation, not many
 * independent samples, whenever the quantity has memory. It is also the second
 * time this project has read a min–max as a bound.
 */
export const DISPERSION_FIT_TURNOVERS = 16;

/**
 * Pooled simulated span a personality needs before its budget can be fitted.
 *
 * A property of the asset, not a constant: a fast alt-coin whose volatility
 * forgets in four hours needs sixteen hours, and an index that remembers for two
 * days needs eight. Registration's default — three replicates of ten days —
 * covers every archetype, but a caller that shortens it has to be told.
 */
export function minimumDispersionSpanMs(
  traits: Pick<PersonalityTraits, 'cascadeSpanMs'>,
  turnovers: number = DISPERSION_FIT_TURNOVERS,
): number {
  if (!Number.isFinite(turnovers) || turnovers <= 0) {
    // **Cycle Audit 6, CA6-21.** `dispersionTurnovers` was the one number on
    // this path nobody validated, and `pooledMs < NaN` is `false` — so `0`,
    // `-5` and `NaN` each silently switched the guard off and registered an
    // asset whose budget was fitted to whatever the window happened to hold.
    throw new RangeError(
      `Dispersion turnovers must be a positive number, received ${turnovers}. A non-positive ` +
        `or unusable value disables the span guard rather than relaxing it.`,
    );
  }
  return turnovers * traits.cascadeSpanMs;
}

/** The window a dispersion budget is quoted over: one quarter. */
export const DISPERSION_WINDOW_MS = 90 * 86_400_000;

/** σ of the terminal log return over `windowMs`, from a calibration's rate. */
export function dispersionLogSigma(
  evidence: Pick<CalibrationEvidence, 'logVariancePerMs'>,
  windowMs: number = DISPERSION_WINDOW_MS,
): number {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError(`A dispersion window must be positive, received ${windowMs}.`);
  }
  if (!Number.isFinite(evidence.logVariancePerMs) || evidence.logVariancePerMs <= 0) {
    throw new RangeError(
      `A calibration reported a diffusion rate of ${evidence.logVariancePerMs}: the asset does not move.`,
    );
  }
  // `Math.sqrt` is one of the few operations ECMAScript specifies exactly, so it
  // needs no portable replacement (`portable.ts` §1).
  return Math.sqrt(evidence.logVariancePerMs * windowMs);
}

/**
 * The same spread as a fraction of the starting price.
 *
 * Log space is where the arithmetic is honest and percent is where an operator
 * thinks, so both exist and the conversion is stated once. For a log return with
 * σ and zero mean the terminal ratio is lognormal, and the standard deviation of
 * `e^X − 1` is `sqrt(e^σ² − 1)·e^{σ²/2}`. Below about 0.2 the two agree to a few
 * percent of each other; at btcusd's 0.58 they differ by a third, which is why
 * the budget itself is held in log units.
 */
export function dispersionPercent(logSigma: number): number {
  if (!Number.isFinite(logSigma) || logSigma < 0) {
    throw new RangeError(`A dispersion σ must be finite and non-negative, received ${logSigma}.`);
  }
  const variance = logSigma * logSigma;
  return Math.sqrt(exp(variance) - 1) * exp(variance / 2);
}
