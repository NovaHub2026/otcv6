import type { EpochMillis } from '@otc/core';

/**
 * Everything the magnitude engine is allowed to see.
 *
 * This type is the anti-predictability guarantee expressed as a compile error.
 *
 * ADR-0003 holds only while the magnitude and timing process never observes a
 * sign, a price, or anything derived from either. That precondition is easy to
 * state and easy to lose: the leverage effect — volatility responding to the
 * *signed* return — is one of the most robust stylized facts in real markets,
 * arrives as a three-line change, leaves the process an exact martingale, and is
 * worth 2.9 percentage points of directional edge. It would pass review.
 *
 * So the context carries magnitudes and elapsed time and nothing else. A
 * magnitude function cannot read a sign because it is never given one.
 *
 * The wall-clock instant is permitted: it is not derived from any sign, and the
 * cascade needs it because components must resample on elapsed **time** rather
 * than on tick counts. A component resampling every N ticks would phase-lock to
 * activity, and activity is something an observer can see.
 */
export interface MagnitudeContext {
  /** Elapsed time since the previous tick, in milliseconds. */
  readonly intervalMs: number;
  /** Absolute size of the previous increment, in lattice steps. Never signed. */
  readonly previousMagnitude: number;
  /** Wall-clock instant of the tick being generated. */
  readonly instant: EpochMillis;
  /** How many ticks have been generated. Sign-blind. */
  readonly sequence: number;
}

/**
 * A sign-blind source of tick magnitudes.
 *
 * Returns a magnitude in **log units**, non-negative. Quantisation to the
 * lattice and the application of the sign both happen outside, in that order:
 * rounding a magnitude is symmetric, rounding a signed price is not.
 */
export interface MagnitudeModel {
  /** Advance latent state and return the magnitude for this tick, in log units. */
  advance(context: MagnitudeContext): number;
  /** Serialise the latent state. */
  snapshot(): unknown;
  /** Restore latent state produced by {@link snapshot}. */
  restore(state: unknown): void;
}

/**
 * A sign-blind source of inter-arrival times.
 *
 * Separate from the magnitude model because volatility can arrive either as more
 * ticks or as bigger ones, and that choice is a personality axis in PH-4 rather
 * than a property of either component alone.
 */
export interface ArrivalModel {
  /** Milliseconds until the next tick. At least 1. */
  nextIntervalMs(context: MagnitudeContext): number;
  snapshot(): unknown;
  restore(state: unknown): void;
}
