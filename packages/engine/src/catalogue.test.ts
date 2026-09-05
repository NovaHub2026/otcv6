import { describe, expect, it } from 'vitest';
import { assertValidInstrument, epochMillis, logPrice, MasterKeyring } from '@otc/core';
import { calibrateAsset, type AssetDefinition } from './asset.js';
import { AUTHORING_RETREAT } from './brief.js';
import { ASSET_CATALOGUE, assetById, configFor, registrationKeyLabel } from './catalogue.js';
import { createMarketEngine } from './factory.js';
import {
  assertPersonalityTraits,
  authorPersonality,
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
    const first = ASSET_CATALOGUE[0]!;
    expect(assetById(first.definition.id).definition.displayName).toBe(
      first.definition.displayName,
    );
    expect(() => assetById('nope')).toThrow(
      new RegExp(`Unknown asset nope.*${first.definition.id}`, 's'),
    );
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
      // Exactly the streams `registerAsset` authors with: keyring
      // `registration-<id>`, stream label `registration-<id>`, environment
      // `simulation` — which is what `buildCatalogue.ts` ran (PH-26.3). The five
      // hand-authored entries were solved with the bare id as the stream label;
      // the thirty carry the pipeline's convention, and this is it.
      const registration = MasterKeyring.forTesting(registrationKeyLabel(id));
      // The target the pipeline authored *from*: the drawn tail weight, retreated
      // as many times as the record says. Re-solving from the achieved value is
      // a different input — the gate's structure term is estimated by
      // simulation, so a different bisection path is a different stream — and
      // two of the thirty landed one bracket away when this was tried.
      const target =
        asset.authored.drawnExcessKurtosis === undefined
          ? asset.authored.excessKurtosis
          : asset.authored.drawnExcessKurtosis *
            AUTHORING_RETREAT ** (asset.authored.retreats ?? 0);
      const targets = { excessKurtosis: target, tickRms: asset.authored.tickRms };
      const again = authorPersonality(asset.definition.traits, targets, (purpose) =>
        registration.derive({
          env: 'simulation',
          asset: registrationKeyLabel(id),
          purpose,
          keyEpoch: 0,
        }),
      );
      // A fixed point on every trait, `volatility` included: the pipeline
      // rescales the base volatility after authoring so the asset hits its
      // dispersion budget exactly, and records the rescaled `tickRms` beside it
      // — so re-authoring from the recorded targets lands on the recorded
      // volatility to floating-point resolution rather than to the bit.
      const { volatility: recordedVolatility, ...recordedRest } = asset.definition.traits;
      const { volatility: authoredVolatility, ...authoredRest } = again.traits;
      expect(authoredRest).toEqual(recordedRest);
      expect(Math.abs(authoredVolatility / recordedVolatility - 1)).toBeLessThan(1e-9);
      // What the solve achieved is recorded exactly; the calibration's own
      // estimate of the same gate, taken with its own stream, agrees to the
      // structure estimator's resolution (PH-26.3: the five were recorded
      // with one number for both, the thirty carry both as measured).
      expect(again.achievedExcessKurtosis).toBe(asset.authored.excessKurtosis);
      // Measured across the thirty on 2026-09-04: the largest gap is 7.9%
      // (eurusd-otc); ten per cent is the estimator's resolution with room.
      expect(
        Math.abs(asset.evidence.predictedExcessKurtosis / asset.authored.excessKurtosis - 1),
        `${id} predicted vs achieved`,
      ).toBeLessThan(0.1);
    },
  );

  it('records what was achieved, not what was asked for', () => {
    // They are close, but they are not the same number, and the difference is
    // the structure estimator's own resolution. Recording the request would be
    // publishing a figure nothing ever computed.
    const differences = ASSET_CATALOGUE.map((a) =>
      Math.abs(a.evidence.predictedExcessKurtosis - a.authored.excessKurtosis),
    );
    // Two independent computations of the same gate: they differ, and never by
    // more than the structure estimator's resolution.
    expect(differences.some((d) => d > 0)).toBe(true);
    expect(Math.max(...differences)).toBeLessThan(
      0.1 * Math.max(...ASSET_CATALOGUE.map((a) => a.authored.excessKurtosis)),
    );
  });
});

/**
 * Retired with the five assets it was about (PH-26.3).
 *
 * "Re-authoring changed rhythm and grain, never scale or tail weight" pinned
 * each of PH-4's five hand-authored assets to its PH-4 amplitude at PH-24.17's
 * grain — six tables of frozen numbers keyed by `eurusd`, `gbpjpy`, `btcusd`,
 * `spx` and `xauusd`. The catalogue of thirty has no PH-4 predecessor to hold
 * to; what it holds to instead is its own recorded run, which
 * `the recorded personalities reproduce from their targets` above re-derives
 * entry by entry, and `catalogue.stat.test.ts` recalibrates. The tables went
 * with the assets rather than being emptied, because an empty table under an
 * `it.each` over the catalogue is a test that passes by having nothing to say.
 */

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
