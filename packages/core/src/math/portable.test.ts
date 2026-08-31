import { describe, expect, it } from 'vitest';
import { fromWords, highWord, lowWord, scaleByPowerOfTwo, withHighWord } from './bits.js';
import { exp, ln, pow } from './portable.js';

/** Distance between two doubles measured in representable steps. */
function ulpDistance(a: number, b: number): number {
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  const buffer = new ArrayBuffer(8);
  const asDouble = new Float64Array(buffer);
  const asInt = new BigInt64Array(buffer);
  asDouble[0] = a;
  const ia = asInt[0]!;
  asDouble[0] = b;
  const ib = asInt[0]!;
  const diff = ia > ib ? ia - ib : ib - ia;
  return Number(diff);
}

describe('bit access', () => {
  it('round-trips words', () => {
    for (const value of [1, -1, 0.5, 1e300, 1e-300, Number.MIN_VALUE, Math.PI]) {
      expect(fromWords(highWord(value), lowWord(value))).toBe(value);
    }
  });

  it('detects word order correctly', () => {
    expect(highWord(1)).toBe(0x3ff0_0000);
    expect(lowWord(1)).toBe(0);
    expect(highWord(-1) >>> 31).toBe(1);
  });

  it('replaces the high word', () => {
    expect(withHighWord(1, 0x4000_0000)).toBe(2);
  });
});

describe('scaleByPowerOfTwo', () => {
  it('is exact for ordinary values', () => {
    expect(scaleByPowerOfTwo(3, 2)).toBe(12);
    expect(scaleByPowerOfTwo(1, 0)).toBe(1);
    expect(scaleByPowerOfTwo(1, -1)).toBe(0.5);
    expect(scaleByPowerOfTwo(-5, 3)).toBe(-40);
  });

  it('reaches the extremes of the representable range', () => {
    expect(scaleByPowerOfTwo(1, -1074)).toBe(Number.MIN_VALUE);
    expect(scaleByPowerOfTwo(1, 1023)).toBe(8.98846567431158e307);
    expect(scaleByPowerOfTwo(1, 1024)).toBe(Number.POSITIVE_INFINITY);
    expect(scaleByPowerOfTwo(1, -1075)).toBe(0);
  });

  it('passes through zero, infinities and NaN', () => {
    expect(scaleByPowerOfTwo(0, 10)).toBe(0);
    expect(scaleByPowerOfTwo(Number.POSITIVE_INFINITY, -10)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(scaleByPowerOfTwo(Number.NaN, 1))).toBe(true);
  });

  it('rejects a non-integer exponent', () => {
    expect(() => scaleByPowerOfTwo(1, 1.5)).toThrow(RangeError);
  });
});

describe('exp — special cases', () => {
  it('matches the specification at the boundaries', () => {
    expect(exp(0)).toBe(1);
    expect(exp(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(exp(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(Number.isNaN(exp(Number.NaN))).toBe(true);
    expect(exp(1000)).toBe(Number.POSITIVE_INFINITY);
    expect(exp(-1000)).toBe(0);
    expect(exp(-745.2)).toBe(0);
  });

  it('is exact for tiny arguments', () => {
    expect(exp(1e-20)).toBe(1 + 1e-20);
    expect(exp(-1e-20)).toBe(1 - 1e-20);
  });
});

describe('ln — special cases', () => {
  it('matches the specification at the boundaries', () => {
    expect(ln(1)).toBe(0);
    expect(ln(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(ln(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(ln(-1))).toBe(true);
    expect(Number.isNaN(ln(Number.NaN))).toBe(true);
    expect(Number.isNaN(ln(Number.NEGATIVE_INFINITY))).toBe(true);
  });

  it('handles subnormals', () => {
    expect(ln(Number.MIN_VALUE)).toBe(Math.log(Number.MIN_VALUE));
    expect(ln(1e-320)).toBe(Math.log(1e-320));
  });
});

describe('accuracy against the platform implementation', () => {
  it('exp agrees within 1 ulp on a representative sweep', () => {
    let worst = 0;
    for (let i = 0; i <= 20_000; i += 1) {
      const x = -745 + (i / 20_000) * (709.7 + 745);
      worst = Math.max(worst, ulpDistance(exp(x), Math.exp(x)));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('ln agrees within 1 ulp on a representative sweep', () => {
    let worst = 0;
    for (let i = 1; i <= 20_000; i += 1) {
      const x = i / 10_000; // dense across 1, the numerically hard region
      worst = Math.max(worst, ulpDistance(ln(x), Math.log(x)));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('round-trips exp and ln', () => {
    // Measured as absolute error scaled by max(1, |x|), not in ulp of x. The
    // round trip is ill-conditioned for small x: a 1-ulp relative error in
    // exp(x) becomes an absolute error near 2e-16 in the logarithm, which at
    // x = 0.01 is over a hundred ulp of x. That is a property of the
    // composition, not of either function.
    let worst = 0;
    for (let i = 1; i <= 5_000; i += 1) {
      const x = i / 100;
      worst = Math.max(worst, Math.abs(ln(exp(x)) - x) / Math.max(1, Math.abs(x)));
    }
    expect(worst).toBeLessThan(4e-16);
  });
});

describe('determinism', () => {
  it('returns identical bits for identical input', () => {
    for (const x of [0.1, 1, 2.5, -3.75, 100, -100, 700, -700]) {
      expect(exp(x)).toBe(exp(x));
      if (x > 0) expect(ln(x)).toBe(ln(x));
    }
  });
});

describe('pow', () => {
  it('handles the algebraic identities', () => {
    expect(pow(2, 0)).toBe(1);
    expect(pow(1, 12345)).toBe(1);
    expect(pow(2, 10)).toBe(1024);
    expect(pow(0, 2)).toBe(0);
    expect(pow(0, -2)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(pow(-2, 0.5))).toBe(true);
    expect(Number.isNaN(pow(Number.NaN, 2))).toBe(true);
  });

  it('agrees with the platform implementation to a small relative error', () => {
    // pow is exp(y * ln x), so it inherits error from both. The relative error
    // grows with |y * ln x| and reaches a few ulp; determinism, not the last
    // bit, is what this function is for.
    let worst = 0;
    for (let base = 1; base <= 50; base += 1) {
      for (const y of [0.25, 0.5, 1.5, 2, 3.7]) {
        const mine = pow(base, y);
        const reference = Math.pow(base, y);
        worst = Math.max(worst, Math.abs(mine - reference) / reference);
      }
    }
    expect(worst).toBeLessThan(1e-14);
  });
});
