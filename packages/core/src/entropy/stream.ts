import { CHACHA20_BLOCK_BYTES, chacha20Block, expandKey } from './chacha20.js';

/**
 * A position in a keystream.
 *
 * This is the complete state of a random stream. Snapshotting a market means
 * snapshotting a cursor and a small amount of model state; it never means
 * serialising a generator's internal buffers, and it never means writing a
 * secret to disk.
 */
export interface StreamCursor {
  /** 64-byte block index, in `[0, 2^64)`. */
  readonly blockIndex: bigint;
  /** Next unconsumed byte within that block, in `[0, 64)`. */
  readonly byteOffset: number;
}

export const MAX_BLOCK_INDEX = (1n << 64n) - 1n;

const TWO_POW_26 = 67_108_864; // 2^26
const TWO_POW_53 = 9_007_199_254_740_992; // 2^53
const TWO_POW_32 = 4_294_967_296; // 2^32

export function cursor(blockIndex: bigint, byteOffset: number): StreamCursor {
  assertCursor(blockIndex, byteOffset);
  return { blockIndex, byteOffset };
}

function assertCursor(blockIndex: bigint, byteOffset: number): void {
  if (blockIndex < 0n || blockIndex > MAX_BLOCK_INDEX) {
    throw new RangeError(`Block index ${blockIndex} is outside [0, 2^64).`);
  }
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset >= CHACHA20_BLOCK_BYTES) {
    throw new RangeError(`Byte offset ${byteOffset} is outside [0, ${CHACHA20_BLOCK_BYTES}).`);
  }
}

/** Serialise a cursor for storage. Stable format: `<blockIndex>:<byteOffset>`. */
export function formatCursor(c: StreamCursor): string {
  return `${c.blockIndex.toString(10)}:${c.byteOffset.toString(10)}`;
}

export function parseCursor(text: string): StreamCursor {
  const match = /^(\d+):(\d+)$/.exec(text);
  if (!match) {
    throw new RangeError(
      `Malformed cursor ${JSON.stringify(text)}. Expected "<blockIndex>:<byteOffset>".`,
    );
  }
  return cursor(BigInt(match[1]!), Number(match[2]!));
}

/**
 * The capability a consumer of randomness needs.
 *
 * Separate from {@link RandomStream} so that a consumer depends on what it uses
 * rather than on the concrete implementation. That matters for more than
 * tidiness: the mirror test that guards the anti-predictability theorem works by
 * wrapping a stream in a decorator that inverts its coin flips, and a decorator
 * cannot implement a class with private fields.
 */
export interface RandomSource {
  readonly label: string;
  nextUint32(): number;
  nextUint64(): bigint;
  nextFloat64(): number;
  nextBoundedUint32(bound: number): number;
  nextBoolean(): boolean;
  nextBytes(count: number): Uint8Array;
  position(): StreamCursor;
  seek(target: StreamCursor): void;
}

/**
 * A seekable, deterministic source of uniform randomness.
 *
 * Reproducible because output is a pure function of `(key, blockIndex)`.
 * Unpredictable because recovering future output from observed output is the
 * ChaCha20 distinguishing problem. Those two properties are what let the same
 * mechanism serve replay (INV-009) and public unpredictability (INV-010).
 */
export class RandomStream implements RandomSource {
  // Private at runtime, not merely at compile time: the expanded stream key is
  // exactly the material an observer would need to compute every future draw,
  // so it must be unreachable by serialisation or enumeration (INV-010).
  readonly #keyWords: Uint32Array;
  private readonly nonceLow: number;
  private readonly nonceMid: number;
  private readonly buffer = new Uint8Array(CHACHA20_BLOCK_BYTES);
  private readonly bufferView: DataView;
  private blockIndex: bigint;
  private byteOffset: number;
  private bufferedBlock: bigint | null = null;
  private blocksGenerated = 0;

  /**
   * @param key   32-byte stream key, already derived for this label
   * @param label canonical label, retained for diagnostics only
   * @param start where to begin; defaults to the start of the stream
   */
  constructor(
    key: Uint8Array,
    readonly label: string,
    start: StreamCursor = { blockIndex: 0n, byteOffset: 0 },
  ) {
    this.#keyWords = expandKey(key);
    // The key is unique per label, so the nonce carries no entropy: it exists
    // only to widen the addressable space from 2^32 to 2^64 blocks. The low two
    // nonce words are fixed at zero and the high 32 bits of the block index
    // occupy the final nonce word, with the low 32 bits in the ChaCha20 counter.
    this.nonceLow = 0;
    this.nonceMid = 0;
    assertCursor(start.blockIndex, start.byteOffset);
    this.blockIndex = start.blockIndex;
    this.byteOffset = start.byteOffset;
    this.bufferView = new DataView(this.buffer.buffer);
  }

  /** Redacted representation: a stream is identified by label and position only. */
  toJSON(): { label: string; position: string } {
    return { label: this.label, position: formatCursor(this.position()) };
  }

  toString(): string {
    return `RandomStream(${this.label} @ ${formatCursor(this.position())})`;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }

  position(): StreamCursor {
    return { blockIndex: this.blockIndex, byteOffset: this.byteOffset };
  }

  seek(target: StreamCursor): void {
    assertCursor(target.blockIndex, target.byteOffset);
    this.blockIndex = target.blockIndex;
    this.byteOffset = target.byteOffset;
  }

  /** Number of keystream blocks computed by this instance. Diagnostics only. */
  get blocksComputed(): number {
    return this.blocksGenerated;
  }

  private fill(): void {
    if (this.bufferedBlock === this.blockIndex) {
      return;
    }
    if (this.blockIndex > MAX_BLOCK_INDEX) {
      throw new RangeError(`Random stream ${this.label} exhausted at block ${this.blockIndex}.`);
    }
    const counter = Number(this.blockIndex & 0xffff_ffffn);
    const high = Number(this.blockIndex >> 32n);
    chacha20Block(this.#keyWords, this.nonceLow, this.nonceMid, high, counter, this.buffer);
    this.bufferedBlock = this.blockIndex;
    this.blocksGenerated += 1;
  }

  private advance(bytes: number): void {
    this.byteOffset += bytes;
    while (this.byteOffset >= CHACHA20_BLOCK_BYTES) {
      this.byteOffset -= CHACHA20_BLOCK_BYTES;
      this.blockIndex += 1n;
    }
  }

  /** One uniform 32-bit value. */
  nextUint32(): number {
    this.fill();
    if (this.byteOffset + 4 <= CHACHA20_BLOCK_BYTES) {
      const value = this.bufferView.getUint32(this.byteOffset, true);
      this.advance(4);
      return value;
    }
    // Straddles a block boundary; assemble byte-wise.
    const bytes = this.nextBytes(4);
    return (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
  }

  nextUint64(): bigint {
    const lo = BigInt(this.nextUint32());
    const hi = BigInt(this.nextUint32());
    return (hi << 32n) | lo;
  }

  /**
   * A uniform double on `[0, 1)` with 53 significant bits.
   *
   * Built from two 32-bit draws using only exact integer and IEEE-754
   * operations, so the result is bit-identical on every platform.
   */
  nextFloat64(): number {
    const a = this.nextUint32() >>> 5; // 27 bits
    const b = this.nextUint32() >>> 6; // 26 bits
    return (a * TWO_POW_26 + b) / TWO_POW_53;
  }

  /**
   * A uniform integer on `[0, bound)`, unbiased.
   *
   * Rejection sampling consumes a variable number of draws. That is fine, and in
   * fact required: the cursor records the exact position reached, so replay
   * consumes exactly the same draws in exactly the same order.
   */
  nextBoundedUint32(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0 || bound > TWO_POW_32) {
      throw new RangeError(`Bound must be an integer in [1, 2^32], received ${bound}.`);
    }
    if (bound === TWO_POW_32) {
      return this.nextUint32();
    }
    const limit = TWO_POW_32 - (TWO_POW_32 % bound);
    for (;;) {
      const draw = this.nextUint32();
      if (draw < limit) {
        return draw % bound;
      }
    }
  }

  /** A fair coin. Consumes one 32-bit draw so that the cursor advances uniformly. */
  nextBoolean(): boolean {
    return (this.nextUint32() & 1) === 1;
  }

  nextBytes(count: number): Uint8Array {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`Byte count must be a non-negative integer, received ${count}.`);
    }
    const out = new Uint8Array(count);
    let written = 0;
    while (written < count) {
      this.fill();
      const available = CHACHA20_BLOCK_BYTES - this.byteOffset;
      const take = Math.min(available, count - written);
      out.set(this.buffer.subarray(this.byteOffset, this.byteOffset + take), written);
      written += take;
      this.advance(take);
    }
    return out;
  }
}
