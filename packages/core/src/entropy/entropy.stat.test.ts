import { describe, expect, it } from 'vitest';
import { MasterKeyring } from './keyring.js';
import type { StreamLabel } from './label.js';
import type { RandomStream } from './stream.js';

/**
 * Statistical evidence for the entropy layer.
 *
 * Every test here is deterministically seeded. That is deliberate: a randomly
 * failing entropy test is indistinguishable from a real entropy defect, and this
 * project cannot afford a gate it learns to ignore. Thresholds are published
 * critical values, not values tuned to the observed output, so a genuine
 * regression fails and a healthy generator passes every time.
 */

const keyring = MasterKeyring.forTesting('statistical');

function streamFor(purpose: string, asset = 'eurusd-otc'): RandomStream {
  const label: StreamLabel = { env: 'simulation', asset, purpose, keyEpoch: 0 };
  return keyring.derive(label);
}

/** Pearson chi-square against a uniform expectation. */
function chiSquareUniform(counts: Int32Array | number[], total: number): number {
  const bins = counts.length;
  const expected = total / bins;
  let chi = 0;
  for (let i = 0; i < bins; i += 1) {
    const d = (counts as number[])[i]! - expected;
    chi += (d * d) / expected;
  }
  return chi;
}

/**
 * Two-sided critical values for chi-square, normal approximation.
 * df is large in every use here, so the approximation is sound.
 */
function chiSquareBounds(df: number, sigma = 4): { lower: number; upper: number } {
  const sd = Math.sqrt(2 * df);
  return { lower: df - sigma * sd, upper: df + sigma * sd };
}

function pearson(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    num += da * db;
    va += da * da;
    vb += db * db;
  }
  return num / Math.sqrt(va * vb);
}

const N = 4_000_000;

describe('nextFloat64 — distribution', () => {
  it('is uniform on [0,1) across 1024 bins', () => {
    const bins = 1024;
    const counts = new Int32Array(bins);
    const s = streamFor('uniformity');
    for (let i = 0; i < N; i += 1) {
      counts[Math.floor(s.nextFloat64() * bins)]! += 1;
    }
    const chi = chiSquareUniform(counts, N);
    const { lower, upper } = chiSquareBounds(bins - 1);
    expect(chi).toBeGreaterThan(lower);
    expect(chi).toBeLessThan(upper);
  });

  it('has no serial correlation at lags 1, 2, 3, 7 and 64', () => {
    const s = streamFor('serial');
    const values = new Float64Array(N);
    for (let i = 0; i < N; i += 1) values[i] = s.nextFloat64();

    for (const lag of [1, 2, 3, 7, 64]) {
      const a = values.subarray(0, N - lag);
      const b = values.subarray(lag, N);
      const r = pearson(a, b);
      // Standard error of r is 1/sqrt(n); 5 sigma at n = 4e6 is 0.0025.
      expect(Math.abs(r), `lag ${lag}: r=${r}`).toBeLessThan(0.0025);
    }
  });

  it('produces the full 53-bit resolution rather than a coarse grid', () => {
    const s = streamFor('resolution');
    const seen = new Set<number>();
    for (let i = 0; i < 200_000; i += 1) seen.add(s.nextFloat64());
    // A generator emitting only k distinct values would collapse this set.
    expect(seen.size).toBe(200_000);
  });
});

describe('nextUint32 — bit-level behaviour', () => {
  it('has each of the 32 bit positions balanced', () => {
    const s = streamFor('bits');
    const ones = new Int32Array(32);
    const trials = 2_000_000;
    for (let i = 0; i < trials; i += 1) {
      const v = s.nextUint32();
      for (let b = 0; b < 32; b += 1) {
        ones[b]! += (v >>> b) & 1;
      }
    }
    const sd = Math.sqrt(trials * 0.25);
    for (let b = 0; b < 32; b += 1) {
      const z = (ones[b]! - trials / 2) / sd;
      expect(Math.abs(z), `bit ${b}: z=${z.toFixed(2)}`).toBeLessThan(5);
    }
  });

  it('has no pairwise dependence between bit positions', () => {
    const s = streamFor('bitpairs');
    const trials = 1_000_000;
    // Count agreements between every pair of bit positions.
    const agree = new Int32Array(32 * 32);
    for (let i = 0; i < trials; i += 1) {
      const v = s.nextUint32();
      for (let a = 0; a < 32; a += 1) {
        const ba = (v >>> a) & 1;
        for (let b = a + 1; b < 32; b += 1) {
          agree[a * 32 + b]! += ba === ((v >>> b) & 1) ? 1 : 0;
        }
      }
    }
    const sd = Math.sqrt(trials * 0.25);
    let worst = 0;
    for (let a = 0; a < 32; a += 1) {
      for (let b = a + 1; b < 32; b += 1) {
        const z = Math.abs(agree[a * 32 + b]! - trials / 2) / sd;
        if (z > worst) worst = z;
      }
    }
    // 496 pairs tested, so the threshold accounts for multiple comparisons.
    expect(worst, `worst pair z=${worst.toFixed(2)}`).toBeLessThan(5);
  });

  it('passes a monobit test over the raw byte stream', () => {
    const s = streamFor('monobit');
    const bytes = s.nextBytes(1_000_000);
    let ones = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      let v = bytes[i]!;
      while (v) {
        ones += v & 1;
        v >>>= 1;
      }
    }
    const n = bytes.length * 8;
    const z = (ones - n / 2) / (Math.sqrt(n) / 2);
    expect(Math.abs(z), `monobit z=${z.toFixed(3)}`).toBeLessThan(5);
  });

  it('passes a runs test over the raw bit stream', () => {
    const s = streamFor('runs');
    const bytes = s.nextBytes(500_000);
    const n = bytes.length * 8;
    let ones = 0;
    let runs = 1;
    let previous = -1;
    for (let i = 0; i < bytes.length; i += 1) {
      const v = bytes[i]!;
      for (let b = 7; b >= 0; b -= 1) {
        const bit = (v >>> b) & 1;
        ones += bit;
        if (previous !== -1 && bit !== previous) runs += 1;
        previous = bit;
      }
    }
    const pi = ones / n;
    const expected = 2 * n * pi * (1 - pi);
    const sd = 2 * Math.sqrt(n) * pi * (1 - pi);
    const z = (runs - expected) / sd;
    expect(Math.abs(z), `runs z=${z.toFixed(3)}`).toBeLessThan(5);
  });
});

describe('nextBoundedUint32 — freedom from modulo bias', () => {
  // Bounds that do not divide 2^32 are exactly where naive `% bound` fails.
  it.each([3, 7, 10, 100, 1000, 3_000_000_000])('is uniform for bound %i', (bound) => {
    const bins = Math.min(bound, 1000);
    const counts = new Int32Array(bins);
    const s = streamFor(`bounded-${bound}`);
    const trials = 2_000_000;
    // Bin with exact integer arithmetic. The obvious `v / bound * bins` form
    // round-trips wrong in floating point (29 / 100 * 100 = 28.999...), which
    // would fabricate a bias that the generator does not have.
    for (let i = 0; i < trials; i += 1) {
      const v = s.nextBoundedUint32(bound);
      const bin = bins === bound ? v : Math.floor((v * bins) / bound);
      counts[bin]! += 1;
    }
    const chi = chiSquareUniform(counts, trials);
    const { lower, upper } = chiSquareBounds(bins - 1);
    expect(chi, `bound ${bound}: chi2=${chi.toFixed(1)}`).toBeGreaterThan(lower);
    expect(chi, `bound ${bound}: chi2=${chi.toFixed(1)}`).toBeLessThan(upper);
  });
});

describe('stream isolation — statistical independence', () => {
  it('shows no correlation between streams differing only in purpose', () => {
    const a = streamFor('iso-a');
    const b = streamFor('iso-b');
    const n = 2_000_000;
    const va = new Float64Array(n);
    const vb = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      va[i] = a.nextFloat64();
      vb[i] = b.nextFloat64();
    }
    const r = pearson(va, vb);
    expect(Math.abs(r), `r=${r}`).toBeLessThan(0.0035);
  });

  it('shows no correlation between streams differing only in asset', () => {
    const a = streamFor('magnitude', 'eurusd-otc');
    const b = streamFor('magnitude', 'gbpusd-otc');
    const n = 2_000_000;
    const va = new Float64Array(n);
    const vb = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      va[i] = a.nextFloat64();
      vb[i] = b.nextFloat64();
    }
    expect(Math.abs(pearson(va, vb))).toBeLessThan(0.0035);
  });

  it('collides across streams only as often as independence predicts', () => {
    const a = streamFor('collide-a');
    const b = streamFor('collide-b');
    const n = 500_000;
    const seen = new Set<number>();
    for (let i = 0; i < n; i += 1) seen.add(a.nextUint32());
    let collisions = 0;
    for (let i = 0; i < n; i += 1) if (seen.has(b.nextUint32())) collisions += 1;
    // Expectation is n^2 / 2^32 = 58.2; Poisson tail well below 120.
    expect(collisions).toBeLessThan(120);
    expect(collisions).toBeGreaterThan(15);
  });
});

describe('throughput', () => {
  it('sustains a rate far above what continuous multi-asset generation needs', () => {
    const s = streamFor('throughput');
    for (let i = 0; i < 200_000; i += 1) s.nextFloat64(); // warm up

    const trials = 5_000_000;
    const start = process.hrtime.bigint();
    let sink = 0;
    for (let i = 0; i < trials; i += 1) sink += s.nextFloat64();
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const perSecond = trials / seconds;

    console.info(
      `entropy throughput: ${(perSecond / 1e6).toFixed(2)}M nextFloat64/s ` +
        `(${seconds.toFixed(3)}s for ${trials.toLocaleString()} draws)`,
    );
    expect(sink).toBeGreaterThan(0);
    // Generous floor: catches a catastrophic regression without failing on a
    // slow or contended CI runner. Measured locally at ~26M/s.
    expect(perSecond).toBeGreaterThan(2_000_000);
  });
});
