import { bucketStart, type Timeframe, type TimeframeId } from '../time/timeframe.js';
import type { EpochMillis } from '../time/instant.js';
import { nests, nestingFactor, timeframe as timeframeById } from '../time/timeframe.js';
import type { LogPrice } from './instrument.js';
import { assertTickOrder, type Tick } from './tick.js';

/**
 * An OHLC bar folded from ticks.
 *
 * `high` and `low` are prices the market **actually visited**, never
 * interpolated. `firstSequence` and `lastSequence` make every candle traceable
 * to the exact ticks that produced it, which is what makes historical
 * reconstruction auditable rather than approximate (INV-009).
 */
export interface Candle {
  readonly openInstant: EpochMillis;
  readonly timeframe: TimeframeId;
  readonly open: LogPrice;
  readonly high: LogPrice;
  readonly low: LogPrice;
  readonly close: LogPrice;
  readonly tickCount: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
}

interface MutableCandle {
  openInstant: EpochMillis;
  open: LogPrice;
  high: LogPrice;
  low: LogPrice;
  close: LogPrice;
  tickCount: number;
  firstSequence: number;
  lastSequence: number;
}

function freeze(candle: MutableCandle, id: TimeframeId): Candle {
  return {
    openInstant: candle.openInstant,
    timeframe: id,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    tickCount: candle.tickCount,
    firstSequence: candle.firstSequence,
    lastSequence: candle.lastSequence,
  };
}

/**
 * Streaming tick-to-candle fold.
 *
 * Pure: it holds no clock and no generator, so it is structurally impossible for
 * the displayed timeframe to influence the market (INV-004). The aggregator
 * cannot reach anything that produces prices.
 */
export class CandleAggregator {
  #open: MutableCandle | null = null;
  #previousTick: Tick | null = null;

  constructor(readonly timeframe: Timeframe) {}

  /** Feed one tick. Returns the candle that just closed, if this tick opened a new bucket. */
  accept(tick: Tick): Candle | null {
    assertTickOrder(this.#previousTick, tick);
    this.#previousTick = tick;

    const start = bucketStart(tick.instant, this.timeframe);
    let closed: Candle | null = null;

    if (this.#open !== null && this.#open.openInstant !== start) {
      closed = freeze(this.#open, this.timeframe.id);
      this.#open = null;
    }

    if (this.#open === null) {
      this.#open = {
        openInstant: start,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        tickCount: 1,
        firstSequence: tick.sequence,
        lastSequence: tick.sequence,
      };
      return closed;
    }

    const open = this.#open;
    if (tick.price > open.high) open.high = tick.price;
    if (tick.price < open.low) open.low = tick.price;
    open.close = tick.price;
    open.tickCount += 1;
    open.lastSequence = tick.sequence;
    return closed;
  }

  /** The bucket currently accumulating, if any. */
  current(): Candle | null {
    return this.#open === null ? null : freeze(this.#open, this.timeframe.id);
  }
}

/** Batch fold from ticks to candles. */
export function foldTicks(tf: Timeframe, ticks: Iterable<Tick>): Candle[] {
  const aggregator = new CandleAggregator(tf);
  const out: Candle[] = [];
  for (const tick of ticks) {
    const closed = aggregator.accept(tick);
    if (closed !== null) out.push(closed);
  }
  const open = aggregator.current();
  if (open !== null) out.push(open);
  return out;
}

/**
 * Re-aggregate finer candles into coarser ones.
 *
 * The invariant that matters is that this agrees with folding ticks directly:
 * that equality is what "a timeframe is a pure view over one stream" means in
 * code, and it is the operational content of INV-004.
 */
export function foldCandles(target: Timeframe, source: readonly Candle[]): Candle[] {
  if (source.length === 0) return [];

  const sourceId = source[0]!.timeframe;
  for (const candle of source) {
    if (candle.timeframe !== sourceId) {
      throw new RangeError(
        `foldCandles requires a single source timeframe; received ${sourceId} and ${candle.timeframe}.`,
      );
    }
  }

  const sourceTimeframe = timeframeById(sourceId);
  if (!nests(sourceTimeframe, target)) {
    throw new RangeError(`Timeframe ${sourceId} does not nest inside ${target.id}.`);
  }
  // Confirms the divisibility chain holds for this pair; throws otherwise.
  nestingFactor(sourceTimeframe, target);

  const out: Candle[] = [];
  let open: MutableCandle | null = null;

  for (let i = 0; i < source.length; i += 1) {
    const candle = source[i]!;
    if (i > 0) {
      const previous = source[i - 1]!;
      if (candle.openInstant <= previous.openInstant) {
        throw new RangeError(
          `Source candles must be strictly ordered: ${candle.openInstant} follows ${previous.openInstant}.`,
        );
      }
    }
    const start = bucketStart(candle.openInstant, target);

    if (open !== null && open.openInstant !== start) {
      out.push(freeze(open, target.id));
      open = null;
    }
    if (open === null) {
      open = {
        openInstant: start,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        tickCount: candle.tickCount,
        firstSequence: candle.firstSequence,
        lastSequence: candle.lastSequence,
      };
      continue;
    }
    if (candle.high > open.high) open.high = candle.high;
    if (candle.low < open.low) open.low = candle.low;
    open.close = candle.close;
    open.tickCount += candle.tickCount;
    open.lastSequence = candle.lastSequence;
  }

  if (open !== null) out.push(freeze(open, target.id));
  return out;
}
