import { exp, pow, type RandomSource } from '@otc/core';
import type { MagnitudeContext } from './magnitude.js';
import type { Modulator } from './modulator.js';

/**
 * Meso structure: compression and expansion.
 *
 * This is what produces the shapes a chartist names — ranges, breakouts, false
 * breakouts, retests — without the engine ever knowing where the price is.
 *
 * ## How structure emerges without a level
 *
 * A `coil` is a stretch of suppressed magnitude. The "range" a viewer sees is
 * simply the running high and low of that stretch; the engine is not steering
 * toward a level, it is producing small moves for a while. When the phase
 * resolves into `expansion`, magnitudes jump and the walk leaves the area it had
 * been wandering in — which reads as a breakout. Because the direction of
 * departure is a fresh fair coin, roughly half of those breakouts return through
 * the range, which reads as a false breakout and a retest.
 *
 * None of it is scripted, and none of it is anchored to a price. PH-2 measured
 * what the level-anchored alternative costs: it is invisible to every
 * conventional attack family and yields a material directional edge.
 *
 * ## The hazard is reflection-invariant
 *
 * The transition out of `coil` depends on **path length per unit time** — how
 * much distance the price covered, ignoring direction — and on the phase's age.
 * A long, tight coil has a high hazard of expanding. Both inputs are absolute
 * magnitudes, so negating every sign leaves the hazard bit-identical, which is
 * exactly what the mirror test checks.
 */
export const STRUCTURE_PHASES = ['coil', 'expansion', 'neutral', 'exhaustion'] as const;
export type StructurePhase = (typeof STRUCTURE_PHASES)[number];

export interface PhaseSpec {
  /** Multiplier applied to magnitude while in this phase. */
  readonly multiplier: number;
  /** Baseline hazard per millisecond of leaving this phase. */
  readonly baseHazardPerMs: number;
  /**
   * Weibull-like age exponent. Above 1 makes the phase increasingly likely to
   * end as it ages; below 1 makes it sticky.
   */
  readonly ageExponent: number;
  /** Reference age, in milliseconds, at which the age term is unity. */
  readonly ageScaleMs: number;
  /**
   * Sensitivity to compression. Positive values raise the hazard when the path
   * covered per unit time is *below* its running average — a tight coil.
   */
  readonly compressionSensitivity: number;
  /** Transition weights, in `STRUCTURE_PHASES` order. */
  readonly transitions: readonly number[];
}

export type StructureConfig = Readonly<Record<StructurePhase, PhaseSpec>>;

/**
 * Multiplier spread is modest for the same reason as the regime layer's: three
 * layers widening the volatility distribution multiply their contributions to
 * kurtosis. What makes a coil read as a coil is the *contrast* against its
 * surroundings, not the absolute depth.
 */
export const DEFAULT_STRUCTURE: StructureConfig = {
  // A coil is quiet, sticky at first, and increasingly likely to break the
  // longer and tighter it gets.
  coil: {
    multiplier: 0.7,
    baseHazardPerMs: 1 / (12 * 60_000),
    ageExponent: 1.6,
    ageScaleMs: 12 * 60_000,
    compressionSensitivity: 1.4,
    transitions: [0, 0.75, 0.25, 0],
  },
  // Expansion is violent and short.
  expansion: {
    multiplier: 1.9,
    baseHazardPerMs: 1 / (3 * 60_000),
    ageExponent: 1.3,
    ageScaleMs: 3 * 60_000,
    compressionSensitivity: 0,
    transitions: [0.15, 0, 0.45, 0.4],
  },
  neutral: {
    multiplier: 1.0,
    baseHazardPerMs: 1 / (20 * 60_000),
    ageExponent: 1.1,
    ageScaleMs: 20 * 60_000,
    compressionSensitivity: 0.6,
    transitions: [0.45, 0.25, 0, 0.3],
  },
  // Exhaustion follows a burst: activity fades before the market settles.
  exhaustion: {
    multiplier: 0.85,
    baseHazardPerMs: 1 / (8 * 60_000),
    ageExponent: 1.2,
    ageScaleMs: 8 * 60_000,
    compressionSensitivity: 0.4,
    transitions: [0.5, 0.05, 0.45, 0],
  },
};

export function assertStructureConfig(config: StructureConfig): void {
  for (const phase of STRUCTURE_PHASES) {
    const spec = config[phase];
    if (!(spec.multiplier > 0) || !Number.isFinite(spec.multiplier)) {
      throw new RangeError(`Phase ${phase} multiplier must be finite and positive.`);
    }
    if (!(spec.baseHazardPerMs > 0) || !Number.isFinite(spec.baseHazardPerMs)) {
      throw new RangeError(`Phase ${phase} baseHazardPerMs must be finite and positive.`);
    }
    if (!(spec.ageScaleMs > 0) || !Number.isFinite(spec.ageScaleMs)) {
      throw new RangeError(`Phase ${phase} ageScaleMs must be finite and positive.`);
    }
    if (spec.transitions.length !== STRUCTURE_PHASES.length) {
      throw new RangeError(
        `Phase ${phase} needs ${STRUCTURE_PHASES.length} transition weights, has ${spec.transitions.length}.`,
      );
    }
    let total = 0;
    for (const weight of spec.transitions) {
      if (!(weight >= 0) || !Number.isFinite(weight)) {
        throw new RangeError(`Phase ${phase} transition weights must be finite and non-negative.`);
      }
      total += weight;
    }
    if (total <= 0) throw new RangeError(`Phase ${phase} must be able to transition somewhere.`);
  }
}

export interface StructureSnapshot {
  readonly phase: StructurePhase;
  readonly ageMs: number;
  readonly pathLength: number;
  readonly averagePathRate: number;
}

/** Time constant of the running path-rate average, in milliseconds. */
const PATH_RATE_HALFLIFE_MS = 30 * 60_000;

export class StructurePhaseModulator implements Modulator {
  #phase: StructurePhase;
  #ageMs = 0;
  #pathLength = 0;
  #averagePathRate = 0;

  constructor(
    readonly config: StructureConfig,
    private readonly stream: RandomSource,
    initial: StructurePhase = 'neutral',
  ) {
    assertStructureConfig(config);
    this.#phase = initial;
  }

  #transition(from: StructurePhase): StructurePhase {
    const weights = this.config[from].transitions;
    let total = 0;
    for (const weight of weights) total += weight;
    const target = this.stream.nextFloat64() * total;
    let cumulative = 0;
    for (let i = 0; i < weights.length; i += 1) {
      cumulative += weights[i]!;
      if (target < cumulative) return STRUCTURE_PHASES[i]!;
    }
    /* c8 ignore next -- reachable only through floating-point accumulation */
    return STRUCTURE_PHASES[STRUCTURE_PHASES.length - 1]!;
  }

  advance(context: MagnitudeContext): number {
    const interval = Math.max(1, context.intervalMs);
    this.#ageMs += interval;
    // Path length uses the previous MAGNITUDE, never a signed increment. This is
    // the whole reason the phase layer survives the mirror test.
    this.#pathLength += context.previousMagnitude;

    const instantRate = context.previousMagnitude / interval;
    const decay = exp(-interval / PATH_RATE_HALFLIFE_MS);
    this.#averagePathRate =
      this.#averagePathRate === 0
        ? instantRate
        : this.#averagePathRate * decay + instantRate * (1 - decay);

    // The multiplier is the phase in force at the START of this tick; a
    // transition takes effect from the next one. The regime layer follows the
    // same rule, so "which state produced this tick" has one answer.
    const spec = this.config[this.#phase];
    const multiplier = spec.multiplier;
    const age = Math.max(1, this.#ageMs);
    // Age term: rising for exponents above 1, so a phase becomes more likely to
    // end the longer it has run.
    const ageTerm = pow(age / spec.ageScaleMs, spec.ageExponent - 1);

    // Compression term: how tight this phase has been relative to the running
    // average. Below-average path per unit time raises the hazard of expanding.
    const phaseRate = this.#pathLength / age;
    const reference = this.#averagePathRate > 0 ? this.#averagePathRate : phaseRate;
    const tightness = reference > 0 ? phaseRate / reference : 1;
    const compressionTerm = exp(spec.compressionSensitivity * (1 - Math.min(3, tightness)));

    const hazard = spec.baseHazardPerMs * ageTerm * compressionTerm;
    const transitionProbability = 1 - exp(-Math.max(0, hazard) * interval);
    if (this.stream.nextFloat64() < transitionProbability) {
      this.#phase = this.#transition(this.#phase);
      this.#ageMs = 0;
      this.#pathLength = 0;
    }

    return multiplier;
  }

  get phase(): StructurePhase {
    return this.#phase;
  }

  /** Current hazard inputs. Exposed for tests and diagnostics. */
  get diagnostics(): { ageMs: number; pathLength: number; averagePathRate: number } {
    return {
      ageMs: this.#ageMs,
      pathLength: this.#pathLength,
      averagePathRate: this.#averagePathRate,
    };
  }

  snapshot(): StructureSnapshot {
    return {
      phase: this.#phase,
      ageMs: this.#ageMs,
      pathLength: this.#pathLength,
      averagePathRate: this.#averagePathRate,
    };
  }

  restore(state: unknown): void {
    const typed = state as StructureSnapshot;
    if (!STRUCTURE_PHASES.includes(typed.phase)) {
      throw new RangeError(`Unknown structure phase in snapshot: ${JSON.stringify(typed.phase)}.`);
    }
    this.#phase = typed.phase;
    this.#ageMs = typed.ageMs;
    this.#pathLength = typed.pathLength;
    this.#averagePathRate = typed.averagePathRate;
  }
}
