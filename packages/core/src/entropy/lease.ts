import { MAX_BLOCK_INDEX } from './stream.js';

export interface LeaseState {
  /** First block index this process is permitted to consume. */
  readonly startAt: bigint;
  /** Durably persisted high-water mark. Blocks below it are reserved. */
  readonly confirmedTo: bigint;
  readonly leaseBlocks: bigint;
}

/**
 * Makes restarts non-repeating.
 *
 * A market engine that crashed between emitting a tick and persisting its cursor
 * would, on restart, redraw random values it had already used, and replay a
 * price sequence observers have already seen. §22 forbids exactly that, and it
 * is not a hypothetical: any crash, container eviction or power loss produces
 * it.
 *
 * The fix is to reserve ahead of use. Cursor positions are leased in blocks and
 * the high-water mark is persisted *before* the blocks behind it are consumed.
 * On restart the engine resumes at the persisted high-water mark and discards
 * whatever remained of the previous lease. Discarding is free — the keystream is
 * i.i.d., so a gap is statistically invisible — and it converts an unbounded
 * correctness hazard into a bounded, recorded gap.
 *
 * The gap is *recorded* rather than merely tolerated, because exact replay of a
 * history spanning a restart needs to know where the cursor jumped.
 *
 * This class is a pure state machine. Persistence is the caller's job: the
 * kernel has no I/O.
 *
 * Usage:
 * ```ts
 * const lease = CursorLease.resume(await store.load(id), 1_000_000n);
 * let block = lease.startAt;
 * const reservation = lease.ensure(block);
 * if (reservation !== null) {
 *   await store.persist(id, reservation);   // durable BEFORE consuming
 *   lease.confirm(reservation);
 * }
 * ```
 */
export class CursorLease {
  private constructor(
    readonly startAt: bigint,
    private confirmedToInternal: bigint,
    readonly leaseBlocks: bigint,
  ) {}

  /**
   * @param persistedHighWater the durably stored high-water mark, or `null` for
   *   a stream that has never run
   * @param leaseBlocks how far ahead to reserve. Larger values mean fewer
   *   durable writes and a larger discarded gap per restart.
   */
  static resume(persistedHighWater: bigint | null, leaseBlocks: bigint): CursorLease {
    if (leaseBlocks <= 0n) {
      throw new RangeError(`Lease size must be positive, received ${leaseBlocks}.`);
    }
    const start = persistedHighWater ?? 0n;
    if (start < 0n || start > MAX_BLOCK_INDEX) {
      throw new RangeError(`Persisted high-water mark ${start} is outside [0, 2^64).`);
    }
    return new CursorLease(start, start, leaseBlocks);
  }

  get confirmedTo(): bigint {
    return this.confirmedToInternal;
  }

  state(): LeaseState {
    return {
      startAt: this.startAt,
      confirmedTo: this.confirmedToInternal,
      leaseBlocks: this.leaseBlocks,
    };
  }

  /** Whether `blockIndex` may be consumed right now. */
  canConsume(blockIndex: bigint): boolean {
    return blockIndex >= this.startAt && blockIndex < this.confirmedToInternal;
  }

  /**
   * The high-water mark that must be durably persisted before `blockIndex` is
   * consumed, or `null` when the confirmed reservation already covers it.
   */
  ensure(blockIndex: bigint): bigint | null {
    if (blockIndex < this.startAt) {
      throw new RangeError(
        `Block ${blockIndex} precedes this lease's start ${this.startAt}; it may already have been consumed.`,
      );
    }
    if (blockIndex < this.confirmedToInternal) {
      return null;
    }
    const grown = this.confirmedToInternal + this.leaseBlocks;
    const needed = blockIndex + 1n;
    const proposed = grown > needed ? grown : needed;
    if (proposed > MAX_BLOCK_INDEX) {
      throw new RangeError(
        `Lease for this stream cannot extend past block ${MAX_BLOCK_INDEX}; the stream is exhausted.`,
      );
    }
    return proposed;
  }

  /** Record that a reservation has been durably persisted. */
  confirm(highWater: bigint): void {
    if (highWater < this.confirmedToInternal) {
      throw new RangeError(
        `Lease high-water mark must not move backwards: ${highWater} < ${this.confirmedToInternal}.`,
      );
    }
    if (highWater > MAX_BLOCK_INDEX) {
      throw new RangeError(`Lease high-water mark ${highWater} is outside [0, 2^64).`);
    }
    this.confirmedToInternal = highWater;
  }
}
