import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { malformedBatch, RecordForkError, sameTick } from './replication.js';
import {
  assertSchemaNotNewer,
  DEFAULT_BUSY_TIMEOUT_MS,
  enableWriteAheadLog,
  stampSchemaVersion,
} from './sqlite.js';

/**
 * The published record, persisted: what the venue served, kept past the
 * process that served it (PH-28.1).
 *
 * Until this existed the shipped service persisted what it needed to
 * *continue* a market — a checkpoint, the closed candles — and nothing of what
 * it had *published*. PH-25.1 measured what that costs across a `SIGKILL`: a
 * client holding a sequence from before the resume point was refused as
 * evicted though nothing had been evicted (finding a), and the minute the kill
 * fell in was withheld by the resumed recorder because it saw it from inside
 * (finding c). Both are the same fact, and this is the store that changes it.
 *
 * ## What it holds, and what it may not
 *
 * A row is a sequence, an instant and a price — exactly what a `tick` frame on
 * the stream carries — and nothing else. No engine state, no cursor, nothing an
 * observer could not have read for themselves (INV-010). It is written **after**
 * generation and read by nothing that generates (INV-001): the venue appends
 * the batch it is about to publish, and what comes back is which of those
 * ticks were new.
 *
 * ## The append compares, and that is the point
 *
 * A resumed market regenerates the ticks between its checkpoint and the kill
 * and publishes them again. They are the same ticks — deterministic replay
 * reproduces them — and the record is what says so: a sequence at or below the
 * head is compared with the stored tick, accepted silently when identical, and
 * refused with {@link RecordForkError} when not. A fork is two different
 * streams claiming one asset (INV-002 broken), and the honest response is to
 * publish nothing rather than a second record. Ticks the record already holds
 * are not returned as fresh, so the feed, the publisher and the history never
 * see a tick twice.
 *
 * ## Bounded
 *
 * Per asset, by count, trimmed on the checkpoint cadence. A gap in sequence
 * above the head is accepted: it is what a seam looks like here, and the feed
 * that is primed from the record takes only the newest contiguous run.
 */
export interface TickRecord {
  /**
   * Append every asset's batch of one scheduler pass, atomically.
   *
   * Returns, per asset, the ticks the record did not already hold — the ones
   * to publish onward. Throws `RecordForkError` when a held sequence is offered
   * with a different instant or price, and nothing is written for any asset in
   * that case.
   */
  append(batches: readonly AssetBatch[]): Promise<ReadonlyMap<string, readonly Tick[]>>;
  /** The newest contiguous run of at most `limit` ticks, oldest first. */
  tail(assetId: string, limit: number): Promise<readonly Tick[]>;
  /** Ticks at or after `fromSequence`, oldest first, at most `limit`. */
  since(assetId: string, fromSequence: number, limit: number): Promise<readonly Tick[]>;
  /** The newest recorded sequence, or null when nothing is recorded. */
  head(assetId: string): Promise<number | null>;
  /** The oldest retained sequence, or null when nothing is recorded. */
  oldest(assetId: string): Promise<number | null>;
  /** Drop everything but the newest `keep` ticks. */
  trim(assetId: string, keep: number): Promise<void>;
  /** Every asset with at least one recorded tick. */
  assets(): Promise<readonly string[]>;
}

export interface AssetBatch {
  readonly assetId: string;
  readonly ticks: readonly Tick[];
}

/**
 * Ticks retained per asset by default.
 *
 * The feed's in-memory window is 50,000 (`DEFAULT_RETAIN_TICKS`); the record
 * keeps five times that so a client's resume across a restart is honoured for
 * the same span the feed would have honoured it in a process that never
 * stopped, with room for PH-29's settlement query behind it. At the measured row
 * cost — 32.6 bytes a tick on disk, `tickRecord.test.ts` prints it on every
 * run — that is about eight megabytes per asset, on disk and not in memory;
 * the catalogue of thirty is a quarter of a gigabyte.
 */
export const DEFAULT_RECORD_TICKS = 250_000;

export const RECORD_SCHEMA_VERSION = 1;

/** A record kept in one SQLite file, opened the way the candle history is. */
export class SqliteTickRecord implements TickRecord {
  readonly #db: DatabaseSync;
  readonly #insert: StatementSync;
  readonly #readAt: StatementSync;
  readonly #readSince: StatementSync;
  readonly #readNewest: StatementSync;
  readonly #headOf: StatementSync;
  readonly #oldestOf: StatementSync;
  readonly #countOf: StatementSync;
  readonly #nthNewest: StatementSync;
  readonly #deleteBelow: StatementSync;
  readonly #assets: StatementSync;

  constructor(location: string) {
    if (location !== ':memory:' && !location.startsWith('file:')) {
      mkdirSync(path.dirname(path.resolve(location)), { recursive: true });
    }
    this.#db = new DatabaseSync(location);
    this.#db.exec(`PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);
    if (location !== ':memory:') enableWriteAheadLog(this.#db);
    // NORMAL, not FULL: a commit in WAL mode is durable against the process
    // dying — the failure this record exists for — without an fsync on every
    // scheduler pass. What it does not survive is the machine losing power
    // between the commit and the next checkpoint of the WAL, and that window
    // holds the ticks a resumed market regenerates anyway.
    this.#db.exec('PRAGMA synchronous = NORMAL');
    assertSchemaNotNewer(this.#db, RECORD_SCHEMA_VERSION, 'tick record');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS tick (
        asset_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        instant INTEGER NOT NULL,
        price INTEGER NOT NULL,
        PRIMARY KEY (asset_id, sequence)
      ) WITHOUT ROWID
    `);
    stampSchemaVersion(this.#db, RECORD_SCHEMA_VERSION);
    this.#insert = this.#db.prepare(
      'INSERT INTO tick (asset_id, sequence, instant, price) VALUES (?, ?, ?, ?)',
    );
    this.#readAt = this.#db.prepare(
      'SELECT sequence, instant, price FROM tick WHERE asset_id = ? AND sequence = ?',
    );
    this.#readSince = this.#db.prepare(
      'SELECT sequence, instant, price FROM tick WHERE asset_id = ? AND sequence >= ? ' +
        'ORDER BY sequence LIMIT ?',
    );
    this.#readNewest = this.#db.prepare(
      'SELECT sequence, instant, price FROM tick WHERE asset_id = ? ' +
        'ORDER BY sequence DESC LIMIT ?',
    );
    this.#headOf = this.#db.prepare('SELECT MAX(sequence) AS head FROM tick WHERE asset_id = ?');
    this.#oldestOf = this.#db.prepare(
      'SELECT MIN(sequence) AS oldest FROM tick WHERE asset_id = ?',
    );
    this.#countOf = this.#db.prepare('SELECT COUNT(*) AS n FROM tick WHERE asset_id = ?');
    this.#nthNewest = this.#db.prepare(
      'SELECT sequence FROM tick WHERE asset_id = ? ORDER BY sequence DESC LIMIT 1 OFFSET ?',
    );
    this.#deleteBelow = this.#db.prepare('DELETE FROM tick WHERE asset_id = ? AND sequence < ?');
    this.#assets = this.#db.prepare('SELECT DISTINCT asset_id FROM tick ORDER BY asset_id');
  }

  close(): void {
    this.#db.close();
  }

  append(batches: readonly AssetBatch[]): Promise<ReadonlyMap<string, readonly Tick[]>> {
    const fresh = new Map<string, readonly Tick[]>();
    try {
      // Validated whole before anything is written, and written inside one
      // transaction, so a refusal for one asset leaves every asset's record as
      // it was. `BEGIN IMMEDIATE` takes the write lock up front; a reader —
      // PH-29's settlement query, a boot priming from another process — never
      // sees a pass half-applied.
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        for (const { assetId, ticks } of batches) {
          if (ticks.length === 0) {
            fresh.set(assetId, []);
            continue;
          }
          const malformed = malformedBatch(assetId, ticks);
          if (malformed !== null) throw malformed;
          const head = this.#head(assetId);
          const added: Tick[] = [];
          for (const tick of ticks) {
            if (head !== null && tick.sequence <= head) {
              const row = this.#readAt.get(assetId, tick.sequence);
              if (row === undefined) {
                // Inside the retained range but not held: below the oldest
                // after a trim, or inside a seam's gap. Either way the record
                // cannot say whether this is the tick that was published
                // there, and it does not guess.
                throw new RangeError(
                  `Cannot append sequence ${tick.sequence} to ${assetId}: it is at or below the ` +
                    `record's head ${head} and the record holds no tick there to compare ` +
                    `against. The record was not modified.`,
                );
              }
              const recorded = toTick(row);
              if (!sameTick(recorded, tick)) {
                throw new RecordForkError(assetId, tick.sequence, recorded, tick);
              }
              continue;
            }
            this.#insert.run(assetId, tick.sequence, tick.instant, tick.price);
            added.push(tick);
          }
          fresh.set(assetId, added);
        }
        this.#db.exec('COMMIT');
      } catch (error) {
        this.#db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return Promise.resolve(fresh);
  }

  tail(assetId: string, limit: number): Promise<readonly Tick[]> {
    const bad = badLimit(limit);
    if (bad !== null) return Promise.reject(bad);
    const newestFirst = this.#readNewest.all(assetId, limit).map(toTick);
    return Promise.resolve(contiguousTail(newestFirst));
  }

  since(assetId: string, fromSequence: number, limit: number): Promise<readonly Tick[]> {
    const bad = badLimit(limit) ?? badSequence(fromSequence);
    if (bad !== null) return Promise.reject(bad);
    return Promise.resolve(this.#readSince.all(assetId, fromSequence, limit).map(toTick));
  }

  head(assetId: string): Promise<number | null> {
    return Promise.resolve(this.#head(assetId));
  }

  oldest(assetId: string): Promise<number | null> {
    const row = this.#oldestOf.get(assetId);
    return Promise.resolve(nullableNumber(row?.['oldest']));
  }

  trim(assetId: string, keep: number): Promise<void> {
    const bad = badLimit(keep);
    if (bad !== null) return Promise.reject(bad);
    const count = asNumber(this.#countOf.get(assetId)?.['n']);
    if (count <= keep) return Promise.resolve();
    const row = this.#nthNewest.get(assetId, keep - 1);
    if (row === undefined) return Promise.resolve();
    this.#deleteBelow.run(assetId, asNumber(row['sequence']));
    return Promise.resolve();
  }

  assets(): Promise<readonly string[]> {
    return Promise.resolve(this.#assets.all().map((row) => String(row['asset_id'])));
  }

  #head(assetId: string): number | null {
    const row = this.#headOf.get(assetId);
    return nullableNumber(row?.['head']);
  }
}

/** A record that persists nothing: tests, and a runtime that must not. */
export class MemoryTickRecord implements TickRecord {
  readonly #ticks = new Map<string, Tick[]>();

  append(batches: readonly AssetBatch[]): Promise<ReadonlyMap<string, readonly Tick[]>> {
    const fresh = new Map<string, readonly Tick[]>();
    const staged = new Map<string, Tick[]>();
    for (const { assetId, ticks } of batches) {
      const malformed = malformedBatch(assetId, ticks);
      if (malformed !== null) return Promise.reject(malformed);
      const held = this.#ticks.get(assetId) ?? [];
      const head = held.length === 0 ? null : held[held.length - 1]!.sequence;
      const added: Tick[] = [];
      for (const tick of ticks) {
        if (head !== null && tick.sequence <= head) {
          const recorded = held.find((entry) => entry.sequence === tick.sequence);
          if (recorded === undefined) {
            return Promise.reject(
              new RangeError(
                `Cannot append sequence ${tick.sequence} to ${assetId}: it is at or below the ` +
                  `record's head ${head} and the record holds no tick there to compare ` +
                  `against. The record was not modified.`,
              ),
            );
          }
          if (!sameTick(recorded, tick)) {
            return Promise.reject(new RecordForkError(assetId, tick.sequence, recorded, tick));
          }
          continue;
        }
        added.push({ sequence: tick.sequence, instant: tick.instant, price: tick.price });
      }
      staged.set(assetId, added);
      fresh.set(assetId, added);
    }
    // Applied only once every batch passed, so a refusal leaves everything as
    // it was — the same all-or-nothing the SQLite transaction gives.
    for (const [assetId, added] of staged) {
      const held = this.#ticks.get(assetId) ?? [];
      held.push(...added);
      this.#ticks.set(assetId, held);
    }
    return Promise.resolve(fresh);
  }

  tail(assetId: string, limit: number): Promise<readonly Tick[]> {
    const bad = badLimit(limit);
    if (bad !== null) return Promise.reject(bad);
    const held = this.#ticks.get(assetId) ?? [];
    const newestFirst = held.slice(Math.max(0, held.length - limit)).reverse();
    return Promise.resolve(contiguousTail(newestFirst));
  }

  since(assetId: string, fromSequence: number, limit: number): Promise<readonly Tick[]> {
    const bad = badLimit(limit) ?? badSequence(fromSequence);
    if (bad !== null) return Promise.reject(bad);
    const held = this.#ticks.get(assetId) ?? [];
    return Promise.resolve(held.filter((tick) => tick.sequence >= fromSequence).slice(0, limit));
  }

  head(assetId: string): Promise<number | null> {
    const held = this.#ticks.get(assetId) ?? [];
    return Promise.resolve(held.length === 0 ? null : held[held.length - 1]!.sequence);
  }

  oldest(assetId: string): Promise<number | null> {
    const held = this.#ticks.get(assetId) ?? [];
    return Promise.resolve(held.length === 0 ? null : held[0]!.sequence);
  }

  trim(assetId: string, keep: number): Promise<void> {
    const bad = badLimit(keep);
    if (bad !== null) return Promise.reject(bad);
    const held = this.#ticks.get(assetId) ?? [];
    if (held.length > keep) this.#ticks.set(assetId, held.slice(held.length - keep));
    return Promise.resolve();
  }

  assets(): Promise<readonly string[]> {
    return Promise.resolve(
      [...this.#ticks.keys()].filter((id) => this.#ticks.get(id)!.length > 0).sort(),
    );
  }

  /** Replace a held tick's price, to plant a fork. */
  corrupt(assetId: string, sequence: number, price: number): void {
    const held = this.#ticks.get(assetId) ?? [];
    const index = held.findIndex((tick) => tick.sequence === sequence);
    if (index < 0) throw new RangeError(`No tick ${sequence} for ${assetId} to corrupt.`);
    held[index] = { ...held[index]!, price: logPrice(price) };
  }
}

/** The newest contiguous run of a newest-first list, returned oldest first. */
function contiguousTail(newestFirst: readonly Tick[]): Tick[] {
  const run: Tick[] = [];
  for (const tick of newestFirst) {
    const previous = run[run.length - 1];
    if (previous !== undefined && tick.sequence !== previous.sequence - 1) break;
    run.push(tick);
  }
  return run.reverse();
}

function badLimit(limit: number): RangeError | null {
  if (!Number.isInteger(limit) || limit < 1) {
    return new RangeError(`A record limit must be a positive integer, received ${limit}.`);
  }
  return null;
}

function badSequence(sequence: number): RangeError | null {
  if (!Number.isInteger(sequence) || sequence < 1) {
    return new RangeError(`A sequence must be a positive integer, received ${sequence}.`);
  }
  return null;
}

function toTick(row: Record<string, unknown>): Tick {
  return {
    sequence: asNumber(row['sequence']),
    instant: epochMillis(asNumber(row['instant'])),
    price: logPrice(asNumber(row['price'])),
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return asNumber(value);
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new TypeError(`Expected a number from the tick record, received ${typeof value}.`);
}
