import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import { designEffect, minimumDetectableEffectUnderDependence } from './dependence.js';
import { minimumDetectableEffect } from './statistics.js';

const keyring = MasterKeyring.forTesting('dependence-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'dependence', purpose, keyEpoch: 0 });

/**
 * A design effect is only worth reporting if it can report the wrong answer.
 *
 * These are the two directions it has to get right: an independent series must
 * read near 1, and an overdispersed series must read above it. The overdispersed
 * control is constructed rather than borrowed, so its true design effect is known
 * in closed form and the estimator can be checked against a number rather than
 * against a vibe.
 */

/** `replicates` proportions from genuinely independent fair coins. */
function independentProportions(replicates: number, n: number, stream: RandomSource): number[] {
  const out: number[] = [];
  for (let r = 0; r < replicates; r += 1) {
    let successes = 0;
    for (let i = 0; i < n; i += 1) if (stream.nextBoolean()) successes += 1;
    out.push(successes / n);
  }
  return out;
}

/**
 * Proportions from a beta-binomial: each replicate draws its own rate.
 *
 * The true design effect is `1 + (n - 1) * rho` with
 * `rho = Var(p) / (p(1 - p))`, which is why this control is a number rather than
 * an impression. It is the same shape as the real defect: PH-10 found the lattice
 * tie rate overdispersed because each stretch of market has its own volatility
 * level and therefore its own tie rate.
 */
function clusteredProportions(
  replicates: number,
  n: number,
  rateSpread: number,
  stream: RandomSource,
): number[] {
  const out: number[] = [];
  for (let r = 0; r < replicates; r += 1) {
    // A two-point rate: mean 0.5, variance exactly rateSpread^2.
    const rate = stream.nextBoolean() ? 0.5 + rateSpread : 0.5 - rateSpread;
    let successes = 0;
    for (let i = 0; i < n; i += 1) if (stream.nextFloat64() < rate) successes += 1;
    out.push(successes / n);
  }
  return out;
}

describe('the design effect reads near 1 on independent trials', () => {
  it('does not manufacture dependence that is not there', () => {
    const result = designEffect(independentProportions(200, 2_000, derive('iid')), 2_000);
    expect(result.mean).toBeCloseTo(0.5, 2);
    // 200 replicates gives a 10% relative error on the ratio; 3 of those is the
    // band inside which "the error bar is honest" is the right reading.
    expect(result.relativeStandardError).toBeLessThan(0.11);
    expect(Math.abs(result.designEffect - 1)).toBeLessThan(3 * result.relativeStandardError);
  });

  it('leaves the effective sample size at the nominal one', () => {
    const result = designEffect(independentProportions(100, 1_000, derive('iid-effective')), 1_000);
    expect(result.effectiveSampleSize).toBeGreaterThan(0.7 * 100 * 1_000);
    expect(result.effectiveSampleSize).toBeLessThanOrEqual(100 * 1_000);
  });
});

describe('the design effect catches overdispersion', () => {
  // The teeth. Without this the estimator could return 1 unconditionally and
  // every test above would still pass.
  it('recovers the closed-form value for a known-overdispersed series', () => {
    const n = 2_000;
    const spread = 0.01;
    const rho = (spread * spread) / 0.25;
    const expected = 1 + (n - 1) * rho;
    const result = designEffect(clusteredProportions(200, n, spread, derive('clustered')), n);

    expect(expected).toBeGreaterThan(1.5);
    expect(result.designEffect).toBeGreaterThan(1.5);
    expect(result.designEffect / expected).toBeCloseTo(1, 0);
  });

  it('shrinks the effective sample size accordingly', () => {
    const n = 2_000;
    const result = designEffect(clusteredProportions(120, n, 0.015, derive('clustered-2')), n);
    expect(result.designEffect).toBeGreaterThan(2);
    expect(result.effectiveSampleSize).toBeLessThan(0.5 * 120 * n);
  });
});

describe('the floor a dependent sample actually achieves', () => {
  it('is coarser than the independent one, by the square root of the design effect', () => {
    const trials = 400_000;
    const independent = minimumDetectableEffect(trials);
    const dependent = minimumDetectableEffectUnderDependence(trials, 4);
    expect(dependent / independent).toBeCloseTo(2, 1);
  });

  it('never claims more sensitivity than independence would give', () => {
    // A measured design effect below 1 is sampling noise, not a discount.
    const trials = 100_000;
    expect(minimumDetectableEffectUnderDependence(trials, 0.8)).toBe(
      minimumDetectableEffect(trials),
    );
  });

  it('refuses a sample that carries no information', () => {
    expect(() => minimumDetectableEffectUnderDependence(10, 20)).toThrow(/carries no information/);
    expect(() => minimumDetectableEffectUnderDependence(100, 0)).toThrow(/finite and positive/);
  });
});

describe('the estimator refuses what it cannot measure', () => {
  it('needs replicates', () => {
    expect(() => designEffect([0.5, 0.5], 100)).toThrow(/at least 3 replicates/);
  });

  it('refuses a degenerate sample rather than dividing by zero', () => {
    expect(() => designEffect([0, 0, 0, 0], 100)).toThrow(/degenerate measurement/);
  });

  it('rejects a proportion outside [0, 1]', () => {
    expect(() => designEffect([0.5, 0.5, 1.5], 100)).toThrow(/must lie in \[0, 1\]/);
  });
});
