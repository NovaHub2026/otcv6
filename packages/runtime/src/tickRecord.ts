import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { epochMillis, logPrice, type EpochMillis, type Tick } from '@otc/core';
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
  /**
   * The last tick at or before `instant`, or null when the record starts after
   * it (PH-29.1). The rule a settlement uses — `settle()`'s `priceAtOrBefore`
   * and the charts' — asked of the record rather than of a copy of it.
   */
  atOrBefore(assetId: string, instant: number): Promise<Tick | null>;
  /** The newest recorded sequence, or null when nothing is recorded. */
  head(assetId: string): Promise<number | null>;
  /** The oldest retained sequence, or null when nothing is recorded. */
  oldest(assetId: string): Promise<number | null>;
  /** Drop everything but the newest `keep` ticks. */
  trim(assetId: string, keep: number): Promise<void>;
  /** Every asset with at least one recorded tick. */
  assets(): Promise<readonly string[]>;
  /**
   * Every discontinuity the record holds for an asset, oldest first (PH-31,
   * Cycle Audit 10 a4-01/a1-01).
   */
  seams(assetId: string): Promise<readonly RecordedSeam[]>;
  /**
   * The seam whose interval contains `instant`, or null when none does.
   *
   * The interval is **open**: an instant equal to `lastInstant` is on the last
   * published tick and an instant equal to `resumesAtInstant` is on the first
   * one after the seam, so both are answerable prices. Everything strictly
   * between them is an instant nothing was published for. That is exactly the
   * predicate `settle()` applies to a window (`entry < resumesAtInstant &&
   * expiry > lastInstant`), narrowed to a point.
   */
  seamAt(assetId: string, instant: number): Promise<RecordedSeam | null>;
}

/**
 * A discontinuity in the published record: an interval nothing was published
 * in, kept as a row rather than left as a hole (PH-31).
 *
 * **Cycle Audit 10, a4-01 and a1-01.** A restart longer than the 15 s catch-up
 * bound — which is every deploy — seams a market: `resumeMarket` reports
 * `{kind:'seam'}` and the record keeps both sides of an interval nobody
 * generated. `settle()` refuses to settle a contract whose window touches one
 * (`RecordSeam` in `@otc/trading`, Cycle Audit 5) — but only when it is *given*
 * the seams, and nothing persisted them: `RecoveryOutcome.seam` lived in one
 * process's memory for the latest boot, so a seam from an earlier boot was
 * visible only as a jump in sequence. Meanwhile `GET /markets/:id/price?at=`
 * answered an instant inside the interval with the pre-seam tick, which is the
 * price a broker then settled real money against.
 *
 * The fields are what a settlement question needs and nothing else: which
 * asset, where the record stopped, and where it starts again — in sequence
 * *and* in instant, because `settle()` asks in instants and the stream's `gap`
 * frame speaks only sequences.
 *
 * Narrower than {@link SeamMarker} in `replication.ts`, deliberately: that one
 * describes a seam in the multi-node log, where a market may seam before it
 * has published anything (`lastSequence: null`). Here a seam is a discontinuity
 * *between two recorded ticks*, so both sides always exist.
 */
export interface RecordedSeam {
  readonly assetId: string;
  /** The last sequence the record holds before the gap. */
  readonly lastSequence: number;
  /** That tick's instant: the last instant a price was published for. */
  readonly lastInstant: EpochMillis;
  /** The first sequence the record holds after the gap. */
  readonly resumesAtSequence: number;
  /** That tick's instant: the first instant a price was published for again. */
  readonly resumesAtInstant: EpochMillis;
}

/**
 * The seam between two consecutive recorded ticks, or null when there is none.
 *
 * One rule, applied by both implementations at the one place a gap can enter
 * the record: an append whose next sequence is not the previous one plus one.
 * The record's own docstring already said what such a jump is — "a gap in
 * sequence above the head is accepted: it is what a seam looks like here" — and
 * this is that sentence made into a row. Detecting it here rather than in the
 * caller means every writer gets it: the venue's resume, the runtime host, and
 * any future path that appends past a hole.
 */
function seamBetween(assetId: string, previous: Tick, next: Tick): RecordedSeam | null {
  if (next.sequence === previous.sequence + 1) return null;
  return {
    assetId,
    lastSequence: previous.sequence,
    lastInstant: previous.instant,
    resumesAtSequence: next.sequence,
    resumesAtInstant: next.instant,
  };
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
 * cost — `MEASURED_RECORD_BYTES_PER_TICK` below, which `tickRecord.test.ts`
 * prints and holds itself to on every run — 250,000 ticks is **15.2 MiB per
 * asset**, on disk and not in memory, and the catalogue of thirty is
 * **456 MiB**.
 */
export const DEFAULT_RECORD_TICKS = 250_000;

/**
 * Bytes a tick costs on disk, and the figure every sizing claim above rests on.
 *
 * **Re-measured 2026-09-06 (Cycle Audit 10, a7-03).** This docstring said 32.6
 * bytes a tick, "about eight megabytes per asset" and "a quarter of a gigabyte
 * for the thirty" from PH-28.1 (2026-09-04) until now. PH-29.1 added the
 * `tick_by_instant` index over `(asset_id, instant, sequence)` — additive, so
 * every existing file gained it on open — and the cost doubled. Nothing said
 * so: the test asserted a bound of 80 and printed the figure, so 61.2 passed
 * the same assertion 32.6 had, and two phases of documents went on sizing an
 * operator's disk at half of what the release writes. That is why this is a
 * constant the test reads rather than a number in prose.
 *
 * **The method, and it is cheap to re-run.** One `SqliteTickRecord` on a real
 * file, 20,000 consecutive ticks of one asset appended in one call, closed,
 * `stat().size / 20000` — exactly what `tickRecord.test.ts` does, so the suite
 * re-measures it on every run. On this machine (2026-09-06, Node 24, WSL2):
 * **61.2**. Built by hand twice over the same table and the same ticks to
 * attribute it: 32.6 without `tick_by_instant`, 61.2 with it, so the index is
 * the whole of the doubling — an index on a `WITHOUT ROWID` table repeats the
 * primary key in every entry.
 *
 * The per-row cost rises slightly with the b-tree's depth, so the *sizing*
 * above is measured at the shipped default rather than extrapolated from this
 * figure: 250,000 ticks of one asset is 15,941,632 bytes on disk (63.8 bytes a
 * tick), which is the 15.2 MiB and 456 MiB stated on `DEFAULT_RECORD_TICKS`.
 * The 20% band the test allows is for a page-size or SQLite change; it fails
 * outright on another index.
 */
export const MEASURED_RECORD_BYTES_PER_TICK = 61.2;

/**
 * The record's schema version.
 *
 * **2 (PH-31):** the `seam` table. The by-instant index of PH-29.1 was additive
 * and left this at 1, because code that did not know about it still read the
 * file correctly — only slower. A seam table is not that kind of addition:
 * code that cannot read it answers `GET /markets/:id/price?at=` with a price
 * for an instant inside a gap nobody generated, which is the settlement defect
 * Cycle Audit 10 found. So a downgrade must fail closed at open rather than
 * quietly serve the wrong answer, and `assertSchemaNotNewer` is what makes it.
 * Forward is automatic: a version-1 file gains the table on open and is
 * stamped 2, and its seams are whatever it can still observe — nothing before
 * the upgrade, every one after it.
 */
export const RECORD_SCHEMA_VERSION = 2;

/** A record kept in one SQLite file, opened the way the candle history is. */
export class SqliteTickRecord implements TickRecord {
  readonly #db: DatabaseSync;
  readonly #insert: StatementSync;
  readonly #readAt: StatementSync;
  readonly #readSince: StatementSync;
  readonly #readNewest: StatementSync;
  readonly #readAtOrBefore: StatementSync;
  readonly #headOf: StatementSync;
  readonly #oldestOf: StatementSync;
  readonly #countOf: StatementSync;
  readonly #nthNewest: StatementSync;
  readonly #deleteBelow: StatementSync;
  readonly #assets: StatementSync;
  readonly #insertSeam: StatementSync;
  readonly #readSeams: StatementSync;
  readonly #readSeamAt: StatementSync;

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
    const foundVersion = Number(
      this.#db.prepare('PRAGMA user_version').get()?.['user_version'] ?? 0,
    );
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS tick (
        asset_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        instant INTEGER NOT NULL,
        price INTEGER NOT NULL,
        PRIMARY KEY (asset_id, sequence)
      ) WITHOUT ROWID
    `);
    // By instant as well as by sequence (PH-29.1): the settlement query asks
    // for the last tick at or before an instant. Additive, so a file from
    // before the index gains it on open; the schema version does not move.
    this.#db.exec(
      'CREATE INDEX IF NOT EXISTS tick_by_instant ON tick (asset_id, instant, sequence)',
    );
    // The discontinuities, one row per gap (PH-31). Tiny by construction — a
    // seam costs a restart past the catch-up bound — so it carries no index of
    // its own beyond its key.
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS seam (
        asset_id TEXT NOT NULL,
        last_sequence INTEGER NOT NULL,
        last_instant INTEGER NOT NULL,
        resumes_at_sequence INTEGER NOT NULL,
        resumes_at_instant INTEGER NOT NULL,
        PRIMARY KEY (asset_id, resumes_at_sequence)
      ) WITHOUT ROWID
    `);
    // The migration `sqlite.ts` said would be asked for here one day. A file
    // written before this version holds its seams already — as jumps between
    // consecutive sequences — and they are the seams of every deploy this
    // record has lived through, which is exactly the set a broker settling
    // last month's contract needs. Reading them out is one ordered pass over
    // the primary key, once, on the boot that upgrades the file; leaving them
    // out would mean the fix only covered gaps this process happened to see.
    if (foundVersion < RECORD_SCHEMA_VERSION) {
      this.#db.exec(`
        INSERT OR REPLACE INTO seam
          (asset_id, last_sequence, last_instant, resumes_at_sequence, resumes_at_instant)
        SELECT asset_id, sequence, instant, next_sequence, next_instant FROM (
          SELECT asset_id, sequence, instant,
                 LEAD(sequence) OVER (PARTITION BY asset_id ORDER BY sequence) AS next_sequence,
                 LEAD(instant) OVER (PARTITION BY asset_id ORDER BY sequence) AS next_instant
          FROM tick
        ) WHERE next_sequence IS NOT NULL AND next_sequence <> sequence + 1
      `);
    }
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
    this.#readAtOrBefore = this.#db.prepare(
      'SELECT sequence, instant, price FROM tick WHERE asset_id = ? AND instant <= ? ' +
        'ORDER BY instant DESC, sequence DESC LIMIT 1',
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
    // `OR REPLACE`: the same gap written twice is the same true fact, and a
    // constraint failure here would roll back the ticks of a whole pass and
    // stall a market over a row that already says what we were about to say.
    this.#insertSeam = this.#db.prepare(
      'INSERT OR REPLACE INTO seam (asset_id, last_sequence, last_instant, ' +
        'resumes_at_sequence, resumes_at_instant) VALUES (?, ?, ?, ?, ?)',
    );
    this.#readSeams = this.#db.prepare(
      'SELECT asset_id, last_sequence, last_instant, resumes_at_sequence, resumes_at_instant ' +
        'FROM seam WHERE asset_id = ? ORDER BY resumes_at_sequence',
    );
    this.#readSeamAt = this.#db.prepare(
      'SELECT asset_id, last_sequence, last_instant, resumes_at_sequence, resumes_at_instant ' +
        'FROM seam WHERE asset_id = ? AND last_instant < ? AND resumes_at_instant > ? LIMIT 1',
    );
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
          // The tick the record ends at, so a jump away from it is seen and
          // written down rather than left as a hole (PH-31). `head` is the
          // maximum sequence, so the row is always there.
          const headRow = head === null ? undefined : this.#readAt.get(assetId, head);
          let previous: Tick | null = headRow === undefined ? null : toTick(headRow);
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
            const seam = previous === null ? null : seamBetween(assetId, previous, tick);
            if (seam !== null) {
              this.#insertSeam.run(
                seam.assetId,
                seam.lastSequence,
                seam.lastInstant,
                seam.resumesAtSequence,
                seam.resumesAtInstant,
              );
            }
            previous = tick;
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

  atOrBefore(assetId: string, instant: number): Promise<Tick | null> {
    if (!Number.isSafeInteger(instant)) {
      return Promise.reject(
        new RangeError(`An instant must be a safe integer, received ${instant}.`),
      );
    }
    const row = this.#readAtOrBefore.get(assetId, instant);
    return Promise.resolve(row === undefined ? null : toTick(row));
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

  seams(assetId: string): Promise<readonly RecordedSeam[]> {
    return Promise.resolve(this.#readSeams.all(assetId).map(toSeam));
  }

  seamAt(assetId: string, instant: number): Promise<RecordedSeam | null> {
    if (!Number.isSafeInteger(instant)) {
      return Promise.reject(
        new RangeError(`An instant must be a safe integer, received ${instant}.`),
      );
    }
    const row = this.#readSeamAt.get(assetId, instant, instant);
    return Promise.resolve(row === undefined ? null : toSeam(row));
  }

  #head(assetId: string): number | null {
    const row = this.#headOf.get(assetId);
    return nullableNumber(row?.['head']);
  }
}

/** A record that persists nothing: tests, and a runtime that must not. */
export class MemoryTickRecord implements TickRecord {
  readonly #ticks = new Map<string, Tick[]>();
  readonly #seams = new Map<string, RecordedSeam[]>();

  append(batches: readonly AssetBatch[]): Promise<ReadonlyMap<string, readonly Tick[]>> {
    const fresh = new Map<string, readonly Tick[]>();
    const staged = new Map<string, Tick[]>();
    const stagedSeams = new Map<string, RecordedSeam[]>();
    for (const { assetId, ticks } of batches) {
      const malformed = malformedBatch(assetId, ticks);
      if (malformed !== null) return Promise.reject(malformed);
      const held = this.#ticks.get(assetId) ?? [];
      const head = held.length === 0 ? null : held[held.length - 1]!.sequence;
      // The same jump detection the SQLite record runs, on the same rule: the
      // two implementations must agree about what the record holds (PH-31).
      let previous: Tick | null = held.length === 0 ? null : held[held.length - 1]!;
      const seams: RecordedSeam[] = [];
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
        const seam = previous === null ? null : seamBetween(assetId, previous, tick);
        if (seam !== null) seams.push(seam);
        previous = tick;
        added.push({ sequence: tick.sequence, instant: tick.instant, price: tick.price });
      }
      staged.set(assetId, added);
      stagedSeams.set(assetId, seams);
      fresh.set(assetId, added);
    }
    // Applied only once every batch passed, so a refusal leaves everything as
    // it was — the same all-or-nothing the SQLite transaction gives.
    for (const [assetId, added] of staged) {
      const held = this.#ticks.get(assetId) ?? [];
      held.push(...added);
      this.#ticks.set(assetId, held);
    }
    for (const [assetId, added] of stagedSeams) {
      if (added.length === 0) continue;
      const held = this.#seams.get(assetId) ?? [];
      for (const seam of added) {
        const at = held.findIndex((one) => one.resumesAtSequence === seam.resumesAtSequence);
        if (at < 0) held.push(seam);
        else held[at] = seam;
      }
      held.sort((a, b) => a.resumesAtSequence - b.resumesAtSequence);
      this.#seams.set(assetId, held);
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

  atOrBefore(assetId: string, instant: number): Promise<Tick | null> {
    if (!Number.isSafeInteger(instant)) {
      return Promise.reject(
        new RangeError(`An instant must be a safe integer, received ${instant}.`),
      );
    }
    const held = this.#ticks.get(assetId) ?? [];
    let found: Tick | null = null;
    for (const tick of held) {
      if (tick.instant <= instant) found = tick;
      else break;
    }
    return Promise.resolve(found);
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

  seams(assetId: string): Promise<readonly RecordedSeam[]> {
    return Promise.resolve([...(this.#seams.get(assetId) ?? [])]);
  }

  seamAt(assetId: string, instant: number): Promise<RecordedSeam | null> {
    if (!Number.isSafeInteger(instant)) {
      return Promise.reject(
        new RangeError(`An instant must be a safe integer, received ${instant}.`),
      );
    }
    const held = this.#seams.get(assetId) ?? [];
    return Promise.resolve(
      held.find((seam) => seam.lastInstant < instant && instant < seam.resumesAtInstant) ?? null,
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

function toSeam(row: Record<string, unknown>): RecordedSeam {
  return {
    assetId: String(row['asset_id']),
    lastSequence: asNumber(row['last_sequence']),
    lastInstant: epochMillis(asNumber(row['last_instant'])),
    resumesAtSequence: asNumber(row['resumes_at_sequence']),
    resumesAtInstant: epochMillis(asNumber(row['resumes_at_instant'])),
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
