import { exp, pow, standardNormal, type RandomSource } from '@otc/core';
import type { MagnitudeContext, MagnitudeModel } from './magnitude.js';

/**
 * Markov-switching multifractal volatility cascade.
 *
 * Volatility is a product of `K` components, each resampling at its own rate:
 *
 * ```
 * volatility = base * prod_{k=1..K} M_k
 * ```
 *
 * Component `k` resamples with hazard `gamma_1 * b^(k-1)` per unit time, drawing
 * from a two-point distribution `{m0, 2 - m0}` with unit mean. Slow components
 * turn over across hours, fast ones across seconds.
 *
 * Chosen over a sum of Ornstein–Uhlenbeck factors for three reasons:
 *
 *  - **Long memory from a tiny state.** The product of components switching at
 *    geometrically spaced rates gives `|r|` autocorrelation that decays slowly
 *    rather than exponentially, which is the single most recognisable signature
 *    of a real market — and the whole latent state is `K` numbers, so a market
 *    snapshot stays small enough to persist per tick.
 *  - **Genuine multifractality.** Volatility scales differently at different
 *    horizons, which is what makes a chart look the same kind of alive when
 *    zoomed in and out.
 *  - **Exact discretisation.** Switching is driven by elapsed time through a
 *    closed-form probability, so a tick of any length is handled exactly. No
 *    integration step, no dependence on tick rate.
 *
 * Every input is sign-blind: elapsed time and the component's own randomness.
 */

export interface CascadeConfig {
  /** Number of components. More gives a longer memory span. */
  readonly components: number;
  /** Switching hazard of the slowest component, per millisecond. */
  readonly slowestHazardPerMs: number;
  /** Geometric ratio between successive components' hazards. */
  readonly hazardRatio: number;
  /** Low value of the two-point multiplier; the high value is `2 - m0`. */
  readonly lowMultiplier: number;
}

/**
 * Ten components spanning roughly six hours down to a few seconds.
 *
 * `lowMultiplier` is 0.7 rather than a more dramatic 0.6 because the cascade is
 * not the only layer widening the volatility distribution. Kurtosis of a normal
 * scale mixture is `3 * prod(E[M^4] / E[M^2]^2)` across independent
 * multiplicative factors, so the cascade, the volatility regime and the
 * structure phase *multiply* their contributions. At 0.6 with all three layers
 * active, measured excess kurtosis was 1366 against a target ceiling of 200 —
 * far past any real market.
 */
export const DEFAULT_CASCADE: CascadeConfig = {
  components: 10,
  slowestHazardPerMs: 1 / (6 * 3_600_000),
  hazardRatio: 2.6,
  lowMultiplier: 0.78,
};

/**
 * The mechanism's own ceiling on components.
 *
 * Six above `TRAIT_BOUNDS.cascadeDepth.max`, deliberately: the personality
 * fence is the region assets are authored in, and this is the point past which
 * a cascade is a configuration error rather than a market — at the narrowest
 * spacing a personality may use, twenty-four rungs already span more than the
 * longest volatility memory any asset is allowed. A hand-written config past it
 * has mistaken the field for something else.
 */
export const MAX_CASCADE_COMPONENTS = 24;

/**
 * Validate a cascade configuration.
 *
 * `lowMultiplier` may be exactly 1. **Cycle Audit 7, a3-03.**
 * `TRAIT_BOUNDS.clustering.min` is 0, which expands to `lowMultiplier: 1` — a
 * two-point multiplier on `{1, 1}`, the constant cascade, with an inflation of
 * exactly 1. The trait fence admitted it and this refused it, so a personality
 * `assertPersonalityTraits` called legal could not be built, and a registration
 * starting there was refused at `safety` with a cascade message about a trait
 * the caller had set inside its bounds.
 *
 * Admitted as the degenerate case rather than raising the fence. A strictly
 * positive floor would re-normalise every trait distance in
 * `differentiation.ts` and move the basis of a measured threshold; the constant
 * cascade, by contrast, runs, snapshots and restores like any other, and still
 * draws from its stream on every switch so cursors advance identically.
 */
export function assertCascadeConfig(config: CascadeConfig): void {
  if (
    !Number.isInteger(config.components) ||
    config.components < 1 ||
    config.components > MAX_CASCADE_COMPONENTS
  ) {
    throw new RangeError(
      `Cascade components must be an integer in [1, ${MAX_CASCADE_COMPONENTS}], received ${config.components}.`,
    );
  }
  if (!(config.slowestHazardPerMs > 0) || !Number.isFinite(config.slowestHazardPerMs)) {
    throw new RangeError(
      `slowestHazardPerMs must be finite and positive, received ${config.slowestHazardPerMs}.`,
    );
  }
  if (!(config.hazardRatio > 1) || !Number.isFinite(config.hazardRatio)) {
    throw new RangeError(
      `hazardRatio must be finite and greater than 1, received ${config.hazardRatio}.`,
    );
  }
  if (!(config.lowMultiplier > 0 && config.lowMultiplier <= 1)) {
    throw new RangeError(`lowMultiplier must lie in (0, 1], received ${config.lowMultiplier}.`);
  }
}

export interface CascadeSnapshot {
  readonly multipliers: readonly number[];
}

export class VolatilityCascade {
  readonly #multipliers: Float64Array;
  readonly #hazards: Float64Array;
  readonly #low: number;
  readonly #high: number;

  constructor(
    readonly config: CascadeConfig,
    private readonly stream: RandomSource,
  ) {
    assertCascadeConfig(config);
    this.#low = config.lowMultiplier;
    this.#high = 2 - config.lowMultiplier;
    this.#multipliers = new Float64Array(config.components);
    this.#hazards = new Float64Array(config.components);
    for (let k = 0; k < config.components; k += 1) {
      // Portable pow: the platform's is implementation-approximated, and a
      // hazard that differs between machines would break replay.
      this.#hazards[k] = config.slowestHazardPerMs * pow(config.hazardRatio, k);
      this.#multipliers[k] = this.#draw();
    }
  }

  #draw(): number {
    return this.stream.nextBoolean() ? this.#high : this.#low;
  }

  /**
   * Advance by `intervalMs` and return the volatility multiplier.
   *
   * Each component switches with probability `1 - exp(-hazard * interval)`,
   * which is exact for any interval length rather than an approximation valid
   * only for small steps.
   */
  advance(intervalMs: number): number {
    let product = 1;
    for (let k = 0; k < this.#multipliers.length; k += 1) {
      const switchProbability = 1 - exp(-this.#hazards[k]! * intervalMs);
      if (this.stream.nextFloat64() < switchProbability) {
        this.#multipliers[k] = this.#draw();
      }
      product *= this.#multipliers[k]!;
    }
    return product;
  }

  /** Current multiplier without advancing. Diagnostics and tests. */
  current(): number {
    let product = 1;
    for (let k = 0; k < this.#multipliers.length; k += 1) product *= this.#multipliers[k]!;
    return product;
  }

  /** Switching hazard of component `k`, per millisecond. */
  hazardOf(component: number): number {
    return this.#hazards[component]!;
  }

  snapshot(): CascadeSnapshot {
    return { multipliers: Array.from(this.#multipliers) };
  }

  restore(state: CascadeSnapshot): void {
    if (state.multipliers.length !== this.#multipliers.length) {
      throw new RangeError(
        `Cascade snapshot has ${state.multipliers.length} components, expected ${this.#multipliers.length}.`,
      );
    }
    for (let k = 0; k < this.#multipliers.length; k += 1) {
      this.#multipliers[k] = state.multipliers[k]!;
    }
  }
}

/**
 * A magnitude model driven by the cascade.
 *
 * Magnitude is `base * cascade * |z|`, with `z` standard normal. Heavy tails and
 * jumps arrive in PH-3.3; this subphase establishes the spine and measures what
 * it does not yet reproduce.
 */
export class CascadeMagnitudeModel implements MagnitudeModel {
  readonly #cascade: VolatilityCascade;

  constructor(
    private readonly baseVolatility: number,
    config: CascadeConfig,
    private readonly cascadeStream: RandomSource,
    private readonly shockStream: RandomSource,
  ) {
    if (!(baseVolatility > 0) || !Number.isFinite(baseVolatility)) {
      throw new RangeError(
        `baseVolatility must be finite and positive, received ${baseVolatility}.`,
      );
    }
    this.#cascade = new VolatilityCascade(config, cascadeStream);
  }

  advance(context: MagnitudeContext): number {
    const volatility = this.baseVolatility * this.#cascade.advance(context.intervalMs);
    return volatility * Math.abs(standardNormal(this.shockStream));
  }

  /** The cascade itself, for tests and for PH-3.2's regime layer. */
  get cascade(): VolatilityCascade {
    return this.#cascade;
  }

  snapshot(): CascadeSnapshot {
    return this.#cascade.snapshot();
  }

  restore(state: unknown): void {
    this.#cascade.restore(state as CascadeSnapshot);
  }
}
