import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { epochMillis, logPrice, type Candle, type EpochMillis, type TimeframeId } from '@otc/core';
import { HistoryError, HISTORY_TIMEFRAMES, type CandleHistory } from './history.js';

/**
 * Candle history on disk.
 *
 * The same engine and the same settings as `SqliteCoordinatedStore`, and for the
 * same reasons: WAL so a reader never sees a half-written transaction, and a
 * busy timeout because contention between the writer and a chart request is the
 * ordinary case rather than an error.
 *
 * **Deliberately a separate database from the state store.** They have opposite
 * shapes — one holds a handful of rows rewritten constantly, the other holds
 * millions written once and never touched again — and the second is the one an
 * operator will want to move, archive, or serve from a replica. Coupling them
 * would make every one of those a migration.
 *
 * ## The cost, measured
 *
 * 129,600 minute bars and 2,160 hourly bars per asset per quarter, and those
 * counts are fixed by the calendar rather than by the asset: `btcusd` generates
 * ten times the ticks of `spx` over the same ninety days and stores exactly the
 * same number of candles. That is the property that makes a hundred-asset
 * catalogue affordable.
 */
export class SqliteCandleHistory implements CandleHistory {
  readonly #db: DatabaseSync;
  readonly #insert: StatementSync;
  readonly #read: StatementSync;
  readonly #head: StatementSync;

  constructor(location: string) {
    this.#db = new DatabaseSync(location);
    this.#db.exec('PRAGMA busy_timeout = 5000');
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS candle (
        asset_id TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        open_instant INTEGER NOT NULL,
        open INTEGER NOT NULL,
        high INTEGER NOT NULL,
        low INTEGER NOT NULL,
        close INTEGER NOT NULL,
        tick_count INTEGER NOT NULL,
        first_sequence INTEGER NOT NULL,
        last_sequence INTEGER NOT NULL,
        PRIMARY KEY (asset_id, timeframe, open_instant)
      ) WITHOUT ROWID
    `);
    this.#insert = this.#db.prepare(`
      INSERT INTO candle (
        asset_id, timeframe, open_instant, open, high, low, close,
        tick_count, first_sequence, last_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#read = this.#db.prepare(`
      SELECT open_instant, open, high, low, close, tick_count, first_sequence, last_sequence
      FROM candle
      WHERE asset_id = ? AND timeframe = ? AND open_instant >= ? AND open_instant < ?
      ORDER BY open_instant
    `);
    this.#head = this.#db.prepare(`
      SELECT MAX(open_instant) AS head FROM candle WHERE asset_id = ? AND timeframe = ?
    `);
  }

  close(): void {
    this.#db.close();
  }

  append(assetId: string, timeframe: TimeframeId, candles: readonly Candle[]): Promise<void> {
    const unstored = unstoredTimeframe(timeframe);
    if (unstored !== null) return Promise.reject(unstored);
    if (candles.length === 0) return Promise.resolve();
    try {
      // One transaction for the batch, so a bad candle in the middle rolls the
      // whole append back. A half-written history is one that no longer matches
      // the ticks it came from, and nothing downstream could tell.
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        let previous = this.#headOf(assetId, timeframe);
        for (const candle of candles) {
          if (candle.timeframe !== timeframe) {
            throw new HistoryError(
              `Candle at ${candle.openInstant} is a ${candle.timeframe} bar, appended to the ` +
                `${timeframe} series. A bar filed under the wrong timeframe is a shape no tick ` +
                `made.`,
            );
          }
          if (previous !== null && candle.openInstant <= previous) {
            throw new HistoryError(
              `History is append-only and ordered: ${timeframe} candle at ${candle.openInstant} ` +
                `does not follow the stored head at ${previous}.`,
            );
          }
          this.#insert.run(
            assetId,
            timeframe,
            candle.openInstant,
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.tickCount,
            candle.firstSequence,
            candle.lastSequence,
          );
          previous = candle.openInstant;
        }
        this.#db.exec('COMMIT');
      } catch (error) {
        this.#db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new HistoryError(`History append failed: ${String(error)}`),
      );
    }
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
    const rows = this.#read.all(assetId, timeframe, from, to);
    return Promise.resolve(
      rows.map((row) => ({
        openInstant: epochMillis(asNumber(row['open_instant'])),
        timeframe,
        open: logPrice(asNumber(row['open'])),
        high: logPrice(asNumber(row['high'])),
        low: logPrice(asNumber(row['low'])),
        close: logPrice(asNumber(row['close'])),
        tickCount: asNumber(row['tick_count']),
        firstSequence: asNumber(row['first_sequence']),
        lastSequence: asNumber(row['last_sequence']),
      })),
    );
  }

  head(assetId: string, timeframe: TimeframeId): Promise<EpochMillis | null> {
    const unstored = unstoredTimeframe(timeframe);
    if (unstored !== null) return Promise.reject(unstored);
    return Promise.resolve(this.#headOf(assetId, timeframe));
  }

  #headOf(assetId: string, timeframe: TimeframeId): EpochMillis | null {
    const row = this.#head.get(assetId, timeframe);
    const value = row?.['head'];
    if (value === null || value === undefined) return null;
    return epochMillis(asNumber(value));
  }
}

function unstoredTimeframe(timeframe: TimeframeId): HistoryError | null {
  if (HISTORY_TIMEFRAMES.includes(timeframe)) return null;
  return new HistoryError(
    `History stores ${HISTORY_TIMEFRAMES.join(' and ')} only, not ${timeframe}. Every ` +
      `offered timeframe folds from one of them.`,
  );
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new HistoryError(`Expected a number from the history database, received ${typeof value}.`);
}
