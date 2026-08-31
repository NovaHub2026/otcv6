import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHACHA20_BLOCK_BYTES, chacha20Block, expandKey, expandNonce } from './chacha20.js';

function keystream(key: Uint8Array, nonce: Uint8Array, counter: number): string {
  const out = new Uint8Array(CHACHA20_BLOCK_BYTES);
  const k = expandKey(key);
  const n = expandNonce(nonce);
  chacha20Block(k, n[0]!, n[1]!, n[2]!, counter, out);
  return Buffer.from(out).toString('hex');
}

/**
 * Independent oracle: OpenSSL's raw ChaCha20, whose 16-byte IV is
 * `counter (LE32) || nonce (96 bit)`. Encrypting zeroes yields the keystream.
 */
function opensslKeystream(key: Uint8Array, nonce: Uint8Array, counter: number): string {
  const iv = Buffer.alloc(16);
  iv.writeUInt32LE(counter >>> 0, 0);
  Buffer.from(nonce).copy(iv, 4);
  const cipher = createCipheriv('chacha20', Buffer.from(key), iv);
  return Buffer.concat([
    cipher.update(Buffer.alloc(CHACHA20_BLOCK_BYTES)),
    cipher.final(),
  ]).toString('hex');
}

/** Deterministic pseudo-random bytes, so the differential test is reproducible. */
function deterministicBytes(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = (seed * 2654435761) >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

const RFC_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);

describe('chacha20Block — known-answer vectors', () => {
  it('matches the all-zero key and nonce vector at counter 0', () => {
    expect(keystream(new Uint8Array(32), new Uint8Array(12), 0)).toBe(
      '76b8e0ada0f13d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7' +
        'da41597c5157488d7724e03fb8d84a376a43b8f41518a11cc387b669b2ee6586',
    );
  });

  it('matches the all-zero key and nonce vector at counter 1', () => {
    expect(keystream(new Uint8Array(32), new Uint8Array(12), 1)).toBe(
      '9f07e7be5551387a98ba977c732d080dcb0f29a048e3656912c6533e32ee7aed' +
        '29b721769ce64e43d57133b074d839d531ed1f28510afb45ace10a1f4b794d6f',
    );
  });

  it('matches RFC 8439 section 2.3.2', () => {
    const nonce = Buffer.from('000000090000004a00000000', 'hex');
    expect(keystream(RFC_KEY, nonce, 1)).toBe(
      '10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e' +
        'd2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e',
    );
  });

  it('matches the first block of the RFC 8439 section 2.4.2 keystream', () => {
    const nonce = Buffer.from('000000000000004a00000000', 'hex');
    expect(keystream(RFC_KEY, nonce, 1)).toBe(
      '224f51f3401bd9e12fde276fb8631ded8c131f823d2c06e27e4fcaec9ef3cf78' +
        '8a3b0aa372600a92b57974cded2b9334794cba40c63e34cdea212c4cf07d41b7',
    );
  });
});

describe('chacha20Block — differential against OpenSSL', () => {
  it('agrees on 400 pseudo-random key/nonce/counter triples', () => {
    let compared = 0;
    for (let trial = 0; trial < 400; trial += 1) {
      const key = deterministicBytes(trial * 3 + 1, 32);
      const nonce = deterministicBytes(trial * 3 + 2, 12);
      const counterBytes = deterministicBytes(trial * 3 + 3, 4);
      const counter =
        (counterBytes[0]! |
          (counterBytes[1]! << 8) |
          (counterBytes[2]! << 16) |
          (counterBytes[3]! << 24)) >>>
        0;
      expect(keystream(key, nonce, counter)).toBe(opensslKeystream(key, nonce, counter));
      compared += 1;
    }
    expect(compared).toBe(400);
  });

  it('agrees at the counter boundaries 0, 1, 2^31 and 2^32-1', () => {
    const key = deterministicBytes(99, 32);
    const nonce = deterministicBytes(98, 12);
    for (const counter of [0, 1, 0x8000_0000, 0xffff_ffff]) {
      expect(keystream(key, nonce, counter)).toBe(opensslKeystream(key, nonce, counter));
    }
  });
});

describe('chacha20Block — input validation', () => {
  it('rejects a key that is not 32 bytes', () => {
    expect(() => expandKey(new Uint8Array(31))).toThrow(RangeError);
    expect(() => expandKey(new Uint8Array(33))).toThrow(RangeError);
  });

  it('rejects a nonce that is not 12 bytes', () => {
    expect(() => expandNonce(new Uint8Array(11))).toThrow(RangeError);
    expect(() => expandNonce(new Uint8Array(16))).toThrow(RangeError);
  });
});
