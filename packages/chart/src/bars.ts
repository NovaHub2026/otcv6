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
  /**
   * The frame these four integers count in (PH-38.4), as the venue states it.
   *
   * Present and non-null: the bar was published under this lattice and is drawn
   * on it. Present and **null**: the bar's first and last sequences resolve to
   * different frames, or to none, so its open is in one unit and its close in
   * another — four integers that are not prices in either. Absent entirely: a
   * venue older than contract 3.1.0, which said nothing per bar, and the
   * caller's instrument is the only answer available.
   */
  readonly logQuantum?: number | null;
  readonly referencePrice?: number | null;
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
/**
 * What a window of candles reduced to, including what it could not (PH-38.4,
 * corrected by Cycle Audit 13, a3-01).
 *
 * A bar that states no frame is not drawn, and until now nothing said how many —
 * `toBars` returned an array and a caller could not tell a bar it had dropped
 * from a bar the venue never had. Measured on the live venue while the audit ran:
 * **24 of 30 assets rendered an entirely empty 1d chart**, and `btcusdt-otc` lost
 * 1,247 of 3,231 one-minute bars, with no message anywhere. An empty pane a
 * viewer cannot distinguish from an outage is the kind of honesty that reads as a
 * bug.
 */
export interface Series {
  readonly bars: Bar[];
  /** Bars the venue could not date, and which are therefore not drawn. */
  readonly undatable: number;
}

/** {@link toSeries}, for a caller that only wants what can be drawn. */
export function toBars(candles: readonly HistoryCandle[], instrument: InstrumentView): Bar[] {
  return toSeries(candles, instrument).bars;
}

export function toSeries(candles: readonly HistoryCandle[], instrument: InstrumentView): Series {
  const bars: Bar[] = [];
  let undatable = 0;
  let previous = -Infinity;
  for (const candle of candles) {
    if (candle.openInstant <= previous) {
      throw new SeriesError(
        `Candles must be strictly ordered; ${candle.openInstant} follows ${previous}. A chart ` +
          `library will draw an unordered series rather than refuse it.`,
      );
    }
    previous = candle.openInstant;
    // **Each bar on the frame it states, and no bar on a frame it does not**
    // (PH-38.4). Drawing everything on the caller's instrument is what made a
    // relattice move nineteen days of chart: the integers were right and the
    // lattice they were read with was not. A bar that states no frame is
    // skipped rather than drawn on today's, because a wrong candle is
    // indistinguishable from a real one and a missing one is not.
    const stated = 'logQuantum' in candle;
    const quantum = candle.logQuantum;
    const reference = candle.referencePrice;
    if (
      stated &&
      (quantum === null || quantum === undefined || reference === null || reference === undefined)
    ) {
      undatable += 1;
      continue;
    }
    const frame: InstrumentView =
      stated &&
      quantum !== null &&
      quantum !== undefined &&
      reference !== null &&
      reference !== undefined
        ? {
            logQuantum: quantum,
            referencePrice: reference,
            displayPrecision: instrument.displayPrecision,
          }
        : instrument;
    bars.push({
      time: Math.floor(candle.openInstant / 1000),
      open: displayPrice(candle.open, frame),
      high: displayPrice(candle.high, frame),
      low: displayPrice(candle.low, frame),
      close: displayPrice(candle.close, frame),
    });
  }
  return { bars, undatable };
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
  /** Bucket start most recently seeded from the record; a re-seed may not precede it. */
  #seeded: number | null = null;
  /** Whether the resume claim has been tested against a tick yet. */
  #joinChecked = false;
  /** Set when the first tick proved the stream did not continue where it claimed. */
  #joinBroken = false;

  constructor(
    readonly durationMs: number,
    readonly instrument: InstrumentView,
    /** Bucket start of the newest bar already drawn from history, if any. */
    private readonly historyThroughMs: number | null = null,
    /**
     * When this client's stream opened.
     *
     * **Cycle Audit 6, CA6-30.** `historyThroughMs` is the last bar that had
     * been *flushed* when the history was read, and a bucket that began before
     * the client connected but had not yet been flushed fell between the two:
     * the builder rebuilt it from whichever ticks arrived after connect.
     * Measured live — the panel's 22:03 candle opened at 68795.53 where the
     * record says 68825.00, and was **missing the high of 68825.00**, a price
     * the record holds and the extreme-preserving contract exists to protect.
     *
     * So a live bar is built only for a bucket that *started after* this client
     * connected — **unless** the caller can show it holds the bucket from its
     * true beginning, which is what {@link gaplessFromHistory} says.
     */
    private readonly openedAtMs: number | null = null,
    /**
     * The sequence the stream was asked to resume at, or `null` for the live
     * edge — **a claim this builder verifies rather than believes**.
     *
     * Set it to `lastSequence + 1` of the newest bar handed in as history (or
     * of the last seeded minute): the record then covers everything before that
     * sequence and this client holds everything from it, so a bucket after
     * `historyThroughMs` is one it holds *entire*. Nothing is rebuilt from a
     * partial view, which is the whole of what CA6-30 forbids.
     *
     * Why it matters: without it, the newest bar cannot move until the next
     * bucket boundary — up to a full hour on the panel's default one-hour
     * chart, with the live price line drifting away from a candle that never
     * follows it. Reported on 2026-09-02 as "the price moves and the candle
     * stands still", which was two correct rules producing a wrong screen.
     *
     * Why a sequence and not a boolean. As a boolean it was the *caller's*
     * assurance, and the caller got it wrong: the panel latched a "we gapped"
     * flag per effect instead of per connection, so a reconnect that gapped a
     * second time went on folding post-hole ticks onto a record seed while the
     * status bar said otherwise. Found by the PH-21 closure audit. A sequence
     * is checkable — if the first tick to arrive is not the one that was asked
     * for, the stream did not continue the record, and {@link joinBroken} says
     * so **from the data** rather than on the caller's word.
     */
    private readonly resumedAtSequence: number | null = null,
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

    // The first tick that is not a replay settles whether the resume held. A
    // stream that was asked for sequence N and answers with anything else did
    // not continue the record — whatever the caller believed, and whether or
    // not the caller was told. Replays are excluded above, so this is the tick
    // the subscription actually began at.
    if (this.resumedAtSequence !== null && !this.#joinChecked) {
      this.#joinChecked = true;
      if (tick.sequence !== this.resumedAtSequence) this.#joinBroken = true;
    }
    this.#lastSequence = tick.sequence;

    const start = bucketStart(tick.instant, this.durationMs);
    // Any bucket that had already begun is the record's, not ours — whether it
    // was flushed to history or was still open when this client connected.
    if (this.historyThroughMs !== null && start <= this.historyThroughMs) return null;
    // A seeded bucket is no exemption. The seed is the *record*; the live
    // stream is this client's. Joining them is only sound when the stream
    // resumed at the tick after the seed — which is exactly what
    // `gaplessFromHistory` asserts. Without that, the ticks between the last
    // seeded minute and this client's first are unaccounted for, and folding
    // the tail onto the seed would draw a bucket out of two pieces with a hole
    // between them. Such a bar is refreshed by seeding again, never by
    // accepting a tick.
    if (
      !this.#gapless &&
      this.openedAtMs !== null &&
      start <= bucketStart(this.openedAtMs, this.durationMs)
    ) {
      return null;
    }

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

  /**
   * Start the forming bucket from bars the record already holds.
   *
   * The panel's coarse timeframes made the conservative rule expensive: on a
   * one-hour chart the newest bar could not move for up to an hour, because a
   * client that connects mid-bucket holds none of the bucket's beginning. The
   * record does hold it — as *complete minute bars*, the permanent base tier —
   * and folding those in is not a rebuild from a partial view. It is the
   * record, read at a finer resolution than the chart draws.
   *
   * `throughSequence` is the last tick accounted for by `bars`. Ticks at or
   * below it are ignored, so a stream resumed at `throughSequence + 1` extends
   * the seed exactly once, and a replay that overlaps cannot double-count.
   *
   * Every bar must belong to the same target bucket; a caller that folds across
   * a boundary would be inventing one.
   */
  seedFrom(bars: readonly HistoryCandle[], throughSequence: number): void {
    if (bars.length === 0) return;
    const start = bucketStart(bars[0]!.openInstant, this.durationMs);
    // Seeding again is how a bar advances when the stream could not resume
    // exactly — the record is re-read as it fills. Backwards it must not go: a
    // later seed naming an earlier bucket would walk the newest bar into the
    // past, which a chart draws without complaint.
    //
    // Compared against **the bar being drawn**, not against the last seed. The
    // first version compared only against `#seeded`, which `accept` never
    // updates — so a builder that had been seeded and then advanced into a
    // later bucket by live ticks would accept a re-seed of the older bucket
    // and walk the newest bar back an hour. Found by the PH-21 closure audit,
    // which executed the sequence rather than reading the guard.
    const newest = Math.max(this.#seeded ?? -Infinity, (this.#open?.time ?? -Infinity) * 1000);
    if (Number.isFinite(newest) && start < newest) {
      throw new SeriesError(
        `A re-seed may not move the forming bucket backwards; ${String(start)} precedes ` +
          `${String(newest)}.`,
      );
    }
    for (const bar of bars) {
      if (bucketStart(bar.openInstant, this.durationMs) !== start) {
        throw new SeriesError(
          `A seed must lie inside one ${String(this.durationMs)}ms bucket; ` +
            `${String(bar.openInstant)} does not belong to the bucket at ${String(start)}.`,
        );
      }
    }
    let high = bars[0]!.high;
    let low = bars[0]!.low;
    for (const bar of bars) {
      if (bar.high > high) high = bar.high;
      if (bar.low < low) low = bar.low;
    }
    this.#open = {
      time: Math.floor(start / 1000),
      open: displayPrice(bars[0]!.open, this.instrument),
      high: displayPrice(high, this.instrument),
      low: displayPrice(low, this.instrument),
      close: displayPrice(bars[bars.length - 1]!.close, this.instrument),
    };
    this.#lastSequence = throughSequence;
    this.#seeded = start;
  }

  /** The bar currently accumulating, if any. */
  current(): Bar | null {
    return this.#open === null ? null : { ...this.#open };
  }

  /**
   * Whether the stream failed to continue where the resume claimed it would.
   *
   * False until a tick has been seen, because until then nothing is known.
   * Once true it stays true: the hole does not close, and the bucket the
   * client connected in is the record's for the rest of its life.
   */
  joinBroken(): boolean {
    return this.#joinBroken;
  }

  /** The resume claim, still standing. */
  get #gapless(): boolean {
    return this.resumedAtSequence !== null && !this.#joinBroken;
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
