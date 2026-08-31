import { exp, ln, pow, type RandomSource } from '@otc/core';
import type { ArrivalContext, ArrivalModel, MagnitudeContext } from './magnitude.js';
import type { Modulator } from './modulator.js';

/**
 * Self-exciting tick arrivals.
 *
 * Each tick excites the process in proportion to its magnitude, and the
 * excitation decays. Bursts beget bursts; quiet begets quiet. That is what
 * `PROJECT_INTRODUCTION.md` §13 asks for when it requires price to be able to
 * "accelerate, decelerate, pause" and tick timing to vary with market state.
 *
 * Sign-blind: excitation is driven by `previousMagnitude`, which is an absolute
 * size. A version driven by the signed return would be a timing analogue of the
 * leverage effect, and would fail the mirror test immediately.
 */

export interface HawkesConfig {
  /** Mean interval with no excitation, in milliseconds. */
  readonly baseIntervalMs: number;
  /**
   * Expected offspring per event, at the reference magnitude.
   *
   * This is the parameter that decides whether the process is stable, so it is
   * the parameter the configuration states. An earlier version exposed the raw
   * excitation increment instead, and the default it shipped with had a
   * branching ratio of 21.6 — explosively unstable — without that being visible
   * anywhere in the numbers.
   *
   * Must be below 1. The realized mean interval is approximately
   * `baseIntervalMs · (1 − branchingRatio)`, because the stationary excitation
   * is `n / (1 − n)`.
   */
  readonly branchingRatio: number;
  /** Decay rate of excitation, per millisecond. */
  readonly decayPerMs: number;
  /**
   * Initial estimate of a typical magnitude, in lattice steps.
   *
   * Only a starting value: the model maintains a running average and normalises
   * against that, so the branching ratio is what the configuration says
   * regardless of the volatility scale the layers above happen to produce.
   *
   * A fixed reference was tried and failed in a way worth recording. Set to 10
   * steps while the layered engine produced magnitudes several times larger, the
   * effective branching ratio exceeded 1, the process ran **permanently pinned
   * to its clamp**, and the realized tick rate was three times the configured
   * one. Nothing failed — the backstop silently became the mechanism.
   */
  readonly referenceMagnitude: number;
  /** Half-life of the running magnitude average, in milliseconds. */
  readonly magnitudeAverageHalfLifeMs: number;
  /** Upper bound on the intensity multiplier. A backstop, not the mechanism. */
  readonly maxIntensityMultiplier: number;
}

/**
 * Base interval is 2.5s with a branching ratio of 0.6, so the realized mean
 * interval is about 1s.
 *
 * That figure is a product requirement rather than a tuning choice. The shortest
 * contract is 30 seconds; at a 5-second mean interval it would resolve on about
 * five ticks, which makes ties common, intra-bar structure thin, and the chart
 * sparse. Measured directly: two-sided wick fraction fell to 0.282 against a
 * floor of 0.30 at that rate.
 */
export const DEFAULT_HAWKES: HawkesConfig = {
  baseIntervalMs: 2_500,
  branchingRatio: 0.6,
  // Excitation half-life of about 83 seconds: long enough for a burst to be
  // visible on a one-minute chart, short enough not to smear into the regime
  // layer's job.
  decayPerMs: 1 / 120_000,
  referenceMagnitude: 10,
  magnitudeAverageHalfLifeMs: 30 * 60_000,
  maxIntensityMultiplier: 8,
};

export function assertHawkesConfig(config: HawkesConfig): void {
  if (!(config.baseIntervalMs > 0) || !Number.isFinite(config.baseIntervalMs)) {
    throw new RangeError(
      `baseIntervalMs must be finite and positive, received ${config.baseIntervalMs}.`,
    );
  }
  if (!(config.branchingRatio >= 0) || !Number.isFinite(config.branchingRatio)) {
    throw new RangeError(
      `branchingRatio must be finite and non-negative, received ${config.branchingRatio}.`,
    );
  }
  // Above one, each event begets more than one successor on average and the
  // interval collapses toward zero.
  if (config.branchingRatio >= 1) {
    throw new RangeError(
      `branchingRatio ${config.branchingRatio} must be below 1; the process would be explosive.`,
    );
  }
  if (!(config.decayPerMs > 0) || !Number.isFinite(config.decayPerMs)) {
    throw new RangeError(`decayPerMs must be finite and positive, received ${config.decayPerMs}.`);
  }
  if (!(config.referenceMagnitude > 0) || !Number.isFinite(config.referenceMagnitude)) {
    throw new RangeError(
      `referenceMagnitude must be finite and positive, received ${config.referenceMagnitude}.`,
    );
  }
  if (
    !(config.magnitudeAverageHalfLifeMs > 0) ||
    !Number.isFinite(config.magnitudeAverageHalfLifeMs)
  ) {
    throw new RangeError(
      `magnitudeAverageHalfLifeMs must be finite and positive, received ${config.magnitudeAverageHalfLifeMs}.`,
    );
  }
  if (!(config.maxIntensityMultiplier > 1) || !Number.isFinite(config.maxIntensityMultiplier)) {
    throw new RangeError(
      `maxIntensityMultiplier must be finite and above 1, received ${config.maxIntensityMultiplier}.`,
    );
  }
}

/** Excitation added per event at the reference magnitude, in intensity units. */
function excitationPerEvent(config: HawkesConfig): number {
  return config.branchingRatio * config.baseIntervalMs * config.decayPerMs;
}

export interface HawkesSnapshot {
  readonly excitation: number;
  readonly averageMagnitude: number;
}

export class HawkesArrivalModel implements ArrivalModel {
  #excitation = 0;
  #averageMagnitude: number;

  constructor(
    readonly config: HawkesConfig,
    private readonly stream: RandomSource,
  ) {
    assertHawkesConfig(config);
    this.#averageMagnitude = config.referenceMagnitude;
  }

  nextIntervalMs(context: ArrivalContext): number {
    // Decay first, over the interval that has already elapsed.
    if (context.elapsedSincePreviousMs > 0) {
      this.#excitation *= exp(-this.config.decayPerMs * context.elapsedSincePreviousMs);
    }

    // Track a running average of magnitude and normalise against it, so the
    // effective branching ratio is the configured one whatever scale the layers
    // above produce. Sign-blind: magnitudes are absolute sizes.
    if (context.previousMagnitude > 0) {
      const weight =
        1 -
        exp(
          (-Math.max(1, context.elapsedSincePreviousMs) * 0.693_147_180_559_945_3) /
            this.config.magnitudeAverageHalfLifeMs,
        );
      this.#averageMagnitude += (context.previousMagnitude - this.#averageMagnitude) * weight;
    }
    const reference = Math.max(1e-9, this.#averageMagnitude);

    // Then excite, in proportion to the relative size of the tick just produced.
    this.#excitation += excitationPerEvent(this.config) * (context.previousMagnitude / reference);

    const multiplier = Math.min(1 + this.#excitation, this.config.maxIntensityMultiplier);
    const meanIntervalMs = this.config.baseIntervalMs / multiplier;
    const u = 1 - this.stream.nextFloat64();
    return Math.max(1, Math.floor(-ln(u) * meanIntervalMs));
  }

  /** Current intensity multiplier. Diagnostics and tests. */
  get intensityMultiplier(): number {
    return Math.min(1 + this.#excitation, this.config.maxIntensityMultiplier);
  }

  /** Running average magnitude. Diagnostics and tests. */
  get averageMagnitude(): number {
    return this.#averageMagnitude;
  }

  snapshot(): HawkesSnapshot {
    return { excitation: this.#excitation, averageMagnitude: this.#averageMagnitude };
  }

  restore(state: unknown): void {
    const typed = state as HawkesSnapshot;
    if (!Number.isFinite(typed.excitation) || typed.excitation < 0) {
      throw new RangeError(`Invalid excitation in snapshot: ${typed.excitation}.`);
    }
    if (!Number.isFinite(typed.averageMagnitude) || typed.averageMagnitude <= 0) {
      throw new RangeError(`Invalid average magnitude in snapshot: ${typed.averageMagnitude}.`);
    }
    this.#excitation = typed.excitation;
    this.#averageMagnitude = typed.averageMagnitude;
  }
}

/**
 * Amplitude–duration coupling.
 *
 * Scales magnitude by `(interval / reference)^h`.
 *
 *  - `h = 0.5` — volatility comes from **elapsed time**. A gap twice as long
 *    carries `sqrt(2)` times the move, so the variance per unit time is constant
 *    and the tick rate is irrelevant to it. This is pure subordination.
 *  - `h = 0` — volatility comes from **events**. Every tick is the same size
 *    regardless of the gap, so activity itself creates variance.
 *
 * The axis matters because it is one of the few personality dimensions that is
 * visible on a chart and genuinely orthogonal to volatility level: two assets
 * with identical daily volatility look different when one moves in many small
 * steps and the other in a few large ones.
 */
/**
 * Default coupling exponent.
 *
 * Chosen by measurement, not by theory: it is the largest value that keeps
 * excess kurtosis comfortably inside the realism band with every other layer
 * active, while leaving headroom for PH-4 personalities to vary it.
 */
export const DEFAULT_DURATION_COUPLING = 0.25;

export class DurationCouplingModulator implements Modulator {
  constructor(
    private readonly exponent: number,
    private readonly referenceIntervalMs: number,
  ) {
    if (!Number.isFinite(exponent) || exponent < 0 || exponent > 1) {
      throw new RangeError(`Coupling exponent must lie in [0, 1], received ${exponent}.`);
    }
    if (!(referenceIntervalMs > 0) || !Number.isFinite(referenceIntervalMs)) {
      throw new RangeError(
        `referenceIntervalMs must be finite and positive, received ${referenceIntervalMs}.`,
      );
    }
  }

  advance(context: MagnitudeContext): number {
    if (this.exponent === 0) return 1;
    return pow(Math.max(1, context.intervalMs) / this.referenceIntervalMs, this.exponent);
  }

  snapshot(): unknown {
    return null;
  }

  restore(_state: unknown): void {
    // Stateless: the coupling is a pure function of the interval.
  }
}
