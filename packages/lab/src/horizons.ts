import { durationMillis, type DurationMillis } from '@otc/core';

/**
 * The product's fixed expiration horizons.
 *
 * Durations, not tick counts. A contract opened at instant `t` expires at
 * `t + horizon`; how many ticks fall in between is itself random and is part of
 * what the market model varies. Measuring in ticks would condition on something
 * the product never fixes, and would miss any leak living in the relationship
 * between activity and elapsed time.
 */
export interface HorizonSpec {
  readonly label: string;
  readonly durationMs: DurationMillis;
}

function horizon(label: string, seconds: number): HorizonSpec {
  return { label, durationMs: durationMillis(seconds * 1_000) };
}

export const BINARY_HORIZONS: readonly HorizonSpec[] = Object.freeze([
  horizon('30s', 30),
  horizon('1m', 60),
  horizon('2m', 120),
  horizon('3m', 180),
  horizon('4m', 240),
  horizon('5m', 300),
  horizon('10m', 600),
  horizon('15m', 900),
]);

export function horizonByLabel(label: string): HorizonSpec {
  const found = BINARY_HORIZONS.find((h) => h.label === label);
  if (found === undefined) {
    throw new RangeError(
      `Unknown horizon ${JSON.stringify(label)}. Known: ${BINARY_HORIZONS.map((h) => h.label).join(', ')}.`,
    );
  }
  return found;
}
