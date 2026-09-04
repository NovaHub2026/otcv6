import { describe, expect, it } from 'vitest';
import { assertValidInstrument, epochMillis, logPrice, MasterKeyring } from '@otc/core';
import { calibrateAsset, type AssetDefinition } from './asset.js';
import { ASSET_CATALOGUE, assetById, configFor, registrationKeyLabel } from './catalogue.js';
import { createMarketEngine } from './factory.js';
import {
  assertPersonalityTraits,
  authorPersonality,
  cascadeRmsGain,
  cascadeTimescalesMs,
  DEFAULT_TRAITS,
  MIN_FASTEST_COMPONENT_TICKS,
} from './personality.js';

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

// ---------------------------------------------------------------------------
// PH-10.2: the rhythm re-authoring
// ---------------------------------------------------------------------------

describe('the recorded personalities reproduce from their targets', () => {
  // A calibration record that reproduces proves the *lattice* was derived. It
  // says nothing about the two traits the lattice was derived from, and those
  // two — clustering and volatility — were solved rather than chosen. Without
  // this, `clustering: 0.18311113955405817` is an unfalsifiable magic number of
  // exactly the kind the project's engineering rules ban.
  //
  // The recorded traits should be a fixed point of the authoring function:
  // re-author from them and the same traits come back, because the solve
  // overwrites both of the values it owns.
  it.each(ASSET_CATALOGUE.map((a) => [a.definition.id, a] as const))(
    '%s re-authors to exactly its recorded traits',
    (id, asset) => {
      const registration = MasterKeyring.forTesting(registrationKeyLabel(id));
      const again = authorPersonality(asset.definition.traits, asset.authored, (purpose) =>
        registration.derive({ env: 'simulation', asset: id, purpose, keyEpoch: 0 }),
      );
      expect(again.traits).toEqual(asset.definition.traits);
      expect(again.achievedExcessKurtosis).toBe(asset.evidence.predictedExcessKurtosis);
    },
  );

  it('records what was achieved, not what was asked for', () => {
    // They are close, but they are not the same number, and the difference is
    // the structure estimator's own resolution. Recording the request would be
    // publishing a figure nothing ever computed.
    const differences = ASSET_CATALOGUE.map((a) =>
      Math.abs(a.evidence.predictedExcessKurtosis - a.authored.excessKurtosis),
    );
    expect(differences.every((d) => d < 1e-9)).toBe(true);
    expect(differences.some((d) => d > 0)).toBe(true);
  });
});

describe('re-authoring changed rhythm and grain, never scale or tail weight', () => {
  /**
   * Realised tick amplitude as PH-4 registered it, before any rhythm existed,
   * and the mean tick interval each asset had then.
   *
   * Frozen deliberately. This is the assertion that stops a re-authoring from
   * claiming a differentiation gain it bought by spreading the assets further
   * apart in size — which would be trivial, true by construction, and
   * meaningless. PH-10 held the amplitude itself. PH-24.17 raised every tempo
   * (three to four times the ticks a minute) and divided the amplitude by the
   * square root of the same factor, so the quantity that is still PH-4's is
   * the **variance per millisecond** — the amplitude squared over the mean
   * interval — which is what the quarterly dispersion is made of. A market
   * with finer ticks and the same dispersion is the same market at a finer
   * grain; a market with more dispersion would be a different one.
   */
  const PH4_TICK_RMS: Record<string, number> = {
    eurusd: 0.000013932458128335953,
    gbpjpy: 0.00004234061764642874,
    btcusd: 0.00007938865808705389,
    spx: 0.00000820990287547472,
    xauusd: 0.00002846808863025055,
  };
  /** Mean tick interval each asset was measured at when PH-4's amplitude was set (ms). */
  const PH4_MEAN_INTERVAL_MS: Record<string, number> = {
    eurusd: 1379.8191861941425,
    gbpjpy: 714.6766515523951,
    btcusd: 332.9569156063406,
    spx: 3352.3021210553543,
    xauusd: 1969.0617253751434,
  };
  /** Tail weight as PH-4 registered it. */
  const PH4_EXCESS_KURTOSIS: Record<string, number> = {
    eurusd: 63.518987927858404,
    gbpjpy: 108.62098096647418,
    btcusd: 151.62450294348804,
    spx: 44.40447547836519,
    xauusd: 100.48688844255925,
  };
  it.each(ASSET_CATALOGUE.map((a) => [a.definition.id, a] as const))(
    "%s keeps its variance per millisecond, PH-4's amplitude at its grain",
    (id, asset) => {
      const realised = asset.definition.traits.volatility * cascadeRmsGain(asset.definition.traits);
      const perMs = (realised * realised) / asset.evidence.meanIntervalMs;
      const ph4PerMs = (PH4_TICK_RMS[id]! * PH4_TICK_RMS[id]!) / PH4_MEAN_INTERVAL_MS[id]!;
      // The measured mean interval carries the arrival process's excitation, so
      // the ratio is a measurement, not an identity: the same 0.7-1.4 band
      // `catalogue.stat.test.ts` holds a fresh calibration's dispersion to.
      const ratio = perMs / ph4PerMs;
      expect(ratio, `${id} variance per ms ratio`).toBeGreaterThan(0.7);
      expect(ratio, `${id} variance per ms ratio`).toBeLessThan(1.4);
    },
  );
  it.each(ASSET_CATALOGUE.map((a) => [a.definition.id, a] as const))(
    '%s keeps its tail weight within 6%',
    (id, asset) => {
      const ratio = asset.evidence.predictedExcessKurtosis / PH4_EXCESS_KURTOSIS[id]!;
      expect(ratio, `${id} kurtosis ratio`).toBeGreaterThan(0.94);
      expect(ratio, `${id} kurtosis ratio`).toBeLessThan(1.06);
    },
  );

  it('carries every non-rhythm trait across unchanged', () => {
    // The exclusion, enforced. If a future re-authoring moves burstiness or a
    // spread while claiming to have changed only rhythm, this is what says so.
    // PH-24.17 divided each tempo by a recorded factor (finer grain, same
    // dispersion); the factor is part of the record, so a tempo that drifts
    // from PH-4's over that factor is still caught.
    const PH4_CARRIED: Record<string, Record<string, number>> = {
      eurusd: { tempoMs: 3_000, burstiness: 0.6, regimeSpread: 1, structureSpread: 1 },
      gbpjpy: { tempoMs: 1_850, burstiness: 0.62, regimeSpread: 1.15, structureSpread: 1 },
      btcusd: { tempoMs: 1_100, burstiness: 0.78, regimeSpread: 1.35, structureSpread: 1 },
      spx: { tempoMs: 5_450, burstiness: 0.45, regimeSpread: 0.85, structureSpread: 1.35 },
      xauusd: { tempoMs: 4_300, burstiness: 0.55, regimeSpread: 1.25, structureSpread: 0.9 },
    };
    const GRAIN_FACTOR: Record<string, number> = {
      eurusd: 4,
      gbpjpy: 3,
      btcusd: 3,
      spx: 4,
      xauusd: 4,
    };
    const drifted: string[] = [];
    for (const asset of ASSET_CATALOGUE) {
      const carried = PH4_CARRIED[asset.definition.id]!;
      for (const [name, value] of Object.entries(carried)) {
        const actual = asset.definition.traits[name as keyof typeof asset.definition.traits];
        const expected = name === 'tempoMs' ? value / GRAIN_FACTOR[asset.definition.id]! : value;
        if (actual !== expected)
          drifted.push(`${asset.definition.id}.${name}: ${actual} != ${expected}`);
      }
      if (asset.definition.traits.durationCoupling !== DEFAULT_TRAITS.durationCoupling) {
        drifted.push(`${asset.definition.id}.durationCoupling`);
      }
    }
    expect(drifted).toEqual([]);
  });
});

describe('the assets have genuinely different ladders', () => {
  it('shares no rhythm between any two assets', () => {
    // Differentiation is measured statistically in tools/sim. This is the
    // cheap structural precondition: if two assets had identical ladders, no
    // measurement downstream could tell them apart and the failure would show
    // up as an unexplained plateau rather than as a duplicate.
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const asset of ASSET_CATALOGUE) {
      const t = asset.definition.traits;
      const key = `${t.cascadeDepth}/${t.cascadeSpanMs}/${t.cascadeSpacing}/${t.regimeTempo}/${t.arrivalMemoryMs}`;
      const previous = seen.get(key);
      if (previous !== undefined) collisions.push(`${previous} and ${asset.definition.id}`);
      seen.set(key, asset.definition.id);
    }
    expect(collisions).toEqual([]);
  });

  it('spans a wide range of memory horizons', () => {
    const spans = ASSET_CATALOGUE.map((a) => a.definition.traits.cascadeSpanMs);
    expect(Math.max(...spans) / Math.min(...spans)).toBeGreaterThan(10);
  });

  it('keeps every fastest component above the tick floor', () => {
    const tooFast: string[] = [];
    for (const asset of ASSET_CATALOGUE) {
      const scales = cascadeTimescalesMs(asset.definition.traits);
      const ratio = scales[scales.length - 1]! / asset.definition.traits.tempoMs;
      if (ratio < MIN_FASTEST_COMPONENT_TICKS) tooFast.push(`${asset.definition.id}: ${ratio}`);
    }
    expect(tooFast).toEqual([]);
  });
});
