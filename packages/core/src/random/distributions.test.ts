import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '../entropy/keyring.js';
import type { StreamLabel } from '../entropy/label.js';
import type { RandomStream } from '../entropy/stream.js';
import {
  bernoulli,
  categorical,
  chiSquared,
  exponential,
  gamma,
  logNormal,
  normal,
  standardNormal,
  studentT,
  uniform,
  uniformSymmetric,
} from './distributions.js';

const keyring = MasterKeyring.forTesting('distributions');
const label: StreamLabel = { env: 'test', asset: 'eurusd-otc', purpose: 'magnitude', keyEpoch: 0 };
const stream = (): RandomStream => keyring.derive(label);

/** Every sampler, as a nullary call against a stream. */
const SAMPLERS: [string, (s: RandomStream) => number][] = [
  ['uniform', (s) => uniform(s, -2, 5)],
  ['uniformSymmetric', (s) => uniformSymmetric(s)],
  ['bernoulli', (s) => (bernoulli(s, 0.3) ? 1 : 0)],
  ['categorical', (s) => categorical(s, [1, 2, 3])],
  ['standardNormal', (s) => standardNormal(s)],
  ['normal', (s) => normal(s, 10, 2)],
  ['exponential', (s) => exponential(s, 3)],
  ['gamma(shape>1)', (s) => gamma(s, 2.5, 1.5)],
  ['gamma(shape<1)', (s) => gamma(s, 0.4, 2)],
  ['chiSquared', (s) => chiSquared(s, 5)],
  ['studentT', (s) => studentT(s, 4)],
  ['logNormal', (s) => logNormal(s, 0, 0.5)],
];

describe('samplers are reproducible', () => {
  it.each(SAMPLERS)('%s gives identical output from an identical stream', (_name, sample) => {
    const a = stream();
    const b = stream();
    expect(Array.from({ length: 200 }, () => sample(a))).toEqual(
      Array.from({ length: 200 }, () => sample(b)),
    );
  });
});

describe('samplers are stateless', () => {
  // A sampler that cached a spare variate would pass the reproducibility test
  // above and fail this one, because the cache is not part of position().
  it.each(SAMPLERS)('%s continues identically from a recorded cursor', (_name, sample) => {
    const reference = stream();
    const expected = Array.from({ length: 100 }, () => sample(reference));

    const interrupted = stream();
    for (let i = 0; i < 40; i += 1) sample(interrupted);
    const cursor = interrupted.position();

    const resumed = keyring.derive(label, cursor);
    expect(Array.from({ length: 60 }, () => sample(resumed))).toEqual(expected.slice(40));
  });
});

describe('uniform', () => {
  it('stays within its bounds', () => {
    const s = stream();
    let out = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const v = uniform(s, -2, 5);
      if (!(v >= -2 && v < 5)) out += 1;
    }
    expect(out).toBe(0);
  });

  it('handles a degenerate range', () => {
    expect(uniform(stream(), 3, 3)).toBe(3);
  });

  it('rejects invalid bounds', () => {
    const s = stream();
    expect(() => uniform(s, 5, 1)).toThrow(RangeError);
    expect(() => uniform(s, Number.NaN, 1)).toThrow(RangeError);
    expect(() => uniform(s, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('uniformSymmetric covers [-1, 1)', () => {
    const s = stream();
    let min = 1;
    let max = -1;
    for (let i = 0; i < 200_000; i += 1) {
      const v = uniformSymmetric(s);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThan(1);
    expect(min).toBeLessThan(-0.999);
    expect(max).toBeGreaterThan(0.999);
  });
});

describe('bernoulli', () => {
  it('is deterministic at the degenerate probabilities', () => {
    const s = stream();
    for (let i = 0; i < 1000; i += 1) {
      expect(bernoulli(s, 0)).toBe(false);
      expect(bernoulli(s, 1)).toBe(true);
    }
  });

  it('rejects an out-of-range probability', () => {
    const s = stream();
    for (const bad of [-0.1, 1.1, Number.NaN]) {
      expect(() => bernoulli(s, bad)).toThrow(RangeError);
    }
  });
});

describe('categorical', () => {
  it('never selects a zero-weight outcome', () => {
    const s = stream();
    const weights = [0, 5, 0, 3, 0];
    const chosen = new Set<number>();
    for (let i = 0; i < 50_000; i += 1) chosen.add(categorical(s, weights));
    expect([...chosen].sort()).toEqual([1, 3]);
  });

  it('always returns the only positive index', () => {
    const s = stream();
    for (let i = 0; i < 1000; i += 1) expect(categorical(s, [0, 0, 7])).toBe(2);
  });

  it('rejects invalid weight vectors', () => {
    const s = stream();
    expect(() => categorical(s, [])).toThrow(RangeError);
    expect(() => categorical(s, [0, 0])).toThrow(RangeError);
    expect(() => categorical(s, [1, -1])).toThrow(RangeError);
    expect(() => categorical(s, [1, Number.NaN])).toThrow(RangeError);
  });
});

describe('parameter validation', () => {
  it('rejects invalid parameters', () => {
    const s = stream();
    expect(() => normal(s, 0, -1)).toThrow(RangeError);
    expect(() => normal(s, Number.NaN, 1)).toThrow(RangeError);
    expect(() => exponential(s, 0)).toThrow(RangeError);
    expect(() => exponential(s, -1)).toThrow(RangeError);
    expect(() => gamma(s, 0, 1)).toThrow(RangeError);
    expect(() => gamma(s, 1, 0)).toThrow(RangeError);
    expect(() => chiSquared(s, 0)).toThrow(RangeError);
    expect(() => studentT(s, -2)).toThrow(RangeError);
  });

  it('accepts a zero standard deviation as a point mass', () => {
    expect(normal(stream(), 7, 0)).toBe(7);
  });
});

describe('support', () => {
  it('produces only positive values where the support requires it', () => {
    const s = stream();
    let violations = 0;
    for (let i = 0; i < 50_000; i += 1) {
      if (exponential(s, 2) < 0) violations += 1;
      if (gamma(s, 0.3, 1) <= 0) violations += 1;
      if (chiSquared(s, 3) <= 0) violations += 1;
      if (logNormal(s, 0, 1) <= 0) violations += 1;
    }
    expect(violations).toBe(0);
  });

  it('produces finite values', () => {
    const s = stream();
    let nonFinite = 0;
    for (let i = 0; i < 50_000; i += 1) {
      if (!Number.isFinite(standardNormal(s))) nonFinite += 1;
      if (!Number.isFinite(studentT(s, 3))) nonFinite += 1;
      if (!Number.isFinite(gamma(s, 0.05, 1))) nonFinite += 1;
    }
    expect(nonFinite).toBe(0);
  });
});
