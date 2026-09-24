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

/**
 * ln 2, to the last bit of a double, for the half-life weight below.
 *
 * Written out rather than taken from the portable module or `Math.LN2`: the
 * fdlibm port keeps ln 2 split into a high and a low part for its own range
 * reduction and exports neither, and ECMAScript specifies `Math.LN2` only as
 * "approximately" this value. A literal is exactly specified everywhere.
 */
const LN2 = 0.693_147_180_559_945_3;

/**
 * Floor on the running-average magnitude the excitation is normalised by.
 *
 * The average starts at `referenceMagnitude` and tracks what the tick stream
 * actually produces, so it is positive in every configuration; the floor is a
 * guard against a division by a magnitude average that has decayed to zero on
 * a market that stopped moving, not a value anything is tuned to.
 */
const MIN_REFERENCE_MAGNITUDE = 1e-9;

export interface HawkesSnapshot {
  readonly excitation: number;
  readonly averageMagnitude: number;
  /**
   * Whether the running average has seen a magnitude (PH-37.1).
   *
   * **It has to be in the snapshot, and the record caught that it was not.** A
   * market checkpointed before its first tick carries the seeded average, and a
   * resume that assumed it had observed *blended* its first magnitude where the
   * original *replaced* it — a different magnitude, a different interval, and a
   * tick at the same price four milliseconds later. `venue.service` refused it
   * as a fork in the record, which is exactly what it was: two streams claiming
   * one asset (INV-009).
   *
   * Absent means observed, which is true of every snapshot written before this
   * field existed — those all seam anyway, because the engine model is part of
   * the personality fingerprint.
   */
  readonly observed?: boolean;
}

/**
 * What sets the market's activity level between bursts: the volatility regime
 * in force (PH-34). Sign-blind by construction — a regime is drawn from its own
 * stream and never sees a price or a sign — so coupling arrivals to it couples
 * one sign-blind state to another, which is what ADR-0003 permits.
 */
export interface ActivitySource {
  /** Multiplier on the baseline intensity. 1 is the market's base tempo. */
  readonly activity: number;
}

export class HawkesArrivalModel implements ArrivalModel {
  #excitation: number;
  #averageMagnitude: number;
  /**
   * Whether the running average has seen a magnitude yet (PH-37.1).
   *
   * `referenceMagnitude` is an absolute number and the magnitudes it is
   * compared against are not: they are sizes in quanta, so how far the seed is
   * from the truth depends on the lattice the asset publishes on. Seeding the
   * excitation at its stationary value exposed it — the same seed left EUR/USD
   * 24% slow over its first 300 ticks on the current lattice and 60% fast on
   * one 32 times coarser, purely from the ratio `magnitude / 10`.
   *
   * So the first magnitude *becomes* the average rather than being blended into
   * a guess, which makes the opening ratio 1 whatever the units are. A restored
   * snapshot counts as having observed: its average is a measurement.
   */
  #observed = false;

  constructor(
    readonly config: HawkesConfig,
    private readonly stream: RandomSource,
    private readonly activitySource: ActivitySource | null = null,
  ) {
    assertHawkesConfig(config);
    this.#averageMagnitude = config.referenceMagnitude;
    // **Open at the stationary excitation, not at zero (PH-37.1).**
    //
    // `branchingRatio`'s own docstring states it: the realised mean interval is
    // `baseIntervalMs · (1 − n)` *because* the stationary excitation is
    // `n / (1 − n)`. Starting at zero opens every market at the immigrant rate
    // and lets it climb, so a market ticks at a fraction of its calibrated pace
    // until the excitation fills — measured over 150 independent markets of
    // EUR/USD, **0.86 ticks a second over the first 300 against 1.55 settled,
    // a 44% shortfall**, and the higher the branching the worse it is.
    //
    // That is not a quiet corner: a genesis restarts here, and so does every
    // seam — a restart, a restore, an upgrade, and since ADR-0020 a market that
    // reopens itself after an outage. The engine was opening each of them on a
    // market that ticks at half pace for its first half hour.
    //
    // The seed is a property of the configuration, not of any state this model
    // cannot vouch for, which is what makes it legitimate on a seam: it is the
    // mean of the distribution the process is stationary in, not a memory of
    // what happened before the gap. Sign-blind, like everything here.
    this.#excitation = config.branchingRatio / (1 - config.branchingRatio);
  }

  /**
   * The baseline intensity multiplier now: the regime's activity, or 1.
   *
   * **Only the baseline is scaled, never the excitation.** Speeding the whole
   * process up by `a` would multiply the branching ratio by `a` as well — each
   * arrival's excitation decays in wall-clock time while the arrivals it excites
   * come `a` times faster — and a stressed regime at ×2.3 on a market at 0.6
   * would be explosive at 1.4. Scaling the immigrant rate alone keeps the
   * branching ratio what the configuration says, and the stationary rate
   * `a / (tempo · (1 − n))` scales by exactly `a`.
   */
  #activity(): number {
    const activity = this.activitySource?.activity ?? 1;
    if (!(activity > 0) || !Number.isFinite(activity)) {
      throw new RangeError(`Arrival activity must be finite and positive, received ${activity}.`);
    }
    return activity;
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
          (-Math.max(1, context.elapsedSincePreviousMs) * LN2) /
            this.config.magnitudeAverageHalfLifeMs,
        );
      if (this.#observed) {
        this.#averageMagnitude += (context.previousMagnitude - this.#averageMagnitude) * weight;
      } else {
        this.#averageMagnitude = context.previousMagnitude;
        this.#observed = true;
      }
    }
    const reference = Math.max(MIN_REFERENCE_MAGNITUDE, this.#averageMagnitude);

    // Then excite, in proportion to the relative size of the tick just produced.
    this.#excitation += excitationPerEvent(this.config) * (context.previousMagnitude / reference);

    const activity = this.#activity();
    const multiplier = Math.min(
      activity + this.#excitation,
      activity * this.config.maxIntensityMultiplier,
    );
    const meanIntervalMs = this.config.baseIntervalMs / multiplier;
    const u = 1 - this.stream.nextFloat64();
    return Math.max(1, Math.floor(-ln(u) * meanIntervalMs));
  }

  /** Current intensity multiplier. Diagnostics and tests. */
  get intensityMultiplier(): number {
    const activity = this.#activity();
    return Math.min(activity + this.#excitation, activity * this.config.maxIntensityMultiplier);
  }

  /** Running average magnitude. Diagnostics and tests. */
  get averageMagnitude(): number {
    return this.#averageMagnitude;
  }

  snapshot(): HawkesSnapshot {
    return {
      excitation: this.#excitation,
      averageMagnitude: this.#averageMagnitude,
      observed: this.#observed,
    };
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
    this.#observed = typed.observed ?? true;
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
