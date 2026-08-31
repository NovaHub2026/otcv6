/**
 * Canonical time primitives.
 *
 * The engine's canonical instant is an integer number of milliseconds since the
 * Unix epoch. Integer milliseconds are used rather than a floating-point or
 * higher-resolution representation because every downstream invariant depends on
 * exact arithmetic: bucket alignment, replay and settlement all compare and
 * divide instants, and a representation that can carry a fractional remainder
 * makes those comparisons platform-sensitive.
 *
 * Tick ordering never depends on clock resolution. Ticks carry their own
 * per-asset monotonic sequence number, so two ticks inside the same millisecond
 * remain strictly ordered.
 */

declare const epochMillisBrand: unique symbol;
declare const durationMillisBrand: unique symbol;

/** An instant, as whole milliseconds since the Unix epoch (UTC). */
export type EpochMillis = number & { readonly [epochMillisBrand]: true };

/** A duration, as a whole number of milliseconds. */
export type DurationMillis = number & { readonly [durationMillisBrand]: true };

/** The largest instant we accept: comfortably beyond any realistic use, and
 *  small enough that all arithmetic stays inside the safe-integer range. */
export const MAX_EPOCH_MILLIS = 8_640_000_000_000_000; // ECMAScript max Date value

export function isValidEpochMillis(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_EPOCH_MILLIS;
}

/**
 * Narrow a number to {@link EpochMillis}.
 *
 * @throws RangeError if the value is not a non-negative integer inside the
 *   representable range. Negative instants (pre-1970) are rejected: the market
 *   is a continuously running system with no pre-epoch history, and allowing
 *   them would make `t % duration` sign-dependent and bucket alignment subtly
 *   wrong.
 */
export function epochMillis(value: number): EpochMillis {
  if (!isValidEpochMillis(value)) {
    throw new RangeError(
      `Invalid epoch milliseconds: ${value}. Expected an integer in [0, ${MAX_EPOCH_MILLIS}].`,
    );
  }
  return value as EpochMillis;
}

export function isValidDurationMillis(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_EPOCH_MILLIS;
}

/**
 * Narrow a number to {@link DurationMillis}.
 *
 * @throws RangeError if the value is not a positive integer. Zero-length
 *   durations are rejected because every use of a duration in this codebase is a
 *   divisor.
 */
export function durationMillis(value: number): DurationMillis {
  if (!isValidDurationMillis(value)) {
    throw new RangeError(
      `Invalid duration in milliseconds: ${value}. Expected a positive integer.`,
    );
  }
  return value as DurationMillis;
}

export function addMillis(instant: EpochMillis, duration: DurationMillis): EpochMillis {
  return epochMillis(instant + duration);
}

export function differenceMillis(later: EpochMillis, earlier: EpochMillis): number {
  return later - earlier;
}

export const SECOND_MS = durationMillis(1_000);
export const MINUTE_MS = durationMillis(60_000);
export const HOUR_MS = durationMillis(3_600_000);
export const DAY_MS = durationMillis(86_400_000);
