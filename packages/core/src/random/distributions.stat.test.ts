import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '../entropy/keyring.js';
import type { RandomStream } from '../entropy/stream.js';
import {
  bernoulli,
  categorical,
  chiSquared,
  exponential,
  gamma,
  normal,
  standardNormal,
  studentT,
  uniform,
} from './distributions.js';

/**
 * Distributional evidence. Deterministically seeded, with published critical
 * values rather than thresholds fitted to the observed output.
 */

const keyring = MasterKeyring.forTesting('distribution-statistics');
const streamFor = (purpose: string): RandomStream =>
  keyring.derive({ env: 'simulation', asset: 'stat', purpose, keyEpoch: 0 });

interface Moments {
  n: number;
  mean: number;
  variance: number;
  skewness: number;
  excessKurtosis: number;
}

function moments(values: Float64Array): Moments {
  const n = values.length;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += values[i]!;
  mean /= n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i += 1) {
    const d = values[i]! - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const sd = Math.sqrt(m2);
  return {
    n,
    mean,
    variance: m2,
    skewness: m3 / (sd * sd * sd),
    excessKurtosis: m4 / (m2 * m2) - 3,
  };
}

function sample(draw: () => number, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = draw();
  return out;
}

/** Standard normal CDF, via a high-accuracy complementary error function. */
function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const tau =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  const erfc = x >= 0 ? tau : 2 - tau;
  return 1 - 0.5 * erfc;
}

/** Kolmogorov–Smirnov statistic against a continuous CDF. */
function ksStatistic(values: Float64Array, cdf: (x: number) => number): number {
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  let d = 0;
  for (let i = 0; i < n; i += 1) {
    const f = cdf(sorted[i]!);
    d = Math.max(d, Math.abs(f - i / n), Math.abs((i + 1) / n - f));
  }
  return d;
}

/** Critical value at alpha = 0.001 for large n. */
const ksCritical = (n: number): number => 1.95 / Math.sqrt(n);

const N = 1_000_000;

describe('standardNormal', () => {
  const values = (() => {
    const s = streamFor('normal');
    return sample(() => standardNormal(s), N);
  })();

  it('matches the first four moments', () => {
    const m = moments(values);
    // Standard errors at n = 1e6: mean 1e-3, variance 1.4e-3, skew 2.4e-3, kurtosis 4.9e-3.
    expect(Math.abs(m.mean), `mean ${m.mean}`).toBeLessThan(0.005);
    expect(Math.abs(m.variance - 1), `variance ${m.variance}`).toBeLessThan(0.007);
    expect(Math.abs(m.skewness), `skewness ${m.skewness}`).toBeLessThan(0.012);
    expect(Math.abs(m.excessKurtosis), `kurtosis ${m.excessKurtosis}`).toBeLessThan(0.025);
  });

  it('passes a Kolmogorov–Smirnov test against the normal CDF', () => {
    const d = ksStatistic(values, normalCdf);
    expect(d, `KS D=${d.toExponential(3)} critical=${ksCritical(N).toExponential(3)}`).toBeLessThan(
      ksCritical(N),
    );
  });

  it('reproduces the tail probabilities', () => {
    // The tails are what matter for a market model, and the polar method's
    // rejection step is exactly where a tail defect would hide.
    const cases: [number, number][] = [
      [1, 0.15865525393145707],
      [1.96, 0.024997895148220435],
      [2.5, 0.006209665325776132],
      [3, 0.0013498980316300933],
      [4, 0.00003167124183311998],
    ];
    for (const [threshold, expected] of cases) {
      let count = 0;
      for (let i = 0; i < N; i += 1) if (values[i]! > threshold) count += 1;
      const observed = count / N;
      const se = Math.sqrt((expected * (1 - expected)) / N);
      const z = (observed - expected) / se;
      expect(Math.abs(z), `P(Z>${threshold}) observed ${observed}, z=${z.toFixed(2)}`).toBeLessThan(
        5,
      );
    }
  });

  it('is symmetric', () => {
    let positive = 0;
    for (let i = 0; i < N; i += 1) if (values[i]! > 0) positive += 1;
    const z = (positive - N / 2) / Math.sqrt(N * 0.25);
    expect(Math.abs(z), `sign balance z=${z.toFixed(2)}`).toBeLessThan(5);
  });
});

describe('normal with parameters', () => {
  it('matches its mean and standard deviation', () => {
    const s = streamFor('normal-scaled');
    const m = moments(sample(() => normal(s, -3.5, 2.25), N));
    expect(Math.abs(m.mean + 3.5)).toBeLessThan(0.02);
    expect(Math.abs(Math.sqrt(m.variance) - 2.25)).toBeLessThan(0.02);
  });
});

describe('uniform', () => {
  it('matches its mean and variance', () => {
    const s = streamFor('uniform');
    const m = moments(sample(() => uniform(s, -2, 5), N));
    expect(Math.abs(m.mean - 1.5)).toBeLessThan(0.02);
    expect(Math.abs(m.variance - 49 / 12)).toBeLessThan(0.03);
  });
});

describe('exponential', () => {
  it('matches mean and variance for several rates', () => {
    for (const rate of [0.5, 1, 7]) {
      const s = streamFor(`exponential-${rate}`);
      const m = moments(sample(() => exponential(s, rate), N));
      expect(Math.abs(m.mean - 1 / rate) * rate, `rate ${rate} mean`).toBeLessThan(0.01);
      expect(
        Math.abs(m.variance - 1 / (rate * rate)) * rate * rate,
        `rate ${rate} var`,
      ).toBeLessThan(0.02);
    }
  });

  it('is memoryless', () => {
    // P(X > s + t | X > s) = P(X > t) is the defining property; a defective
    // inverse-CDF implementation breaks it while keeping the mean correct.
    const s = streamFor('exponential-memoryless');
    const values = sample(() => exponential(s, 1), N);
    let beyondOne = 0;
    let beyondTwo = 0;
    for (let i = 0; i < N; i += 1) {
      if (values[i]! > 1) {
        beyondOne += 1;
        if (values[i]! > 2) beyondTwo += 1;
      }
    }
    const conditional = beyondTwo / beyondOne;
    expect(Math.abs(conditional - Math.exp(-1))).toBeLessThan(0.005);
  });
});

describe('gamma', () => {
  it.each([
    [0.3, 2],
    [1, 1],
    [2.5, 1.5],
    [10, 0.5],
  ])('matches mean and variance for shape %f, scale %f', (shape, scale) => {
    const s = streamFor(`gamma-${shape}-${scale}`);
    const n = 500_000;
    const m = moments(sample(() => gamma(s, shape, scale), n));
    const expectedMean = shape * scale;
    const expectedVariance = shape * scale * scale;
    // Relative tolerance sized by the sampling error of each statistic.
    expect(Math.abs(m.mean - expectedMean) / expectedMean, `mean ${m.mean}`).toBeLessThan(0.01);
    expect(
      Math.abs(m.variance - expectedVariance) / expectedVariance,
      `variance ${m.variance}`,
    ).toBeLessThan(0.03);
  });
});

describe('chiSquared', () => {
  it.each([1, 3, 10])('matches mean and variance for %i degrees of freedom', (df) => {
    const s = streamFor(`chi2-${df}`);
    const n = 500_000;
    const m = moments(sample(() => chiSquared(s, df), n));
    expect(Math.abs(m.mean - df) / df).toBeLessThan(0.01);
    expect(Math.abs(m.variance - 2 * df) / (2 * df)).toBeLessThan(0.04);
  });
});

describe('studentT', () => {
  it('has the right variance where it exists', () => {
    for (const df of [5, 10, 30]) {
      const s = streamFor(`t-${df}`);
      const n = 500_000;
      const m = moments(sample(() => studentT(s, df), n));
      const expectedVariance = df / (df - 2);
      expect(Math.abs(m.mean), `df ${df} mean`).toBeLessThan(0.02);
      expect(
        Math.abs(m.variance - expectedVariance) / expectedVariance,
        `df ${df} variance ${m.variance}`,
      ).toBeLessThan(0.05);
    }
  });

  it('is heavier-tailed than the normal, increasingly so as df falls', () => {
    const tailMass = (df: number): number => {
      const s = streamFor(`t-tail-${df}`);
      const n = 400_000;
      let beyond = 0;
      for (let i = 0; i < n; i += 1) if (Math.abs(studentT(s, df)) > 3) beyond += 1;
      return beyond / n;
    };
    const normalTail = 0.0026997960632601866; // P(|Z| > 3)
    const t30 = tailMass(30);
    const t10 = tailMass(10);
    const t4 = tailMass(4);
    expect(t30).toBeGreaterThan(normalTail);
    expect(t10).toBeGreaterThan(t30);
    expect(t4).toBeGreaterThan(t10);
    // This is the property the market model needs: genuinely fat tails, not
    // merely large Gaussian draws.
    expect(t4 / normalTail).toBeGreaterThan(5);
  });
});

describe('bernoulli and categorical', () => {
  it('bernoulli reproduces its probability', () => {
    for (const p of [0.01, 0.25, 0.5, 0.9]) {
      const s = streamFor(`bernoulli-${p}`);
      let hits = 0;
      for (let i = 0; i < N; i += 1) if (bernoulli(s, p)) hits += 1;
      const observed = hits / N;
      const se = Math.sqrt((p * (1 - p)) / N);
      expect(Math.abs(observed - p) / se, `p=${p} observed=${observed}`).toBeLessThan(5);
    }
  });

  it('categorical reproduces its weight vector', () => {
    const weights = [1, 3, 0.5, 7, 2];
    const total = weights.reduce((a, b) => a + b, 0);
    const s = streamFor('categorical');
    const counts = new Int32Array(weights.length);
    for (let i = 0; i < N; i += 1) counts[categorical(s, weights)]! += 1;
    let chi = 0;
    for (let i = 0; i < weights.length; i += 1) {
      const expected = (N * weights[i]!) / total;
      const d = counts[i]! - expected;
      chi += (d * d) / expected;
    }
    // 4 degrees of freedom, upper 0.999 critical value 18.47.
    expect(chi, `chi2=${chi.toFixed(2)}`).toBeLessThan(18.47);
  });
});

describe('throughput', () => {
  it('measures sampler cost', () => {
    const s = streamFor('throughput');
    for (let i = 0; i < 100_000; i += 1) standardNormal(s);
    const trials = 2_000_000;
    const start = process.hrtime.bigint();
    let sink = 0;
    for (let i = 0; i < trials; i += 1) sink += standardNormal(s);
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    console.info(
      `standardNormal throughput: ${(trials / seconds / 1e6).toFixed(2)}M/s ` +
        `(${seconds.toFixed(3)}s for ${trials.toLocaleString()})`,
    );
    expect(Number.isFinite(sink)).toBe(true);
    expect(trials / seconds).toBeGreaterThan(300_000);
  });
});
