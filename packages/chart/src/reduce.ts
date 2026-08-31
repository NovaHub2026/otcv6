import { logPrice, type EpochMillis, type LogPrice } from '@otc/core/browser';

/**
 * One drawable column: what happened inside a slice of the window.
 *
 * This is an OHLC bar, and that is not a stylistic choice. Reducing a price path
 * to a fixed number of columns is lossy by necessity — a chart has hundreds of
 * pixels and the record has hundreds of thousands of ticks — and open/high/low/
 * close is precisely the reduction that keeps what matters about a path. Taking
 * the first tick per column, or every Nth, discards the spikes, and a spike is
 * usually the thing the viewer is looking at.
 */
export interface Column {
  readonly fromInstant: EpochMillis;
  readonly toInstant: EpochMillis;
  readonly open: LogPrice;
  readonly high: LogPrice;
  readonly low: LogPrice;
  readonly close: LogPrice;
  readonly tickCount: number;
}

export interface ReduceOptions {
  readonly from: EpochMillis;
  readonly to: EpochMillis;
  /** Drawable columns available, typically the pixel width of the chart. */
  readonly columns: number;
}

/**
 * Reduce a tick record to columns that can be drawn directly.
 *
 * Three properties hold, and each exists because the natural alternative lies to
 * the viewer:
 *
 * 1. **Every value drawn is a price that was actually observed.** Nothing is
 *    interpolated or averaged. A line drawn between two ticks implies every
 *    intermediate value traded; it did not. `query.ts` has said since PH-1.3
 *    that interpolating "would invent prices the market never visited, which is
 *    the same defect as synthesising a candle for an empty bucket" — and a
 *    binary option settles on whether the price crossed a level, so a smooth
 *    path through a level the market never touched is not cosmetic.
 *
 * 2. **Every extreme in the window survives.** The maximum of the columns' highs
 *    equals the maximum tick in the window, and likewise for lows. This is what
 *    makes the reduction honest at any zoom level.
 *
 * 3. **A slice with no ticks produces no column.** Markets tick irregularly; a
 *    flat bar across an empty minute asserts a trade that did not happen.
 *    `foldTicks` already refuses to synthesise, and the rendering path must not
 *    undo that on the way to the screen.
 */
export function reduceToColumns(
  instants: Float64Array,
  prices: Int32Array,
  options: ReduceOptions,
): Column[] {
  const { from, to, columns } = options;
  if (!Number.isInteger(columns) || columns < 1) {
    throw new RangeError(`columns must be a positive integer, received ${columns}.`);
  }
  if (!(to > from)) {
    throw new RangeError(`Window must be non-empty: received from ${from} to ${to}.`);
  }

  const length = Math.min(instants.length, prices.length);
  const span = to - from;
  const out: Column[] = [];

  let open = 0;
  let high = 0;
  let low = 0;
  let close = 0;
  let count = 0;
  let current = -1;

  const flush = (): void => {
    if (count === 0) return;
    const start = from + (span * current) / columns;
    const end = from + (span * (current + 1)) / columns;
    out.push({
      fromInstant: start as EpochMillis,
      toInstant: end as EpochMillis,
      open: logPrice(open),
      high: logPrice(high),
      low: logPrice(low),
      close: logPrice(close),
      tickCount: count,
    });
    count = 0;
  };

  for (let i = 0; i < length; i += 1) {
    const instant = instants[i]!;
    if (instant < from || instant >= to) continue;
    // Which column this tick falls in. Integer arithmetic on the offset rather
    // than a running accumulator, so a long window cannot drift.
    const column = Math.min(columns - 1, Math.floor(((instant - from) * columns) / span));
    if (column !== current) {
      flush();
      current = column;
    }
    const price = prices[i]!;
    if (count === 0) {
      open = price;
      high = price;
      low = price;
    } else {
      if (price > high) high = price;
      if (price < low) low = price;
    }
    close = price;
    count += 1;
  }
  flush();
  return out;
}

/**
 * The extremes of a window, computed directly from the record.
 *
 * Exists so the reduction can be checked against the truth rather than against
 * itself: `reduceToColumns` is only trustworthy if its highs and lows agree with
 * these.
 */
export function windowExtremes(
  instants: Float64Array,
  prices: Int32Array,
  from: EpochMillis,
  to: EpochMillis,
): { high: LogPrice; low: LogPrice; count: number } | null {
  const length = Math.min(instants.length, prices.length);
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let count = 0;
  for (let i = 0; i < length; i += 1) {
    const instant = instants[i]!;
    if (instant < from || instant >= to) continue;
    const price = prices[i]!;
    if (price > high) high = price;
    if (price < low) low = price;
    count += 1;
  }
  if (count === 0) return null;
  return { high: logPrice(high), low: logPrice(low), count };
}
