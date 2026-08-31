import type { MagnitudeContext, MagnitudeModel } from './magnitude.js';

/**
 * A sign-blind multiplier on magnitude.
 *
 * Layers compose as multipliers so each can be measured on its own: turning one
 * off is a configuration change, not a code change, which is what makes it
 * possible to attribute a realism movement to the mechanism that caused it.
 *
 * A modulator sees only what {@link MagnitudeContext} carries — elapsed time,
 * the previous magnitude, the instant. It cannot read a price or a sign.
 */
export interface Modulator {
  /** Advance latent state and return this tick's multiplier. Must be positive. */
  advance(context: MagnitudeContext): number;
  snapshot(): unknown;
  restore(state: unknown): void;
}

/** A magnitude model wrapped by an ordered stack of modulators. */
export class ModulatedMagnitudeModel implements MagnitudeModel {
  constructor(
    private readonly inner: MagnitudeModel,
    private readonly modulators: readonly Modulator[],
  ) {}

  advance(context: MagnitudeContext): number {
    let magnitude = this.inner.advance(context);
    for (const modulator of this.modulators) {
      const multiplier = modulator.advance(context);
      if (!(multiplier > 0) || !Number.isFinite(multiplier)) {
        throw new RangeError(`Modulator returned a non-positive multiplier: ${multiplier}.`);
      }
      magnitude *= multiplier;
    }
    return magnitude;
  }

  snapshot(): unknown {
    return {
      inner: this.inner.snapshot(),
      modulators: this.modulators.map((m) => m.snapshot()),
    };
  }

  restore(state: unknown): void {
    const typed = state as { inner: unknown; modulators: unknown[] };
    if (typed.modulators.length !== this.modulators.length) {
      throw new RangeError(
        `Snapshot has ${typed.modulators.length} modulators, expected ${this.modulators.length}.`,
      );
    }
    this.inner.restore(typed.inner);
    for (let i = 0; i < this.modulators.length; i += 1) {
      this.modulators[i]!.restore(typed.modulators[i]);
    }
  }
}
