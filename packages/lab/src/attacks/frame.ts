import { bucketStart, epochMillis, timeframe, type EpochMillis } from '@otc/core';
import type { ObserverDataset } from '../observer.js';

/**
 * Rolling features, precomputed once per dataset in a single linear pass.
 *
 * Every family used to recompute its own windowed statistics per entry. With a
 * 240-tick range window, twenty families and eight horizons that is hundreds of
 * operations per entry per family — which capped a run at a few hundred thousand
 * samples, and a few hundred thousand samples is a detection floor of about
 * 0.26 percentage points. The threshold the battery has to police at the
 * promotional payout is 0.25.
 *
 * So the cost was not an inconvenience, it was the difference between a battery
 * that can answer the question and one that cannot. Computing each rolling
 * statistic once, incrementally, takes the floor to roughly 0.10pp at the same
 * wall-clock budget.
 *
 * Float32 is used for the derived statistics: they exist only to place an entry
 * into one of a handful of buckets, and single precision is far finer than a
 * bucket boundary.
 */

export const VOLATILITY_WINDOW = 60;
export const EFFICIENCY_WINDOW = 60;
export const RANGE_WINDOW = 240;
export const RUN_CAP = 8;

export interface MinuteCandles {
  /** Minute index of the first minute present. */
  readonly baseMinute: number;
  readonly open: Int32Array;
  readonly high: Int32Array;
  readonly low: Int32Array;
  readonly close: Int32Array;
  readonly present: Uint8Array;
}

export interface FeatureFrame {
  readonly dataset: ObserverDataset;
  readonly prices: Int32Array;
  readonly instants: Float64Array;
  /** RMS tick change over the trailing window; NaN before the window fills. */
  readonly volatility: Float32Array;
  /** Net displacement over path length across the trailing window; NaN if undefined. */
  readonly efficiency: Float32Array;
  /** Position within the trailing high-low range, on [0, 1]; NaN if undefined. */
  readonly rangePosition: Float32Array;
  /** Signed length of the current same-sign run, capped; 0 when the last tick was flat. */
  readonly signedRun: Int8Array;
  readonly minutes: MinuteCandles;
}

/** Monotonic deque giving sliding-window extrema in amortised O(1). */
class ExtremaWindow {
  #indices: Int32Array;
  #head = 0;
  #tail = 0;

  constructor(
    capacity: number,
    private readonly better: (a: number, b: number) => boolean,
  ) {
    this.#indices = new Int32Array(capacity + 1);
  }

  push(index: number, values: Int32Array, windowStart: number): void {
    while (
      this.#tail > this.#head &&
      !this.better(values[this.#indices[this.#tail - 1]!]!, values[index]!)
    ) {
      this.#tail -= 1;
    }
    this.#indices[this.#tail] = index;
    this.#tail += 1;
    while (this.#indices[this.#head]! < windowStart) this.#head += 1;
  }

  value(values: Int32Array): number {
    return values[this.#indices[this.#head]!]!;
  }
}

export function buildFeatureFrame(dataset: ObserverDataset): FeatureFrame {
  const prices = dataset.prices;
  const instants = dataset.instants;
  const n = prices.length;

  const volatility = new Float32Array(n).fill(Number.NaN);
  const efficiency = new Float32Array(n).fill(Number.NaN);
  const rangePosition = new Float32Array(n).fill(Number.NaN);
  const signedRun = new Int8Array(n);

  let squaredSum = 0;
  let absoluteSum = 0;
  let run = 0;
  let runDirection = 0;

  const maxWindow = new ExtremaWindow(n, (a, b) => a >= b);
  const minWindow = new ExtremaWindow(n, (a, b) => a <= b);

  for (let i = 0; i < n; i += 1) {
    if (i > 0) {
      const delta = prices[i]! - prices[i - 1]!;
      squaredSum += delta * delta;
      absoluteSum += Math.abs(delta);
      if (i > VOLATILITY_WINDOW) {
        const old = prices[i - VOLATILITY_WINDOW]! - prices[i - VOLATILITY_WINDOW - 1]!;
        squaredSum -= old * old;
      }
      if (i > EFFICIENCY_WINDOW) {
        const old = prices[i - EFFICIENCY_WINDOW]! - prices[i - EFFICIENCY_WINDOW - 1]!;
        absoluteSum -= Math.abs(old);
      }

      const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1;
      if (direction === 0) {
        run = 0;
        runDirection = 0;
      } else if (direction === runDirection) {
        run = Math.min(RUN_CAP, run + 1);
      } else {
        run = 1;
        runDirection = direction;
      }
      signedRun[i] = runDirection * run;

      if (i >= VOLATILITY_WINDOW) volatility[i] = Math.sqrt(squaredSum / VOLATILITY_WINDOW);
      if (i >= EFFICIENCY_WINDOW && absoluteSum > 0) {
        efficiency[i] = Math.abs(prices[i]! - prices[i - EFFICIENCY_WINDOW]!) / absoluteSum;
      }
    }

    const windowStart = Math.max(0, i - RANGE_WINDOW);
    maxWindow.push(i, prices, windowStart);
    minWindow.push(i, prices, windowStart);
    if (i >= RANGE_WINDOW) {
      const high = maxWindow.value(prices);
      const low = minWindow.value(prices);
      if (high !== low) rangePosition[i] = (prices[i]! - low) / (high - low);
    }
  }

  return {
    dataset,
    prices,
    instants,
    volatility,
    efficiency,
    rangePosition,
    signedRun,
    minutes: buildMinuteCandles(prices, instants),
  };
}

/**
 * Completed one-minute candles, indexed by minute.
 *
 * Held per minute rather than per tick: there are far fewer minutes than ticks,
 * and a family only ever wants the last *completed* one. Reading the dataset's
 * cached fold instead would be look-ahead through the back door — that fold
 * covers the whole history, and the candle containing an entry is not finished
 * yet, so its high and low may not have happened.
 */
function buildMinuteCandles(prices: Int32Array, instants: Float64Array): MinuteCandles {
  const minute = timeframe('1m');
  const n = prices.length;
  if (n === 0) {
    return {
      baseMinute: 0,
      open: new Int32Array(0),
      high: new Int32Array(0),
      low: new Int32Array(0),
      close: new Int32Array(0),
      present: new Uint8Array(0),
    };
  }
  const baseMinute = Math.floor(instants[0]! / minute.durationMs);
  const lastMinute = Math.floor(instants[n - 1]! / minute.durationMs);
  const span = lastMinute - baseMinute + 1;

  const open = new Int32Array(span);
  const high = new Int32Array(span);
  const low = new Int32Array(span);
  const close = new Int32Array(span);
  const present = new Uint8Array(span);

  for (let i = 0; i < n; i += 1) {
    const slot = Math.floor(instants[i]! / minute.durationMs) - baseMinute;
    const price = prices[i]!;
    if (present[slot] === 0) {
      present[slot] = 1;
      open[slot] = price;
      high[slot] = price;
      low[slot] = price;
    } else {
      if (price > high[slot]!) high[slot] = price;
      if (price < low[slot]!) low[slot] = price;
    }
    close[slot] = price;
  }
  return { baseMinute, open, high, low, close, present };
}

export interface CompletedMinute {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** The last completed minute strictly before the entry instant, or null. */
export function lastCompletedMinute(
  frame: FeatureFrame,
  entryInstant: EpochMillis,
): CompletedMinute | null {
  const minute = timeframe('1m');
  const slot =
    Math.floor(bucketStart(epochMillis(entryInstant), minute) / minute.durationMs) -
    frame.minutes.baseMinute -
    1;
  if (slot < 0 || slot >= frame.minutes.present.length || frame.minutes.present[slot] === 0) {
    return null;
  }
  return {
    open: frame.minutes.open[slot]!,
    high: frame.minutes.high[slot]!,
    low: frame.minutes.low[slot]!,
    close: frame.minutes.close[slot]!,
  };
}
