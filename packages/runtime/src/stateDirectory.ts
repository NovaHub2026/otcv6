import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { epochMillis } from '@otc/core';
import {
  BACKUP_MANIFEST,
  BACKUP_MANIFEST_KIND,
  FileStateStore,
  isBackupManifestText,
} from './fileStore.js';
import { lastStoredSequence } from './history.js';
import { FileAssetRegistry } from './registry.js';
import { SqliteCandleHistory } from './sqliteHistory.js';
import {
  assertUsableRecord,
  CorruptRecordError,
  UnusableRecordError,
  type MarketStateRecord,
} from './state.js';
import { SqliteTickRecord } from './tickRecord.js';

/**
 * The state directory as one thing an operator can check, copy and put back
 * (PH-28.3).
 *
 * A deployment's state directory holds a checkpoint per asset (`<id>.json`),
 * the candle history (`history.db`), the published record (`record.db`), the
 * asset registry (`assets/`) and, for a Lab-composed engine, the marker under
 * `lab/`. Each file is written safely on its own — atomic renames, WAL — and
 * nothing said whether they agreed with one another. A restore that mixed a
 * newer checkpoint with an older record would boot, refuse every client's
 * resume as evicted, and continue the commitment chain from a tip the record
 * cannot reach: three files each consistent and one directory that is not.
 *
 * `verifyStateDirectory` is the check, run before a market resumes and by the
 * operator's tool; `backupStateDirectory` is the copy, consistent per file
 * while the venue runs, verified on the way out.
 */

export interface StateProblem {
  readonly file: string;
  readonly assetId: string | null;
  readonly detail: string;
}

export interface AssetHeads {
  /** `lastPublished` of the checkpoint, or null when it has published nothing. */
  readonly checkpoint: number | null;
  /** The record's newest sequence, or null when it holds nothing for the asset. */
  readonly record: number | null;
  /** The candle history's newest stored `lastSequence`, or null. */
  readonly history: number | null;
}

/**
 * The backup this directory is a copy of, when it holds a manifest (a6-07).
 */
export interface BackupOrigin {
  /** `takenAt` of the manifest the directory holds. */
  readonly takenAt: number;
  /**
   * Whether nothing has run here since: every head still exactly what the
   * manifest recorded.
   *
   * True is the signature of a **restore that has not been started yet** — a
   * directory swap, the documented procedure. It is the one moment at which an
   * operator can still be told what the restore costs: every tick the venue
   * served after `takenAt` is absent from this record, so those sequences
   * answer 404 and the settlement query answers those instants with the price
   * this record ends at rather than the one observers saw. False means the
   * venue has already run here and the manifest is only history.
   */
  readonly untouched: boolean;
}

export interface StateDirectoryReport {
  readonly directory: string;
  /** Assets with a checkpoint, sorted. */
  readonly assets: readonly string[];
  readonly heads: Readonly<Record<string, AssetHeads>>;
  /** Refuse the boot: the directory cannot be resumed safely. */
  readonly problems: readonly StateProblem[];
  /** Seams and gaps a resume will take and say so; not refusals. */
  readonly warnings: readonly StateProblem[];
  readonly labComposed: boolean;
  /** See {@link BackupOrigin}. Null when the directory holds no manifest. */
  readonly backup: BackupOrigin | null;
}

export const RECORD_DB = 'record.db';
export const HISTORY_DB = 'history.db';
export const REGISTRY_DIR = 'assets';
export const LAB_MARKER = path.join('lab', 'composed-by-lab.json');
export { BACKUP_MANIFEST } from './fileStore.js';

/**
 * `PRAGMA quick_check` on one database file: null when it holds together, or
 * what SQLite says is wrong with it (Cycle Audit 10, a6-13).
 *
 * Until this ran, verification asked each database only for a head per asset —
 * a handful of pages — so damage anywhere else in the file was invisible. A
 * state directory with 8 KB of garbage written into the middle of `record.db`
 * passed `state:verify` with `Consistent: every file agrees.` and exit 0, which
 * is the acceptance check the restore runbook names. The venue then booted,
 * resumed and **seamed** every asset, hosted them, and died in
 * `#primeFromRecord` with a raw `ERR_SQLITE_ERROR` and a Node stack;
 * `deploy/otc-engine.service` is `Restart=always` / `RestartSec=2`, so that is
 * a two-second crash loop that reseams the catalogue on every pass and never
 * names a file. At other corruption offsets the operator's own tool died the
 * same way, inside this function. One question, asked once per database, ends
 * both: the directory is refused before a market resumes, by file, with what
 * SQLite found.
 *
 * **Opened read-write, like every other reader here.** A read-only connection
 * cannot create the `-shm` a WAL database needs, so a directory left behind by
 * a killed process — precisely the directory a restore is run against — could
 * fail to open at all and turn a recoverable boot into a refusal.
 * `SqliteTickRecord` opens the same file read-write two statements later.
 *
 * The scan reads the whole file: tens of milliseconds on the tens of megabytes
 * a bounded record runs to, once per boot and once per operator command.
 */
function integrityFailure(file: string): string | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
  } catch (error) {
    return `cannot be opened: ${(error as Error).message}`;
  }
  try {
    // SQLite answers one row of `ok`, or a row per fault — some of them
    // several lines long. A problem is one line in a refusal, so they are
    // flattened here rather than in the middle of the operator's output.
    const said = db
      .prepare('PRAGMA quick_check')
      .all()
      .flatMap((row) => String(Object.values(row)[0] ?? '').split('\n'))
      .map((line) => line.trim())
      .filter((line) => line !== '' && line !== 'ok');
    if (said.length === 0) return null;
    return (
      `is damaged and cannot answer for what the venue published: ${said.join('; ')}. ` +
      `A boot on this file resumes and seams the catalogue and then dies part-way through ` +
      `priming; restore a backup instead.`
    );
  } catch (error) {
    // The check itself refused: damage bad enough that SQLite will not even
    // walk the file. Same conclusion, and the message is SQLite's own.
    return `is damaged: ${(error as Error).message}`;
  } finally {
    db.close();
  }
}

/**
 * Check that the directory's files describe one market each, and agree.
 *
 * What refuses (a problem): a checkpoint that exists and cannot be read
 * (`CorruptRecordError`, the same class `resumeMarket` refuses); a database
 * written by newer code; a database whose own pages do not hold together
 * ({@link integrityFailure}, Cycle Audit 10 a6-13); a database that cannot be
 * read at all; a record whose head is **behind** the checkpoint's
 * `lastPublished` — ticks observers saw and the record does not hold, which
 * a restore from an older record beside a newer checkpoint produces; a candle
 * history **ahead** of the record for the same reason, the other way round.
 *
 * What warns: a checkpoint `resumeMarket` will seam past (`UnusableRecordError`),
 * an asset with a checkpoint and no record — `record.db` **absent from the
 * directory**, or present and holding nothing for that asset; the two are said
 * differently because an operator fixes them differently (Cycle Audit 10,
 * a3-03: the guard read `record !== null`, so the case the sentence above
 * names — no record at all — was the one case that could not reach it) — and
 * an asset the **record** holds that no checkpoint names, which is what a
 * SIGKILL inside the first checkpoint interval leaves and what this function
 * used to report as `Assets: none (nothing to resume)` (a6-06).
 *
 * What is not a checkpoint: a backup manifest (`backup.json`, `kind:
 * 'otc-state-backup'`) left in a directory the backup tool wrote. The store
 * skips it, so a restore is not refused for holding the file that says what it
 * holds (Cycle Audit 10, a7-01).
 */
/**
 * How hard to look (Cycle Audit 13, a6-06).
 *
 * `scanForHoles` walks the record's whole tick table once per asset, ordered, to
 * find a sequence gap no seam row covers — a tick the record lost. It is off by
 * default because **this function runs at every boot** (`apps/api/src/main.ts`),
 * and a boot that spends twenty seconds scanning 7.5 million rows is a boot that
 * is already past its own catch-up bound before it serves anything. The operator
 * commands turn it on, because that is the moment somebody is asking whether the
 * directory is sound rather than whether it can be resumed.
 */
export interface VerifyOptions {
  readonly scanForHoles?: boolean;
}

export async function verifyStateDirectory(
  directory: string,
  options: VerifyOptions = {},
): Promise<StateDirectoryReport> {
  const problems: StateProblem[] = [];
  const warnings: StateProblem[] = [];
  const heads: Record<string, AssetHeads> = {};
  const labComposed = existsSync(path.join(directory, LAB_MARKER));
  if (!existsSync(directory)) {
    return { directory, assets: [], heads, problems, warnings, labComposed, backup: null };
  }

  const store = new FileStateStore(directory);
  const checkpoints = new Map<string, MarketStateRecord>();
  for (const assetId of await store.list()) {
    const file = `${assetId}.json`;
    try {
      const record = await store.load(assetId);
      if (record === null) continue;
      try {
        assertUsableRecord(record, assetId);
      } catch (error) {
        if (error instanceof UnusableRecordError) {
          warnings.push({ file, assetId, detail: `will be seamed past: ${error.detail}` });
        } else {
          throw error;
        }
      }
      checkpoints.set(assetId, record);
    } catch (error) {
      if (error instanceof CorruptRecordError) {
        problems.push({ file, assetId, detail: error.detail });
        continue;
      }
      throw error;
    }
  }

  // Absent, unreadable, or open: three states, because they are three
  // different things to tell an operator. Unreadable covers both a file
  // `integrityFailure` found damaged and one whose schema this code refuses —
  // in either case the heads below are unknown, not null, and the directory is
  // already refused.
  const recordFile = path.join(directory, RECORD_DB);
  let record: SqliteTickRecord | null = null;
  let recordState: 'absent' | 'unreadable' | 'open' = 'absent';
  if (existsSync(recordFile)) {
    recordState = 'unreadable';
    const damage = integrityFailure(recordFile);
    if (damage !== null) {
      problems.push({ file: RECORD_DB, assetId: null, detail: damage });
    } else {
      try {
        // Read-only, for the same reason the history open below says — and this
        // line is the one that did not have it (Cycle Audit 13, a6-01). The
        // constructor of a read-write record creates the `lattice` table, runs
        // the v2→v3 seam backfill and stamps `user_version = 3`, so
        // `npm run state:verify` against a v2.4.0 deployment moved its record to
        // a version that build refuses, and the service then would not boot on
        // its own record. It exited 0 and printed "every file agrees" while
        // doing it, and `state:backup` carried the same upgrade into the copy an
        // operator would restore. An inspection that bricks the next boot is not
        // an inspection.
        record = new SqliteTickRecord(recordFile, { readOnly: true });
        recordState = 'open';
      } catch (error) {
        problems.push({ file: RECORD_DB, assetId: null, detail: (error as Error).message });
      }
    }
  }
  const historyFile = path.join(directory, HISTORY_DB);
  let history: SqliteCandleHistory | null = null;
  if (existsSync(historyFile)) {
    const damage = integrityFailure(historyFile);
    if (damage !== null) {
      problems.push({ file: HISTORY_DB, assetId: null, detail: damage });
    } else {
      try {
        // Read-only: verification must not upgrade the file it inspects, and
        // this path is pointed at directories a live venue is writing (PH-38.4).
        history = new SqliteCandleHistory(historyFile, { readOnly: true });
      } catch (error) {
        problems.push({ file: HISTORY_DB, assetId: null, detail: (error as Error).message });
      }
    }
  }

  /**
   * A head read that names its file instead of escaping as a stack (a6-13).
   *
   * `quick_check` above catches the damage that is in the file; what a `-wal`
   * still holds, or damage it does not reach, arrives here — and a raw
   * `ERR_SQLITE_ERROR` out of the operator's own tool refuses nothing and names
   * nothing. Once per file: thirty assets share one damaged database, and one
   * problem describes it.
   */
  const unreadable = new Set<string>();
  const headOf = async (
    file: string,
    read: () => Promise<number | null>,
  ): Promise<number | null> => {
    try {
      return await read();
    } catch (error) {
      if (!unreadable.has(file)) {
        unreadable.add(file);
        problems.push({
          file,
          assetId: null,
          detail: `cannot be read: ${(error as Error).message}`,
        });
      }
      return null;
    }
  };

  const openRecord = record;
  const openHistory = history;
  try {
    for (const [assetId, checkpoint] of checkpoints) {
      const published = checkpoint.lastPublished?.sequence ?? null;
      const recordHead =
        openRecord === null ? null : await headOf(RECORD_DB, () => openRecord.head(assetId));
      const historyHead =
        openHistory === null
          ? null
          : await headOf(HISTORY_DB, () => lastStoredSequence(openHistory, assetId));
      heads[assetId] = { checkpoint: published, record: recordHead, history: historyHead };
      // A head of null means "no tick for this asset" only when the record was
      // read; when it was not, the directory is refused already and a warning
      // about priming would be describing a file nobody will read.
      if (
        published !== null &&
        recordHead === null &&
        recordState !== 'unreadable' &&
        !unreadable.has(RECORD_DB)
      ) {
        warnings.push({
          file: RECORD_DB,
          assetId,
          detail:
            recordState === 'absent'
              ? `is not in the state directory, and this asset's checkpoint has published ` +
                `through ${published}: nothing is primed at boot, the commitment chain ` +
                `restarts at a new root, and every client resuming from below the new head ` +
                `is refused`
              : `holds no tick for an asset whose checkpoint has published through ${published}; nothing is primed at boot`,
        });
      }
      // **An upgraded record's past is undeclared, and nothing said so
      // (Cycle Audit 13, a6-03).** The v2→v3 migration writes no frame rows, by
      // design: it cannot know what the integers it inherited were counted in.
      // So on the one upgrade that needs them, every retained pre-upgrade tick
      // has no frame — the read routes answer `null` rather than a guess, which
      // is right, but a broker's chart goes blank and nothing anywhere names the
      // repair. It is `state:lattice declare`, and one line is enough.
      if (recordHead !== null && openRecord !== null) {
        const declared = await openRecord.frames(assetId).catch(() => null);
        if (declared !== null && declared.length === 0) {
          warnings.push({
            file: RECORD_DB,
            assetId,
            detail:
              `holds ticks through ${recordHead} and declares no frame for any of them, so every ` +
              `read route answers their price as null: run \`state:lattice declare\` to date the ` +
              `past on evidence, or leave it undeclared deliberately`,
          });
        }
      }
      if (published !== null && recordHead !== null && recordHead < published) {
        problems.push({
          file: RECORD_DB,
          assetId,
          detail:
            `the record ends at sequence ${recordHead} and the checkpoint has published through ` +
            `${published}: ticks observers saw are not in the record. A record restored from an ` +
            `older backup than the checkpoint looks like this.`,
        });
      }
      // **A live directory advances between these two reads, and it used to be
      // called damaged for it.** `recordHead` is taken before `historyHead`, so
      // a venue that publishes in between leaves the history legitimately ahead
      // of the record it was folded from — the reading is stale, not the
      // directory. It fired twice in PH-38.4's gate on the suite written for
      // exactly this case ("calls a database a second process is writing
      // healthy, not damaged"), on a host slow enough to widen the gap.
      //
      // So the record is asked once more before the accusation is made. A live
      // writer will have passed the history by then; a directory whose history
      // really was restored from a newer backup will not, because nothing is
      // advancing it. The check keeps its teeth and loses the race.
      const settledRecordHead =
        historyHead !== null &&
        recordHead !== null &&
        historyHead > recordHead &&
        openRecord !== null
          ? await headOf(RECORD_DB, () => openRecord.head(assetId))
          : recordHead;
      if (historyHead !== null && settledRecordHead !== null && historyHead > settledRecordHead) {
        problems.push({
          file: HISTORY_DB,
          assetId,
          detail:
            `the candle history reaches sequence ${historyHead} and the record ends at ` +
            `${settledRecordHead}: bars were folded from ticks the record does not hold. A history ` +
            `restored from a newer backup than the record looks like this.`,
        });
      }
    }
    // **The other direction, which nothing looked at (Cycle Audit 10, a6-06).**
    // The loop above iterates the *checkpoints*, so an asset the record holds
    // and no checkpoint names was examined by nothing at all: after a SIGKILL
    // inside the first checkpoint interval — an OOM on a first deploy, a bad
    // env, a crash loop — the record held ticks for 29 of 30 assets, and this
    // function answered `Assets: none (nothing to resume)` with no problem and
    // no warning, exit 0, on the directory that produced it.
    //
    // A warning, not a refusal: `resumeMarket` reopens such a market past the
    // record on a new key epoch rather than forking it at sequence 1, so the
    // directory boots correctly and what the operator needs is to be told which
    // assets are about to take a seam nobody asked for.
    if (record !== null) {
      for (const assetId of await record.assets()) {
        if (checkpoints.has(assetId)) continue;
        const recordHead = await record.head(assetId);
        const recordOldest = await record.oldest(assetId);
        const historyHead = history === null ? null : await lastStoredSequence(history, assetId);
        heads[assetId] = { checkpoint: null, record: recordHead, history: historyHead };
        warnings.push({
          file: RECORD_DB,
          assetId,
          detail:
            `holds ticks ${String(recordOldest)}–${String(recordHead)} for an asset no ` +
            `checkpoint names it: the process that served them was killed before its first ` +
            `checkpoint. The market reopens past the record on a new key epoch — a seam — ` +
            `rather than restarting at sequence 1.`,
        });
      }
    }
  } finally {
    record?.close();
    history?.close();
  }

  // **A hole in the published record (Cycle Audit 13, a6-06).** Until now this
  // function checked three heads and SQLite's own page integrity, and a record
  // with a tick deleted out of the middle passed as "every file agrees". That
  // matters in one direction more than the other: a **native v3** record derives
  // no seam from an existing gap — only the v2→v3 migration ever did, and only
  // while migrating — so `settle()` finds no seam to refuse and settles straight
  // across a stretch nobody was served. A refuter reproduced exactly that:
  // `seams` empty, `seamAt` null, inside a hole punched into a v3 record.
  //
  // One ordered pass over the primary key, the same `LEAD` window the migration
  // uses, and only when an operator asked (see {@link VerifyOptions}).
  if (options.scanForHoles === true && recordState === 'open') {
    const db = new DatabaseSync(recordFile, { readOnly: true });
    try {
      const holes = db
        .prepare(
          `SELECT asset_id, sequence AS last_sequence, next_sequence FROM (
             SELECT asset_id, sequence,
                    LEAD(sequence) OVER (PARTITION BY asset_id ORDER BY sequence) AS next_sequence
             FROM tick
           ) AS walked
           WHERE next_sequence IS NOT NULL AND next_sequence <> sequence + 1
             AND NOT EXISTS (
               SELECT 1 FROM seam
               WHERE seam.asset_id = walked.asset_id
                 AND seam.resumes_at_sequence = walked.next_sequence
             )`,
        )
        .all() as { asset_id: string; last_sequence: number; next_sequence: number }[];
      for (const hole of holes) {
        problems.push({
          file: RECORD_DB,
          assetId: hole.asset_id,
          detail:
            `is missing ticks ${hole.last_sequence + 1}..${hole.next_sequence - 1} and no seam ` +
            `declares that gap: a contract whose window touches it settles across ticks nobody ` +
            `was served. Restore from a backup taken before the loss`,
        });
      }
    } catch (error) {
      problems.push({
        file: RECORD_DB,
        assetId: null,
        detail: `could not be scanned for holes: ${(error as Error).message}`,
      });
    } finally {
      db.close();
    }
  }

  const registryDir = path.join(directory, REGISTRY_DIR);
  if (existsSync(registryDir)) {
    try {
      await new FileAssetRegistry(registryDir, { now: () => epochMillis(0) }).list();
    } catch (error) {
      problems.push({ file: REGISTRY_DIR, assetId: null, detail: (error as Error).message });
    }
  }

  return {
    directory,
    assets: [...checkpoints.keys()].sort(),
    heads,
    problems,
    warnings,
    labComposed,
    backup: backupOrigin(directory, heads),
  };
}

/**
 * What the manifest in this directory says, and whether the directory still
 * matches it (Cycle Audit 10, a6-07).
 *
 * The restore this project documents is a directory swap with the service
 * stopped, and after one nothing in the directory says a restore happened. The
 * boot seams from the backup's checkpoint and serves on, and everything the
 * venue published after the backup was taken is simply gone: those sequences
 * answer 404, and `GET /markets/:id/price?at=` answers instants observers
 * already held with the price this record ends at — a contract settled before
 * the restore settles differently after it. Measured on a 3.5-minute run
 * against a 30-second-old backup, and reproduced independently.
 *
 * A boot cannot undo that. It can refuse to be silent about it, and the
 * manifest `backupStateDirectory` leaves in the copy is enough: heads still
 * exactly as recorded means nothing has run here yet, which is precisely the
 * moment before the damage — the operator can still stop and reach for a newer
 * backup. It is not a refusal, because a restore is sometimes the right thing
 * to do and refusing the only remaining copy helps nobody.
 */
function backupOrigin(
  directory: string,
  heads: Readonly<Record<string, AssetHeads>>,
): BackupOrigin | null {
  const file = path.join(directory, BACKUP_MANIFEST);
  if (!existsSync(file)) return null;
  let manifest: BackupManifest;
  try {
    const text = readFileSync(file, 'utf8');
    if (!isBackupManifestText(text)) return null;
    manifest = JSON.parse(text) as BackupManifest;
  } catch {
    return null;
  }
  const takenAt = typeof manifest.takenAt === 'number' ? manifest.takenAt : 0;
  const recorded = manifest.heads ?? {};
  const names = Object.keys(recorded);
  const untouched =
    names.length === Object.keys(heads).length &&
    names.every((id) => {
      const was = recorded[id];
      const now = heads[id];
      return (
        was !== undefined &&
        now !== undefined &&
        was.checkpoint === now.checkpoint &&
        was.record === now.record &&
        was.history === now.history
      );
    });
  return { takenAt, untouched };
}

/** The boot refusal a report earns, or null when it may be resumed. */
export function stateRefusal(report: StateDirectoryReport): string | null {
  if (report.problems.length === 0) return null;
  const lines = report.problems.map(
    (p) => `  - ${p.file}${p.assetId === null ? '' : ` (${p.assetId})`}: ${p.detail}`,
  );
  return (
    `Refusing to start: ${report.directory} does not describe one market per asset.\n` +
    `${lines.join('\n')}\n` +
    `Resuming would either spend keystream positions twice or serve a record observers did ` +
    `not see. Restore a consistent backup, or move the directory aside deliberately.`
  );
}

export interface BackupManifest {
  readonly kind: typeof BACKUP_MANIFEST_KIND;
  readonly version: 1;
  readonly takenAt: number;
  readonly source: string;
  readonly assets: readonly string[];
  readonly heads: Readonly<Record<string, AssetHeads>>;
}

/**
 * Copy the directory somewhere else, consistently per file, while the venue
 * may be running.
 *
 * Checkpoints are single files replaced by rename, so a copy is one whole
 * record or the previous one. Each SQLite database is copied with
 * `VACUUM INTO`, which is a consistent snapshot of a live WAL database. The
 * registry and the Lab marker are copied as they are. The copy is then
 * verified the way a boot verifies it, and the manifest names what it holds.
 *
 * `at` is the instant the manifest records; nothing under `packages/` reads
 * ambient time. The target must not exist or must be empty: a backup never
 * writes over another.
 *
 * **The manifest stays in the copy, and a restore keeps it.** A restore is a
 * directory swap with the service stopped, so whatever is in the copy is what
 * boots; `FileStateStore.list` skips the manifest by its `kind` so the boot
 * check reads the copy the way the operator's `state:verify` does (Cycle Audit
 * 10, a7-01). The report returned is of the target **after** the manifest is
 * written — verified as it will be found, not as it was one file ago, which is
 * how the tool came to exit 0 on a directory that would not boot.
 */
export async function backupStateDirectory(
  from: string,
  to: string,
  at: number,
): Promise<{ manifest: BackupManifest; report: StateDirectoryReport }> {
  if (!existsSync(from)) throw new RangeError(`No state directory at ${from}.`);
  if (existsSync(to) && readdirSync(to).length > 0) {
    throw new RangeError(`${to} exists and is not empty; a backup never writes over another.`);
  }
  const sourceManifest = path.join(from, BACKUP_MANIFEST);
  const manifestInSource =
    existsSync(sourceManifest) && isBackupManifestText(readFileSync(sourceManifest, 'utf8'));
  if (existsSync(sourceManifest) && !manifestInSource) {
    // `backup` is a legal asset id and the manifest is written under that name.
    // Copying the checkpoint and then writing the manifest over it would lose a
    // market's lease marks silently; refusing costs an operator a rename.
    throw new RangeError(
      `${from} holds a checkpoint at ${BACKUP_MANIFEST}, which is the name a backup manifest ` +
        `takes; a copy would write the manifest over it.`,
    );
  }
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    // A previous backup's manifest is not copied forward: the copy gets its own.
    if (name.endsWith('.json') && !(name === BACKUP_MANIFEST && manifestInSource)) {
      copyFileSync(path.join(from, name), path.join(to, name));
    }
  }
  // **History before the record, and both after the checkpoints (Cycle Audit
  // 10, a3-05).** Each `VACUUM INTO` snapshots at its own instant, so a source
  // that is still advancing is caught at three different moments and the order
  // decides which way the copy's disagreements point. `verifyStateDirectory`
  // refuses a record *behind* its checkpoint and a history *ahead* of its
  // record, so every file must be copied before the file it may not overtake:
  // checkpoints, then history, then record. Each pair is then monotone in the
  // benign direction — the record copy is the newest of the three, the
  // checkpoints the oldest — and the copy verifies.
  //
  // Taken the other way round, which is how it was taken until this audit, the
  // history is the newest file in the copy: a bar folded while the record's
  // VACUUM ran lands in a copy whose record does not hold the ticks it was
  // folded from, `backupStateDirectory` fails its own verification, the tool
  // exits 1, and the unbootable directory is left on disk — for a backup of a
  // perfectly healthy running venue. The window is the record's VACUUM against
  // the bar flush on the checkpoint cadence.
  for (const database of [HISTORY_DB, RECORD_DB]) {
    const source = path.join(from, database);
    if (!existsSync(source)) continue;
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      db.exec(`VACUUM INTO '${path.join(to, database).replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
  }
  const registry = path.join(from, REGISTRY_DIR);
  if (existsSync(registry) && statSync(registry).isDirectory()) {
    mkdirSync(path.join(to, REGISTRY_DIR), { recursive: true });
    for (const name of readdirSync(registry)) {
      copyFileSync(path.join(registry, name), path.join(to, REGISTRY_DIR, name));
    }
  }
  const marker = path.join(from, LAB_MARKER);
  if (existsSync(marker)) {
    mkdirSync(path.dirname(path.join(to, LAB_MARKER)), { recursive: true });
    copyFileSync(marker, path.join(to, LAB_MARKER));
  }
  const scanned = await verifyStateDirectory(to);
  const manifest: BackupManifest = {
    kind: BACKUP_MANIFEST_KIND,
    version: 1,
    takenAt: at,
    source: path.resolve(from),
    assets: scanned.assets,
    heads: scanned.heads,
  };
  writeFileSync(path.join(to, BACKUP_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  // Verified as the operator will find it, manifest included (a7-01).
  const report = await verifyStateDirectory(to);
  return { manifest, report };
}
