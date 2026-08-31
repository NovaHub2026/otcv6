import { describe, expect, it } from 'vitest';
import { MasterKeyring } from './keyring.js';
import type { StreamLabel } from './label.js';
import {
  cursor,
  formatCursor,
  MAX_BLOCK_INDEX,
  parseCursor,
  type RandomStream,
  type StreamCursor,
} from './stream.js';

const keyring = MasterKeyring.forTesting('stream-spec');
const label: StreamLabel = { env: 'test', asset: 'eurusd-otc', purpose: 'magnitude', keyEpoch: 0 };

function stream(start?: StreamCursor): RandomStream {
  return keyring.derive(label, start);
}

describe('RandomStream — reproducibility', () => {
  it('produces an identical sequence when re-derived', () => {
    const first = stream();
    const second = stream();
    expect(Array.from({ length: 512 }, () => first.nextUint32())).toEqual(
      Array.from({ length: 512 }, () => second.nextUint32()),
    );
  });

  it('is not a constant sequence', () => {
    const s = stream();
    const values = new Set(Array.from({ length: 512 }, () => s.nextUint32()));
    expect(values.size).toBe(512);
  });

  it('is a pure function of position — seek(position()) round-trips', () => {
    const reference = stream();
    const consumed = Array.from({ length: 300 }, () => reference.nextUint32());

    const interrupted = stream();
    for (let i = 0; i < 137; i += 1) interrupted.nextUint32();
    const saved = interrupted.position();

    const restored = stream(saved);
    const continuation = Array.from({ length: 300 - 137 }, () => restored.nextUint32());
    expect(continuation).toEqual(consumed.slice(137));
  });

  it('seeking to an index matches consuming sequentially to it', () => {
    const sequential = stream();
    for (let i = 0; i < 1000; i += 1) sequential.nextUint32();
    const reached = sequential.position();
    const expected = Array.from({ length: 64 }, () => sequential.nextUint32());

    // Seeking a live stream and re-deriving from the recorded cursor must both
    // land on exactly the bytes sequential consumption would have produced.
    const seeked = stream();
    seeked.seek(reached);
    expect(Array.from({ length: 64 }, () => seeked.nextUint32())).toEqual(expected);

    const fresh = stream(cursor(reached.blockIndex, reached.byteOffset));
    expect(Array.from({ length: 64 }, () => fresh.nextUint32())).toEqual(expected);
  });

  it('random access at a far index costs nothing and is exact', () => {
    const far = cursor(1_000_000_000n, 17);
    const a = stream(far);
    const b = stream(far);
    expect(Array.from({ length: 32 }, () => a.nextUint32())).toEqual(
      Array.from({ length: 32 }, () => b.nextUint32()),
    );
    expect(a.blocksComputed).toBeLessThanOrEqual(3);
  });
});

describe('RandomStream — cursor arithmetic', () => {
  it('advances exactly four bytes per uint32', () => {
    const s = stream();
    expect(s.position()).toEqual({ blockIndex: 0n, byteOffset: 0 });
    s.nextUint32();
    expect(s.position()).toEqual({ blockIndex: 0n, byteOffset: 4 });
    for (let i = 0; i < 15; i += 1) s.nextUint32();
    expect(s.position()).toEqual({ blockIndex: 1n, byteOffset: 0 });
  });

  it('reads correctly across a block boundary', () => {
    const straddling = stream(cursor(0n, 62));
    const value = straddling.nextUint32();
    expect(straddling.position()).toEqual({ blockIndex: 1n, byteOffset: 2 });

    // The same four bytes read one at a time must reassemble to the same value.
    const byteWise = stream(cursor(0n, 62));
    const bytes = byteWise.nextBytes(4);
    expect((bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0).toBe(
      value,
    );
  });

  it('nextBytes spans many blocks correctly', () => {
    const bulk = stream().nextBytes(200);
    const piecewise = stream();
    const parts = [piecewise.nextBytes(1), piecewise.nextBytes(63), piecewise.nextBytes(136)];
    expect(Buffer.concat(parts.map((p) => Buffer.from(p)))).toEqual(Buffer.from(bulk));
  });

  it('refuses to generate past the end of the stream', () => {
    // Reachable only at block 2^64, but it is a correctness boundary: silently
    // wrapping would restart the keystream and repeat history.
    const exhausted = stream(cursor(MAX_BLOCK_INDEX, 60));
    exhausted.nextUint32(); // consumes the last four bytes of the final block
    expect(() => exhausted.nextUint32()).toThrow(RangeError);
  });

  it('rejects an out-of-range cursor', () => {
    expect(() => cursor(-1n, 0)).toThrow(RangeError);
    expect(() => cursor(MAX_BLOCK_INDEX + 1n, 0)).toThrow(RangeError);
    expect(() => cursor(0n, 64)).toThrow(RangeError);
    expect(() => cursor(0n, -1)).toThrow(RangeError);
    expect(() => cursor(0n, 1.5)).toThrow(RangeError);
  });
});

describe('StreamCursor serialisation', () => {
  it('round-trips through the stable text format', () => {
    const c = cursor(18_446_744_073_709_551_000n, 63);
    expect(parseCursor(formatCursor(c))).toEqual(c);
    expect(formatCursor(c)).toBe('18446744073709551000:63');
  });

  it('rejects malformed text', () => {
    for (const bad of ['', '1', 'a:b', '1:64', '-1:0', '1:0:0', '1.5:0']) {
      expect(() => parseCursor(bad), bad).toThrow(RangeError);
    }
  });
});

describe('RandomStream — uniform primitives', () => {
  it('nextFloat64 stays inside [0, 1)', () => {
    const s = stream();
    let outOfRange = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 1_000_000; i += 1) {
      const v = s.nextFloat64();
      if (!(v >= 0 && v < 1)) outOfRange += 1;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(outOfRange).toBe(0);
    expect(min).toBeLessThan(1e-5);
    expect(max).toBeGreaterThan(1 - 1e-5);
  });

  it('nextBoundedUint32 stays inside range', () => {
    const s = stream();
    for (const bound of [1, 2, 3, 7, 255, 1000, 0xffff_ffff]) {
      let outOfRange = 0;
      for (let i = 0; i < 2000; i += 1) {
        const v = s.nextBoundedUint32(bound);
        if (!(Number.isInteger(v) && v >= 0 && v < bound)) outOfRange += 1;
      }
      expect(outOfRange, `bound ${bound}`).toBe(0);
    }
  });

  it('nextBoundedUint32 accepts the full 32-bit range', () => {
    const s = stream();
    const value = s.nextBoundedUint32(2 ** 32);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(2 ** 32);
  });

  it('nextBoundedUint32 rejects invalid bounds', () => {
    const s = stream();
    for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 32 + 1]) {
      expect(() => s.nextBoundedUint32(bad)).toThrow(RangeError);
    }
  });

  it('nextBytes rejects invalid counts', () => {
    const s = stream();
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => s.nextBytes(bad)).toThrow(RangeError);
    }
    expect(s.nextBytes(0)).toEqual(new Uint8Array(0));
  });

  it('nextUint64 composes the two 32-bit halves little-endian', () => {
    const a = stream();
    const lo = BigInt(a.nextUint32());
    const hi = BigInt(a.nextUint32());
    expect(stream().nextUint64()).toBe((hi << 32n) | lo);
  });
});
