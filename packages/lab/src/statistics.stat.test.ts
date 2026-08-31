import { describe, expect, it } from 'vitest';
import { MasterKeyring, standardNormal, type RandomStream } from '@otc/core';
import { benjaminiHochberg, minimumDetectableEffect, twoSidedPValue } from './statistics.js';

/**
 * Empirical behaviour of the multiple-testing control.
 *
 * The battery conditions on hundreds of bins. Without correction it would find
 * "leaks" in a perfectly fair market on most runs, and the project would learn
 * to ignore its own gate. These tests measure that the correction does what it
 * claims rather than assuming it.
 */

const keyring = MasterKeyring.forTesting('lab-fdr');
const stream = (purpose: string): RandomStream =>
  keyring.derive({ env: 'simulation', asset: 'fdr', purpose, keyEpoch: 0 });

const Q = 0.05;
const FAMILIES = 4_000;
const HYPOTHESES = 200;

describe('Benjamini–Hochberg under the global null', () => {
  it('rejects something in about q of families when every hypothesis is true', () => {
    // With all nulls true, FDR control coincides with family-wise error control,
    // so the rate of families with any rejection should sit near q.
    const s = stream('global-null');
    let familiesWithRejection = 0;
    for (let f = 0; f < FAMILIES; f += 1) {
      const pValues = Array.from({ length: HYPOTHESES }, () => s.nextFloat64());
      if (benjaminiHochberg(pValues, Q).rejected.length > 0) familiesWithRejection += 1;
    }
    const rate = familiesWithRejection / FAMILIES;
    console.info(
      `BH global-null rejection rate: ${(rate * 100).toFixed(2)}% (nominal ${Q * 100}%)`,
    );
    expect(rate).toBeLessThan(Q * 1.5);
    expect(rate).toBeGreaterThan(Q * 0.4);
  });

  it('is far stricter than an uncorrected worst-bin rule', () => {
    // The comparison that justifies the machinery: an uncorrected rule fires on
    // essentially every family, which is what a naive battery would do.
    const s = stream('uncorrected');
    let uncorrected = 0;
    for (let f = 0; f < 500; f += 1) {
      const pValues = Array.from({ length: HYPOTHESES }, () => s.nextFloat64());
      if (pValues.some((p) => p < Q)) uncorrected += 1;
    }
    expect(uncorrected / 500).toBeGreaterThan(0.99);
  });
});

describe('Benjamini–Hochberg with real effects present', () => {
  it('controls the false discovery proportion and still finds the effects', () => {
    const s = stream('mixed');
    const trueEffects = 20;
    let totalRejected = 0;
    let falseRejected = 0;
    let trueRejected = 0;

    for (let f = 0; f < 500; f += 1) {
      const pValues: number[] = [];
      for (let i = 0; i < HYPOTHESES; i += 1) {
        if (i < trueEffects) {
          // A genuine effect at roughly 4 sigma.
          pValues.push(twoSidedPValue(4 + standardNormal(s)));
        } else {
          pValues.push(s.nextFloat64());
        }
      }
      for (const index of benjaminiHochberg(pValues, Q).rejected) {
        totalRejected += 1;
        if (index < trueEffects) trueRejected += 1;
        else falseRejected += 1;
      }
    }

    const falseDiscoveryProportion = falseRejected / Math.max(1, totalRejected);
    const power = trueRejected / (trueEffects * 500);
    console.info(
      `BH with effects: FDP=${(falseDiscoveryProportion * 100).toFixed(2)}% (nominal ${Q * 100}%), ` +
        `power=${(power * 100).toFixed(1)}%`,
    );
    expect(falseDiscoveryProportion).toBeLessThan(Q * 1.3);
    // Effects are drawn at 4 +/- 1 sigma, so a minority land near 2 sigma
    // (two-sided p about 0.045) and legitimately fall outside the step-up
    // threshold of 20/200 * 0.05 = 0.005. Around 88% is the correct behaviour;
    // demanding more would be demanding that the procedure over-reject.
    expect(power).toBeGreaterThan(0.8);
  });
});

describe('minimum detectable effect is achieved in practice', () => {
  it('detects an effect at its stated size about as often as the power says', () => {
    const trials = 40_000;
    const effect = minimumDetectableEffect(trials, 0.05, 0.8);
    const s = stream('mde');
    let detected = 0;
    const runs = 600;
    for (let r = 0; r < runs; r += 1) {
      let successes = 0;
      for (let i = 0; i < trials; i += 1) {
        if (s.nextFloat64() < 0.5 + effect) successes += 1;
      }
      const z = (successes / trials - 0.5) / Math.sqrt(0.25 / trials);
      if (twoSidedPValue(z) < 0.05) detected += 1;
    }
    const observedPower = detected / runs;
    console.info(
      `MDE at n=${trials}: effect ${(effect * 100).toFixed(3)}pp, ` +
        `observed power ${(observedPower * 100).toFixed(1)}% (nominal 80%)`,
    );
    expect(observedPower).toBeGreaterThan(0.72);
    expect(observedPower).toBeLessThan(0.88);
  });
});
