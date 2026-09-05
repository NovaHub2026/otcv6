// Invariant evidence: INV-003 (single underlying stream).
import { describe, expect, it } from 'vitest';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryAssetRegistry } from '@otc/runtime';
import { AppModule } from './app.module.js';

/**
 * The boot-time refusal of one market under two names (Cycle Audit 9, a6-04).
 *
 * A registry holding an asset whose id the compiled catalogue also has would
 * host two engines deriving the same keystream under one id — INV-003 broken
 * before a tick is published. `AppModule.register()`'s `ASSETS` factory refuses
 * it; the refusal was in the code and in no test.
 */
type Factory = (registry: MemoryAssetRegistry) => Promise<unknown>;

function assetsFactory(): Factory {
  const module = AppModule.register();
  const provider = (module.providers ?? []).find(
    (p) => typeof p === 'object' && p !== null && 'provide' in p && p.provide === 'ASSETS',
  ) as { useFactory?: Factory } | undefined;
  expect(provider?.useFactory, "the ASSETS provider's factory").toBeDefined();
  return provider!.useFactory!;
}

describe('the ASSETS factory', () => {
  it('refuses a registered asset whose id the compiled catalogue also has, by name', async () => {
    const compiled = ASSET_CATALOGUE[0]!;
    const registry = new MemoryAssetRegistry();
    await registry.add(compiled);
    await expect(assetsFactory()(registry)).rejects.toThrow(
      new RegExp(`${compiled.definition.id}.*collides`),
    );
  });

  it('hosts the compiled catalogue plus what the registry holds, when nothing collides', async () => {
    const registry = new MemoryAssetRegistry();
    const assets = (await assetsFactory()(registry)) as { definition: { id: string } }[];
    expect(assets.map((a) => a.definition.id)).toEqual(ASSET_CATALOGUE.map((a) => a.definition.id));
  });
});
