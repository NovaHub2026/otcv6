/**
 * ChaCha20 block function (RFC 8439 §2.3).
 *
 * Implemented in-repo rather than taken from `node:crypto` for three reasons
 * that all trace back to product invariants:
 *
 *  - **Seekability.** The engine addresses the keystream by block index so that
 *    any point in history can be regenerated without replaying everything before
 *    it. The cipher APIs expose a stream, not an indexed block function.
 *  - **Portability of the exact bytes.** The implementation uses only integer
 *    operations that ECMAScript specifies exactly, so the output is
 *    byte-identical on every platform and Node version, forever. That is what
 *    makes historical settlement reproducible (INV-009).
 *  - **Verifiability.** A block function can be checked against published test
 *    vectors and differentially against OpenSSL, which is done in the tests.
 *
 * The 16 state words are held in local variables rather than an array. That is
 * both the fastest shape for this function in a JIT and the one that avoids
 * indexed reads entirely.
 */

/** "expand 32-byte k", little-endian. */
const C0 = 0x61707865;
const C1 = 0x3320646e;
const C2 = 0x79622d32;
const C3 = 0x6b206574;

export const CHACHA20_KEY_BYTES = 32;
export const CHACHA20_NONCE_BYTES = 12;
export const CHACHA20_BLOCK_BYTES = 64;
export const CHACHA20_ROUNDS = 20;

/**
 * Expand a 32-byte key into the eight little-endian state words.
 * Done once per stream, not once per block.
 */
export function expandKey(key: Uint8Array): Uint32Array {
  if (key.length !== CHACHA20_KEY_BYTES) {
    throw new RangeError(
      `ChaCha20 key must be ${CHACHA20_KEY_BYTES} bytes, received ${key.length}.`,
    );
  }
  const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const words = new Uint32Array(8);
  for (let i = 0; i < 8; i += 1) {
    words[i] = view.getUint32(i * 4, true);
  }
  return words;
}

/** Expand a 12-byte nonce into the three little-endian state words. */
export function expandNonce(nonce: Uint8Array): Uint32Array {
  if (nonce.length !== CHACHA20_NONCE_BYTES) {
    throw new RangeError(
      `ChaCha20 nonce must be ${CHACHA20_NONCE_BYTES} bytes, received ${nonce.length}.`,
    );
  }
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  const words = new Uint32Array(3);
  for (let i = 0; i < 3; i += 1) {
    words[i] = view.getUint32(i * 4, true);
  }
  return words;
}

/**
 * Produce one 64-byte keystream block into `out`.
 *
 * @param k        eight key words from {@link expandKey}
 * @param n0 n1 n2 three nonce words from {@link expandNonce}
 * @param counter  32-bit block counter; values outside uint32 are masked
 * @param out      destination, exactly 64 bytes
 */
export function chacha20Block(
  k: Uint32Array,
  n0: number,
  n1: number,
  n2: number,
  counter: number,
  out: Uint8Array,
): void {
  const k0 = k[0]!;
  const k1 = k[1]!;
  const k2 = k[2]!;
  const k3 = k[3]!;
  const k4 = k[4]!;
  const k5 = k[5]!;
  const k6 = k[6]!;
  const k7 = k[7]!;
  const ctr = counter >>> 0;

  let x0 = C0;
  let x1 = C1;
  let x2 = C2;
  let x3 = C3;
  let x4 = k0;
  let x5 = k1;
  let x6 = k2;
  let x7 = k3;
  let x8 = k4;
  let x9 = k5;
  let x10 = k6;
  let x11 = k7;
  let x12 = ctr;
  let x13 = n0 >>> 0;
  let x14 = n1 >>> 0;
  let x15 = n2 >>> 0;

  for (let round = 0; round < CHACHA20_ROUNDS; round += 2) {
    // Column rounds
    x0 = (x0 + x4) | 0;
    x12 ^= x0;
    x12 = (x12 << 16) | (x12 >>> 16);
    x8 = (x8 + x12) | 0;
    x4 ^= x8;
    x4 = (x4 << 12) | (x4 >>> 20);
    x0 = (x0 + x4) | 0;
    x12 ^= x0;
    x12 = (x12 << 8) | (x12 >>> 24);
    x8 = (x8 + x12) | 0;
    x4 ^= x8;
    x4 = (x4 << 7) | (x4 >>> 25);

    x1 = (x1 + x5) | 0;
    x13 ^= x1;
    x13 = (x13 << 16) | (x13 >>> 16);
    x9 = (x9 + x13) | 0;
    x5 ^= x9;
    x5 = (x5 << 12) | (x5 >>> 20);
    x1 = (x1 + x5) | 0;
    x13 ^= x1;
    x13 = (x13 << 8) | (x13 >>> 24);
    x9 = (x9 + x13) | 0;
    x5 ^= x9;
    x5 = (x5 << 7) | (x5 >>> 25);

    x2 = (x2 + x6) | 0;
    x14 ^= x2;
    x14 = (x14 << 16) | (x14 >>> 16);
    x10 = (x10 + x14) | 0;
    x6 ^= x10;
    x6 = (x6 << 12) | (x6 >>> 20);
    x2 = (x2 + x6) | 0;
    x14 ^= x2;
    x14 = (x14 << 8) | (x14 >>> 24);
    x10 = (x10 + x14) | 0;
    x6 ^= x10;
    x6 = (x6 << 7) | (x6 >>> 25);

    x3 = (x3 + x7) | 0;
    x15 ^= x3;
    x15 = (x15 << 16) | (x15 >>> 16);
    x11 = (x11 + x15) | 0;
    x7 ^= x11;
    x7 = (x7 << 12) | (x7 >>> 20);
    x3 = (x3 + x7) | 0;
    x15 ^= x3;
    x15 = (x15 << 8) | (x15 >>> 24);
    x11 = (x11 + x15) | 0;
    x7 ^= x11;
    x7 = (x7 << 7) | (x7 >>> 25);

    // Diagonal rounds
    x0 = (x0 + x5) | 0;
    x15 ^= x0;
    x15 = (x15 << 16) | (x15 >>> 16);
    x10 = (x10 + x15) | 0;
    x5 ^= x10;
    x5 = (x5 << 12) | (x5 >>> 20);
    x0 = (x0 + x5) | 0;
    x15 ^= x0;
    x15 = (x15 << 8) | (x15 >>> 24);
    x10 = (x10 + x15) | 0;
    x5 ^= x10;
    x5 = (x5 << 7) | (x5 >>> 25);

    x1 = (x1 + x6) | 0;
    x12 ^= x1;
    x12 = (x12 << 16) | (x12 >>> 16);
    x11 = (x11 + x12) | 0;
    x6 ^= x11;
    x6 = (x6 << 12) | (x6 >>> 20);
    x1 = (x1 + x6) | 0;
    x12 ^= x1;
    x12 = (x12 << 8) | (x12 >>> 24);
    x11 = (x11 + x12) | 0;
    x6 ^= x11;
    x6 = (x6 << 7) | (x6 >>> 25);

    x2 = (x2 + x7) | 0;
    x13 ^= x2;
    x13 = (x13 << 16) | (x13 >>> 16);
    x8 = (x8 + x13) | 0;
    x7 ^= x8;
    x7 = (x7 << 12) | (x7 >>> 20);
    x2 = (x2 + x7) | 0;
    x13 ^= x2;
    x13 = (x13 << 8) | (x13 >>> 24);
    x8 = (x8 + x13) | 0;
    x7 ^= x8;
    x7 = (x7 << 7) | (x7 >>> 25);

    x3 = (x3 + x4) | 0;
    x14 ^= x3;
    x14 = (x14 << 16) | (x14 >>> 16);
    x9 = (x9 + x14) | 0;
    x4 ^= x9;
    x4 = (x4 << 12) | (x4 >>> 20);
    x3 = (x3 + x4) | 0;
    x14 ^= x3;
    x14 = (x14 << 8) | (x14 >>> 24);
    x9 = (x9 + x14) | 0;
    x4 ^= x9;
    x4 = (x4 << 7) | (x4 >>> 25);
  }

  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(0, (x0 + C0) >>> 0, true);
  view.setUint32(4, (x1 + C1) >>> 0, true);
  view.setUint32(8, (x2 + C2) >>> 0, true);
  view.setUint32(12, (x3 + C3) >>> 0, true);
  view.setUint32(16, (x4 + k0) >>> 0, true);
  view.setUint32(20, (x5 + k1) >>> 0, true);
  view.setUint32(24, (x6 + k2) >>> 0, true);
  view.setUint32(28, (x7 + k3) >>> 0, true);
  view.setUint32(32, (x8 + k4) >>> 0, true);
  view.setUint32(36, (x9 + k5) >>> 0, true);
  view.setUint32(40, (x10 + k6) >>> 0, true);
  view.setUint32(44, (x11 + k7) >>> 0, true);
  view.setUint32(48, (x12 + ctr) >>> 0, true);
  view.setUint32(52, (x13 + (n0 >>> 0)) >>> 0, true);
  view.setUint32(56, (x14 + (n1 >>> 0)) >>> 0, true);
  view.setUint32(60, (x15 + (n2 >>> 0)) >>> 0, true);
}
