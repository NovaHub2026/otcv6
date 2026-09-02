import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CorruptRecordError, type MarketStateRecord, type StateStore } from './state.js';

/**
 * A durable store backed by one JSON file per asset.
 *
 * Writes are atomic by `rename`, which is the property that matters: a crash
 * during a save must leave either the previous record or the new one, never a
 * half-written file. A torn record would be indistinguishable from a corrupt one
 * and would push every restart down the seam path.
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
   * Sequence number for temporary file names, unique within this process.
   *
   * **Cycle Audit 6, minor.** The temporary path was `${target}.${pid}.tmp` —
   * unique per *process*, not per call. Two concurrent saves of one asset raced:
   * the first `rename` moved the file the second was still writing, and the
   * second failed with `ENOENT`. Reproduced 200 times out of 200, and observed
   * on two ordinary SIGTERM shutdowns of the shipped configuration, where
   * `VenueService.stop()` clears the timer without awaiting an in-flight
   * `tick()` whose `checkpoint()` is running. The rejection then aborts the
   * checkpoint loop, so the remaining markets get no final checkpoint either.
   */
  #saveSequence = 0;

  async save(record: MarketStateRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#pathFor(record.assetId);
    this.#saveSequence += 1;
    const temporary = `${target}.${process.pid}.${this.#saveSequence}.tmp`;
    await writeFile(temporary, JSON.stringify(record), 'utf8');
    await rename(temporary, target);
  }

  async list(): Promise<readonly string[]> {
    try {
      const entries = await readdir(this.directory);
      return entries
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
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
