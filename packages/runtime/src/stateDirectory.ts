import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { epochMillis } from '@otc/core';
import { FileStateStore } from './fileStore.js';
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
}

export const RECORD_DB = 'record.db';
export const HISTORY_DB = 'history.db';
export const REGISTRY_DIR = 'assets';
export const LAB_MARKER = path.join('lab', 'composed-by-lab.json');
export const BACKUP_MANIFEST = 'backup.json';

/**
 * Check that the directory's files describe one market each, and agree.
 *
 * What refuses (a problem): a checkpoint that exists and cannot be read
 * (`CorruptRecordError`, the same class `resumeMarket` refuses); a database
 * written by newer code; a record whose head is **behind** the checkpoint's
 * `lastPublished` — ticks observers saw and the record does not hold, which
 * a restore from an older record beside a newer checkpoint produces; a candle
 * history **ahead** of the record for the same reason, the other way round.
 *
 * What warns: a checkpoint `resumeMarket` will seam past (`UnusableRecordError`),
 * and an asset with a checkpoint and no record at all — a deployment from
 * before the record existed, which boots and primes nothing.
 */
export async function verifyStateDirectory(directory: string): Promise<StateDirectoryReport> {
  const problems: StateProblem[] = [];
  const warnings: StateProblem[] = [];
  const heads: Record<string, AssetHeads> = {};
  const labComposed = existsSync(path.join(directory, LAB_MARKER));
  if (!existsSync(directory)) {
    return { directory, assets: [], heads, problems, warnings, labComposed };
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

  const recordFile = path.join(directory, RECORD_DB);
  let record: SqliteTickRecord | null = null;
  if (existsSync(recordFile)) {
    try {
      record = new SqliteTickRecord(recordFile);
    } catch (error) {
      problems.push({ file: RECORD_DB, assetId: null, detail: (error as Error).message });
    }
  }
  const historyFile = path.join(directory, HISTORY_DB);
  let history: SqliteCandleHistory | null = null;
  if (existsSync(historyFile)) {
    try {
      history = new SqliteCandleHistory(historyFile);
    } catch (error) {
      problems.push({ file: HISTORY_DB, assetId: null, detail: (error as Error).message });
    }
  }

  try {
    for (const [assetId, checkpoint] of checkpoints) {
      const published = checkpoint.lastPublished?.sequence ?? null;
      const recordHead = record === null ? null : await record.head(assetId);
      const historyHead = history === null ? null : await lastStoredSequence(history, assetId);
      heads[assetId] = { checkpoint: published, record: recordHead, history: historyHead };
      if (published !== null && recordHead === null && record !== null) {
        warnings.push({
          file: RECORD_DB,
          assetId,
          detail: `holds no tick for an asset whose checkpoint has published through ${published}; nothing is primed at boot`,
        });
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
      if (historyHead !== null && recordHead !== null && historyHead > recordHead) {
        problems.push({
          file: HISTORY_DB,
          assetId,
          detail:
            `the candle history reaches sequence ${historyHead} and the record ends at ` +
            `${recordHead}: bars were folded from ticks the record does not hold. A history ` +
            `restored from a newer backup than the record looks like this.`,
        });
      }
    }
  } finally {
    record?.close();
    history?.close();
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
  };
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
  readonly kind: 'otc-state-backup';
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
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.endsWith('.json') && name !== BACKUP_MANIFEST) {
      copyFileSync(path.join(from, name), path.join(to, name));
    }
  }
  for (const database of [RECORD_DB, HISTORY_DB]) {
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
  const report = await verifyStateDirectory(to);
  const manifest: BackupManifest = {
    kind: 'otc-state-backup',
    version: 1,
    takenAt: at,
    source: path.resolve(from),
    assets: report.assets,
    heads: report.heads,
  };
  writeFileSync(path.join(to, BACKUP_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, report };
}
