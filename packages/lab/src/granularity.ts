import type { Tick } from '@otc/core';

/**
 * Tick granularity (PH-24.17): what a candle chart shows of a market's tick
 * structure, measured from the record.
 *
 * A candle opens on the first tick inside it and the previous one closed on
 * the last tick before it, so the boundary gap is one tick step. Whether that
 * step is visible depends on how many ticks a candle holds and how large a
 * step is against the candle's range. These are the numbers the Human Owner
 * looked at when the candles read as gappy, computed the way the chart would.
 */
export interface GranularityReport {
  /** Complete minute buckets measured (the first and last, partial, are dropped). */
  readonly minutes: number;
  readonly ticksPerMinute: { readonly median: number; readonly p10: number; readonly p90: number };
  /** |open − previous close| over the candle's own range, per minute bucket. */
  readonly gapOverRange: { readonly median: number; readonly shareAboveQuarter: number };
  /** One tick's move, in lattice steps. */
  readonly step: { readonly median: number; readonly p90: number; readonly zeroShare: number };
  /** Milliseconds between consecutive ticks. */
  readonly intervalMs: { readonly median: number; readonly p90: number };
}

const MINUTE_MS = 60_000;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[at]!;
}

const median = (values: readonly number[]): number =>
  quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );

export function tickGranularity(ticks: readonly Tick[]): GranularityReport {
  interface Bucket {
    start: number;
    open: number;
    high: number;
    low: number;
    close: number;
    count: number;
  }
  const buckets: Bucket[] = [];
  const steps: number[] = [];
  const intervals: number[] = [];
  let previous: Tick | null = null;
  for (const tick of ticks) {
    if (previous !== null) {
      steps.push(Math.abs(tick.price - previous.price));
      intervals.push(tick.instant - previous.instant);
    }
    const start = Math.floor(tick.instant / MINUTE_MS) * MINUTE_MS;
    const last = buckets[buckets.length - 1];
    if (last === undefined || last.start !== start) {
      buckets.push({
        start,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        count: 1,
      });
    } else {
      last.high = Math.max(last.high, tick.price);
      last.low = Math.min(last.low, tick.price);
      last.close = tick.price;
      last.count += 1;
    }
    previous = tick;
  }
  // Complete buckets only: the first and the last are cut by the sample's edges.
  const complete = buckets.slice(1, -1);
  const counts = complete.map((b) => b.count).sort((a, b) => a - b);
  const ratios: number[] = [];
  for (let i = 1; i < complete.length; i += 1) {
    const candle = complete[i]!;
    const gap = Math.abs(candle.open - complete[i - 1]!.close);
    const range = Math.max(1, candle.high - candle.low);
    ratios.push(gap / range);
  }
  const sortedRatios = [...ratios].sort((a, b) => a - b);
  const sortedSteps = [...steps].sort((a, b) => a - b);
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  return {
    minutes: complete.length,
    ticksPerMinute: {
      median: quantile(counts, 0.5),
      p10: quantile(counts, 0.1),
      p90: quantile(counts, 0.9),
    },
    gapOverRange: {
      median: quantile(sortedRatios, 0.5),
      shareAboveQuarter:
        ratios.length === 0 ? Number.NaN : ratios.filter((r) => r > 0.25).length / ratios.length,
    },
    step: {
      median: median(steps),
      p90: quantile(sortedSteps, 0.9),
      zeroShare:
        steps.length === 0 ? Number.NaN : steps.filter((s) => s === 0).length / steps.length,
    },
    intervalMs: { median: median(intervals), p90: quantile(sortedIntervals, 0.9) },
  };
}
