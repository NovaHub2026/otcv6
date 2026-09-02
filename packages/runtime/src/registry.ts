import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { assertValidInstrument, type Clock } from '@otc/core';
import type { RegisteredAsset } from '@otc/engine';
import { createFileExclusively, replaceFileAtomically } from './atomicFile.js';

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
/**
 * What an operator may change about an asset after it exists.
 *
 * Two fields, and the shortness of the list is the design. An id enters the key
 * derivation (ADR-0002); a quantum defines the published integers every
 * settlement is decided on (ADR-0004); a reference price is the map from those
 * integers to the numbers a viewer read; a personality *is* the market. Editing
 * any of them would rewrite what already happened — a chart of last month drawn
 * against a lattice that did not exist then, and settlements that can no longer
 * be reproduced from the record (INV-009).
 *
 * So what is editable is a **label** and a **decision to stop**, and everything
 * else is refused by name rather than guarded by care.
 */
export interface AssetOverlay {
  /** Human-facing name. Never used in a comparison. */
  readonly displayName?: string;
  /**
   * When the operator stopped hosting this market, if they have.
   *
   * Retirement is final, and that is a product decision rather than a technical
   * limit. A market resumed after a gap either invents the interval nobody
   * generated or takes a seam in the published record; the first is forbidden
   * outright and the second is a discontinuity an operator would be choosing to
   * put into a market that had already printed prices. The record of a retired
   * asset stays readable for ever — history, settlement, publication — it simply
   * stops advancing.
   */
  readonly retiredAt?: number;
}

/** The fields an overlay may carry. Anything else is refused by name. */
export const OVERLAY_FIELDS = ['displayName', 'retiredAt'] as const;

export interface AssetRegistry {
  /** Every registered asset, in registration order. */
  list(): Promise<readonly RegisteredAsset[]>;

  /** Operator overlays, by asset id — for compiled and registered assets alike. */
  overlays(): Promise<ReadonlyMap<string, AssetOverlay>>;

  /**
   * Apply an overlay to an asset, merging with what is stored.
   *
   * Takes an id that need not be in {@link AssetRegistry.list}: the five
   * compiled catalogue entries are assets an operator administers too, and an
   * overlay is the only thing about them that is data.
   */
  putOverlay(assetId: string, patch: AssetOverlay): Promise<void>;
  /**
   * Persist a newly registered asset.
   *
   * Refuses an id that is already stored. A registration that could overwrite
   * one would let an operator replace the lattice a settled contract was priced
   * on, which is INV-009 broken by an administrative action.
   */
  add(asset: RegisteredAsset): Promise<void>;
}

/**
 * A registry backed by one JSON file per asset, written atomically.
 *
 * ## What a5-07 found here
 *
 * Three things `FileStateStore` had already learned and this file had not. The
 * temporary name was per process, so two overlay edits in one second lost one
 * or both. The id inside a file was trusted over its name, so a backup copy
 * `eurusd.bak.json` was read as a second registration of `eurusd` and the venue
 * refused to boot on the duplicate. And `JSON.parse` sat outside any `try`, so
 * one half-written file made `list()` throw a bare `SyntaxError` for the whole
 * catalogue. Each is now the opposite: per-call names through `atomicFile.ts`,
 * a file is refused unless it is named `${id}.json`, and every parse failure is
 * a `CorruptRegistrationError` naming the file.
 */
export class FileAssetRegistry implements AssetRegistry {
  /**
   * Overlay edits, one after another.
   *
   * `putOverlay` is a read-modify-write of one file, and two of them
   * interleaved is a lost update whatever the temporary names are. The venue
   * has one operator and one panel, but a double-click is two requests.
   */
  #overlayEdits: Promise<void> = Promise.resolve();

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
      // Only files whose name is an asset id. The overlay file starts with an
      // underscore precisely so it falls out here rather than being read as a
      // registration — which is what it did on its first test run.
      if (!name.endsWith('.json')) continue;
      if (!/^[a-z0-9][a-z0-9._-]{0,63}\.json$/.test(name)) continue;
      const raw = parseRegistration(name, await readFile(path.join(this.directory, name), 'utf8'));
      stored.push(asStored(name, raw));
    }
    // Registration order, not filename order: the differentiation check compares
    // a candidate against everything already registered, so replaying the
    // catalogue in a different order would re-run those comparisons in a
    // different order too.
    stored.sort((a, b) => a.at - b.at);
    return stored.map((entry) => entry.asset);
  }

  /**
   * `_overlays.json`, and the underscore is doing work.
   *
   * An asset id must match `^[a-z0-9][a-z0-9._-]{0,63}$`, so it can never begin
   * with an underscore — which means this file can never collide with an asset
   * named `overlays`. It was `overlays.json` for one test run, and `list()`
   * duly tried to read it as a registration.
   */
  #overlayPath(): string {
    return path.join(this.directory, '_overlays.json');
  }

  async overlays(): Promise<ReadonlyMap<string, AssetOverlay>> {
    let text: string;
    try {
      text = await readFile(this.#overlayPath(), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw error;
    }
    const parsed = parseRegistration('_overlays.json', text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new CorruptRegistrationError('_overlays.json', 'did not parse to an object');
    }
    const out = new Map<string, AssetOverlay>();
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      out.set(id, asOverlay(id, value));
    }
    return out;
  }

  putOverlay(assetId: string, patch: AssetOverlay): Promise<void> {
    assertOverlay(patch);
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(assetId)) {
      return Promise.reject(new RangeError(`Unsafe asset id: ${assetId}.`));
    }
    // Queued behind every edit before it, and the queue never breaks: a
    // rejected edit is the caller's to see, not the next edit's to inherit.
    const edit = this.#overlayEdits.then(() => this.#writeOverlay(assetId, patch));
    this.#overlayEdits = edit.then(
      () => undefined,
      () => undefined,
    );
    return edit;
  }

  async #writeOverlay(assetId: string, patch: AssetOverlay): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const current = new Map(await this.overlays());
    current.set(assetId, { ...current.get(assetId), ...patch });
    await replaceFileAtomically(
      this.#overlayPath(),
      JSON.stringify(Object.fromEntries(current), null, 2),
    );
  }

  async add(asset: RegisteredAsset): Promise<void> {
    const target = this.#pathFor(asset.definition.id);
    await mkdir(this.directory, { recursive: true });
    // Exclusive as well as atomic. A read-then-write let ten concurrent
    // registrations of one id all pass the read; the filesystem decides now,
    // and it admits exactly one.
    const created = await createFileExclusively(
      target,
      JSON.stringify({ registeredAt: this.clock.now(), asset }, null, 2),
    );
    if (!created) throw new AlreadyRegisteredError(asset.definition.id);
  }
}

/** Parse a stored file, naming it in the refusal rather than surfacing a bare `SyntaxError`. */
function parseRegistration(file: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CorruptRegistrationError(
      file,
      `does not parse as JSON (${(error as Error).message})`,
    );
  }
}

/** An in-memory registry, for tests and for a deployment that stores nothing. */
export class MemoryAssetRegistry implements AssetRegistry {
  readonly #assets: RegisteredAsset[] = [];
  readonly #overlays = new Map<string, AssetOverlay>();

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

  overlays(): Promise<ReadonlyMap<string, AssetOverlay>> {
    return Promise.resolve(new Map(this.#overlays));
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the interface is async
  async putOverlay(assetId: string, patch: AssetOverlay): Promise<void> {
    assertOverlay(patch);
    this.#overlays.set(assetId, { ...this.#overlays.get(assetId), ...patch });
  }
}

export class ImmutableFieldError extends Error {
  constructor(readonly field: string) {
    super(
      `${field} cannot be edited. An id derives the keystream, a quantum decides ` +
        `every settlement, a reference price maps those integers to what a viewer ` +
        `read, and a personality is the market itself — changing any of them ` +
        `rewrites what already happened (INV-009). Editable: ${OVERLAY_FIELDS.join(', ')}.`,
    );
    this.name = 'ImmutableFieldError';
  }
}

/** Refuse an overlay carrying anything but a label or a retirement. */
export function assertOverlay(patch: object): void {
  for (const key of Object.keys(patch)) {
    if (!OVERLAY_FIELDS.includes(key as (typeof OVERLAY_FIELDS)[number])) {
      throw new ImmutableFieldError(key);
    }
  }
  const named = patch as AssetOverlay;
  if (named.displayName !== undefined && named.displayName.trim().length === 0) {
    throw new RangeError('An asset needs a display name.');
  }
  if (named.retiredAt !== undefined && !Number.isFinite(named.retiredAt)) {
    throw new RangeError(`retiredAt must be an instant, got ${String(named.retiredAt)}.`);
  }
}

function asOverlay(id: string, value: unknown): AssetOverlay {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CorruptRegistrationError('_overlays.json', `overlay for ${id} is not an object`);
  }
  assertOverlay(value);
  return value;
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
  // The name is the id. A file that registers `eurusd` under any other name is
  // a copy — a backup, a rename — and hosting it would host `eurusd` twice.
  if (file !== `${candidate.definition.id}.json`) {
    throw new CorruptRegistrationError(
      file,
      `it registers ${candidate.definition.id}, whose registration is ${candidate.definition.id}.json. ` +
        `A copy under another name would be hosted as a second ${candidate.definition.id}`,
    );
  }
  const at = typeof record.registeredAt === 'number' ? record.registeredAt : 0;
  return { asset: candidate, at };
}
