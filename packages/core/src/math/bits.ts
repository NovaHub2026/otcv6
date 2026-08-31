/**
 * IEEE-754 double bit access.
 *
 * The portable elementary functions need to read and write a double's exponent
 * field directly. Every operation here is integer manipulation of the bit
 * pattern, so it is exact and identical on every platform — which is the whole
 * point of the module that uses it.
 */

const scratch = new ArrayBuffer(8);
const asDouble = new Float64Array(scratch);
const asWords = new Uint32Array(scratch);

// Word order follows platform endianness. Detected once from a known bit
// pattern rather than assumed, so the module is correct on either.
asDouble[0] = 1;
const HIGH = asWords[1] === 0x3ff0_0000 ? 1 : 0;
const LOW = 1 - HIGH;

/** Upper 32 bits: sign, exponent and the top 20 mantissa bits. */
export function highWord(value: number): number {
  asDouble[0] = value;
  return asWords[HIGH]!;
}

/** Lower 32 mantissa bits. */
export function lowWord(value: number): number {
  asDouble[0] = value;
  return asWords[LOW]!;
}

export function fromWords(high: number, low: number): number {
  asWords[HIGH] = high >>> 0;
  asWords[LOW] = low >>> 0;
  return asDouble[0]!;
}

/** `value` with its upper 32 bits replaced. */
export function withHighWord(value: number, high: number): number {
  asDouble[0] = value;
  asWords[HIGH] = high >>> 0;
  return asDouble[0];
}

const TWO_POW_1023 = fromWords(0x7fe0_0000, 0); // 2^1023
const TWO_POW_MINUS_1022 = fromWords(0x0010_0000, 0); // 2^-1022

/**
 * `value * 2^exponent`, exact where representable.
 *
 * This is `ldexp`. Scaling by a power of two changes only the exponent field,
 * so it introduces no rounding error at all — which is why the range-reduction
 * steps in `exp` and `ln` are able to stay exact.
 */
export function scaleByPowerOfTwo(value: number, exponent: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  if (!Number.isInteger(exponent)) {
    throw new RangeError(`Exponent must be an integer, received ${exponent}.`);
  }
  let n = exponent;
  let x = value;
  // Applied in bounded steps so that very large or very small exponents cannot
  // overflow the intermediate power of two itself.
  while (n > 1023) {
    x *= TWO_POW_1023;
    n -= 1023;
    if (!Number.isFinite(x)) return x;
  }
  while (n < -1022) {
    x *= TWO_POW_MINUS_1022;
    n += 1022;
    if (x === 0) return x;
  }
  return x * fromWords((n + 1023) << 20, 0);
}
