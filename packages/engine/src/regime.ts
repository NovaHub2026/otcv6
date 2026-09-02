import { ln, pow, type RandomSource } from '@otc/core';
import type { MagnitudeContext } from './magnitude.js';
import type { Modulator } from './modulator.js';

/**
 * Macro volatility regime.
 *
 * A continuous-time semi-Markov chain over four volatility levels. The regime
 * sets *how large* moves are, never which way they go — ADR-0003 forbids the
 * latter, and a directional regime is not a thing this engine can have. What a
 * viewer reads as a trend is a realized excursion of a driftless walk, and PH-3.1
 * measured those excursions at 13.7 times the heterogeneity of a plain random
 * walk.
 *
 * ## Why Weibull sojourns with shape below one
 *
 * Two reasons, and both are requirements rather than preferences.
 *
 * **Non-lattice.** A regime lasting a whole number of ticks or candles
 * phase-locks to the candle and expiry grids, and the attack battery has a
 * family that conditions on exactly that. Sojourns are drawn in continuous time.
 *
 * **No characteristic duration** (§10). With shape below one the hazard falls
 * with age, so the remaining lifetime of a long-lived regime *grows* rather than
 * shrinking. Regimes therefore feel persistent and unpredictable in length,
 * instead of metronomic — which is what a fixed or exponential duration would
 * give.
 */
export const VOLATILITY_REGIMES = ['compressed', 'normal', 'elevated', 'stressed'] as const;
export type VolatilityRegime = (typeof VOLATILITY_REGIMES)[number];

export interface RegimeSpec {
  /** Multiplier applied to magnitude while in this regime. */
  readonly multiplier: number;
  /** Weibull scale, in milliseconds. Sets the typical sojourn length. */
  readonly scaleMs: number;
  /** Weibull shape. Below 1 gives a heavy-tailed, no-characteristic-duration law. */
  readonly shape: number;
  /** Transition weights to each regime, in `VOLATILITY_REGIMES` order. */
  readonly transitions: readonly number[];
}

export type RegimeConfig = Readonly<Record<VolatilityRegime, RegimeSpec>>;

/**
 * Defaults spanning quiet coils of tens of minutes to stressed episodes of a few
 * minutes, with transitions that favour neighbouring levels — volatility usually
 * escalates and subsides in steps rather than jumping between extremes.
 *
 * The multiplier spread is deliberately modest. This layer is one of three that
 * widen the volatility distribution, and their contributions to kurtosis
 * multiply rather than add; a wider spread here was measured and put excess
 * kurtosis an order of magnitude past any real market.
 */
export const DEFAULT_REGIMES: RegimeConfig = {
  compressed: {
    multiplier: 0.45,
    scaleMs: 45 * 60_000,
    shape: 0.8,
    transitions: [0, 0.75, 0.2, 0.05],
  },
  normal: { multiplier: 1.0, scaleMs: 60 * 60_000, shape: 0.75, transitions: [0.35, 0, 0.5, 0.15] },
  elevated: {
    multiplier: 1.9,
    scaleMs: 25 * 60_000,
    shape: 0.7,
    transitions: [0.1, 0.55, 0, 0.35],
  },
  stressed: {
    multiplier: 3.6,
    scaleMs: 8 * 60_000,
    shape: 0.65,
    transitions: [0.05, 0.25, 0.7, 0],
  },
};

export function assertRegimeConfig(config: RegimeConfig): void {
  for (const regime of VOLATILITY_REGIMES) {
    const spec = config[regime];
    if (!(spec.multiplier > 0) || !Number.isFinite(spec.multiplier)) {
      throw new RangeError(`Regime ${regime} multiplier must be finite and positive.`);
    }
    if (!(spec.scaleMs > 0) || !Number.isFinite(spec.scaleMs)) {
      throw new RangeError(`Regime ${regime} scaleMs must be finite and positive.`);
    }
    if (!(spec.shape > 0) || !Number.isFinite(spec.shape)) {
      throw new RangeError(`Regime ${regime} shape must be finite and positive.`);
    }
    if (spec.transitions.length !== VOLATILITY_REGIMES.length) {
      throw new RangeError(
        `Regime ${regime} needs ${VOLATILITY_REGIMES.length} transition weights, has ${spec.transitions.length}.`,
      );
    }
    let total = 0;
    for (const weight of spec.transitions) {
      if (!(weight >= 0) || !Number.isFinite(weight)) {
        throw new RangeError(
          `Regime ${regime} transition weights must be finite and non-negative.`,
        );
      }
      total += weight;
    }
    if (total <= 0) {
      throw new RangeError(`Regime ${regime} must be able to transition somewhere.`);
    }
  }
}

/** Weibull sample: `scale * (-ln U)^(1/shape)`. Uses the portable `ln` and `pow`. */
export function weibullSample(stream: RandomSource, scaleMs: number, shape: number): number {
  // 1 - u lies in (0, 1], so the logarithm is finite.
  const u = 1 - stream.nextFloat64();
  return scaleMs * pow(-ln(u), 1 / shape);
}

/**
 * Transitions one tick may consume before the sojourn law is declared broken.
 *
 * A single interval can outlast several short sojourns, which is why the
 * advance below loops; a thousand in one tick means the scale has collapsed
 * toward zero, and continuing would spin rather than model. Never reached by a
 * configuration `assertRegimeConfig` accepts at any tempo `TRAIT_BOUNDS`
 * allows.
 */
export const MAX_TRANSITIONS_PER_TICK = 1_000;

export interface RegimeSnapshot {
  readonly regime: VolatilityRegime;
  readonly remainingMs: number;
}

export class VolatilityRegimeModulator implements Modulator {
  #regime: VolatilityRegime;
  #remainingMs: number;

  constructor(
    readonly config: RegimeConfig,
    private readonly stream: RandomSource,
    initial: VolatilityRegime = 'normal',
  ) {
    assertRegimeConfig(config);
    this.#regime = initial;
    this.#remainingMs = this.#drawSojourn(initial);
  }

  #drawSojourn(regime: VolatilityRegime): number {
    const spec = this.config[regime];
    return weibullSample(this.stream, spec.scaleMs, spec.shape);
  }

  #transition(from: VolatilityRegime): VolatilityRegime {
    const weights = this.config[from].transitions;
    let total = 0;
    for (const weight of weights) total += weight;
    const target = this.stream.nextFloat64() * total;
    let cumulative = 0;
    for (let i = 0; i < weights.length; i += 1) {
      cumulative += weights[i]!;
      if (target < cumulative) return VOLATILITY_REGIMES[i]!;
    }
    /* c8 ignore next -- reachable only through floating-point accumulation */
    return VOLATILITY_REGIMES[VOLATILITY_REGIMES.length - 1]!;
  }

  advance(context: MagnitudeContext): number {
    // The multiplier is the regime in force at the START of this tick; a
    // transition takes effect from the next one. Both layers follow this rule,
    // so "which state produced this tick" has one answer.
    const multiplier = this.config[this.#regime].multiplier;

    this.#remainingMs -= context.intervalMs;
    // A loop rather than a single step: an interval can be longer than a
    // short sojourn, and skipping a regime silently would distort occupancy.
    let guard = 0;
    while (this.#remainingMs <= 0) {
      this.#regime = this.#transition(this.#regime);
      this.#remainingMs += this.#drawSojourn(this.#regime);
      guard += 1;
      if (guard > MAX_TRANSITIONS_PER_TICK) {
        throw new RangeError(
          `Regime sojourns are degenerate: more than ${MAX_TRANSITIONS_PER_TICK} transitions in one tick.`,
        );
      }
    }
    return multiplier;
  }

  get regime(): VolatilityRegime {
    return this.#regime;
  }

  snapshot(): RegimeSnapshot {
    return { regime: this.#regime, remainingMs: this.#remainingMs };
  }

  restore(state: unknown): void {
    const typed = state as RegimeSnapshot;
    if (!VOLATILITY_REGIMES.includes(typed.regime)) {
      throw new RangeError(`Unknown regime in snapshot: ${JSON.stringify(typed.regime)}.`);
    }
    this.#regime = typed.regime;
    this.#remainingMs = typed.remainingMs;
  }
}
