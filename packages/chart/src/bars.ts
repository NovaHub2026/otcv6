import { exp, type Tick } from '@otc/core/browser';

/**
 * The bridge between the record and a chart library, and it invents nothing.
 *
 * It lives beside `reduce.ts` rather than in the web app because it is the same
 * concern: PH-8 built the extreme-preserving reduction of ticks to columns, and
 * this is the extreme-preserving conversion of the record's own OHLC bars into
 * whatever a chart library calls a candlestick. Both answer "what may a screen
 * show", and the answer is the same in both: only what the record holds.
 *
 * Putting it here also puts it inside the root build and the type-aware lint,
 * which `apps/web` was outside of until PH-18.2 noticed.
 *
 * TradingView Lightweight Charts draws OHLC bars. The record already holds OHLC
 * bars whose highs and lows are prices the market **actually visited** — never
 * interpolated, and each traceable to the ticks that produced it. So the bridge
 * is a conversion of units and nothing more, and that is the property worth
 * protecting: every number the viewer sees has to be a number the record holds.
 *
 * ## Why this file has no React and no chart library in it
 *
 * Because it is the part that can be wrong in a way nobody would notice. A
 * component that mounts a chart is either visible or broken; a bar builder that
 * loses a spike looks fine. So the arithmetic lives here, framework-free and
 * unit-tested, and the component is left with nothing but mounting.
 *
 * ## Prices
 *
 * The record is an integer count of log units (ADR-0004) and a chart is a
 * decimal price. The conversion is `reference * exp(price * quantum)`, it is
 * one-way, and nothing is ever compared in display space — a comparison there
 * would be a comparison against a rounded number, which is the channel worth up
 * to 22 percentage points of directional edge that ADR-0004 exists to close.
 */

export interface HistoryCandle {
  readonly openInstant: number;
  readonly timeframe: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly tickCount: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
}

export interface InstrumentView {
  readonly logQuantum: number;
  readonly referencePrice: number;
  readonly displayPrecision: number;
}

/** What Lightweight Charts calls a candlestick datum. Time is in seconds. */
export interface Bar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** Display price for a canonical integer. One-way, never compared against. */
export function displayPrice(price: number, instrument: InstrumentView): number {
  // `exp` from the portable kernel, not `Math.exp`: ECMAScript does not specify
  // the latter exactly, so two engines can disagree on the last bits — and a
  // display price that differs between a viewer's browser and an operator's
  // would be two answers to one question about one market.
  return instrument.referencePrice * exp(price * instrument.logQuantum);
}

export class SeriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeriesError';
  }
}

/**
 * Convert stored candles to drawable bars.
 *
 * Bars must arrive strictly ordered — Lightweight Charts silently misdraws an
 * out-of-order series rather than refusing it, so the refusal happens here. The
 * seconds resolution its time axis uses is coarser than the record's
 * milliseconds, which is exactly why the finest timeframe served from history is
 * a minute: two bars in one second would collide.
 */
export function toBars(candles: readonly HistoryCandle[], instrument: InstrumentView): Bar[] {
  const bars: Bar[] = [];
  let previous = -Infinity;
  for (const candle of candles) {
    if (candle.openInstant <= previous) {
      throw new SeriesError(
        `Candles must be strictly ordered; ${candle.openInstant} follows ${previous}. A chart ` +
          `library will draw an unordered series rather than refuse it.`,
      );
    }
    previous = candle.openInstant;
    bars.push({
      time: Math.floor(candle.openInstant / 1000),
      open: displayPrice(candle.open, instrument),
      high: displayPrice(candle.high, instrument),
      low: displayPrice(candle.low, instrument),
      close: displayPrice(candle.close, instrument),
    });
  }
  return bars;
}

/** Bucket start for an instant, on a fixed grid from the epoch. */
export function bucketStart(instant: number, durationMs: number): number {
  return Math.floor(instant / durationMs) * durationMs;
}

/**
 * Folds live ticks into the bar currently open, and closes it on time.
 *
 * This is the only place the panel produces a bar rather than reading one, and
 * it exists because the live edge of a chart is always a bar that has not
 * finished. Two rules make it honest:
 *
 * - **The high and the low only ever widen.** A viewer who saw a spike must not
 *   watch it disappear because a later tick came back.
 * - **A bar is never emitted for a bucket that already has one.** History and
 *   the live stream overlap at the join, and the stored bar is the one the
 *   record holds; a live rebuild of a bucket whose ticks are partly in the past
 *   would draw a bar out of a fragment.
 */
export class LiveBarBuilder {
  #open: { time: number; open: number; high: number; low: number; close: number } | null = null;
  #lastSequence: number | null = null;

  constructor(
    readonly durationMs: number,
    readonly instrument: InstrumentView,
    /** Bucket start of the newest bar already drawn from history, if any. */
    private readonly historyThroughMs: number | null = null,
  ) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new SeriesError(`A bar duration must be positive, got ${durationMs}.`);
    }
  }

  /**
   * Feed one tick. Returns the bar to draw, or null when the tick is skipped.
   *
   * Ticks must arrive in sequence order. A repeat is ignored rather than folded
   * twice — a reconnecting stream replays from the resume point, and counting a
   * tick twice would inflate the bar's tick count and could widen its range with
   * a price already counted.
   */
  accept(tick: Tick): Bar | null {
    if (this.#lastSequence !== null && tick.sequence <= this.#lastSequence) return null;
    this.#lastSequence = tick.sequence;

    const start = bucketStart(tick.instant, this.durationMs);
    // The bucket the last stored bar belongs to is the record's, not ours.
    if (this.historyThroughMs !== null && start <= this.historyThroughMs) return null;

    const price = displayPrice(tick.price, this.instrument);
    if (this.#open === null || this.#open.time * 1000 !== start) {
      this.#open = {
        time: Math.floor(start / 1000),
        open: price,
        high: price,
        low: price,
        close: price,
      };
      return { ...this.#open };
    }
    if (price > this.#open.high) this.#open.high = price;
    if (price < this.#open.low) this.#open.low = price;
    this.#open.close = price;
    return { ...this.#open };
  }

  /** The bar currently accumulating, if any. */
  current(): Bar | null {
    return this.#open === null ? null : { ...this.#open };
  }
}

/** Timeframes the panel offers, and where each one is served from. */
export const PANEL_TIMEFRAMES = [
  { id: '1m', durationMs: 60_000, defaultSpanMs: 6 * 3_600_000 },
  { id: '5m', durationMs: 300_000, defaultSpanMs: 24 * 3_600_000 },
  { id: '15m', durationMs: 900_000, defaultSpanMs: 3 * 86_400_000 },
  { id: '30m', durationMs: 1_800_000, defaultSpanMs: 7 * 86_400_000 },
  { id: '1h', durationMs: 3_600_000, defaultSpanMs: 14 * 86_400_000 },
  { id: '4h', durationMs: 14_400_000, defaultSpanMs: 45 * 86_400_000 },
  { id: '1d', durationMs: 86_400_000, defaultSpanMs: 90 * 86_400_000 },
] as const;

export type PanelTimeframeId = (typeof PANEL_TIMEFRAMES)[number]['id'];

export function panelTimeframe(id: PanelTimeframeId): (typeof PANEL_TIMEFRAMES)[number] {
  const found = PANEL_TIMEFRAMES.find((entry) => entry.id === id);
  if (found === undefined) throw new SeriesError(`Unknown panel timeframe ${id}.`);
  return found;
}
