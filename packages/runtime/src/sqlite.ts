import type { DatabaseSync } from 'node:sqlite';

/**
 * What the two SQLite databases share: how they are opened.
 *
 * `SqliteCoordinatedStore` and `SqliteCandleHistory` are deliberately separate
 * databases (`sqliteHistory.ts` says why). They are not separate problems at
 * open time, and the store had solved two of them the history had not (a5-10,
 * a5-11): the journal-mode race between processes opening one new file, and
 * the version of the schema they find in it.
 */

/**
 * The busy timeout, in milliseconds.
 *
 * Contention between processes is expected and is not an error: a leader
 * renewing while another node polls for the lease, a writer flushing candles
 * while a chart request reads them. Without a timeout the loser of a race gets
 * `SQLITE_BUSY` immediately, and a healthy deployment reports failures as its
 * steady state.
 *
 * **The wait is synchronous.** `node:sqlite` blocks the thread for it, so the
 * event loop — every asset, every HTTP handler — stalls for up to this long on
 * a contended write (a5-06). That is a property of the binding, not of this
 * code; what this code guarantees is the contract at the end of the wait: a
 * rejection, never a synchronous throw, and no transaction left open.
 */
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

/** How many times to try the journal-mode change before giving up. */
export const WAL_ATTEMPTS = 100;

/**
 * Put the database in WAL mode, tolerating another process doing it first.
 *
 * `busy_timeout` does not cover this. The journal-mode change needs an
 * exclusive lock and SQLite refuses immediately rather than invoking the busy
 * handler, so eight processes opening the same new database at once had seven
 * of them die with "database is locked" — in the constructor, before any
 * method the store's tests exercise. The mode is a property of the file, so
 * losing the race is not a failure: whoever wins sets it for everyone.
 *
 * What is checked is the outcome, not the attempt. If the mode is not WAL
 * after the retries, that is a real refusal and it is raised: a database on
 * the rollback journal would let a reader observe a half-written transaction,
 * which is the one thing this pragma is for.
 *
 * Shared by both databases (a5-10): the candle history ran the unretried form,
 * so two API processes provisioning into one new history file could die in the
 * constructor — the defect the store had already measured and fixed.
 */
export function enableWriteAheadLog(db: DatabaseSync): void {
  for (let attempt = 0; attempt < WAL_ATTEMPTS; attempt += 1) {
    // Read before writing. Once any process has set the mode it is a
    // property of the file, so every later open takes this branch and never
    // contends at all — the race exists only while the database is new.
    const row = db.prepare('PRAGMA journal_mode').get();
    if (row !== undefined && String(row['journal_mode']).toLowerCase() === 'wal') return;
    try {
      db.exec('PRAGMA journal_mode = WAL');
    } catch (error) {
      void error;
      // Wait for the process that holds the lock rather than spinning
      // against it. An empty immediate transaction blocks under
      // `busy_timeout`, which the journal-mode change itself does not
      // honour — that asymmetry is the whole reason this loop exists.
      try {
        db.exec('BEGIN IMMEDIATE; COMMIT;');
      } catch (waited) {
        void waited;
      }
    }
  }
  throw new Error(
    `Could not put the database into WAL mode after ${WAL_ATTEMPTS} attempts. Without it a ` +
      `reader can observe a half-written transaction, so the database refuses to open.`,
  );
}

/**
 * Refuse a database whose schema is newer than this code (a5-11).
 *
 * `PRAGMA user_version` is the schema version the code that created or last
 * migrated the file wrote there. Zero is a file this code has not versioned:
 * either new, or written before versioning existed, and in both cases the
 * schema statements that follow are the ones it needs. A version *above* the
 * one this code writes is a downgrade or a mixed-version rollout, and the file
 * may hold columns and rules this code does not know — it is refused before
 * any statement runs against it, with both numbers in the message.
 *
 * An *older* shape under version zero still fails closed where it always did,
 * at `prepare`, with SQLite's own message about a missing column. No migration
 * exists yet because no schema has changed yet; when one does, this is where
 * it will be asked for.
 */
export function assertSchemaNotNewer(db: DatabaseSync, expected: number, what: string): void {
  const row = db.prepare('PRAGMA user_version').get();
  const found = Number(row?.['user_version'] ?? 0);
  if (found > expected) {
    throw new Error(
      `The ${what} database is at schema version ${found}, newer than the ${expected} this ` +
        `code understands. It was written by newer code — a downgrade or a mixed-version ` +
        `rollout — and is refused rather than written to in a shape that code does not expect.`,
    );
  }
}

/** Record the schema version this code writes, once the schema exists. */
export function stampSchemaVersion(db: DatabaseSync, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}
