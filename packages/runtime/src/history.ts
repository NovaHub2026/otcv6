import {
  CandleAggregator,
  foldCandles,
  isCoarserOrEqual,
  nests,
  timeframe as timeframeById,
  type Candle,
  type EpochMillis,
  type Tick,
  type TimeframeId,
} from '@otc/core';

/**
 * Long history, stored as candles rather than as ticks.
 *
 * ## Why this tier exists
 *
 * The product wants ninety days of chart on the first frame an observer sees.
 * Ninety days of *ticks* is between 2.6 and 61 million rows per asset depending
 * on its pace, and a hundred assets would be of order a billion, for data whose
 * only consumer is a chart that reduces it to a few hundred columns anyway
 * (`packages/chart`).
 *
 * So the record keeps ticks for as long as anything can dispute a settlement,
 * which `retention.ts` decides and which is bounded by the fifteen-minute
 * longest contract plus the dispute window, and this keeps candles for as long
 * as anyone wants to look.
 *
 * ## What is deliberately not offered
 *
 * **Anything finer than a minute.** A one-second chart of last March cannot be
 * served from here, and the honest answer is a refusal rather than a coarser
 * series returned under the requested name. INV-004 says the displayed timeframe
 * never changes the market; it does not say every timeframe is available over
 * every span, and pretending otherwise would put a shape on the screen that no
 * tick ever produced.
 *
 * **Open candles.** Only a bar that has closed is written. A bar still
 * accumulating has a high and a low that are not yet true, and a reader cannot
 * tell the difference once it is stored.
 */

/** The finest resolution kept for ever. */
export const HISTORY_BASE_TIMEFRAME: TimeframeId = '1m';

/**
 * The coarse tier, kept so a long chart does not read a fine one.
 *
 * Ninety days is 129,600 one-minute candles and 2,160 one-hour candles. A daily
 * chart of a quarter folded from the base tier would read sixty times what it
 * needs; folded from here it reads ninety rows.
 *
 * Two tiers rather than five: every timeframe the product offers nests into one
 * of these two, and each extra stored tier is another thing that can disagree
 * with the ticks.
 */
export const HISTORY_ROLLUP_TIMEFRAME: TimeframeId = '1h';

export const HISTORY_TIMEFRAMES: readonly TimeframeId[] = [
  HISTORY_BASE_TIMEFRAME,
  HISTORY_ROLLUP_TIMEFRAME,
];

export class HistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryError';
  }
}

/**
 * Durable candle history.
 *
 * An interface rather than a database, for the same reason `StateStore` is one:
 * the storage decision belongs to whoever knows the load profile, and the
 * runtime is framework-free.
 */
export interface CandleHistory {
  /** Append closed candles, in order, after everything already stored. */
  append(assetId: string, timeframe: TimeframeId, candles: readonly Candle[]): Promise<void>;
  /** Candles whose open instant is in `[from, to)`. */
  read(
    assetId: string,
    timeframe: TimeframeId,
    from: EpochMillis,
    to: EpochMillis,
  ): Promise<readonly Candle[]>;
  /** Open instant of the newest stored candle, or null. */
  head(assetId: string, timeframe: TimeframeId): Promise<EpochMillis | null>;
}

/**
 * Validation returns an error rather than throwing.
 *
 * The interface is asynchronous, and `MemoryStateStore` already established the
 * convention this repository holds to: a rejected promise, never a synchronous
 * throw from a method that returns one. A caller that has to guard both is a
 * caller that will guard one.
 */
function unstoredTimeframe(timeframe: TimeframeId): HistoryError | null {
  if (HISTORY_TIMEFRAMES.includes(timeframe)) return null;
  return new HistoryError(
    `History stores ${HISTORY_TIMEFRAMES.join(' and ')} only, not ${timeframe}. Every ` +
      `offered timeframe folds from one of them.`,
  );
}

/** The reference `CandleHistory`, in memory. */
export class InMemoryCandleHistory implements CandleHistory {
  readonly #series = new Map<string, Candle[]>();

  #key(assetId: string, timeframe: TimeframeId): string {
    return `${assetId} ${timeframe}`;
  }

  append(assetId: string, timeframe: TimeframeId, candles: readonly Candle[]): Promise<void> {
    const unstored = unstoredTimeframe(timeframe);
    if (unstored !== null) return Promise.reject(unstored);
    const key = this.#key(assetId, timeframe);
    const series = this.#series.get(key) ?? [];
    // Appended to a copy and swapped in at the end, so a batch with a bad candle
    // in the middle leaves nothing behind. A half-written append would be a
    // history that no longer matches the ticks it came from.
    const next = [...series];
    let previous = next.length === 0 ? null : next[next.length - 1]!;
    for (const candle of candles) {
      if (candle.timeframe !== timeframe) {
        return Promise.reject(
          new HistoryError(
            `Candle at ${candle.openInstant} is a ${candle.timeframe} bar, appended to the ` +
              `${timeframe} series. A bar filed under the wrong timeframe is a shape no tick made.`,
          ),
        );
      }
      if (previous !== null && candle.openInstant <= previous.openInstant) {
        return Promise.reject(
          new HistoryError(
            `History is append-only and ordered: ${timeframe} candle at ${candle.openInstant} ` +
              `does not follow the stored head at ${previous.openInstant}.`,
          ),
        );
      }
      next.push(candle);
      previous = candle;
    }
    this.#series.set(key, next);
    return Promise.resolve();
  }

  read(
    assetId: string,
    timeframe: TimeframeId,
    from: EpochMillis,
    to: EpochMillis,
  ): Promise<readonly Candle[]> {
    const unstored = unstoredTimeframe(timeframe);
    if (unstored !== null) return Promise.reject(unstored);
    const series = this.#series.get(this.#key(assetId, timeframe)) ?? [];
    return Promise.resolve(
      series.filter((candle) => candle.openInstant >= from && candle.openInstant < to),
    );
  }

  head(assetId: string, timeframe: TimeframeId): Promise<EpochMillis | null> {
    const unstored = unstoredTimeframe(timeframe);
    if (unstored !== null) return Promise.reject(unstored);
    const series = this.#series.get(this.#key(assetId, timeframe)) ?? [];
    return Promise.resolve(series.length === 0 ? null : series[series.length - 1]!.openInstant);
  }
}

/**
 * Folds ticks into the base tier and derives the rollup from what closes.
 *
 * The rollup is folded from the **base candles**, not from the ticks a second
 * time. Two independent folds of one stream is two chances to disagree, and
 * `foldCandles` agreeing with `foldTicks` is the operational content of INV-004,
 * so the tier that is derived is derived visibly.
 */
export class HistoryRecorder {
  readonly #base = new CandleAggregator(timeframeById(HISTORY_BASE_TIMEFRAME));
  #closedBase: Candle[] = [];
  #carriedBase: Candle[] = [];
  #rollupOpenInstant: EpochMillis | null = null;

  /** Feed ticks in order. Closed candles accumulate until {@link drain}. */
  accept(ticks: Iterable<Tick>): void {
    for (const tick of ticks) {
      const closed = this.#base.accept(tick);
      if (closed !== null) this.#closedBase.push(closed);
    }
  }

  /**
   * Everything that has closed since the last drain.
   *
   * A rollup bar is emitted only once every base candle inside it has closed, so
   * its high and low are the true extremes of the hour rather than of the part
   * of it that happened to have been drained. Base candles belonging to a
   * still-open hour are carried to the next drain instead of being folded early.
   */
  drain(): { base: readonly Candle[]; rollup: readonly Candle[] } {
    const base = this.#closedBase;
    this.#closedBase = [];

    const pool = [...this.#carriedBase, ...base];
    const hour = timeframeById(HISTORY_ROLLUP_TIMEFRAME);
    const folded = foldCandles(hour, pool);
    // The last folded bar is the only one that can still be open: the pool is
    // ordered, so everything before it belongs to an hour that has ended.
    const complete = folded.length === 0 ? [] : folded.slice(0, -1);
    const openHour = folded.length === 0 ? null : folded[folded.length - 1]!.openInstant;
    this.#rollupOpenInstant = openHour;
    this.#carriedBase =
      openHour === null ? [] : pool.filter((candle) => candle.openInstant >= openHour);
    return { base, rollup: complete };
  }

  /** The bars still accumulating. Never stored; useful for a live chart. */
  open(): { base: Candle | null; rollupOpenInstant: EpochMillis | null } {
    return { base: this.#base.current(), rollupOpenInstant: this.#rollupOpenInstant };
  }
}

/**
 * Read any offered timeframe, folding from the finest tier that nests into it.
 *
 * The choice is not an optimisation: reading a daily chart from the base tier
 * would fold 129,600 rows into 90 and get the same answer, while reading a
 * five-minute chart from the rollup tier is impossible. Nesting decides it, and
 * the coarser tier wins wherever both work.
 */
export async function readTimeframe(
  history: CandleHistory,
  assetId: string,
  target: TimeframeId,
  from: EpochMillis,
  to: EpochMillis,
): Promise<readonly Candle[]> {
  const wanted = timeframeById(target);
  const base = timeframeById(HISTORY_BASE_TIMEFRAME);
  if (!isCoarserOrEqual(wanted, base)) {
    throw new HistoryError(
      `History is stored from ${HISTORY_BASE_TIMEFRAME} up, so ${target} is available only ` +
        `from the tick record and only as far back as retention keeps it. Returning a coarser ` +
        `series under a finer name would put a shape on the screen that no tick produced.`,
    );
  }
  const rollup = timeframeById(HISTORY_ROLLUP_TIMEFRAME);
  const source = nests(rollup, wanted) ? rollup : base;
  const stored = await history.read(assetId, source.id, from, to);
  if (source.id === target) return stored;
  return foldCandles(wanted, stored);
}
