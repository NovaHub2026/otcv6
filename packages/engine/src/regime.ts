import { ln, pow, type RandomSource } from '@otc/core';
import { DEFAULT_DURATION_COUPLING } from './hawkes.js';
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
 * ## A sojourn is a minimum and a memoryless remainder (PH-34)
 *
 * **Non-lattice.** A regime lasting a whole number of ticks or candles
 * phase-locks to the candle and expiry grids, and the attack battery has a
 * family that conditions on exactly that. Sojourns are drawn in continuous time.
 *
 * **Stochastic, not fixed** (§10). Until PH-34 a sojourn was a Weibull draw
 * with shape below one, whose mass sits near zero: on a typical asset the
 * median stressed episode was five minutes and half of them ended inside one
 * five-minute candle; on the most restless, a minute and four fifths. The Human
 * Owner saw it as a regime that changes from one candle to the next and asked
 * for durations like a market's, the highest regime the shortest "pero tampoco
 * una vela". So each regime has a **minimum** and, above it, a Weibull
 * remainder at shape one — exponential, memoryless: past the minimum, how long
 * a regime has left never depends on how long it has run, which keeps the
 * length unpredictable in the sense §10 asks for without the mass at zero.
 *
 * ## A ladder
 *
 * Transitions move one step: compressed ↔ normal ↔ elevated ↔ stressed, the
 * direction a fair draw with the weights below. Volatility escalates and
 * subsides through the levels between; the fast shocks §10 also allows come
 * from the structure layer's expansions and the cascade, not from a regime
 * jumping two levels at once.
 */
export const VOLATILITY_REGIMES = ['compressed', 'normal', 'elevated', 'stressed'] as const;
export type VolatilityRegime = (typeof VOLATILITY_REGIMES)[number];

export interface RegimeSpec {
  /**
   * The regime's volatility level relative to normal (PH-34): what its
   * multiplier and activity were split from, and what the volatility floor
   * compares against.
   */
  readonly level: number;
  /** Multiplier applied to each tick's magnitude while in this regime. */
  readonly multiplier: number;
  /**
   * Multiplier on the tick rate while in this regime (PH-34): the share of the
   * regime's volatility that arrives as more ticks rather than as larger ones.
   * The arrival model reads it; 1 is the market's base tempo.
   */
  readonly activity: number;
  /** Shortest sojourn, in milliseconds (PH-34). */
  readonly minimumMs: number;
  /** Weibull scale of the remainder above the minimum, in milliseconds. */
  readonly scaleMs: number;
  /** Weibull shape of the remainder. 1 is exponential: memoryless past the minimum. */
  readonly shape: number;
  /** Transition weights to each regime, in `VOLATILITY_REGIMES` order. */
  readonly transitions: readonly number[];
}

export type RegimeConfig = Readonly<Record<VolatilityRegime, RegimeSpec>>;

/**
 * Each regime's volatility level, as a multiple of the real instrument's
 * average volatility (PH-34, the Human Owner's numbers).
 *
 * Calm is 20% **above** the real market, because an OTC market must be
 * dynamic even at its quietest: "aun en los tramos más tranquilos debe haber
 * un movimiento por arriba de la media del mercado real". Until PH-34
 * compressed was ×0.45 of normal and the cascade could take it far lower —
 * the quietest moments moved at about a twentieth of normal.
 */
export const REGIME_LEVELS: Readonly<Record<VolatilityRegime, number>> = {
  compressed: 1.2,
  normal: 1.5,
  elevated: 2.2,
  stressed: 3.5,
};

/**
 * The share of a regime's variance that arrives as ticks rather than as size.
 *
 * A half, by the Human Owner's decision: a level `L` times normal multiplies
 * the tick rate by `L` and the effective tick size by `√L`, so variance per
 * unit time is `L²` either way and a candle is the size its level says.
 */
export const REGIME_ACTIVITY_SHARE = 0.5;

/** A regime's level relative to normal: what its multipliers are built from. */
export function relativeRegimeLevel(regime: VolatilityRegime): number {
  return REGIME_LEVELS[regime] / REGIME_LEVELS.normal;
}

/**
 * Split a relative level into a tick-rate factor and a per-tick multiplier.
 *
 * Variance per unit time is `rate × size²`, and the duration coupling shrinks
 * each tick by `rate^(−h)` because faster ticks mean shorter intervals
 * (`DurationCouplingModulator`). So `size = level · activity^(h − ½)` keeps
 * variance per unit time at `level²` whatever the activity is — including when
 * a floor on the tick rate has raised it above `level^(2·share)`.
 */
export function splitRegimeLevel(
  level: number,
  durationCoupling: number,
  minimumActivity = 0,
): { readonly activity: number; readonly multiplier: number } {
  if (!(level > 0) || !Number.isFinite(level)) {
    throw new RangeError(`A regime level must be finite and positive, received ${level}.`);
  }
  const activity = Math.max(pow(level, 2 * REGIME_ACTIVITY_SHARE), minimumActivity);
  return { activity, multiplier: level * pow(activity, durationCoupling - 0.5) };
}

/**
 * How long each regime lasts, before a market's own character scales it.
 *
 * Minimums and medians the Human Owner confirmed: compressed 30 min (median
 * about 1.4 h), normal 45 min (about 2 h), elevated 20 min (about 50 min),
 * stressed 10 min (about 18 min) — the highest the shortest, and never a
 * single five-minute candle.
 */
export const REGIME_DURATIONS: Readonly<
  Record<VolatilityRegime, { readonly minimumMs: number; readonly scaleMs: number }>
> = {
  compressed: { minimumMs: 30 * 60_000, scaleMs: 80 * 60_000 },
  normal: { minimumMs: 45 * 60_000, scaleMs: 110 * 60_000 },
  elevated: { minimumMs: 20 * 60_000, scaleMs: 40 * 60_000 },
  stressed: { minimumMs: 10 * 60_000, scaleMs: 12 * 60_000 },
};

/**
 * The ladder: from each regime, the weights of stepping down and up, in
 * `VOLATILITY_REGIMES` order. The ends can only step inward.
 */
export const REGIME_LADDER: Readonly<Record<VolatilityRegime, readonly number[]>> = {
  compressed: [0, 1, 0, 0],
  normal: [0.45, 0, 0.55, 0],
  elevated: [0, 0.65, 0, 0.35],
  stressed: [0, 0, 1, 0],
};

/**
 * The regime layer at the default personality: the levels above, split at the
 * default duration coupling, with no floor on the tick rate.
 *
 * The multiplier spread is still modest. This layer is one of three that widen
 * the volatility distribution, and their contributions to kurtosis multiply
 * rather than add.
 */
export const DEFAULT_REGIMES: RegimeConfig = Object.fromEntries(
  VOLATILITY_REGIMES.map((regime) => [
    regime,
    {
      level: relativeRegimeLevel(regime),
      ...splitRegimeLevel(relativeRegimeLevel(regime), DEFAULT_DURATION_COUPLING),
      ...REGIME_DURATIONS[regime],
      shape: 1,
      transitions: REGIME_LADDER[regime],
    },
  ]),
) as unknown as RegimeConfig;

export function assertRegimeConfig(config: RegimeConfig): void {
  for (const regime of VOLATILITY_REGIMES) {
    const spec = config[regime];
    if (!(spec.multiplier > 0) || !Number.isFinite(spec.multiplier)) {
      throw new RangeError(`Regime ${regime} multiplier must be finite and positive.`);
    }
    if (!(spec.level > 0) || !Number.isFinite(spec.level)) {
      throw new RangeError(`Regime ${regime} level must be finite and positive.`);
    }
    if (!(spec.activity > 0) || !Number.isFinite(spec.activity)) {
      throw new RangeError(`Regime ${regime} activity must be finite and positive.`);
    }
    if (!(spec.minimumMs >= 0) || !Number.isFinite(spec.minimumMs)) {
      throw new RangeError(`Regime ${regime} minimumMs must be finite and non-negative.`);
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
  /** The regime the last tick was sized under; the floor reads its level. */
  #inForce: VolatilityRegime;

  constructor(
    readonly config: RegimeConfig,
    private readonly stream: RandomSource,
    initial: VolatilityRegime = 'normal',
  ) {
    assertRegimeConfig(config);
    this.#regime = initial;
    this.#inForce = initial;
    this.#remainingMs = this.#drawSojourn(initial);
  }

  #drawSojourn(regime: VolatilityRegime): number {
    const spec = this.config[regime];
    return spec.minimumMs + weibullSample(this.stream, spec.scaleMs, spec.shape);
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
    this.#inForce = this.#regime;

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

  /**
   * The tick-rate factor of the regime in force now, for the arrival model
   * (PH-34). Read before a tick's interval is drawn, so it is the regime that
   * the tick about to be produced will be sized under: `advance` returns the
   * multiplier of the regime in force at the *start* of a tick, and a
   * transition takes effect from the next one.
   */
  get activity(): number {
    return this.config[this.#regime].activity;
  }

  /** The relative level of the regime the last tick was sized under (PH-34). */
  get levelInForce(): number {
    return this.config[this.#inForce].level;
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
    this.#inForce = typed.regime;
    this.#remainingMs = typed.remainingMs;
  }
}
