import { describe, expect, it } from 'vitest';
import { assertValidInstrument, epochMillis, logPrice, MasterKeyring } from '@otc/core';
import { calibrateAsset, type AssetDefinition } from './asset.js';
import { ASSET_CATALOGUE, assetById, configFor } from './catalogue.js';
import { createMarketEngine } from './factory.js';
import { assertPersonalityTraits, DEFAULT_TRAITS } from './personality.js';

const keyring = MasterKeyring.forTesting('catalogue-spec');
const derive =
  (asset: string) =>
  (purpose: string): ReturnType<typeof keyring.derive> =>
    keyring.derive({ env: 'test', asset, purpose, keyEpoch: 0 });

describe('the catalogue is well formed', () => {
  it('holds assets across several families', () => {
    const families = new Set(ASSET_CATALOGUE.map((asset) => asset.definition.family));
    expect(ASSET_CATALOGUE.length).toBeGreaterThanOrEqual(4);
    expect(families.size).toBeGreaterThanOrEqual(3);
  });

  it('gives every asset a unique id', () => {
    const ids = ASSET_CATALOGUE.map((asset) => asset.definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ASSET_CATALOGUE.map((a) => [a.definition.id, a] as const))(
    '%s has a valid instrument and in-bounds traits',
    (_id, asset) => {
      expect(() => assertValidInstrument(asset.instrument)).not.toThrow();
      expect(() => assertPersonalityTraits(asset.definition.traits)).not.toThrow();
      expect(asset.instrument.logQuantum).toBe(asset.evidence.logQuantum);
    },
  );

  it.each(ASSET_CATALOGUE.map((a) => [a.definition.id, a] as const))(
    '%s displays at least as finely as it settles',
    (_id, asset) => {
      // One display unit must not be coarser than one lattice step, or a trader
      // could see an unchanged price on a contract that settled as a move.
      const { logQuantum, displayPrecision, referencePrice } = asset.instrument;
      let displayUnit = 1;
      for (let i = 0; i < displayPrecision; i += 1) displayUnit /= 10;
      const relativeDisplayUnit = displayUnit / referencePrice;
      expect(relativeDisplayUnit).toBeLessThanOrEqual(logQuantum);
    },
  );

  it('looks up by id and rejects an unknown one', () => {
    expect(assetById('eurusd').definition.displayName).toBe('EUR/USD');
    expect(() => assetById('nope')).toThrow(/Unknown asset nope.*eurusd/s);
  });
});

describe('registered assets drive the real engine', () => {
  it.each(ASSET_CATALOGUE.map((a) => [a.definition.id, a] as const))(
    '%s produces a market',
    (_id, asset) => {
      const engine = createMarketEngine({
        config: configFor(asset),
        keyring,
        environment: 'test',
        start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
      });
      let previous = engine.next()!;
      for (let i = 0; i < 2_000; i += 1) {
        const tick = engine.next()!;
        expect(tick.sequence).toBe(previous.sequence + 1);
        expect(tick.instant).toBeGreaterThan(previous.instant);
        previous = tick;
      }
    },
  );

  it('gives different assets different markets', () => {
    // The same keyring, the same start, different personalities: the streams are
    // keyed by asset id, so two assets are never the same market relabelled.
    const [first, second] = [ASSET_CATALOGUE[0]!, ASSET_CATALOGUE[2]!];
    const run = (asset: typeof first): number[] => {
      const engine = createMarketEngine({
        config: configFor(asset),
        keyring,
        environment: 'test',
        start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
      });
      return Array.from({ length: 500 }, () => engine.next()!.price);
    };
    expect(run(first)).not.toEqual(run(second));
  });
});

describe('registration rejects before it simulates', () => {
  const base: AssetDefinition = {
    id: 'probe',
    family: 'forex',
    displayName: 'Probe',
    referencePrice: 1.1,
    traits: DEFAULT_TRAITS,
  };

  it('rejects out-of-bounds traits', () => {
    expect(() =>
      calibrateAsset({ ...base, traits: { ...DEFAULT_TRAITS, burstiness: 1.4 } }, derive('probe'), {
        simulatedMs: 86_400_000,
      }),
    ).toThrow(/burstiness/);
  });

  it('rejects a personality whose layers would compound past the ceiling', () => {
    // This must fail on the analytic gate, before any simulation: the option
    // below asks for a full day of ticks, and a rejection has to be faster than
    // producing them.
    expect(() =>
      calibrateAsset({ ...base, traits: { ...DEFAULT_TRAITS, clustering: 0.4 } }, derive('probe'), {
        simulatedMs: 30 * 86_400_000,
      }),
    ).toThrow(/above the realism ceiling/);
  });

  it('rejects a nonsensical tie-rate target', () => {
    expect(() => calibrateAsset(base, derive('probe'), { targetTieRate: 0 })).toThrow(RangeError);
    expect(() => calibrateAsset(base, derive('probe'), { targetTieRate: 1 })).toThrow(RangeError);
  });
});
