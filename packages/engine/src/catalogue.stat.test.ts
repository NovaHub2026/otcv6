import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import {
  calibrateAsset as calibrateAssetSync,
  calibrateAssetAsync,
  TARGET_TIE_RATE,
  type AssetDefinition,
} from './asset.js';
import { dispersionLogSigma } from './dispersion.js';
import { ASSET_CATALOGUE } from './catalogue.js';
import { HEAVY_SUITE_SAMPLE, sampleCatalogue } from './catalogueSample.js';
import { seatById } from './seats.js';

/**
 * Registration evidence has to be reproducible or it is decoration.
 *
 * Every asset here was calibrated once, and the resulting quantum decides every
 * settlement for that asset. These tests recalibrate from entirely different
 * streams and require the recorded numbers to come back.
 */
/**
 * Which assets this run recalibrates (PH-26.1).
 *
 * A three-replicate, ten-day recalibration per asset is 50.1 M simulated ticks
 * at five assets and would be 301 M at thirty. The run recalibrates a fixed,
 * stratified sample and prints what it left out; every asset's evidence is
 * reproduced by the evidence run at the phase boundary. At five assets the
 * sample is the catalogue and nothing changes.
 */
const SAMPLE = sampleCatalogue(
  ASSET_CATALOGUE,
  (a) => a.definition.id,
  MasterKeyring.forTesting('catalogue-sample').derive({
    env: 'test',
    asset: 'sample',
    purpose: 'recalibration',
    keyEpoch: 0,
  }),
  {
    size: HEAVY_SUITE_SAMPLE,
    // One stratum per archetype (eight), read from the seat each compiled asset
    // was drawn from; family (four) for anything without a seat.
    stratumOf: (a) => {
      try {
        return seatById(a.definition.id).archetype;
      } catch {
        return a.definition.family;
      }
    },
  },
);

describe('recorded calibration evidence reproduces', () => {
  it('says which assets this run recalibrated, and which it did not (§68)', () => {
    console.info(`recalibration: ${SAMPLE.describe()}`);
    expect(SAMPLE.measured).toHaveLength(Math.min(HEAVY_SUITE_SAMPLE, ASSET_CATALOGUE.length));
  });

  it.each(SAMPLE.measured.map((a) => [a.definition.id, a] as const))(
    '%s recalibrates to its recorded quantum',
    async (id, asset) => {
      const keyring = MasterKeyring.forTesting(`recalibrate-${id}`);
      const derive = (purpose: string): RandomSource =>
        keyring.derive({ env: 'test', asset: `recal-${id}`, purpose, keyEpoch: 0 });

      const fresh = await calibrateAssetAsync(asset.definition, derive);

      // What must reproduce is the *property* the quantum was chosen for, not
      // the number itself. Measured during PH-4.2: the recorded quanta deliver
      // 0.78%-1.22% on fresh realisations, while the quanta themselves differ by
      // up to 28% between seeds. Both facts are consistent, because the return
      // distribution is very flat in its lower tail — a large move in the
      // quantile is a small move in the probability it cuts.
      //
      // Asserting on the quantum would therefore have been a tighter-looking
      // test of a quantity that does not matter, and it would have failed for
      // the wrong reason.
      expect(
        Math.abs(fresh.evidence.tieRate - TARGET_TIE_RATE),
        `${id} realised tie rate ${fresh.evidence.tieRate}`,
      ).toBeLessThan(0.003);

      // A loose band on the quantum still catches gross drift — a calibration
      // that changed meaning rather than merely resampled.
      const ratio = fresh.evidence.logQuantum / asset.evidence.logQuantum;
      expect(ratio, `${id} quantum ratio`).toBeGreaterThan(0.6);
      expect(ratio, `${id} quantum ratio`).toBeLessThan(1.6);

      // Display precision is derived from the quantum, so it must be stable.
      expect(fresh.instrument.displayPrecision).toBe(asset.instrument.displayPrecision);

      // The gate is analytic, so it should barely move at all.
      const kurtosisRatio =
        fresh.evidence.predictedExcessKurtosis / asset.evidence.predictedExcessKurtosis;
      expect(kurtosisRatio, `${id} gate`).toBeGreaterThan(0.9);
      expect(kurtosisRatio, `${id} gate`).toBeLessThan(1.1);

      // The diffusion rate: how far this asset's price wanders per unit of time,
      // which PH-17.2 turned into a family design parameter. Recorded from a
      // named seed; re-measured here from an unrelated one.
      //
      // A wide band, and it has to be. Four seeds put the ratio between 0.836
      // and 1.165, and the widest is `spx`, whose volatility remembers for 44
      // hours against a 30-day calibration — the same B-002 fact that governs
      // the tie rates above. What this catches is a calibration that changed
      // meaning, not one that resampled.
      const dispersionRatio =
        dispersionLogSigma(fresh.evidence) / dispersionLogSigma(asset.evidence);
      expect(dispersionRatio, `${id} dispersion`).toBeGreaterThan(0.7);
      expect(dispersionRatio, `${id} dispersion`).toBeLessThan(1.4);

      // Pace is a personality trait, not a realisation.
      const paceRatio = fresh.evidence.meanIntervalMs / asset.evidence.meanIntervalMs;
      expect(paceRatio, `${id} pace`).toBeGreaterThan(0.9);
      expect(paceRatio, `${id} pace`).toBeLessThan(1.1);
    },
  );
});

describe('the catalogue is actually varied', () => {
  // Not the full differentiation metric — that is PH-4.3, and it must show the
  // assets are statistically distinguishable rather than merely differently
  // parameterised. This is the weaker claim that the catalogue is not five
  // relabelled copies of one market.
  it('spans a wide range of pace', () => {
    const paces = ASSET_CATALOGUE.map((a) => a.evidence.meanIntervalMs);
    expect(Math.max(...paces) / Math.min(...paces)).toBeGreaterThan(5);
  });

  it('spans a wide range of scale', () => {
    const quanta = ASSET_CATALOGUE.map((a) => a.evidence.logQuantum);
    expect(Math.max(...quanta) / Math.min(...quanta)).toBeGreaterThan(5);
  });

  it('spans a wide range of tail weight, all inside the realism band', () => {
    const kurtosis = ASSET_CATALOGUE.map((a) => a.evidence.predictedExcessKurtosis);
    expect(Math.max(...kurtosis) / Math.min(...kurtosis)).toBeGreaterThan(2);
    for (const value of kurtosis) {
      expect(value).toBeGreaterThan(1.5);
      expect(value).toBeLessThan(200);
    }
  });

  it('gives every asset a comparable lattice resolution, without targeting it', () => {
    // An emergent property worth guarding: because each quantum is a quantile of
    // that asset's own returns, the median move lands in the same band of
    // lattice steps for every asset despite an order of magnitude of volatility
    // between them. If this drifts, the calibration rule has changed meaning.
    for (const asset of ASSET_CATALOGUE) {
      expect(asset.evidence.medianSteps, asset.definition.id).toBeGreaterThan(40);
      expect(asset.evidence.medianSteps, asset.definition.id).toBeLessThan(150);
    }
  });
});

describe('the registration procedure itself', () => {
  const keyring = MasterKeyring.forTesting('registration-spec');
  const derive = (purpose: string): RandomSource =>
    keyring.derive({ env: 'test', asset: 'probe', purpose, keyEpoch: 0 });
  const base: AssetDefinition = {
    id: 'probe',
    family: 'forex',
    displayName: 'Probe',
    referencePrice: 1.1,
    traits: ASSET_CATALOGUE[0]!.definition.traits,
  };

  it('derives a quantum that hits the target tie rate', async () => {
    const asset = await calibrateAssetAsync(base, derive, { simulatedMs: 2 * 86_400_000 });
    expect(Math.abs(asset.evidence.tieRate - TARGET_TIE_RATE)).toBeLessThan(0.003);
    expect(asset.evidence.logQuantum).toBeGreaterThan(0);
    expect(asset.evidence.medianSteps).toBeGreaterThan(20);
    expect(asset.evidence.replicates).toBeGreaterThan(1);
  });

  it('refuses a span too short to place the quantile', () => {
    expect(() => calibrateAssetSync(base, derive, { simulatedMs: 60_000 })).toThrow(
      /simulate a longer span/,
    );
  });

  it('refuses a nonsensical replicate count', () => {
    expect(() => calibrateAssetSync(base, derive, { replicates: 0 })).toThrow(RangeError);
    expect(() => calibrateAssetSync(base, derive, { replicates: 1.5 })).toThrow(RangeError);
  });
});
