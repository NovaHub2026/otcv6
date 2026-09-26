import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { epochMillis, logPrice, type Candle, type EpochMillis, type TimeframeId } from '@otc/core';
import { HistoryError, HISTORY_TIMEFRAMES, type CandleHistory } from './history.js';
import {
  assertSchemaNotNewer,
  DEFAULT_BUSY_TIMEOUT_MS,
  enableWriteAheadLog,
  stampSchemaVersion,
} from './sqlite.js';
import { type LatticeEpoch, type PriceFrame } from './priceFrame.js';

/**
 * Schema version stamped into a candle history database (`PRAGMA user_version`).
 *
 * Bump when the `candle` table changes shape, and add the migration
 * `sqlite.ts` asks for.
 *
 * **2 (PH-38.4):** the `lattice` table — what a candle's four integers count
 * in. Its own, and deliberately not the record's: the two artefacts can be
 * re-expressed independently, and on the live venue they were. After v2.4.0
 * moved every lattice, `history.db` was converted by hand onto the new one and
 * `record.db` was not, so at one sequence the stored candle close was 677 and
 * the stored tick price 8797 — the same price in different units. A reader that
 * dated a candle from the record's log would have drawn nineteen days of chart
 * on the wrong lattice.
 *
 * A reader that cannot see this table falls back to the instrument in force,
 * which is what every reader did before it existed — a wrong chart rather than a
 * wrong settlement.
 *
 * **It does fail closed, and this note said it did not** (Cycle Audit 13, a6-04
 * and a2-03, found independently by two auditors and executed by a refuter
 * against the previous release's own build). `assertSchemaNotNewer` is shared and
 * unconditional, so `v2.4.0` refuses a `history.db` at version 2 by name. The
 * consequence is a rollback across this bump cannot boot — on this file and on
 * `record.db`, which refuses first — and no operational document says so.
 */
export const HISTORY_SCHEMA_VERSION = 2;

/**
 * Candle history on disk.
 *
 * The same engine and the same settings as `SqliteCoordinatedStore`, and for the
 * same reasons: WAL so a reader never sees a half-written transaction, and a
 * busy timeout because contention between the writer and a chart request is the
 * ordinary case rather than an error. The same *code*, too, since a5-10: the
 * retried journal-mode change and the schema-version check live in
 * `sqlite.ts`, because this file ran the unretried form the store had already
 * measured killing seven of eight processes that opened one new file together.
 *
 * `synchronous = FULL`, not `NORMAL`. In WAL mode `NORMAL` lets a power loss
 * discard the last committed transactions — safely, without corruption — and
 * for most databases that is the right trade. Not for this one: the ticks a
 * minute bar was folded from are deleted by retention after the dispute window,
 * so a bar lost from the last WAL frames is, once the ticks are gone, a hole in
 * the permanent record that nothing can refill. One `fsync` per flush, on the
 * checkpoint cadence, is the whole cost (a5-10).
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
  #insertLattice!: StatementSync;
  #readLattices!: StatementSync;
  #insert!: StatementSync;
  #read!: StatementSync;
  #head!: StatementSync;

  readonly #readOnly: boolean;
  #hasLattice = true;

  /**
   * @param readOnly Open without upgrading the file: no table is created and
   * the schema version is not stamped.
   *
   * **Opening became a write when this store learned its frame log (PH-38.4),
   * and that broke verification.** `verifyStateDirectory` constructs this class
   * to read a directory's heads — including one a live venue is writing — and
   * an open that creates a table and stamps `user_version` is a second writer
   * on that file. The state-directory suite caught it: "calls a database a
   * second process is writing healthy, not damaged" went red on the coverage
   * leg, which is the one slow enough to lose the race.
   *
   * It is the same hazard the record has, answered the same way. Reading must
   * not upgrade.
   */
  constructor(location: string, { readOnly = false }: { readOnly?: boolean } = {}) {
    this.#readOnly = readOnly;
    // The directory before the file. SQLite reports a missing parent directory
    // as `unable to open database file`, which reads as a permissions or
    // corruption problem and is neither — and it happens at construction, so
    // the process dies during dependency injection with no context at all.
    // Found by the PH-18 phase gate: three API suites that set a temporary
    // state directory and let the history default went from booting to not.
    if (location !== ':memory:' && !location.startsWith('file:')) {
      mkdirSync(path.dirname(path.resolve(location)), { recursive: true });
    }
    this.#db = new DatabaseSync(location);
    this.#db.exec(`PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);
    if (location !== ':memory:') enableWriteAheadLog(this.#db);
    this.#db.exec('PRAGMA synchronous = FULL');
    assertSchemaNotNewer(this.#db, HISTORY_SCHEMA_VERSION, 'candle history');
    if (readOnly) {
      this.#prepare();
      return;
    }
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
    // What the candles count in (PH-38.4). Same shape as the record's, and a
    // separate log for the reason the version note above gives.
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS lattice (
        asset_id TEXT NOT NULL,
        from_sequence INTEGER NOT NULL,
        from_instant INTEGER NOT NULL,
        log_quantum REAL NOT NULL,
        reference_price REAL NOT NULL,
        display_precision INTEGER NOT NULL,
        PRIMARY KEY (asset_id, from_sequence)
      ) WITHOUT ROWID
    `);
    // No v1 to v2 body, for the reason the record has none: nothing here can
    // say what an existing candle counted in, and a guess written durably is
    // worse than an honest silence. An empty log reads as "the instrument in
    // force", which is exactly what this store's readers already assumed.
    stampSchemaVersion(this.#db, HISTORY_SCHEMA_VERSION);
    this.#prepare();
  }

  #prepare(): void {
    this.#hasLattice =
      this.#db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lattice'")
        .get() !== undefined;
    if (!this.#hasLattice) {
      this.#prepareRest();
      return;
    }
    this.#insertLattice = this.#db.prepare(
      'INSERT OR IGNORE INTO lattice (asset_id, from_sequence, from_instant, log_quantum, ' +
        'reference_price, display_precision) VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.#readLattices = this.#db.prepare(
      'SELECT asset_id, from_sequence, from_instant, log_quantum, reference_price, ' +
        'display_precision FROM lattice WHERE asset_id = ? ORDER BY from_sequence',
    );
    this.#prepareRest();
  }

  #prepareRest(): void {
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

  /**
   * Declare what an already-stored range of bars counted in (PH-38.4).
   *
   * Insert-only into the frame log; no candle row is read or touched. The
   * caller is expected to have dated the bars against the record —
   * `dateCandlesAgainstRecord` is what does that — because this store's rows
   * can have been re-expressed independently of the record and nothing in the
   * store itself can say so.
   */
  declareFrames(assetId: string, epochs: readonly LatticeEpoch[], replace = false): Promise<void> {
    if (this.#readOnly) {
      return Promise.reject(
        new HistoryError('This candle history was opened read-only. Nothing was modified.'),
      );
    }
    if (!this.#hasLattice) {
      return Promise.reject(
        new HistoryError('This candle history has no frame log to declare into.'),
      );
    }
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      if (replace) this.#db.prepare('DELETE FROM lattice WHERE asset_id = ?').run(assetId);
      for (const epoch of epochs) {
        this.#insertLattice.run(
          epoch.assetId,
          epoch.fromSequence,
          epoch.fromInstant,
          epoch.logQuantum,
          epoch.referencePrice,
          epoch.displayPrecision,
        );
      }
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
    return Promise.resolve();
  }

  frames(assetId: string): Promise<readonly LatticeEpoch[]> {
    if (!this.#hasLattice) return Promise.resolve([]);
    return Promise.resolve(
      this.#readLattices.all(assetId).map((row) => ({
        assetId: String(row['asset_id']),
        fromSequence: Number(row['from_sequence']),
        fromInstant: epochMillis(Number(row['from_instant'])),
        logQuantum: Number(row['log_quantum']),
        referencePrice: Number(row['reference_price']),
        displayPrecision: Number(row['display_precision']),
      })),
    );
  }

  append(
    assetId: string,
    timeframe: TimeframeId,
    candles: readonly Candle[],
    frame?: PriceFrame,
  ): Promise<void> {
    if (this.#readOnly) {
      return Promise.reject(
        new HistoryError(
          'This candle history was opened read-only, so that reading a running deployment could ' +
            'not upgrade its file underneath it (PH-38.4). Nothing was modified.',
        ),
      );
    }
    const unstored = unstoredTimeframe(timeframe);
    if (unstored !== null) return Promise.reject(unstored);
    if (candles.length === 0) return Promise.resolve();
    if (frame !== undefined && this.#hasLattice) {
      const held = this.#readLattices.all(assetId);
      const inForce = held.length === 0 ? null : held[held.length - 1]!;
      const same =
        inForce !== null &&
        Number(inForce['log_quantum']) === frame.logQuantum &&
        Number(inForce['reference_price']) === frame.referencePrice &&
        Number(inForce['display_precision']) === frame.displayPrecision;
      if (!same) {
        this.#insertLattice.run(
          assetId,
          candles[0]!.firstSequence,
          candles[0]!.openInstant,
          frame.logQuantum,
          frame.referencePrice,
          frame.displayPrecision,
        );
      }
    }
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
