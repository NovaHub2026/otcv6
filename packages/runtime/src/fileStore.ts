import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { replaceFileAtomically } from './atomicFile.js';
import { CorruptRecordError, type MarketStateRecord, type StateStore } from './state.js';

/**
 * A durable store backed by one JSON file per asset.
 *
 * Writes are atomic by `rename`, which is the property that matters: a crash
 * during a save must leave either the previous record or the new one, never a
 * half-written file. A torn record would be indistinguishable from a corrupt one
 * and would push every restart down the seam path. And they are `fsync`ed —
 * file, then directory — because `rename` is atomic against a crash and not
 * against a power loss (a5-10); `atomicFile.ts` explains both.
 *
 * This is deliberately not a database. PH-5 has no load profile to design
 * against; PH-7 chooses a hosted engine when distribution semantics exist to
 * inform the choice. What matters now is that the *boundary* is right, so that
 * swap is a new implementation rather than a change to the runtime.
 */
/**
 * Narrow parsed JSON to a record, or refuse.
 *
 * `JSON.parse('null')` succeeds and yields `null`, which `resumeMarket` reads as
 * "nothing ever ran" — so a file containing four bytes of `null` restarted the
 * market at genesis and re-consumed keystream from block zero. That is the exact
 * failure PH-5.2 says has no safe automatic recovery, reached by the one
 * malformed shape that parses cleanly. Arrays and primitives are refused for the
 * same reason.
 */
function asRecord(assetId: string, parsed: unknown): MarketStateRecord {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CorruptRecordError(assetId, `record parsed to ${describe(parsed)}, not an object`);
  }
  return parsed as MarketStateRecord;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/**
 * The name `backupStateDirectory` writes its manifest under, inside the copy.
 *
 * It lives here rather than in `stateDirectory.ts` because the store is what
 * has to know not to read it as a checkpoint; `stateDirectory.ts` re-exports it
 * so the public name is unchanged.
 */
export const BACKUP_MANIFEST = 'backup.json';

/** What a backup manifest calls itself. A checkpoint has no `kind`. */
export const BACKUP_MANIFEST_KIND = 'otc-state-backup';

/** Whether this text is a backup manifest rather than a checkpoint. */
export function isBackupManifestText(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    (parsed as { kind?: unknown }).kind === BACKUP_MANIFEST_KIND
  );
}

export class FileStateStore implements StateStore {
  constructor(private readonly directory: string) {}

  #pathFor(assetId: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(assetId)) {
      throw new RangeError(`Unsafe asset id for a filename: ${assetId}.`);
    }
    return path.join(this.directory, `${assetId}.json`);
  }

  async load(assetId: string): Promise<MarketStateRecord | null> {
    let text: string;
    try {
      text = await readFile(this.#pathFor(assetId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      // Not `null`. Reporting a corrupt record as absent would restart the
      // market at genesis and re-consume keystream from block zero.
      throw new CorruptRecordError(assetId, (error as Error).message);
    }
    return asRecord(assetId, parsed);
  }

  /**
   * **Cycle Audit 6, minor.** The temporary path was `${target}.${pid}.tmp` —
   * unique per *process*, not per call. Two concurrent saves of one asset raced:
   * the first `rename` moved the file the second was still writing, and the
   * second failed with `ENOENT`. Reproduced 200 times out of 200, and observed
   * on two ordinary SIGTERM shutdowns of the shipped configuration, where
   * `VenueService.stop()` clears the timer without awaiting an in-flight
   * `tick()` whose `checkpoint()` is running. The rejection then aborts the
   * checkpoint loop, so the remaining markets get no final checkpoint either.
   *
   * The per-call name now lives in `atomicFile.ts`, where the registry shares
   * it rather than repeating the defect (a5-07).
   */
  async save(record: MarketStateRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await replaceFileAtomically(this.#pathFor(record.assetId), JSON.stringify(record));
  }

  /**
   * The assets this directory holds a checkpoint for.
   *
   * **Cycle Audit 10 (a7-01).** This used to be "every `*.json`", and
   * `backupStateDirectory` writes its manifest as `backup.json` *into the copy*
   * — so every directory the backup tool produced named one extra asset,
   * `backup`, whose record belonged to asset `undefined`. `verifyStateDirectory`
   * loaded it as a checkpoint, `stateRefusal` turned that into a refusal, and
   * the documented restore — swap the directory in, start the service — was
   * refused by the boot check on a directory the tool had just called
   * consistent. Deleting one file made it boot.
   *
   * The manifest is skipped by what it *says it is* (`kind: 'otc-state-backup'`),
   * not by its name: `backup` is a legal asset id, and silently skipping a real
   * checkpoint would restart that market at genesis — the failure `load`
   * refuses a corrupt file to avoid. Every other `*.json` is still listed, so a
   * stray file is still refused by name rather than ignored.
   */
  async list(): Promise<readonly string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const ids: string[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      if (name === BACKUP_MANIFEST && (await this.#holdsBackupManifest())) continue;
      ids.push(name.slice(0, -'.json'.length));
    }
    return ids.sort();
  }

  /** Whether this directory's `backup.json` is a backup manifest, not a checkpoint. */
  async #holdsBackupManifest(): Promise<boolean> {
    try {
      return isBackupManifestText(
        await readFile(path.join(this.directory, BACKUP_MANIFEST), 'utf8'),
      );
    } catch {
      // Unreadable or gone between the listing and now: treat it as a
      // checkpoint, so `load` refuses it by name rather than nothing seeing it.
      return false;
    }
  }
}

/** An in-memory store, for tests and for a runtime that must not persist. */
export class MemoryStateStore implements StateStore {
  readonly #records = new Map<string, string>();

  load(assetId: string): Promise<MarketStateRecord | null> {
    const text = this.#records.get(assetId);
    if (text === undefined) return Promise.resolve(null);
    let parsed: unknown;
    try {
      // Serialised on the way in and out, so a test cannot accidentally share a
      // mutable object with the runtime and hide an aliasing bug.
      parsed = JSON.parse(text);
    } catch (error) {
      return Promise.reject(new CorruptRecordError(assetId, (error as Error).message));
    }
    try {
      return Promise.resolve(asRecord(assetId, parsed));
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new CorruptRecordError(assetId, String(error)),
      );
    }
  }

  save(record: MarketStateRecord): Promise<void> {
    this.#records.set(record.assetId, JSON.stringify(record));
    return Promise.resolve();
  }

  list(): Promise<readonly string[]> {
    return Promise.resolve([...this.#records.keys()].sort());
  }

  /** Corrupt a stored record, to exercise the refusal path. */
  corrupt(assetId: string): void {
    this.#records.set(assetId, '{ this is not json');
  }

  /** Replace the stored bytes verbatim, to exercise shapes that parse cleanly. */
  replaceRaw(assetId: string, payload: string): void {
    this.#records.set(assetId, payload);
  }
}
