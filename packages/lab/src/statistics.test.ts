import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import {
  benjaminiHochberg,
  binomialProportionTest,
  minimumDetectableEffect,
  movingBlockBootstrap,
  normalCdf,
  normalQuantile,
  samplesForEffect,
  twoSidedPValue,
} from './statistics.js';

const stream = (purpose: string) =>
  MasterKeyring.forTesting('lab-statistics').derive({
    env: 'test',
    asset: 'stat',
    purpose,
    keyEpoch: 0,
  });

describe('normalCdf', () => {
  it.each([
    [0, 0.5],
    [1, 0.8413447460685429],
    [-1, 0.15865525393145707],
    [1.959963984540054, 0.975],
    [2.5, 0.9937903346742238],
    [3, 0.9986501019683699],
    [-3, 0.0013498980316300933],
  ])('is accurate at z=%f', (z, expected) => {
    expect(normalCdf(z)).toBeCloseTo(expected, 7);
  });

  it('is monotonic and bounded', () => {
    let previous = -1;
    for (let z = -8; z <= 8; z += 0.01) {
      const value = normalCdf(z);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it('is symmetric', () => {
    for (const z of [0.5, 1, 2, 3, 4]) {
      expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 7);
    }
  });
});

describe('normalQuantile', () => {
  it.each([
    [0.5, 0],
    [0.975, 1.959963984540054],
    [0.995, 2.5758293035489004],
    [0.8, 0.8416212335729143],
    [0.001, -3.090232306167813],
  ])('is accurate at p=%f', (p, expected) => {
    // Acklam's stated relative accuracy is 1.15e-9; assert that rather than a
    // decimal count, so the test states the guarantee the function actually
    // makes.
    const actual = normalQuantile(p);
    const scale = Math.max(1, Math.abs(expected));
    expect(Math.abs(actual - expected) / scale).toBeLessThan(2e-9);
  });

  it('is exactly zero at the median', () => {
    expect(normalQuantile(0.5)).toBe(0);
  });

  it('inverts normalCdf across the range', () => {
    // Bounded by normalCdf's own 1.2e-7 accuracy, not by the quantile's.
    let worst = 0;
    for (let z = -6; z <= 6; z += 0.013) {
      const p = normalCdf(z);
      if (p <= 0 || p >= 1) continue;
      worst = Math.max(worst, Math.abs(normalQuantile(p) - z));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('handles the degenerate probabilities', () => {
    expect(normalQuantile(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(normalQuantile(1)).toBe(Number.POSITIVE_INFINITY);
    expect(() => normalQuantile(-0.1)).toThrow(RangeError);
    expect(() => normalQuantile(1.1)).toThrow(RangeError);
  });
});

describe('binomialProportionTest', () => {
  it('recovers a known z-score', () => {
    // 5100 of 10000 against a fair coin: z = 0.01 / sqrt(0.25/10000) = 2.
    const result = binomialProportionTest(5100, 10_000);
    expect(result.proportion).toBe(0.51);
    expect(result.z).toBeCloseTo(2, 10);
    expect(result.pValue).toBeCloseTo(0.0455, 3);
  });

  it('reports no signal for an exactly fair sample', () => {
    const result = binomialProportionTest(500, 1_000);
    expect(result.z).toBe(0);
    expect(result.pValue).toBe(1);
  });

  it('scales the z-score with the square root of the sample', () => {
    const small = binomialProportionTest(5_100, 10_000);
    const large = binomialProportionTest(51_000, 100_000);
    expect(large.z / small.z).toBeCloseTo(Math.sqrt(10), 6);
  });

  it('handles an empty sample without dividing by zero', () => {
    const result = binomialProportionTest(0, 0);
    expect(result.z).toBe(0);
    expect(result.pValue).toBe(1);
  });

  it('rejects malformed input', () => {
    expect(() => binomialProportionTest(11, 10)).toThrow(RangeError);
    expect(() => binomialProportionTest(-1, 10)).toThrow(RangeError);
    expect(() => binomialProportionTest(1, 1.5)).toThrow(RangeError);
    expect(() => binomialProportionTest(1, 10, 0)).toThrow(RangeError);
  });

  it('agrees with twoSidedPValue', () => {
    const result = binomialProportionTest(5_200, 10_000);
    expect(result.pValue).toBe(twoSidedPValue(result.z));
  });
});

describe('benjaminiHochberg', () => {
  it('rejects nothing when every p-value is large', () => {
    const result = benjaminiHochberg([0.4, 0.6, 0.9, 0.75], 0.05);
    expect(result.rejected).toEqual([]);
    expect(result.threshold).toBeNull();
  });

  it('rejects the clear findings and keeps the borderline ones', () => {
    // With m=5 and q=0.05 the step-up thresholds are 0.01, 0.02, 0.03, 0.04, 0.05.
    const result = benjaminiHochberg([0.001, 0.008, 0.6, 0.7, 0.9], 0.05);
    expect(result.rejected).toEqual([0, 1]);
    expect(result.threshold).toBe(0.008);
  });

  it('is a step-up procedure, not a per-test comparison', () => {
    // 0.04 alone would fail its own rank threshold, but a smaller p-value at a
    // higher rank pulls it in. A naive per-test rule would miss it.
    const result = benjaminiHochberg([0.01, 0.02, 0.03, 0.04, 0.05], 0.2);
    expect(result.rejected).toEqual([0, 1, 2, 3, 4]);
  });

  it('is more permissive than Bonferroni, which is the point', () => {
    const pValues = [0.001, 0.002, 0.02, 0.5, 0.9];
    const bonferroniRejects = pValues.filter((p) => p <= 0.05 / pValues.length).length;
    const bh = benjaminiHochberg(pValues, 0.05);
    expect(bh.rejected.length).toBeGreaterThanOrEqual(bonferroniRejects);
    expect(bh.rejected).toEqual([0, 1, 2]);
  });

  it('handles an empty input', () => {
    expect(benjaminiHochberg([], 0.05)).toEqual({
      rejected: [],
      threshold: null,
      falseDiscoveryRate: 0.05,
      tested: 0,
    });
  });

  it('rejects malformed input', () => {
    expect(() => benjaminiHochberg([0.5], 0)).toThrow(RangeError);
    expect(() => benjaminiHochberg([0.5], 1.5)).toThrow(RangeError);
    expect(() => benjaminiHochberg([1.5], 0.05)).toThrow(RangeError);
    expect(() => benjaminiHochberg([-0.1], 0.05)).toThrow(RangeError);
  });

  it('reports indices in the original order', () => {
    const result = benjaminiHochberg([0.9, 0.0001, 0.5, 0.0002], 0.05);
    expect(result.rejected).toEqual([1, 3]);
  });
});

describe('minimumDetectableEffect', () => {
  it('matches the analytic formula', () => {
    const n = 1_000_000;
    const analytic = (normalQuantile(0.975) + normalQuantile(0.8)) * Math.sqrt(0.25 / n);
    expect(minimumDetectableEffect(n)).toBe(analytic);
    // Sanity: about 0.14 percentage points at a million samples.
    expect(minimumDetectableEffect(n) * 100).toBeCloseTo(0.14, 2);
  });

  it('scales as one over the square root of the sample', () => {
    const small = minimumDetectableEffect(10_000);
    const large = minimumDetectableEffect(1_000_000);
    expect(small / large).toBeCloseTo(10, 6);
  });

  it('round-trips with samplesForEffect', () => {
    for (const n of [10_000, 250_000, 4_000_000]) {
      const effect = minimumDetectableEffect(n);
      expect(samplesForEffect(effect)).toBeGreaterThan(n * 0.999);
      expect(samplesForEffect(effect)).toBeLessThan(n * 1.001 + 2);
    }
  });

  it('reproduces the published sample requirement for a 0.05pp edge', () => {
    // The figure that governs the project's simulation budget: certifying an
    // edge below 0.05 percentage points needs on the order of 10 million
    // independent samples.
    const samples = samplesForEffect(0.0005, 0.0027, 0.5);
    expect(samples).toBeGreaterThan(8_000_000);
    expect(samples).toBeLessThan(12_000_000);
  });

  it('rejects malformed input', () => {
    expect(() => minimumDetectableEffect(0)).toThrow(RangeError);
    expect(() => minimumDetectableEffect(100, 0)).toThrow(RangeError);
    expect(() => minimumDetectableEffect(100, 0.05, 1)).toThrow(RangeError);
    expect(() => samplesForEffect(0)).toThrow(RangeError);
    expect(() => samplesForEffect(0.6)).toThrow(RangeError);
  });
});

describe('movingBlockBootstrap', () => {
  function independent(n: number, purpose: string): Float64Array {
    const s = stream(purpose);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 1) out[i] = s.nextBoolean() ? 1 : 0;
    return out;
  }

  /** Strongly dependent: long runs of the same value. */
  function dependent(n: number, runLength: number, purpose: string): Float64Array {
    const s = stream(purpose);
    const out = new Float64Array(n);
    let value = 0;
    for (let i = 0; i < n; i += 1) {
      if (i % runLength === 0) value = s.nextBoolean() ? 1 : 0;
      out[i] = value;
    }
    return out;
  }

  it('recovers the mean of an independent sample', () => {
    const values = independent(20_000, 'boot-independent');
    const result = movingBlockBootstrap(values, 1, 400, stream('boot-r1'));
    expect(result.mean).toBeCloseTo(0.5, 1);
    expect(result.lower95).toBeLessThan(result.mean);
    expect(result.upper95).toBeGreaterThan(result.mean);
  });

  it('widens the interval for dependent data, which the i.i.d. formula does not', () => {
    // The reason this exists: an i.i.d. standard error on dependent samples is
    // too small, and too-small intervals manufacture significance.
    const values = dependent(20_000, 50, 'boot-dependent');
    const naive = Math.sqrt(0.25 / values.length);
    const blocked = movingBlockBootstrap(values, 200, 500, stream('boot-r2'));
    expect(blocked.standardError).toBeGreaterThan(naive * 3);
  });

  it('is reproducible from the stream', () => {
    const values = independent(5_000, 'boot-repro');
    const a = movingBlockBootstrap(values, 20, 200, stream('boot-r3'));
    const b = movingBlockBootstrap(values, 20, 200, stream('boot-r3'));
    expect(a).toEqual(b);
  });

  it('rejects malformed input', () => {
    const values = independent(100, 'boot-bad');
    expect(() => movingBlockBootstrap(new Float64Array(0), 1, 10, stream('x'))).toThrow(RangeError);
    expect(() => movingBlockBootstrap(values, 0, 10, stream('x'))).toThrow(RangeError);
    expect(() => movingBlockBootstrap(values, 101, 10, stream('x'))).toThrow(RangeError);
    expect(() => movingBlockBootstrap(values, 10, 0, stream('x'))).toThrow(RangeError);
  });
});
