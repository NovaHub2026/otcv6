// Invariant evidence: INV-009 (settlement reproducible from records), INV-003 (one stream per asset).
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FixedClock, SteppableClock, durationMillis, epochMillis } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';

/** The first compiled asset, derived rather than named (PH-26.3). */
const FIRST = ASSET_CATALOGUE[0]!.definition.id;
import {
  AlreadyRegisteredError,
  assertOverlay,
  CorruptRegistrationError,
  FileAssetRegistry,
  ImmutableFieldError,
  MemoryAssetRegistry,
  OVERLAY_FIELDS,
} from './registry.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function registry(at = 1_000): Promise<FileAssetRegistry> {
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-registry-'));
  directories.push(directory);
  return new FileAssetRegistry(directory, new FixedClock(epochMillis(at)));
}

describe('the registry stores what was solved', () => {
  it('reads back an asset exactly as it was written', async () => {
    const store = await registry();
    const asset = ASSET_CATALOGUE[0]!;
    await store.add(asset);
    const [read] = await store.list();
    // Deep equality, not "close enough". A quantum that survived a round trip
    // with a different last digit is a different lattice, and every settlement
    // recorded against the first one becomes unreproducible (INV-009).
    expect(read).toEqual(asset);
  });

  it('never re-derives: a stored asset is returned even when nothing could solve it', async () => {
    const store = await registry();
    const asset = ASSET_CATALOGUE[1]!;
    await store.add(asset);
    const [read] = await store.list();
    expect(read!.evidence.logQuantum).toBe(asset.evidence.logQuantum);
    expect(read!.instrument.logQuantum).toBe(asset.instrument.logQuantum);
    expect(read!.definition.traits).toEqual(asset.definition.traits);
  });

  it('refuses to overwrite a registration', async () => {
    const store = await registry();
    await store.add(ASSET_CATALOGUE[2]!);
    await expect(store.add(ASSET_CATALOGUE[2]!)).rejects.toBeInstanceOf(AlreadyRegisteredError);
  });

  it('returns assets in registration order rather than filename order', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-registry-'));
    directories.push(directory);
    const clock = new SteppableClock(epochMillis(10));
    const store = new FileAssetRegistry(directory, clock);
    // `zeta` first, `alpha` second: sorted by name they come back the other way.
    await store.add(renamed('zeta'));
    clock.advance(durationMillis(10));
    await store.add(renamed('alpha'));
    const ids = (await store.list()).map((asset) => asset.definition.id);
    expect(ids).toEqual(['zeta', 'alpha']);
    // And the files really are the other way round, so this is a property of
    // the registry rather than of the filesystem.
    expect((await readdir(directory)).sort()).toEqual(['alpha.json', 'zeta.json']);
  });

  it('refuses a stored file whose instrument the core rejects', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-registry-'));
    directories.push(directory);
    const asset = ASSET_CATALOGUE[0]!;
    await writeFile(
      path.join(directory, 'eurusd.json'),
      JSON.stringify({
        registeredAt: 1,
        asset: { ...asset, instrument: { ...asset.instrument, logQuantum: -1 } },
      }),
    );
    await expect(
      new FileAssetRegistry(directory, new FixedClock(epochMillis(0))).list(),
    ).rejects.toBeInstanceOf(CorruptRegistrationError);
  });

  it('refuses a file whose instrument and definition disagree about the id', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-registry-'));
    directories.push(directory);
    const asset = ASSET_CATALOGUE[0]!;
    await writeFile(
      path.join(directory, 'eurusd.json'),
      JSON.stringify({
        registeredAt: 1,
        // The definition says one asset and the lattice belongs to another: the
        // market would publish under one id and settle on another's quantum.
        asset: { ...asset, definition: { ...asset.definition, id: 'somethingelse' } },
      }),
    );
    await expect(
      new FileAssetRegistry(directory, new FixedClock(epochMillis(0))).list(),
    ).rejects.toBeInstanceOf(CorruptRegistrationError);
  });

  it('refuses four bytes of null, the shape that parses cleanly', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-registry-'));
    directories.push(directory);
    await writeFile(path.join(directory, 'eurusd.json'), 'null');
    await expect(
      new FileAssetRegistry(directory, new FixedClock(epochMillis(0))).list(),
    ).rejects.toBeInstanceOf(CorruptRegistrationError);
  });

  it('is empty, not absent, before anything is registered', async () => {
    const store = new FileAssetRegistry(
      path.join(tmpdir(), 'otc-registry-does-not-exist'),
      new FixedClock(epochMillis(0)),
    );
    expect(await store.list()).toEqual([]);
  });
});

describe('the in-memory registry answers the same way', () => {
  it('refuses a duplicate', async () => {
    const store = new MemoryAssetRegistry([ASSET_CATALOGUE[0]!]);
    await expect(store.add(ASSET_CATALOGUE[0]!)).rejects.toBeInstanceOf(AlreadyRegisteredError);
    expect((await store.list()).length).toBe(1);
  });
});

function renamed(id: string) {
  const asset = ASSET_CATALOGUE[0]!;
  return {
    ...asset,
    definition: { ...asset.definition, id },
    instrument: { ...asset.instrument, id },
  };
}

describe('what an operator may change about an asset', () => {
  it('is a label and a decision to stop, and nothing else', () => {
    // Written as a closed list rather than as a set of individual refusals: the
    // failure this prevents is a *future* field being added to the overlay
    // because it was convenient, and a list is what makes that a deliberate act.
    expect([...OVERLAY_FIELDS]).toEqual(['displayName', 'retiredAt']);
  });

  it('refuses every field that decided what already happened, by name', () => {
    for (const field of [
      'id',
      'logQuantum',
      'referencePrice',
      'displayPrecision',
      'traits',
      'family',
      'evidence',
    ]) {
      let thrown: unknown;
      try {
        assertOverlay({ [field]: 1 });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, field).toBeInstanceOf(ImmutableFieldError);
      // The message names the field *and* says which invariant it protects. An
      // operator who is told "invalid request" learns nothing.
      expect((thrown as Error).message, field).toContain(field);
      expect((thrown as Error).message, field).toContain('INV-009');
    }
  });

  it('refuses an empty display name', () => {
    expect(() => {
      assertOverlay({ displayName: '   ' });
    }).toThrow(/needs a display name/);
  });

  it('stores and merges overlays, for compiled assets too', async () => {
    const store = await registry();
    // `eurusd` is compiled into the catalogue and was never registered here.
    // Administering it is exactly the case an overlay exists for.
    await store.putOverlay('eurusd', { displayName: 'Euro / Dollar' });
    await store.putOverlay('eurusd', { retiredAt: 1_700_000 });
    const overlays = await store.overlays();
    expect(overlays.get('eurusd')).toEqual({
      displayName: 'Euro / Dollar',
      retiredAt: 1_700_000,
    });
    // And the overlay file is not itself read as a registration: it was
    // `overlays.json` for one test run, and `list()` duly tried.
    expect(await store.list(), 'an overlay is not a registration').toEqual([]);
  });

  it('survives a reopen', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-registry-'));
    directories.push(directory);
    const clock = new FixedClock(epochMillis(5));
    await new FileAssetRegistry(directory, clock).putOverlay('spx', { retiredAt: 42 });
    const reopened = await new FileAssetRegistry(directory, clock).overlays();
    expect(reopened.get('spx')?.retiredAt).toBe(42);
  });

  it('refuses a stored overlay carrying an immutable field', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-registry-'));
    directories.push(directory);
    // A hand-edited file is the realistic route to this, and hosting a market
    // whose quantum came from an overlay is the outcome worth refusing.
    await writeFile(
      path.join(directory, '_overlays.json'),
      JSON.stringify({ eurusd: { logQuantum: 1e-6 } }),
    );
    await expect(
      new FileAssetRegistry(directory, new FixedClock(epochMillis(0))).overlays(),
    ).rejects.toBeInstanceOf(ImmutableFieldError);
  });

  it('has no overlays before anything is administered', async () => {
    const store = await registry();
    expect((await store.overlays()).size).toBe(0);
  });

  it('refuses an immutable field in memory too', async () => {
    await expect(
      new MemoryAssetRegistry().putOverlay('eurusd', { id: 'other' } as never),
    ).rejects.toBeInstanceOf(ImmutableFieldError);
  });
});

describe('the registry survives what a running venue does to it (a5-07)', () => {
  it('stores every one of twenty concurrent overlay edits', async () => {
    // The temporary path was `${target}.${pid}.tmp` — unique per process, not
    // per call — and the read-modify-write of `_overlays.json` was not
    // serialised. Twenty edits at once: nineteen rejected with ENOENT on their
    // own temporary file, one overlay stored. The same defect Cycle Audit 6
    // fixed in `FileStateStore`, unfixed here.
    const store = await registry();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => store.putOverlay(`asset${i}`, { displayName: `A${i}` })),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const overlays = await store.overlays();
    expect(overlays.size).toBe(20);
    for (let i = 0; i < 20; i += 1) expect(overlays.get(`asset${i}`)?.displayName).toBe(`A${i}`);
  });

  it('refuses a file whose name is not the id it contains', async () => {
    // A backup copy such as `eurusd.bak.json` matches the filename rule, is
    // read as a second registration of `eurusd`, and `new Venue(...)` then
    // refuses to boot on a duplicate asset — until an operator finds the copy.
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-registry-'));
    directories.push(directory);
    const clock = new FixedClock(epochMillis(1));
    await new FileAssetRegistry(directory, clock).add(ASSET_CATALOGUE[0]!);
    await copyFile(
      path.join(directory, `${FIRST}.json`),
      path.join(directory, `${FIRST}.bak.json`),
    );
    const error = await new FileAssetRegistry(directory, clock).list().then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(CorruptRegistrationError);
    expect(error?.message).toContain(`${FIRST}.bak.json`);
    expect(error?.message).toContain(FIRST);
  });

  it('reports a truncated file as a corrupt registration naming the file, not a bare SyntaxError', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-registry-'));
    directories.push(directory);
    const clock = new FixedClock(epochMillis(1));
    const store = new FileAssetRegistry(directory, clock);
    await store.add(ASSET_CATALOGUE[0]!);
    await store.putOverlay(FIRST, { displayName: 'Euro' });
    const registration = await readFile(path.join(directory, `${FIRST}.json`), 'utf8');
    await writeFile(
      path.join(directory, `${FIRST}.json`),
      registration.slice(0, registration.length >> 1),
    );
    const overlays = await readFile(path.join(directory, '_overlays.json'), 'utf8');
    await writeFile(path.join(directory, '_overlays.json'), overlays.slice(0, 5));

    const listed = await store.list().then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(listed).toBeInstanceOf(CorruptRegistrationError);
    expect(listed?.message).toContain(`${FIRST}.json`);
    await expect(store.overlays()).rejects.toBeInstanceOf(CorruptRegistrationError);
  });

  it('admits exactly one of ten concurrent registrations of one id', async () => {
    // Ten at once passed the "already registered?" read together, and the
    // per-process temporary name then made nine of them fail with ENOENT
    // rather than `AlreadyRegisteredError`. The registration has to be
    // published exclusively as well as atomically.
    const store = await registry();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => store.add(ASSET_CATALOGUE[2]!)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toBeInstanceOf(AlreadyRegisteredError);
    }
    expect((await store.list()).map((a) => a.definition.id)).toEqual([
      ASSET_CATALOGUE[2]!.definition.id,
    ]);
  });
});
