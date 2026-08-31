import { bucketStart, epochMillis, timeframe, type EpochMillis } from '@otc/core';
import type { ObserverDataset } from '../observer.js';

/**
 * Feature computations shared by the attack families.
 *
 * Every function here takes an `entryIndex` and reads no index beyond it. That
 * discipline is the single most important property of this file: a feature that
 * reads one tick too far turns a fair market into an apparent goldmine, which is
 * exactly what happened to a PH-1 design probe.
 */

/** Signed price change over the last `lag` ticks, or `null` without history. */
export function trailingChange(
  dataset: ObserverDataset,
  entryIndex: number,
  lag: number,
): number | null {
  const from = entryIndex - lag;
  if (from < 0) return null;
  return dataset.prices[entryIndex]! - dataset.prices[from]!;
}

/** Sign of the most recent price change: 1 up, 0 down, -1 unchanged or unknown. */
export function previousMoveSign(dataset: ObserverDataset, entryIndex: number): number {
  if (entryIndex < 1) return -1;
  const delta = dataset.prices[entryIndex]! - dataset.prices[entryIndex - 1]!;
  return delta > 0 ? 1 : delta < 0 ? 0 : -1;
}

/** Length of the current run of same-signed ticks, counting back from the entry. */
export function runLength(dataset: ObserverDataset, entryIndex: number, cap: number): number {
  if (entryIndex < 1) return 0;
  const first = dataset.prices[entryIndex]! - dataset.prices[entryIndex - 1]!;
  if (first === 0) return 0;
  const direction = first > 0 ? 1 : -1;
  let length = 1;
  for (let i = entryIndex - 1; i > 0 && length < cap; i -= 1) {
    const delta = dataset.prices[i]! - dataset.prices[i - 1]!;
    if (delta === 0 || (delta > 0 ? 1 : -1) !== direction) break;
    length += 1;
  }
  return length;
}

/** Root-mean-square tick change over a trailing window. */
export function realizedVolatility(
  dataset: ObserverDataset,
  entryIndex: number,
  window: number,
): number | null {
  if (entryIndex < window) return null;
  let sum = 0;
  for (let i = entryIndex - window + 1; i <= entryIndex; i += 1) {
    const delta = dataset.prices[i]! - dataset.prices[i - 1]!;
    sum += delta * delta;
  }
  return Math.sqrt(sum / window);
}

/** Net displacement divided by total path length: how directed the recent path was. */
export function efficiencyRatio(
  dataset: ObserverDataset,
  entryIndex: number,
  window: number,
): number | null {
  if (entryIndex < window) return null;
  let path = 0;
  for (let i = entryIndex - window + 1; i <= entryIndex; i += 1) {
    path += Math.abs(dataset.prices[i]! - dataset.prices[i - 1]!);
  }
  if (path === 0) return null;
  return Math.abs(dataset.prices[entryIndex]! - dataset.prices[entryIndex - window]!) / path;
}

/** Position of the current price within its trailing range, on [0, 1]. */
export function positionInRange(
  dataset: ObserverDataset,
  entryIndex: number,
  window: number,
): number | null {
  if (entryIndex < window) return null;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  for (let i = entryIndex - window; i <= entryIndex; i += 1) {
    const price = dataset.prices[i]!;
    if (price > high) high = price;
    if (price < low) low = price;
  }
  if (high === low) return null;
  return (dataset.prices[entryIndex]! - low) / (high - low);
}

export interface CompletedCandle {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/**
 * The last fully completed one-minute candle before the entry instant, built
 * from ticks at or before the entry index only.
 *
 * Built here rather than read from `dataset.candles` because the cached fold
 * covers the whole history, including the future. Using it would be look-ahead
 * through the back door: the candle containing the entry is not complete yet,
 * and its high and low may not have happened.
 */
export function lastCompletedMinute(
  dataset: ObserverDataset,
  entryIndex: number,
  entryInstant: EpochMillis,
): CompletedCandle | null {
  const minute = timeframe('1m');
  const currentStart = bucketStart(entryInstant, minute);
  const previousStart = currentStart - minute.durationMs;
  if (previousStart < dataset.firstInstant) return null;

  let open: number | null = null;
  let close: number | null = null;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  for (let i = entryIndex; i >= 0; i -= 1) {
    const instant = dataset.instants[i]!;
    if (instant >= currentStart) continue;
    if (instant < previousStart) break;
    const price = dataset.prices[i]!;
    if (price > high) high = price;
    if (price < low) low = price;
    if (close === null) close = price;
    open = price;
  }
  if (open === null || close === null) return null;
  return { open, high, low, close };
}

/** Milliseconds elapsed within the current minute at the entry instant. */
export function phaseWithinMinute(entryInstant: EpochMillis): number {
  const minute = timeframe('1m');
  return entryInstant - bucketStart(epochMillis(entryInstant), minute);
}

/** Non-negative price modulo `cell`, handling negative canonical prices. */
export function priceModulo(price: number, cell: number): number {
  return ((price % cell) + cell) % cell;
}

/** Bucket a value against ascending thresholds fitted on training data. */
export function bucketByThresholds(value: number, thresholds: readonly number[]): number {
  for (let i = 0; i < thresholds.length; i += 1) {
    if (value < thresholds[i]!) return i;
  }
  return thresholds.length;
}

/** Quantile thresholds of a sample, for fitting bucket boundaries. */
export function quantileThresholds(values: number[], buckets: number): number[] {
  if (values.length === 0 || buckets < 2) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const thresholds: number[] = [];
  for (let i = 1; i < buckets; i += 1) {
    thresholds.push(
      sorted[Math.min(sorted.length - 1, Math.floor((i / buckets) * sorted.length))]!,
    );
  }
  return thresholds;
}
