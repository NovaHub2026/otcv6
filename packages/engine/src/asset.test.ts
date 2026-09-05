// Invariant evidence: INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import {
  calibrateAsset,
  MEASURED_LATTICE_TIE_RATES,
  rescaleCalibration,
  TARGET_TIE_RATE,
} from './asset.js';
import { ASSET_CATALOGUE, registrationKeyLabel } from './catalogue.js';
import { dispersionLogSigma } from './dispersion.js';

const base = ASSET_CATALOGUE[0]!.definition;
const QUICK = { replicates: 1, simulatedMs: 2 * 86_400_000 } as const;

function calibrate(volatility: number, over: { replicates?: number; simulatedMs?: number } = {}) {
  const keyring = MasterKeyring.forTesting('rescale-spec');
  return calibrateAsset(
    { ...base, traits: { ...base.traits, volatility } },
    (purpose) =>
      keyring.derive({
        env: 'test',
        asset: registrationKeyLabel('probe'),
        purpose,
        keyEpoch: 0,
      }),
    { ...QUICK, ...over },
  );
}

describe('a calibration can be moved to another volatility without simulating', () => {
  const factor = 3.7;
  const measured = calibrate(base.traits.volatility);
  const scaledBySimulation = calibrate(base.traits.volatility * factor);
  const scaledByArithmetic = rescaleCalibration(measured, factor);

  it('reaches the same lattice', () => {
    expect(scaledByArithmetic.instrument.logQuantum).toBeCloseTo(
      scaledBySimulation.instrument.logQuantum,
      15,
    );
  });

  it('reaches the same diffusion rate', () => {
    const ratio =
      scaledByArithmetic.evidence.logVariancePerMs / scaledBySimulation.evidence.logVariancePerMs;
    expect(ratio).toBeCloseTo(1, 10);
  });

  it('leaves the shape of the market untouched', () => {
    // Tie rate, median move in lattice steps, mean interval and tail weight are
    // ratios or counts, so a change of scale cannot move them. If one of these
    // ever drifts, some layer has started reading an absolute magnitude.
    expect(scaledByArithmetic.evidence.tieRate).toBe(scaledBySimulation.evidence.tieRate);
    expect(scaledByArithmetic.evidence.medianSteps).toBeCloseTo(
      scaledBySimulation.evidence.medianSteps,
      6,
    );
    expect(scaledByArithmetic.evidence.meanIntervalMs).toBe(
      scaledBySimulation.evidence.meanIntervalMs,
    );
    expect(scaledByArithmetic.evidence.predictedExcessKurtosis).toBe(
      scaledBySimulation.evidence.predictedExcessKurtosis,
    );
  });

  it('recomputes the display precision rather than carrying it', () => {
    // A coarser lattice needs fewer decimals. Carrying the old figure would
    // publish a display finer than anything that can happen — harmless — or, at
    // a factor below one, coarser than the lattice, which is not.
    expect(scaledByArithmetic.instrument.displayPrecision).toBe(
      scaledBySimulation.instrument.displayPrecision,
    );
    // Far enough for the answer to actually move. A fiftyfold coarser lattice
    // needs fewer decimals and a fiftyfold finer one needs more; carrying the
    // figure across would get the second of those dangerously wrong.
    expect(rescaleCalibration(measured, 50).instrument.displayPrecision).toBeLessThan(
      measured.instrument.displayPrecision,
    );
    expect(rescaleCalibration(measured, 0.02).instrument.displayPrecision).toBeGreaterThan(
      measured.instrument.displayPrecision,
    );
  });

  it('records the factor it applied', () => {
    expect(measured.evidence.volatilityScale).toBe(1);
    expect(scaledByArithmetic.evidence.volatilityScale).toBe(factor);
    // Composing two rescalings composes the record, so an audit can always
    // recover the volatility the simulation actually ran at.
    expect(rescaleCalibration(scaledByArithmetic, 2).evidence.volatilityScale).toBe(factor * 2);
  });

  it('moves the definition, not only the instrument', () => {
    expect(scaledByArithmetic.definition.traits.volatility).toBeCloseTo(
      base.traits.volatility * factor,
      18,
    );
    expect(scaledByArithmetic.config.baseVolatility).toBeCloseTo(
      scaledBySimulation.config.baseVolatility,
      18,
    );
  });

  it('scales the quarterly dispersion by exactly the factor', () => {
    expect(
      dispersionLogSigma(scaledByArithmetic.evidence) / dispersionLogSigma(measured.evidence),
    ).toBeCloseTo(factor, 9);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses the factor %s', (bad) => {
    expect(() => rescaleCalibration(measured, bad)).toThrow(RangeError);
  });

  it('refuses a factor that pushes the base volatility out of range', () => {
    // This is the refusal that matters in registration: a dispersion budget a
    // personality cannot reach shows up here, as a factor that would leave the
    // asset outside the trait bounds rather than as a quietly clipped one.
    expect(() => rescaleCalibration(measured, 1e6)).toThrow(/volatility/);
    expect(() => rescaleCalibration(measured, 1e-6)).toThrow(/volatility/);
  });
});

describe('the measured tie-rate table is complete (CA9 a3-05)', () => {
  it('names every catalogue id, no other, with a rate inside (0, TARGET_TIE_RATE)', () => {
    // A constant deleted or zeroed for an asset the heavy suites do not sample
    // passed every cheap gate step; the table is a record of thirty
    // measurements and this holds it to the thirty.
    const ids = ASSET_CATALOGUE.map((asset) => asset.definition.id).sort();
    expect(Object.keys(MEASURED_LATTICE_TIE_RATES).sort()).toEqual(ids);
    for (const [id, rate] of Object.entries(MEASURED_LATTICE_TIE_RATES)) {
      expect(rate, id).toBeGreaterThan(0);
      expect(rate, id).toBeLessThan(TARGET_TIE_RATE);
    }
  });
});
