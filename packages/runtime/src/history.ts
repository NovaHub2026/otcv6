import {
  bucketStart,
  CandleAggregator,
  epochMillis,
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
 * Folds ticks into the base tier. Nothing else.
 *
 * The rollup tier used to be folded here too, from the base candles this
 * recorder had seen. **Cycle Audit 6, F2** falsified that: the carry is
 * process-local and `HistoryService` builds a fresh recorder on every start, so
 * a recorder that begins mid-hour declares that hour complete as soon as it sees
 * a minute of the next one and writes it from only the minutes it happened to
 * see. Measured at a provisioning handoff: an hour stored with 738 ticks of
 * 1,023, its high understated by 1,013 lattice steps.
 *
 * That is exactly the failure the old docstring said it prevented, and the
 * symptom `backfill.ts` names as the sign of a wrong implementation — a chart
 * that disagrees with the record at the seam.
 *
 * So the rollup is no longer derived from anything a process remembers. It is
 * derived from the **stored** minute series by {@link refreshRollup}, which
 * makes the two tiers agree by construction rather than by lifetime.
 */
export class HistoryRecorder {
  readonly #base = new CandleAggregator(timeframeById(HISTORY_BASE_TIMEFRAME));
  #closed: Candle[] = [];

  /** Feed ticks in order. Closed candles accumulate until {@link drain}. */
  accept(ticks: Iterable<Tick>): void {
    for (const tick of ticks) {
      const closed = this.#base.accept(tick);
      if (closed !== null) this.#closed.push(closed);
    }
  }

  /** Every minute bar that has closed since the last drain. */
  drain(): readonly Candle[] {
    const closed = this.#closed;
    this.#closed = [];
    return closed;
  }

  /** The bar still accumulating. Never stored; useful for a live chart. */
  open(): Candle | null {
    return this.#base.current();
  }
}

/**
 * Bring the rollup tier up to date from the stored minute series.
 *
 * An hour is complete when the minute tier has moved past its end — not when a
 * recorder thinks it has seen enough of it. Any minute belonging to hour `H`
 * opens before `H + 1h`, and the store is append-only and ordered, so once the
 * stored head is at or past `H + 1h` nothing can arrive inside `H` again.
 *
 * Hours with no minutes at all produce no bar. That is a gap in the record and
 * the honest thing to show; a bar invented to fill it would assert trades that
 * did not happen.
 *
 * Returns how many hourly bars it appended.
 */
export async function refreshRollup(history: CandleHistory, assetId: string): Promise<number> {
  const hour = timeframeById(HISTORY_ROLLUP_TIMEFRAME);
  const baseHead = await history.head(assetId, HISTORY_BASE_TIMEFRAME);
  if (baseHead === null) return 0;
  const rollupHead = await history.head(assetId, HISTORY_ROLLUP_TIMEFRAME);
  const from = rollupHead === null ? 0 : rollupHead + hour.durationMs;
  // The hour containing the minute head is still open, so it is the boundary.
  const openHourStart = Math.floor(baseHead / hour.durationMs) * hour.durationMs;
  if (from >= openHourStart) return 0;
  const minutes = await history.read(
    assetId,
    HISTORY_BASE_TIMEFRAME,
    epochMillis(from),
    epochMillis(openHourStart),
  );
  if (minutes.length === 0) return 0;
  const hours = foldCandles(hour, minutes);
  if (hours.length === 0) return 0;
  await history.append(assetId, HISTORY_ROLLUP_TIMEFRAME, hours);
  return hours.length;
}

/**
 * Read any offered timeframe, folding from the finest tier that nests into it.
 *
 * The choice of tier is not an optimisation: reading a daily chart from the base
 * tier would fold 129,600 rows into 90 and get the same answer, while reading a
 * five-minute chart from the rollup tier is impossible. Nesting decides it, and
 * the coarser tier wins wherever both work.
 *
 * ## Only whole bars
 *
 * **Cycle Audit 6, F4.** The window used to be passed through as given, so a
 * `30m` chart asked from ten minutes into a bucket returned that bucket's label
 * over forty of its sixty minutes, and the newest `4h` bar was routinely short
 * by up to an hour — presented as closed. Both are the object the "no open
 * candles" rule exists to prevent, one step further out.
 *
 * So the window is snapped outward to the target's own grid, and a bar is
 * returned only when the stored series covers its whole bucket. At the leading
 * edge that is decided by looking one source bucket further back: if nothing is
 * stored there, the first bucket may begin inside the history and is dropped.
 * Conservative in the right direction — a bar that exists may be withheld, but
 * no partial bar is ever labelled whole.
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

  const alignedFrom = bucketStart(from, wanted);
  const alignedTo = bucketStart(to, wanted) + wanted.durationMs;
  const stored = await history.read(
    assetId,
    source.id,
    epochMillis(alignedFrom),
    epochMillis(alignedTo),
  );
  if (stored.length === 0) return [];
  const folded = source.id === target ? [...stored] : foldCandles(wanted, stored);
  if (folded.length === 0) return [];

  // The trailing bucket is whole only if the source has moved past its end.
  const head = await history.head(assetId, source.id);
  const covered = head === null ? -Infinity : head + source.durationMs;
  let complete = folded.filter((bar) => bar.openInstant + wanted.durationMs <= covered);
  if (complete.length === 0) return [];

  // The leading bucket is whole only if the source also covers what precedes it.
  const first = complete[0]!.openInstant;
  if (first < bucketStart(from, wanted) + wanted.durationMs) {
    const before = await history.read(
      assetId,
      source.id,
      epochMillis(first - source.durationMs),
      epochMillis(first),
    );
    if (before.length === 0 && stored[0]!.openInstant > first) complete = complete.slice(1);
  }
  return complete;
}
