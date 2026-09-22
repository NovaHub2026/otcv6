import type { MagnitudeContext } from './magnitude.js';
import type { Modulator } from './modulator.js';

/**
 * A floor under the volatility level (PH-34).
 *
 * The Human Owner's requirement: "el OTC debe ser dinámico, así que aun en los
 * tramos más tranquilos debe haber un movimiento por arriba de la media del
 * mercado real". Before this, the quietest moments of the market were the
 * product of three sign-blind layers at their low states — a compressed regime
 * at ×0.45 of normal, a cascade whose product can sit at a small fraction of
 * its typical value, a coil at ×0.7 — and moved at about a twentieth of
 * normal.
 *
 * The **level** is the product of the three layers' state: the regime's level
 * relative to normal, the cascade's product relative to its reference, and the
 * structure phase's multiplier. When it falls below `floor`, this modulator
 * lifts the tick by exactly the shortfall, so the volatility the market is at
 * is never below the floor. The per-tick shock — the draw that makes one tick
 * larger than the next — is not floored: a floor on the expected movement, not
 * on each tick or each candle, which a fair walk can still make small by
 * chance.
 *
 * **Sign-blind.** Every input is a magnitude state drawn from a stream that
 * never sees a price or a sign, so the floor is a function of sign-blind state
 * and ADR-0003's involution is untouched; the mirror test runs on it. And it is
 * a multiplier, so the path stays homogeneous of degree one in the base
 * volatility and the calibration's exact rescale to a dispersion budget still
 * holds (`asset.ts`).
 *
 * Stateless: it reads the layers it sits above, after they have advanced for
 * this tick, which is why it must be the **last** modulator in the stack.
 */
export interface FloorSources {
  /** The regime level the tick is being sized under, relative to normal. */
  readonly regimeLevel: () => number;
  /** The cascade's product for this tick, before any reference is applied. */
  readonly cascadeProduct: () => number;
  /** The structure phase multiplier the tick is being sized with. */
  readonly structureMultiplier: () => number;
}

export interface VolatilityFloorConfig {
  /** The lowest level, relative to the normal regime at the cascade's reference. */
  readonly level: number;
  /** The cascade product that counts as the regime's own level: its typical value. */
  readonly cascadeReference: number;
}

export function assertVolatilityFloorConfig(config: VolatilityFloorConfig): void {
  if (!(config.level > 0) || !Number.isFinite(config.level)) {
    throw new RangeError(
      `The volatility floor must be finite and positive, received ${config.level}.`,
    );
  }
  if (!(config.cascadeReference > 0) || !Number.isFinite(config.cascadeReference)) {
    throw new RangeError(
      `The cascade reference must be finite and positive, received ${config.cascadeReference}.`,
    );
  }
}

export class VolatilityFloorModulator implements Modulator {
  constructor(
    readonly config: VolatilityFloorConfig,
    private readonly sources: FloorSources,
  ) {
    assertVolatilityFloorConfig(config);
  }

  /** The level the layers put the market at for this tick, before the floor. */
  level(): number {
    return (
      this.sources.regimeLevel() *
      (this.sources.cascadeProduct() / this.config.cascadeReference) *
      this.sources.structureMultiplier()
    );
  }

  advance(_context: MagnitudeContext): number {
    const level = this.level();
    return level >= this.config.level ? 1 : this.config.level / level;
  }

  snapshot(): unknown {
    return null;
  }

  restore(_state: unknown): void {
    // Stateless: it reads the layers beneath it.
  }
}
