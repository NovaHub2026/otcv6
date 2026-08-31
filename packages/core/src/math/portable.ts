import { highWord, lowWord, scaleByPowerOfTwo, withHighWord } from './bits.js';

/**
 * Portable elementary functions.
 *
 * ECMAScript specifies `+ - * /`, comparison and `Math.sqrt` exactly, but leaves
 * every transcendental function and the `**` operator
 * *implementation-approximated*. V8, JavaScriptCore and SpiderMonkey differ, and
 * V8's own results have changed between versions.
 *
 * For this project that is a correctness problem, not a precision problem.
 * INV-009 requires a settled contract to be reproducible from records, and
 * "recomputes to within one ulp" is not reproduction. Worse, a single last-bit
 * difference does not stay small: it flips a comparison, which changes a
 * rejection-sampling outcome, which changes every subsequent draw and therefore
 * the entire future of the market.
 *
 * These implementations follow the classic fdlibm decompositions, using only
 * exactly-specified arithmetic and direct manipulation of the exponent field.
 * The result is the same bits everywhere, forever.
 */

// exp: range reduction and minimax rational, from fdlibm e_exp.c
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;
const EXP_P1 = 1.66666666666666019037e-1;
const EXP_P2 = -2.77777777770155933842e-3;
const EXP_P3 = 6.61375632143793436117e-5;
const EXP_P4 = -1.6533902205465251539e-6;
const EXP_P5 = 4.13813679705723846039e-8;
const EXP_OVERFLOW = 7.09782712893383973096e2;
const EXP_UNDERFLOW = -7.4513321910194110842e2;
const HALF_LN2 = 0.34657359027997264; // 0.5 * ln 2
const ONE_AND_HALF_LN2 = 1.0397207708399179; // 1.5 * ln 2
const TWO_POW_MINUS_28 = 3.725290298461914e-9;

/** e^x, deterministic on every platform. */
export function exp(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (x === Number.NEGATIVE_INFINITY) return 0;
  if (x > EXP_OVERFLOW) return Number.POSITIVE_INFINITY;
  if (x < EXP_UNDERFLOW) return 0;

  const absX = x < 0 ? -x : x;
  let k = 0;
  let hi = 0;
  let lo = 0;
  let r = x;

  if (absX > HALF_LN2) {
    if (absX < ONE_AND_HALF_LN2) {
      if (x > 0) {
        hi = x - LN2_HI;
        lo = LN2_LO;
        k = 1;
      } else {
        hi = x + LN2_HI;
        lo = -LN2_LO;
        k = -1;
      }
    } else {
      k = Math.trunc(INV_LN2 * x + (x > 0 ? 0.5 : -0.5));
      const t = k;
      hi = x - t * LN2_HI; // exact: t * LN2_HI has no rounding here
      lo = t * LN2_LO;
    }
    r = hi - lo;
  } else if (absX < TWO_POW_MINUS_28) {
    return 1 + x;
  }

  const t = r * r;
  const c = r - t * (EXP_P1 + t * (EXP_P2 + t * (EXP_P3 + t * (EXP_P4 + t * EXP_P5))));
  if (k === 0) {
    return 1 - ((r * c) / (c - 2) - r);
  }
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  return scaleByPowerOfTwo(y, k);
}

// ln: from fdlibm e_log.c
const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;
const TWO_POW_54 = 1.8014398509481984e16;
// fdlibm writes this as 0.33333333333333333; 1/3 rounds to the identical double
// and does not lose precision in source.
const ONE_THIRD = 1 / 3;

/** Natural logarithm, deterministic on every platform. */
export function ln(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x < 0) return Number.NaN;
  if (x === 0) return Number.NEGATIVE_INFINITY;
  if (x === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;

  let value = x;
  let hx = highWord(value);
  let k = 0;

  if (hx < 0x0010_0000) {
    // Subnormal: scale into the normal range and correct the exponent.
    k -= 54;
    value *= TWO_POW_54;
    hx = highWord(value);
  }

  k += (hx >> 20) - 1023;
  hx &= 0x000f_ffff;
  const i = (hx + 0x9_5f64) & 0x10_0000;
  value = withHighWord(value, hx | (i ^ 0x3ff0_0000)); // normalise to [sqrt(2)/2, sqrt(2))
  k += i >> 20;

  const f = value - 1;
  const dk = k;

  if ((0x000f_ffff & (2 + hx)) < 3) {
    // |f| < 2^-20: the series above would lose accuracy, so use a short one.
    if (f === 0) {
      return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    }
    const R = f * f * (0.5 - ONE_THIRD * f);
    return k === 0 ? f - R : dk * LN2_HI - (R - dk * LN2_LO - f);
  }

  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;

  // Selects the more accurate of two algebraically equivalent forms, by how far
  // the normalised mantissa sits from 1. The sign of the bitwise OR is negative
  // exactly when the mantissa lies inside the narrow band around 1.
  const branch = (hx - 0x6_147a) | (0x6_b851 - hx);
  if (branch > 0) {
    const halfFSquared = 0.5 * f * f;
    return k === 0
      ? f - (halfFSquared - s * (halfFSquared + R))
      : dk * LN2_HI - (halfFSquared - (s * (halfFSquared + R) + dk * LN2_LO) - f);
  }
  return k === 0 ? f - s * (f - R) : dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f);
}

/** `x^y`, computed as `exp(y * ln x)`. Defined for `x > 0`. */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x === 1) return 1;
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (x < 0) return Number.NaN;
  if (x === 0) return y > 0 ? 0 : Number.POSITIVE_INFINITY;
  return exp(y * ln(x));
}

export { scaleByPowerOfTwo, highWord, lowWord };
