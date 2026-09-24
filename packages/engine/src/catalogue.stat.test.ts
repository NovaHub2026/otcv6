import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import {
  calibrateAsset as calibrateAssetSync,
  calibrateAssetAsync,
  MAX_REFUND_RATE,
  REFUND_CANDIDATE_FACTORS,
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
      // **PH-37: the property is what the lattice refunds.** This compared the
      // continuous quantile against the 1% nominal, which was the property a
      // quantum was chosen for until the choice became a measured one. The
      // quantile is where the search starts now — it cuts at 11%-17% once the
      // lattice is 12 to 16 steps coarser — and what must reproduce is the
      // realised rate clearing the ceiling, which is what the choice is made
      // against and what a broker pays.
      expect(
        fresh.evidence.realisedRefundRate,
        `${id} refunds ${String(fresh.evidence.realisedRefundRate)}`,
      ).toBeLessThanOrEqual(MAX_REFUND_RATE);
      expect(
        Math.abs(fresh.evidence.realisedRefundRate - asset.evidence.realisedRefundRate),
        `${id} drifted from the recorded refund`,
      ).toBeLessThan(0.015);

      // A loose band on the quantum still catches gross drift — a calibration
      // that changed meaning rather than merely resampled.
      const ratio = fresh.evidence.logQuantum / asset.evidence.logQuantum;
      expect(ratio, `${id} quantum ratio`).toBeGreaterThan(0.6);
      expect(ratio, `${id} quantum ratio`).toBeLessThan(1.6);

      // Display precision is derived from the quantum, so it moves at most a
      // step. The published one is the lattice PH-26.3 recorded, kept through
      // every recalibration so a running market's prices keep their meaning
      // (PH-34); a fresh calibration derives its own, and at PH-35's level the
      // two can land either side of a decade — tcx-idx-otc reads 4 fresh
      // against the 3 it publishes.
      expect(
        Math.abs(fresh.instrument.displayPrecision - asset.instrument.displayPrecision),
        `${id} display precision`,
      ).toBeLessThanOrEqual(1);

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
    // Since PH-34 the pace is **derived** from each asset's dispersion — the
    // square root of it, normalised to 2.47 ticks a second across the thirty —
    // so the spread is the catalogue's own range of volatility rather than a
    // free axis: 4.6× from EUR/GBP to DOGE (it was 8.1× when the tempo was
    // drawn per seat). A floor of 4 keeps the claim this makes, which is that
    // the assets do not share a tape.
    const paces = ASSET_CATALOGUE.map((a) => a.evidence.meanIntervalMs);
    expect(Math.max(...paces) / Math.min(...paces)).toBeGreaterThan(4);
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
    // An emergent property worth guarding: the median move lands in the same
    // band of lattice steps for every asset despite an order of magnitude of
    // volatility between them. If this drifts, the calibration rule has changed
    // meaning.
    //
    // **PH-37 tightened it, which is the rule changing meaning for the better.**
    // It was 40 to 150 — a factor of 3.8 — when each quantum was a quantile of
    // its own asset's returns. Choosing every lattice against one refund
    // ceiling makes the resolution itself uniform: measured across the thirty,
    // **4.32 to 6.24 steps**, a factor of 1.44. The band below is that with
    // room for a resample, and it is a tighter statement than the one it
    // replaces, not a looser one.
    for (const asset of ASSET_CATALOGUE) {
      expect(asset.evidence.medianSteps, asset.definition.id).toBeGreaterThan(3);
      expect(asset.evidence.medianSteps, asset.definition.id).toBeLessThan(9);
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

  it('derives a lattice that clears the refund ceiling (PH-37)', async () => {
    const asset = await calibrateAssetAsync(base, derive, { simulatedMs: 2 * 86_400_000 });
    // What a lattice is chosen by, and what it is chosen *from*: the quantile
    // at `TARGET_TIE_RATE` is the finest candidate, and the factor says how far
    // past it the refund ceiling let the search go.
    expect(asset.evidence.realisedRefundRate).toBeLessThanOrEqual(MAX_REFUND_RATE);
    expect(asset.evidence.refundLatticeFactor).toBeGreaterThanOrEqual(1);
    expect(REFUND_CANDIDATE_FACTORS).toContain(asset.evidence.refundLatticeFactor);
    expect(asset.evidence.tieRate).toBeGreaterThan(TARGET_TIE_RATE);
    expect(asset.evidence.logQuantum).toBeGreaterThan(0);
    expect(asset.evidence.medianSteps).toBeGreaterThan(2);
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
