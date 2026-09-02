// Note: this does NOT tag INV-007. PH-4.1 builds the personality model; the
// evidence that assets are genuinely differentiated is PH-4.3, and traceability.test.ts
// rejects a claim of evidence for an invariant the map still records as pending.
import { beforeAll, describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type InstrumentSpec, type RandomSource } from '@otc/core';
import { yieldToLoop } from '@otc/core';
import { CascadeMagnitudeModel } from './cascade.js';
import { DurationCouplingModulator } from './hawkes.js';
import { ModulatedMagnitudeModel } from './modulator.js';
import { VolatilityRegimeModulator } from './regime.js';
import { StructurePhaseModulator } from './structure.js';
import {
  DEFAULT_TRAITS,
  expandPersonality,
  predictedExcessKurtosis,
  type PersonalityTraits,
} from './personality.js';

const instrument: InstrumentSpec = {
  id: 'personality-stat',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const keyring = MasterKeyring.forTesting('personality-stat');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'personality', purpose, keyEpoch: 0 });

/**
 * Measured excess kurtosis of the increment distribution.
 *
 * Increments are `sign × magnitude` with an independent fair sign, so the
 * kurtosis of the increment is exactly `E[m⁴]/E[m²]²` — the sign contributes
 * nothing to an even moment. Measuring magnitudes alone is therefore not an
 * approximation, and it avoids generating a price path entirely.
 */
async function measuredExcessKurtosis(
  traits: PersonalityTraits,
  steps: number,
  seed: string,
): Promise<number> {
  const config = expandPersonality(traits, instrument);
  const seeded = MasterKeyring.forTesting(seed);
  const derive = (purpose: string): RandomSource =>
    seeded.derive({ env: 'test', asset: 'personality', purpose, keyEpoch: 0 });
  const model = new ModulatedMagnitudeModel(
    new CascadeMagnitudeModel(
      config.baseVolatility,
      config.cascade,
      derive('cascade'),
      derive('shock'),
    ),
    [
      new VolatilityRegimeModulator(config.regimes, derive('regime')),
      new StructurePhaseModulator(config.structure, derive('structure')),
      new DurationCouplingModulator(config.durationCoupling, config.arrival.baseIntervalMs),
    ],
  );

  const intervalMs = 1_000;
  let instant = 1_776_000_000_000;
  let previousMagnitude = 10;
  let second = 0;
  let fourth = 0;
  for (let step = 0; step < steps; step += 1) {
    instant += intervalMs;
    const magnitude = model.advance({
      intervalMs,
      previousMagnitude,
      instant: epochMillis(instant),
      sequence: step,
    });
    previousMagnitude = magnitude / instrument.logQuantum;
    const squared = magnitude * magnitude;
    second += squared;
    fourth += squared * squared;

    // Yield periodically, matching `buildObserverDataset`. A million-iteration
    // synchronous block starves the test runner's progress channel, which
    // surfaces as an unrelated-looking worker RPC timeout at the end of the run.
    if (step % 250_000 === 0) await yieldToLoop();
  }
  const e2 = second / steps;
  const e4 = fourth / steps;
  return e4 / (e2 * e2) - 3;
}

const SEEDS = ['s1', 's2', 's3', 's4', 's5', 's6'] as const;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

describe('the analytic gate predicts what the layers actually do', () => {
  const predicted = predictedExcessKurtosis(
    expandPersonality(DEFAULT_TRAITS, instrument),
    derive('gate'),
  );
  let measured: number[] = [];

  beforeAll(async () => {
    measured = [];
    for (const seed of SEEDS) {
      measured.push(await measuredExcessKurtosis(DEFAULT_TRAITS, 1_000_000, seed));
    }
  }, 900_000);

  it('matches the median realisation closely', () => {
    // The median, not the mean. See the next test for why: one realisation in
    // six lands far enough out to drag a mean by 60%.
    const ratio = predicted / median(measured);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.5);
  });

  it('is far more stable than any single measurement of the same thing', () => {
    // This is the finding the design rests on, executed rather than asserted.
    // Six independent seeds, one million magnitudes each, identical
    // configuration. The measured fourth moment is dominated by a handful of
    // extreme draws, so it swings widely between realisations; a separate probe
    // during PH-4.1 saw one seed read 370 against another's 37, either side of
    // the realism ceiling of 200, on the same market.
    //
    // The prediction moves too, but only by the few percent its simulated
    // structure term contributes. The assertion is the contrast, not either
    // absolute spread, because the spread of a heavy-tailed estimator is itself
    // a heavy-tailed quantity — fixing a threshold on it would be the same
    // mistake one level up.
    const predictions = SEEDS.map((seed) =>
      predictedExcessKurtosis(
        expandPersonality(DEFAULT_TRAITS, instrument),
        MasterKeyring.forTesting(seed).derive({
          env: 'test',
          asset: 'personality',
          purpose: 'gate',
          keyEpoch: 0,
        }),
      ),
    );
    const spread = (values: readonly number[]): number => Math.max(...values) / Math.min(...values);

    const measuredSpread = spread(measured);
    const predictedSpread = spread(predictions);

    expect(
      predictedSpread,
      `predictions: ${predictions.map((v) => v.toFixed(1)).join(', ')}`,
    ).toBeLessThan(1.2);
    expect(
      measuredSpread,
      `measured: ${measured.map((v) => v.toFixed(1)).join(', ')}`,
    ).toBeGreaterThan(1.5);
    expect(measuredSpread).toBeGreaterThan(predictedSpread * 1.5);
  });

  it('tracks a change in clustering, in both prediction and measurement', async () => {
    const calm: PersonalityTraits = { ...DEFAULT_TRAITS, clustering: 0.12 };
    const wild: PersonalityTraits = { ...DEFAULT_TRAITS, clustering: 0.3 };

    const calmValues: number[] = [];
    const wildValues: number[] = [];
    for (const seed of SEEDS) {
      calmValues.push(await measuredExcessKurtosis(calm, 400_000, seed));
      wildValues.push(await measuredExcessKurtosis(wild, 400_000, seed));
    }
    const calmMeasured = median(calmValues);
    const wildMeasured = median(wildValues);
    expect(wildMeasured).toBeGreaterThan(calmMeasured);

    const calmPredicted = predictedExcessKurtosis(expandPersonality(calm, instrument), derive('g'));
    const wildPredicted = predictedExcessKurtosis(expandPersonality(wild, instrument), derive('g'));
    expect(wildPredicted).toBeGreaterThan(calmPredicted);
  });
});
