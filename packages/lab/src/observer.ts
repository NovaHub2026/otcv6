import {
  CandleAggregator,
  epochMillis,
  foldTicks,
  indexAtOrAfter,
  priceAtOrBefore,
  timeframe,
  type AssetFamily,
  type Candle,
  type EpochMillis,
  type InstrumentSpec,
  type LogPrice,
  type Tick,
  type TickSource,
  type TimeframeId,
} from '@otc/core';

/**
 * Everything an attacker is allowed to see, and nothing else.
 *
 * The dataset holds arrays and candles. It holds no source, no keyring, no
 * cursor and no model state, so an attack cannot reach private information —
 * it never receives anything that carries any. The observer boundary is
 * therefore structural rather than a rule someone has to remember.
 *
 * This same boundary becomes the public API contract in PH-7, so the surface
 * that ships and the surface that was attacked are provably the same one.
 */

/** The public half of an instrument specification. The quote grid is public. */
export interface PublicInstrument {
  readonly id: string;
  readonly family: AssetFamily;
  readonly logQuantum: number;
  readonly displayPrecision: number;
  readonly referencePrice: number;
}

export function toPublicInstrument(spec: InstrumentSpec): PublicInstrument {
  return {
    id: spec.id,
    family: spec.family,
    logQuantum: spec.logQuantum,
    displayPrecision: spec.displayPrecision,
    referencePrice: spec.referencePrice,
  };
}

export interface ObserverDataset {
  readonly instrument: PublicInstrument;
  readonly tickCount: number;
  /** Canonical integer prices — exactly what is published and what settles. */
  readonly prices: Int32Array;
  readonly instants: Float64Array;
  readonly firstInstant: EpochMillis;
  readonly lastInstant: EpochMillis;
  /** OHLC on a timeframe, folded lazily and cached. */
  candles(id: TimeframeId): readonly Candle[];
  /** Price in force at an instant: the last tick at or before it. */
  priceAt(instant: EpochMillis): { price: LogPrice; index: number } | null;
  /** First tick at or after an instant. Used to place an entry on the grid. */
  entryIndexAt(instant: EpochMillis): number | null;
}

class Dataset implements ObserverDataset {
  readonly #candleCache = new Map<TimeframeId, readonly Candle[]>();

  constructor(
    readonly instrument: PublicInstrument,
    readonly prices: Int32Array,
    readonly instants: Float64Array,
    private readonly ticks: readonly Tick[],
  ) {}

  get tickCount(): number {
    return this.prices.length;
  }

  get firstInstant(): EpochMillis {
    return epochMillis(this.instants[0]!);
  }

  get lastInstant(): EpochMillis {
    return epochMillis(this.instants[this.instants.length - 1]!);
  }

  candles(id: TimeframeId): readonly Candle[] {
    const cached = this.#candleCache.get(id);
    if (cached !== undefined) return cached;
    const folded = foldTicks(timeframe(id), this.ticks);
    this.#candleCache.set(id, folded);
    return folded;
  }

  priceAt(instant: EpochMillis): { price: LogPrice; index: number } | null {
    return priceAtOrBefore(this.instants, this.prices, instant);
  }

  entryIndexAt(instant: EpochMillis): number | null {
    return indexAtOrAfter(this.instants, instant);
  }
}

export interface DatasetBuildOptions {
  readonly source: TickSource;
  /** Stop after this many ticks. */
  readonly maxTicks: number;
  /** Yield to the event loop every this many ticks. */
  readonly chunkTicks?: number;
}

/**
 * Build a dataset by draining a tick source.
 *
 * Retains the ticks so candles can be folded on demand for any timeframe. That
 * costs memory, and it is the right trade: a battery that folded candles up
 * front would have to guess which timeframes an attack will want, and an attack
 * that could re-derive candles itself would be re-implementing aggregation and
 * could get it subtly different from the one that ships.
 */
export async function buildObserverDataset(options: DatasetBuildOptions): Promise<ObserverDataset> {
  const { source, maxTicks, chunkTicks = 250_000 } = options;
  if (!Number.isInteger(maxTicks) || maxTicks <= 0) {
    throw new RangeError(`maxTicks must be a positive integer, received ${maxTicks}.`);
  }

  const ticks: Tick[] = [];
  const prices = new Int32Array(maxTicks);
  const instants = new Float64Array(maxTicks);
  let count = 0;

  while (count < maxTicks) {
    const tick = source.next();
    if (tick === null) break;
    if (count > 0 && tick.instant < instants[count - 1]!) {
      throw new RangeError(
        `Observer dataset requires non-decreasing instants: ${tick.instant} follows ${instants[count - 1]!}.`,
      );
    }
    prices[count] = tick.price;
    instants[count] = tick.instant;
    ticks.push(tick);
    count += 1;
    if (count % chunkTicks === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  if (count < 2) {
    throw new RangeError(`Observer dataset needs at least two ticks, received ${count}.`);
  }
  return new Dataset(
    toPublicInstrument(source.instrument),
    prices.subarray(0, count),
    instants.subarray(0, count),
    ticks,
  );
}

/** Build a dataset from an already-materialised tick array. */
export function datasetFromTicks(
  instrument: InstrumentSpec | PublicInstrument,
  ticks: readonly Tick[],
): ObserverDataset {
  if (ticks.length < 2) {
    throw new RangeError(`Observer dataset needs at least two ticks, received ${ticks.length}.`);
  }
  const prices = new Int32Array(ticks.length);
  const instants = new Float64Array(ticks.length);
  for (let i = 0; i < ticks.length; i += 1) {
    const tick = ticks[i]!;
    if (i > 0 && tick.instant < instants[i - 1]!) {
      throw new RangeError(
        `Observer dataset requires non-decreasing instants: ${tick.instant} follows ${instants[i - 1]!}.`,
      );
    }
    prices[i] = tick.price;
    instants[i] = tick.instant;
  }
  const publicSpec: PublicInstrument =
    'family' in instrument ? toPublicInstrument(instrument) : instrument;
  return new Dataset(publicSpec, prices, instants, ticks);
}

/** Streaming aggregation, exposed so a runtime can reuse the same fold. */
export function aggregatorFor(id: TimeframeId): CandleAggregator {
  return new CandleAggregator(timeframe(id));
}
