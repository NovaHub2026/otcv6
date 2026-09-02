// Invariant evidence: INV-009 (settlement reproducible from records), INV-003 (one stream per asset).
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FixedClock, SteppableClock, durationMillis, epochMillis } from '@otc/core';
import { assetById } from '@otc/engine';
import {
  AlreadyRegisteredError,
  CorruptRegistrationError,
  FileAssetRegistry,
  MemoryAssetRegistry,
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
    const asset = assetById('eurusd');
    await store.add(asset);
    const [read] = await store.list();
    // Deep equality, not "close enough". A quantum that survived a round trip
    // with a different last digit is a different lattice, and every settlement
    // recorded against the first one becomes unreproducible (INV-009).
    expect(read).toEqual(asset);
  });

  it('never re-derives: a stored asset is returned even when nothing could solve it', async () => {
    const store = await registry();
    const asset = assetById('btcusd');
    await store.add(asset);
    const [read] = await store.list();
    expect(read!.evidence.logQuantum).toBe(asset.evidence.logQuantum);
    expect(read!.instrument.logQuantum).toBe(asset.instrument.logQuantum);
    expect(read!.definition.traits).toEqual(asset.definition.traits);
  });

  it('refuses to overwrite a registration', async () => {
    const store = await registry();
    await store.add(assetById('spx'));
    await expect(store.add(assetById('spx'))).rejects.toBeInstanceOf(AlreadyRegisteredError);
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
    const asset = assetById('eurusd');
    await writeFile(
      path.join(directory, 'broken.json'),
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
    const asset = assetById('eurusd');
    await writeFile(
      path.join(directory, 'mismatch.json'),
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
    await writeFile(path.join(directory, 'null.json'), 'null');
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
    const store = new MemoryAssetRegistry([assetById('eurusd')]);
    await expect(store.add(assetById('eurusd'))).rejects.toBeInstanceOf(AlreadyRegisteredError);
    expect((await store.list()).length).toBe(1);
  });
});

function renamed(id: string) {
  const asset = assetById('eurusd');
  return {
    ...asset,
    definition: { ...asset.definition, id },
    instrument: { ...asset.instrument, id },
  };
}
