import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { epochMillis, logPrice, type Clock, type EpochMillis, type Tick } from '@otc/core';
import { StaleFenceError, type FenceToken } from './fence.js';
import {
  DEFAULT_LEASE_TERM_MS,
  isUsableHolder,
  LeaseHolderError,
  type AcquireOutcome,
  type CoordinatedStore,
  type LeaseGrant,
  type RenewOutcome,
} from './lease.js';
import {
  entrySequence,
  malformedBatch,
  RecordForkError,
  sameTick,
  SeamError,
  type RecordEntry,
  type SeamMarker,
} from './replication.js';
import {
  assertSchemaNotNewer,
  DEFAULT_BUSY_TIMEOUT_MS,
  enableWriteAheadLog,
  stampSchemaVersion,
} from './sqlite.js';
import { CorruptRecordError, type MarketStateRecord } from './state.js';

/**
 * A `CoordinatedStore` two processes can share.
 *
 * PH-14.1 argued that a fence check and a write must not interleave, and
 * satisfied it in memory by keeping the critical section free of `await`. That
 * argument does not survive two processes. A transaction is the real form of it:
 * `BEGIN IMMEDIATE` takes SQLite's write lock, so the read-compare-write is
 * atomic *across* processes rather than merely uninterrupted within one.
 *
 * **What this is correct for:** several processes on one machine, on a local
 * filesystem. It is not a distributed store, and SQLite over a network
 * filesystem is a documented way to corrupt a database. Multi-machine deployment
 * needs a networked backend, which PH-15 excludes because building one without a
 * deployment to inform it would be guessing.
 *
 * The clock is injected, like the in-memory store's. Persistence belongs to the
 * storage, not to where the time comes from, and expiry is judged by the store
 * (PH-14.1 §3) whichever store it is.
 */
export class SqliteCoordinatedStore implements CoordinatedStore {
  readonly #db: DatabaseSync;
  readonly #clock: Clock;
  readonly termMs: number;
  readonly #statements: Statements;

  /**
   * `busyTimeoutMs` is how long a contended write waits before the store
   * refuses it (`sqlite.ts` explains the default, and that the wait is
   * synchronous). Tests shorten it; a deployment has no reason to.
   */
  constructor(
    location: string,
    clock: Clock,
    termMs: number = DEFAULT_LEASE_TERM_MS,
    busyTimeoutMs: number = DEFAULT_BUSY_TIMEOUT_MS,
  ) {
    if (!Number.isFinite(termMs) || termMs <= 0) {
      throw new RangeError(`Lease term must be a positive number of milliseconds: ${termMs}.`);
    }
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new RangeError(`Busy timeout must be a non-negative integer: ${busyTimeoutMs}.`);
    }
    this.#clock = clock;
    this.termMs = termMs;
    this.#db = new DatabaseSync(location);
    // WAL so a reader never observes a half-written transaction. Set rather
    // than relied upon: the default journal mode does not give that.
    // `busy_timeout` first, and the order is the point. Contention between
    // processes is expected and is not an error: a leader renewing while
    // another node polls for the lease is the ordinary case, and without this
    // the loser of a race gets SQLITE_BUSY immediately, making a healthy
    // cluster report failures as its steady state.
    //
    // It is set *before* the schema because opening is itself contended:
    // `journal_mode = WAL` and `CREATE TABLE` both take a lock, and eight
    // processes opening the same new database at once had six of them die with
    // "database is locked" during construction. The store was concurrency-safe
    // in every method and not in its constructor, which no single-process test
    // could have shown.
    this.#db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    // An in-memory database has no file, no journal and no second process, so
    // there is nothing for WAL to protect and SQLite will not enter it — the
    // mode stays `memory` however often it is asked. Requiring WAL here broke
    // the whole conformance battery, which runs in memory, and the tie-ordering
    // test written minutes later was what surfaced it.
    if (location !== ':memory:') enableWriteAheadLog(this.#db);
    // Before any statement touches the schema (a5-11): a file written by newer
    // code is refused, not extended.
    assertSchemaNotNewer(this.#db, STORE_SCHEMA_VERSION, 'venue');
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec(SCHEMA);
    stampSchemaVersion(this.#db, STORE_SCHEMA_VERSION);
    this.#statements = prepareAll(this.#db);
  }

  close(): void {
    this.#db.close();
  }

  // ---------------------------------------------------------------- leases

  // The clock is read *inside* every transaction below, never before it
  // (a5-05, B-019 SQL-1). `BEGIN IMMEDIATE` blocks for up to the busy timeout,
  // and a reading taken before the wait judged expiry against a moment that had
  // passed by the time the compare ran — granting or renewing a lease that had
  // expired while the caller waited. `sqliteStore.test.ts` holds a clock that
  // can tell whether the lock is held when it is asked the time.

  acquire(assetId: string, holder: string): Promise<AcquireOutcome> {
    if (!isUsableHolder(holder)) return Promise.reject(new LeaseHolderError(holder));
    return this.#inTransaction(() => {
      const now = this.#clock.now();
      const held = this.#liveGrant(assetId, now);
      if (held !== null) return { kind: 'held', by: held } as const;

      // Strictly above the high-water mark, which is retained when a grant is
      // deleted. Reissuing an expired grant's token would let a stranded
      // holder's write match the new grant exactly.
      const row = this.#statements.readLease.get(assetId);
      const highWater = row === undefined ? 0 : asNumber(row['high_water']);
      const token = highWater + 1;
      const expiresAt = now + this.termMs;
      this.#statements.writeLease.run(assetId, holder, token, now, expiresAt, token);
      return {
        kind: 'granted',
        grant: {
          assetId,
          holder,
          token,
          grantedAt: now,
          expiresAt: epochMillis(expiresAt),
        },
      } as const;
    });
  }

  renew(grant: LeaseGrant): Promise<RenewOutcome> {
    return this.#inTransaction(() => {
      const now = this.#clock.now();
      const held = this.#liveGrant(grant.assetId, now);
      if (held === null || held.token !== grant.token || held.holder !== grant.holder) {
        return { kind: 'lost', current: held } as const;
      }
      // The token is preserved. Bumping it here would fence the live leader's
      // own in-flight writes, which is the failure renewal exists to prevent.
      const expiresAt = now + this.termMs;
      this.#statements.touchLease.run(expiresAt, grant.assetId);
      return {
        kind: 'renewed',
        grant: { ...held, expiresAt: epochMillis(expiresAt) },
      } as const;
    });
  }

  release(grant: LeaseGrant): Promise<void> {
    return this.#inTransaction(() => {
      const held = this.#liveGrant(grant.assetId, this.#clock.now());
      if (held !== null && held.token === grant.token && held.holder === grant.holder) {
        this.#statements.clearLease.run(grant.assetId);
      }
    });
  }

  inspect(assetId: string): Promise<LeaseGrant | null> {
    return this.#inTransaction(() => this.#liveGrant(assetId, this.#clock.now()));
  }

  // ------------------------------------------------------------ the record

  appendTicks(assetId: string, token: FenceToken, ticks: readonly Tick[]): Promise<void> {
    return this.#inTransaction(() => {
      const refusal = this.#fenceRefusal(assetId, token);
      if (refusal !== null) throw refusal;
      if (ticks.length === 0) return;
      // The rule both stores share (a5-05): a batch that disagrees with itself
      // is refused before it is compared with the record. Without this the
      // loop below deduplicated `[n, n]` against the row it had just inserted.
      const malformed = malformedBatch(assetId, ticks);
      if (malformed !== null) throw malformed;

      const meta = this.#meta(assetId);
      let head = meta.head;
      let expectNext = meta.expectNext;
      let position = meta.nextPosition;

      // The whole batch is validated before anything is written. A partial
      // append would leave a record no single writer could have produced — and
      // here that is a rollback rather than a convention, because a throw
      // inside the transaction rolls it back.
      for (const tick of ticks) {
        if (head !== null && tick.sequence <= head) {
          const row = this.#statements.readTickAt.get(assetId, tick.sequence);
          if (row === undefined) {
            throw new RangeError(
              `Cannot append sequence ${tick.sequence} to ${assetId}: the record holds no tick ` +
                `there to compare against, so a match cannot be established.`,
            );
          }
          const recorded: Tick = {
            sequence: asNumber(row['sequence']),
            instant: epochMillis(asNumber(row['instant'])),
            price: logPrice(asNumber(row['price'])),
          };
          if (!sameTick(recorded, tick)) {
            throw new RecordForkError(assetId, tick.sequence, recorded, tick);
          }
          continue; // Identical replay of a tick already recorded.
        }
        const expected = expectNext ?? tick.sequence;
        if (tick.sequence !== expected) {
          throw new RangeError(
            `Cannot append sequence ${tick.sequence} to ${assetId} after ${String(head)}: a gap ` +
              `in the record would be served to every observer as though it were the market. ` +
              `Past a genuine discontinuity, record a seam.`,
          );
        }
        this.#statements.insertTick.run(assetId, position, tick.sequence, tick.instant, tick.price);
        position += 1;
        head = tick.sequence;
        expectNext = tick.sequence + 1;
      }
      this.#statements.writeMeta.run(assetId, head, expectNext, position);
    });
  }

  recordSeam(assetId: string, token: FenceToken, seam: SeamMarker): Promise<void> {
    return this.#inTransaction(() => {
      const refusal = this.#fenceRefusal(assetId, token);
      if (refusal !== null) throw refusal;

      const meta = this.#meta(assetId);
      if (seam.assetId !== assetId) {
        throw new SeamError(assetId, `it names asset ${seam.assetId}`);
      }
      // A seam claiming a different last sequence would be rewriting history
      // rather than extending it, and the rewrite would be invisible after.
      if (seam.lastSequence !== meta.head) {
        throw new SeamError(
          assetId,
          `it continues from ${String(seam.lastSequence)} but the record's head is ` +
            `${String(meta.head)}`,
        );
      }
      if (!Number.isInteger(seam.resumesAtSequence) || seam.resumesAtSequence < 1) {
        throw new SeamError(assetId, `it resumes at sequence ${seam.resumesAtSequence}`);
      }
      if (meta.head !== null && seam.resumesAtSequence <= meta.head) {
        throw new SeamError(
          assetId,
          `it resumes at ${seam.resumesAtSequence}, at or before the head ${meta.head} — a seam ` +
            `moves forward or it is not a seam`,
        );
      }
      this.#statements.insertSeam.run(
        assetId,
        meta.nextPosition,
        entrySequence({ kind: 'seam', seam }),
        seam.lastSequence,
        seam.lastInstant,
        seam.resumesAtSequence,
        seam.resumesAtInstant,
        seam.reason,
      );
      this.#statements.writeMeta.run(
        assetId,
        meta.head,
        seam.resumesAtSequence,
        meta.nextPosition + 1,
      );
    });
  }

  readRecord(
    assetId: string,
    fromSequence: number,
    limit: number,
  ): Promise<readonly RecordEntry[]> {
    if (!Number.isInteger(fromSequence) || fromSequence < 1) {
      return Promise.reject(
        new RangeError(`A sequence must be a positive integer, received ${fromSequence}.`),
      );
    }
    if (!Number.isInteger(limit) || limit < 1) {
      return Promise.reject(new RangeError(`A read limit must be a positive integer.`));
    }
    const first = this.#statements.firstEntrySequence.get(assetId);
    const oldest = first === undefined ? null : asNullableNumber(first['sequence']);
    if (oldest === null) return Promise.resolve([]);
    if (fromSequence < oldest) {
      return Promise.reject(
        new RangeError(
          `Sequence ${fromSequence} for ${assetId} precedes the retained record, which starts ` +
            `at ${oldest}.`,
        ),
      );
    }
    const rows = this.#statements.readFrom.all(assetId, fromSequence, limit);
    return Promise.resolve(rows.map((row) => toEntry(assetId, row)));
  }

  recordHead(assetId: string): Promise<number | null> {
    return Promise.resolve(this.#meta(assetId).head);
  }

  seams(assetId: string): Promise<readonly SeamMarker[]> {
    const rows = this.#statements.readSeams.all(assetId);
    return Promise.resolve(rows.map((row) => toSeam(assetId, row)));
  }

  // ------------------------------------------------------------- the state

  saveFenced(record: MarketStateRecord, token: FenceToken): Promise<void> {
    return this.#inTransaction(() => {
      const refusal = this.#fenceRefusal(record.assetId, token);
      if (refusal !== null) throw refusal;
      this.#statements.writeState.run(record.assetId, JSON.stringify(record));
    });
  }

  /**
   * Unfenced write.
   *
   * Present because `CoordinatedStore` is a `StateStore`, and needed by the
   * paths that legitimately write without leading — tests, and the fresh-start
   * path before any lease exists.
   */
  save(record: MarketStateRecord): Promise<void> {
    this.#statements.writeState.run(record.assetId, JSON.stringify(record));
    return Promise.resolve();
  }

  load(assetId: string): Promise<MarketStateRecord | null> {
    const row = this.#statements.readState.get(assetId);
    if (row === undefined) return Promise.resolve(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(asString(row['payload']));
    } catch (error) {
      return Promise.reject(new CorruptRecordError(assetId, (error as Error).message));
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Promise.reject(new CorruptRecordError(assetId, 'record did not parse to an object'));
    }
    return Promise.resolve(parsed as MarketStateRecord);
  }

  list(): Promise<readonly string[]> {
    return Promise.resolve(
      this.#statements.listState.all().map((row) => asString(row['asset_id'])),
    );
  }

  // -------------------------------------------------------------- internals

  /**
   * Run a critical section under SQLite's write lock.
   *
   * `BEGIN IMMEDIATE` rather than `BEGIN`: a deferred transaction takes the
   * write lock only at its first write, which leaves the read-compare-write
   * open to exactly the interleaving the fence exists to prevent.
   *
   * A throw rolls back, which is what makes "a rejected write leaves the
   * database untouched" structural rather than careful.
   *
   * **One error contract (a5-06).** `BEGIN IMMEDIATE` and `COMMIT` sat outside
   * the `try`, so on `SQLITE_BUSY` a method whose type says `Promise` threw
   * synchronously — after blocking for the busy timeout — and a caller using
   * `.catch()` never saw it. Every failure is a rejection now; and any throw
   * once a transaction may be open is followed by a rollback, so a failed
   * `COMMIT` cannot leave the connection inside a transaction that makes every
   * later `BEGIN` fail. The wait itself is the binding's, and is documented at
   * `DEFAULT_BUSY_TIMEOUT_MS`.
   */
  #inTransaction<T>(body: () => T): Promise<T> {
    try {
      this.#db.exec('BEGIN IMMEDIATE');
    } catch (error) {
      return Promise.reject(asError(error));
    }
    try {
      const result = body();
      this.#db.exec('COMMIT');
      return Promise.resolve(result);
    } catch (error) {
      this.#rollBack();
      return Promise.reject(asError(error));
    }
  }

  /** Roll back if a transaction is open; a failed `BEGIN` or `COMMIT` may have left none. */
  #rollBack(): void {
    if (!this.#db.isTransaction) return;
    this.#db.exec('ROLLBACK');
  }

  /**
   * The grant in force at `now`, or null.
   *
   * An expired grant is cleared but its token stays in `high_water`, so expiry
   * can never recycle a token.
   */
  #liveGrant(assetId: string, now: EpochMillis): LeaseGrant | null {
    const row = this.#statements.readLease.get(assetId);
    if (row === undefined) return null;
    const holder = row['holder'];
    if (holder === null) return null;
    const expiresAt = asNumber(row['expires_at']);
    if (now >= expiresAt) {
      this.#statements.clearLease.run(assetId);
      return null;
    }
    return {
      assetId,
      holder: asString(holder),
      token: asNumber(row['token']),
      grantedAt: epochMillis(asNumber(row['granted_at'])),
      expiresAt: epochMillis(expiresAt),
    };
  }

  /** The fence check every write shares. Returns a refusal rather than throwing. */
  #fenceRefusal(assetId: string, token: FenceToken): StaleFenceError | null {
    const now = this.#clock.now();
    const row = this.#statements.readLease.get(assetId);
    if (row === undefined || row['holder'] === null) {
      const known = row === undefined ? null : asNullableNumber(row['token']);
      return new StaleFenceError(assetId, token, known, 'the asset is not currently led');
    }
    const currentToken = asNumber(row['token']);
    if (now >= asNumber(row['expires_at'])) {
      this.#statements.clearLease.run(assetId);
      return new StaleFenceError(assetId, token, currentToken, 'that grant has expired');
    }
    if (currentToken !== token) {
      return new StaleFenceError(
        assetId,
        token,
        currentToken,
        `held by ${asString(row['holder'])}`,
      );
    }
    return null;
  }

  #meta(assetId: string): { head: number | null; expectNext: number | null; nextPosition: number } {
    const row = this.#statements.readMeta.get(assetId);
    if (row === undefined) return { head: null, expectNext: null, nextPosition: 0 };
    return {
      head: asNullableNumber(row['head']),
      expectNext: asNullableNumber(row['expect_next']),
      nextPosition: asNumber(row['next_position']),
    };
  }
}

/**
 * The schema, and every column is a property the conformance battery asserts.
 *
 * `high_water` is separate from `token` because expiry must never recycle a
 * token: the grant row is cleared when it expires and the mark survives it. A
 * schema that folded the two together would pass every property but that one.
 *
 * `position` is an insertion ordinal rather than a sequence, because sequences
 * are sparse after a seam and cannot index the table. A separate index on
 * `(asset_id, sequence)` serves lookup.
 */
/**
 * Schema version stamped into a coordinated-store database (`PRAGMA user_version`).
 *
 * Bump when `SCHEMA` changes shape, and add the migration `sqlite.ts` asks for.
 */
export const STORE_SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lease (
  asset_id   TEXT PRIMARY KEY,
  holder     TEXT,
  token      INTEGER,
  granted_at INTEGER,
  expires_at INTEGER,
  high_water INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS record (
  asset_id              TEXT NOT NULL,
  position              INTEGER NOT NULL,
  kind                  TEXT NOT NULL,
  sequence              INTEGER NOT NULL,
  instant               INTEGER,
  price                 INTEGER,
  seam_last_sequence    INTEGER,
  seam_last_instant     INTEGER,
  seam_resumes_sequence INTEGER,
  seam_resumes_instant  INTEGER,
  seam_reason           TEXT,
  PRIMARY KEY (asset_id, position)
) STRICT;

CREATE INDEX IF NOT EXISTS record_by_sequence ON record (asset_id, sequence, position);
CREATE INDEX IF NOT EXISTS record_ticks ON record (asset_id, kind, sequence);

CREATE TABLE IF NOT EXISTS record_meta (
  asset_id      TEXT PRIMARY KEY,
  head          INTEGER,
  expect_next   INTEGER,
  next_position INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS state (
  asset_id TEXT PRIMARY KEY,
  payload  TEXT NOT NULL
) STRICT;
`;

interface Statements {
  readonly readLease: StatementSync;
  readonly writeLease: StatementSync;
  readonly touchLease: StatementSync;
  readonly clearLease: StatementSync;
  readonly readMeta: StatementSync;
  readonly writeMeta: StatementSync;
  readonly insertTick: StatementSync;
  readonly insertSeam: StatementSync;
  readonly readTickAt: StatementSync;
  readonly readFrom: StatementSync;
  readonly firstEntrySequence: StatementSync;
  readonly readSeams: StatementSync;
  readonly readState: StatementSync;
  readonly writeState: StatementSync;
  readonly listState: StatementSync;
}

function prepareAll(db: DatabaseSync): Statements {
  return {
    readLease: db.prepare('SELECT * FROM lease WHERE asset_id = ?'),
    writeLease: db.prepare(
      `INSERT INTO lease (asset_id, holder, token, granted_at, expires_at, high_water)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         holder = excluded.holder, token = excluded.token,
         granted_at = excluded.granted_at, expires_at = excluded.expires_at,
         high_water = excluded.high_water`,
    ),
    touchLease: db.prepare('UPDATE lease SET expires_at = ? WHERE asset_id = ?'),
    // The grant goes; `high_water` stays, which is the whole reason it is a
    // column of its own.
    clearLease: db.prepare(
      `UPDATE lease SET holder = NULL, token = NULL, granted_at = NULL, expires_at = NULL
       WHERE asset_id = ?`,
    ),
    readMeta: db.prepare('SELECT * FROM record_meta WHERE asset_id = ?'),
    writeMeta: db.prepare(
      `INSERT INTO record_meta (asset_id, head, expect_next, next_position)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         head = excluded.head, expect_next = excluded.expect_next,
         next_position = excluded.next_position`,
    ),
    insertTick: db.prepare(
      `INSERT INTO record (asset_id, position, kind, sequence, instant, price)
       VALUES (?, ?, 'tick', ?, ?, ?)`,
    ),
    insertSeam: db.prepare(
      `INSERT INTO record (asset_id, position, kind, sequence, seam_last_sequence,
                           seam_last_instant, seam_resumes_sequence, seam_resumes_instant,
                           seam_reason)
       VALUES (?, ?, 'seam', ?, ?, ?, ?, ?, ?)`,
    ),
    readTickAt: db.prepare(
      `SELECT sequence, instant, price FROM record
       WHERE asset_id = ? AND kind = 'tick' AND sequence = ?`,
    ),
    readFrom: db.prepare(
      `SELECT * FROM record WHERE asset_id = ? AND sequence >= ?
       ORDER BY position LIMIT ?`,
    ),
    firstEntrySequence: db.prepare(
      'SELECT sequence FROM record WHERE asset_id = ? ORDER BY position LIMIT 1',
    ),
    readSeams: db.prepare(
      `SELECT * FROM record WHERE asset_id = ? AND kind = 'seam' ORDER BY position`,
    ),
    readState: db.prepare('SELECT payload FROM state WHERE asset_id = ?'),
    writeState: db.prepare(
      `INSERT INTO state (asset_id, payload) VALUES (?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET payload = excluded.payload`,
    ),
    listState: db.prepare('SELECT asset_id FROM state ORDER BY asset_id'),
  };
}

type Row = Record<string, unknown>;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new TypeError(`Expected a number from the database, received ${typeof value}.`);
}

function asNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : asNumber(value);
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected a string from the database, received ${typeof value}.`);
  }
  return value;
}

function toEntry(assetId: string, row: Row): RecordEntry {
  if (row['kind'] === 'seam') return { kind: 'seam', seam: toSeam(assetId, row) };
  return {
    kind: 'tick',
    tick: {
      sequence: asNumber(row['sequence']),
      instant: epochMillis(asNumber(row['instant'])),
      price: logPrice(asNumber(row['price'])),
    },
  };
}

function toSeam(assetId: string, row: Row): SeamMarker {
  const lastInstant = asNullableNumber(row['seam_last_instant']);
  return {
    assetId,
    lastSequence: asNullableNumber(row['seam_last_sequence']),
    lastInstant: lastInstant === null ? null : epochMillis(lastInstant),
    resumesAtSequence: asNumber(row['seam_resumes_sequence']),
    resumesAtInstant: epochMillis(asNumber(row['seam_resumes_instant'])),
    reason: asString(row['seam_reason']),
  };
}
