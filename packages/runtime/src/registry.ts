import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertValidInstrument, type Clock } from '@otc/core';
import type { RegisteredAsset } from '@otc/engine';

/**
 * Every asset this deployment has registered, durably.
 *
 * ## Why the definition is stored and not recomputed
 *
 * A registration is a job whose last four stages are simulation — the
 * personality solve, the lattice calibration, the dispersion fit, the
 * differentiation check — and which runs for seconds to tens of seconds. **What is registered is what was solved**
 * (`docs/architecture/CATALOGUE_AND_PANEL.md` §1) — recomputing it at boot would
 * mean the market a restart hosts is whatever the current code happens to solve
 * for, and a settlement recorded last month would be re-derived against a
 * different quantum. INV-009 says historical outcomes are reproducible from
 * records; this is the record.
 *
 * So the solved asset is written out as JSON and read back verbatim. Nothing
 * here re-derives, re-fits, or "corrects" a stored asset.
 *
 * ## What it refuses
 *
 * A stored file whose instrument the core rejects. That is not defensiveness
 * about disk corruption — it is the case where the *shape* changed under a
 * deployment's feet, and the honest response to "this asset no longer type-checks
 * as an instrument" is to refuse to host it rather than to host something
 * approximating it.
 */
export interface AssetRegistry {
  /** Every registered asset, in registration order. */
  list(): Promise<readonly RegisteredAsset[]>;
  /**
   * Persist a newly registered asset.
   *
   * Refuses an id that is already stored. A registration that could overwrite
   * one would let an operator replace the lattice a settled contract was priced
   * on, which is INV-009 broken by an administrative action.
   */
  add(asset: RegisteredAsset): Promise<void>;
}

/** A registry backed by one JSON file per asset, written atomically. */
export class FileAssetRegistry implements AssetRegistry {
  /**
   * The clock is injected for the reason every clock in `packages/` is: a module
   * that reads ambient time cannot be replayed. Here it stamps registration
   * order, which decides the order `list()` returns and therefore the order the
   * differentiation check compares a future candidate against.
   */
  constructor(
    private readonly directory: string,
    private readonly clock: Clock,
  ) {}

  #pathFor(id: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
      throw new RangeError(`Unsafe asset id for a filename: ${id}.`);
    }
    return path.join(this.directory, `${id}.json`);
  }

  async list(): Promise<readonly RegisteredAsset[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const stored: { asset: RegisteredAsset; at: number }[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue;
      const raw = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as unknown;
      stored.push(asStored(name, raw));
    }
    // Registration order, not filename order: the differentiation check compares
    // a candidate against everything already registered, so replaying the
    // catalogue in a different order would re-run those comparisons in a
    // different order too.
    stored.sort((a, b) => a.at - b.at);
    return stored.map((entry) => entry.asset);
  }

  async add(asset: RegisteredAsset): Promise<void> {
    const target = this.#pathFor(asset.definition.id);
    await mkdir(this.directory, { recursive: true });
    try {
      await readFile(target, 'utf8');
      throw new AlreadyRegisteredError(asset.definition.id);
    } catch (error) {
      if (error instanceof AlreadyRegisteredError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ registeredAt: this.clock.now(), asset }, null, 2));
    await rename(temporary, target);
  }
}

/** An in-memory registry, for tests and for a deployment that stores nothing. */
export class MemoryAssetRegistry implements AssetRegistry {
  readonly #assets: RegisteredAsset[] = [];

  constructor(initial: readonly RegisteredAsset[] = []) {
    this.#assets.push(...initial);
  }

  list(): Promise<readonly RegisteredAsset[]> {
    return Promise.resolve([...this.#assets]);
  }

  add(asset: RegisteredAsset): Promise<void> {
    if (this.#assets.some((entry) => entry.definition.id === asset.definition.id)) {
      return Promise.reject(new AlreadyRegisteredError(asset.definition.id));
    }
    this.#assets.push(asset);
    return Promise.resolve();
  }
}

export class AlreadyRegisteredError extends Error {
  constructor(readonly assetId: string) {
    super(
      `Asset ${assetId} is already registered. Re-registering would replace the ` +
        `lattice that settled contracts were priced on (INV-009).`,
    );
    this.name = 'AlreadyRegisteredError';
  }
}

export class CorruptRegistrationError extends Error {
  constructor(file: string, detail: string) {
    super(`Stored registration ${file} is unusable: ${detail}.`);
    this.name = 'CorruptRegistrationError';
  }
}

function asStored(file: string, raw: unknown): { asset: RegisteredAsset; at: number } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CorruptRegistrationError(file, `parsed to ${raw === null ? 'null' : typeof raw}`);
  }
  const record = raw as { registeredAt?: unknown; asset?: unknown };
  const asset = record.asset;
  if (typeof asset !== 'object' || asset === null) {
    throw new CorruptRegistrationError(file, 'no asset');
  }
  const candidate = asset as RegisteredAsset;
  if (candidate.definition === undefined || candidate.instrument === undefined) {
    throw new CorruptRegistrationError(file, 'no definition or no instrument');
  }
  try {
    assertValidInstrument(candidate.instrument);
  } catch (error) {
    throw new CorruptRegistrationError(file, (error as Error).message);
  }
  if (candidate.instrument.id !== candidate.definition.id) {
    throw new CorruptRegistrationError(
      file,
      `instrument id ${candidate.instrument.id} does not match definition id ${candidate.definition.id}`,
    );
  }
  const at = typeof record.registeredAt === 'number' ? record.registeredAt : 0;
  return { asset: candidate, at };
}
