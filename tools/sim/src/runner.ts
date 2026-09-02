import {
  allTimeframes,
  CandleAggregator,
  timeframe,
  type Candle,
  type Tick,
  type TickSource,
  type TimeframeId,
} from '@otc/core';
import { yieldToLoop } from '@otc/lab';

export interface SimulationRequest {
  readonly source: TickSource;
  /** Timeframes to fold while running. Defaults to none. */
  readonly timeframes?: readonly TimeframeId[];
  /** Retain the tick stream. Off by default: long runs are large. */
  readonly retainTicks?: boolean;
  /** Hint for the initial price buffer, so short runs do not over-allocate. */
  readonly initialCapacity?: number;
}

export interface SimulationResult {
  readonly instrumentId: string;
  readonly tickCount: number;
  readonly firstInstant: number;
  readonly lastInstant: number;
  readonly ticks: readonly Tick[];
  /** Canonical prices, always retained: this is what the estimators consume. */
  readonly prices: Int32Array;
  readonly instants: Float64Array;
  readonly candles: ReadonlyMap<TimeframeId, readonly Candle[]>;
  readonly elapsedSeconds: number;
}

/**
 * Drive a tick source to exhaustion, folding candles as it goes.
 *
 * Prices are kept in a typed array rather than as objects: a calibration run is
 * tens of millions of ticks, and the estimators want contiguous memory.
 */
export function runSimulation(request: SimulationRequest): SimulationResult {
  const { source, timeframes = [], retainTicks = false } = request;
  const aggregators = timeframes.map((id) => ({
    id,
    aggregator: new CandleAggregator(timeframe(id)),
    closed: [] as Candle[],
  }));

  const ticks: Tick[] = [];
  let capacity = Math.max(1, request.initialCapacity ?? 1 << 16);
  let prices = new Int32Array(capacity);
  let instants = new Float64Array(capacity);
  let count = 0;
  let firstInstant = 0;
  let lastInstant = 0;

  const started = process.hrtime.bigint();
  for (;;) {
    const tick = source.next();
    if (tick === null) break;
    if (count === capacity) {
      capacity *= 2;
      const grownPrices = new Int32Array(capacity);
      grownPrices.set(prices);
      prices = grownPrices;
      const grownInstants = new Float64Array(capacity);
      grownInstants.set(instants);
      instants = grownInstants;
    }
    prices[count] = tick.price;
    instants[count] = tick.instant;
    if (count === 0) firstInstant = tick.instant;
    lastInstant = tick.instant;
    count += 1;
    if (retainTicks) ticks.push(tick);
    for (const entry of aggregators) {
      const closed = entry.aggregator.accept(tick);
      if (closed !== null) entry.closed.push(closed);
    }
  }
  const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1e9;

  const candles = new Map<TimeframeId, readonly Candle[]>();
  for (const entry of aggregators) {
    const open = entry.aggregator.current();
    candles.set(entry.id, open === null ? entry.closed : [...entry.closed, open]);
  }

  return {
    instrumentId: source.instrument.id,
    tickCount: count,
    firstInstant,
    lastInstant,
    ticks,
    prices: prices.subarray(0, count),
    instants: instants.subarray(0, count),
    candles,
    elapsedSeconds,
  };
}

/**
 * Same as {@link runSimulation}, but yields to the event loop between chunks.
 *
 * A multi-million-tick run is several seconds of uninterrupted synchronous work.
 * That starves anything else in the process — a progress reporter, a health
 * check, a test runner's own worker RPC — and the symptom is an unexplained
 * timeout somewhere unrelated. Yielding periodically costs nothing measurable
 * and keeps long runs well-behaved.
 */
export async function runSimulationAsync(
  request: SimulationRequest,
  chunkTicks = 250_000,
): Promise<SimulationResult> {
  if (!Number.isInteger(chunkTicks) || chunkTicks <= 0) {
    throw new RangeError(`chunkTicks must be a positive integer, received ${chunkTicks}.`);
  }
  const source = request.source;
  let produced = 0;
  const chunked: TickSource = {
    instrument: source.instrument,
    next: () => {
      if (produced >= chunkTicks) return null;
      const tick = source.next();
      if (tick !== null) produced += 1;
      return tick;
    },
  };

  const merged: SimulationResult[] = [];
  for (;;) {
    produced = 0;
    const part = runSimulation({
      ...request,
      source: chunked,
      initialCapacity: Math.min(chunkTicks, 1 << 16),
    });
    if (part.tickCount === 0) break;
    merged.push(part);
    if (part.tickCount < chunkTicks) break;
    await yieldToLoop();
  }
  return mergeResults(merged, source.instrument.id);
}

function mergeResults(parts: readonly SimulationResult[], instrumentId: string): SimulationResult {
  const total = parts.reduce((sum, p) => sum + p.tickCount, 0);
  const prices = new Int32Array(total);
  const instants = new Float64Array(total);
  const ticks: Tick[] = [];
  const candles = new Map<TimeframeId, Candle[]>();
  let offset = 0;
  let elapsedSeconds = 0;
  for (const part of parts) {
    prices.set(part.prices, offset);
    instants.set(part.instants, offset);
    offset += part.tickCount;
    elapsedSeconds += part.elapsedSeconds;
    ticks.push(...part.ticks);
    for (const [id, list] of part.candles) {
      const existing = candles.get(id);
      if (existing === undefined) {
        candles.set(id, [...list]);
        continue;
      }
      // The last candle of a chunk is still open; the next chunk reopens the
      // same bucket, so the two must be merged rather than both kept.
      const last = existing[existing.length - 1];
      const [first, ...rest] = list;
      if (last !== undefined && first !== undefined && last.openInstant === first.openInstant) {
        existing[existing.length - 1] = {
          ...last,
          high: first.high > last.high ? first.high : last.high,
          low: first.low < last.low ? first.low : last.low,
          close: first.close,
          tickCount: last.tickCount + first.tickCount,
          lastSequence: first.lastSequence,
        };
        existing.push(...rest);
      } else {
        existing.push(...list);
      }
    }
  }
  return {
    instrumentId,
    tickCount: total,
    firstInstant: parts[0]?.firstInstant ?? 0,
    lastInstant: parts[parts.length - 1]?.lastInstant ?? 0,
    ticks,
    prices,
    instants,
    candles,
    elapsedSeconds,
  };
}

export const ALL_TIMEFRAME_IDS: readonly TimeframeId[] = allTimeframes().map((t) => t.id);
