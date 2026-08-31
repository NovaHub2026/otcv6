import { durationMillis, epochMillis, type DurationMillis, type EpochMillis } from './instant.js';

/**
 * Chart timeframes.
 *
 * Two properties are load-bearing and are asserted by tests rather than assumed:
 *
 *  1. Every timeframe duration divides every coarser timeframe duration
 *     (the divisibility chain 5, 3, 2, 2, 5, 3, 2, 2, 4, 6).
 *  2. Every bucket is aligned to the Unix epoch.
 *
 * Together these make a coarse candle exactly the union of the fine candles
 * inside it, which is what lets every timeframe be a pure view over one tick
 * stream (INV-003, INV-004).
 *
 * Weekly and monthly timeframes are deliberately absent. Their lengths do not
 * divide evenly into a fixed grid, so they would break exact nesting and would
 * reintroduce calendar logic into a market that runs continuously.
 */
export const TIMEFRAME_IDS = [
  '1s',
  '5s',
  '15s',
  '30s',
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
] as const;

export type TimeframeId = (typeof TIMEFRAME_IDS)[number];

export interface Timeframe {
  readonly id: TimeframeId;
  readonly durationMs: DurationMillis;
}

const DURATIONS_MS: Readonly<Record<TimeframeId, number>> = {
  '1s': 1_000,
  '5s': 5_000,
  '15s': 15_000,
  '30s': 30_000,
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

const TIMEFRAMES: Readonly<Record<TimeframeId, Timeframe>> = Object.freeze(
  Object.fromEntries(
    TIMEFRAME_IDS.map((id) => [
      id,
      Object.freeze({ id, durationMs: durationMillis(DURATIONS_MS[id]) }),
    ]),
  ) as Record<TimeframeId, Timeframe>,
);

export function timeframe(id: TimeframeId): Timeframe {
  return TIMEFRAMES[id];
}

/** All timeframes, ordered from finest to coarsest. */
export function allTimeframes(): readonly Timeframe[] {
  return TIMEFRAME_IDS.map(timeframe);
}

export function isTimeframeId(value: string): value is TimeframeId {
  return Object.prototype.hasOwnProperty.call(DURATIONS_MS, value);
}

/** Start of the bucket containing `instant`, inclusive. */
export function bucketStart(instant: EpochMillis, tf: Timeframe): EpochMillis {
  return epochMillis(instant - (instant % tf.durationMs));
}

/** End of the bucket containing `instant`, exclusive. */
export function bucketEnd(instant: EpochMillis, tf: Timeframe): EpochMillis {
  return epochMillis(bucketStart(instant, tf) + tf.durationMs);
}

/** Zero-based index of the bucket containing `instant`, counting from the epoch. */
export function bucketIndex(instant: EpochMillis, tf: Timeframe): number {
  return (instant - (instant % tf.durationMs)) / tf.durationMs;
}

export function isCoarserOrEqual(a: Timeframe, b: Timeframe): boolean {
  return a.durationMs >= b.durationMs;
}

/** True when `coarse` buckets are exact unions of `fine` buckets. */
export function nests(fine: Timeframe, coarse: Timeframe): boolean {
  return coarse.durationMs % fine.durationMs === 0;
}

/** How many `fine` buckets fit in one `coarse` bucket. */
export function nestingFactor(fine: Timeframe, coarse: Timeframe): number {
  if (!nests(fine, coarse)) {
    throw new RangeError(`Timeframe ${fine.id} does not nest inside ${coarse.id}.`);
  }
  return coarse.durationMs / fine.durationMs;
}
