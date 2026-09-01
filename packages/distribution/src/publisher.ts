import type { KeyObject } from 'node:crypto';
import type { Tick } from '@otc/core';
import { assertAssetId, assertPreviousRoot, commit, CommitmentError } from './commitment.js';
import { signCommitment, type SignedCommitment } from './signing.js';

/**
 * Turns a running market's output into a signed, append-only commitment chain.
 *
 * PH-9.3 recorded, as a limitation, that no journal is produced by the service —
 * everything it verified was verified against journals written by tests. A
 * commitment scheme over a record nothing publishes is a scheme over nothing.
 * This is what closes it.
 *
 * It holds no engine, reads no configuration, and cannot generate. It sees ticks
 * only after they exist, which is what keeps the publishing path incapable of
 * influencing the price path (INV-001) and separate from generation (INV-010).
 *
 * ## Windows close on tick count, never on elapsed time
 *
 * A window that closed on wall-clock would produce wildly different sizes across
 * a catalogue that ticks between 333 ms and 3.4 s, and would make the commitment
 * cadence a function of how busy the market is — which is precisely when an
 * operator would most want to delay one. A fixed count makes the cadence a
 * property of the record rather than of the operator's circumstances.
 *
 * ## The open window is not committed, and that is the honest state
 *
 * Committing a partial window and then extending it would produce two different
 * roots covering overlapping ranges. A verifier cannot distinguish that from an
 * operator restating history — which is the one thing the chain exists to make
 * impossible.
 *
 * So a tick is *published* immediately and *committed* when its window fills.
 * Between those two moments it is uncommitted, {@link pendingTicks} says how
 * many are in that state, and a counterparty can see it.
 */
export interface PublisherOptions {
  readonly assetId: string;
  /** Ticks per commitment window. */
  readonly windowTicks: number;
  readonly privateKey: KeyObject;
  /** Chain tip to continue from, for a restarted publisher. */
  readonly previousRoot?: string;
  /**
   * Sequence the next committed window must start at.
   *
   * Required alongside `previousRoot`: a resumed publisher that guessed would
   * either leave a hole or overlap the previous window, and both are
   * indistinguishable from tampering once published.
   */
  readonly nextSequence?: number;
}

/** A window that filled: its signature, and the ticks it commits to. */
export interface ClosedWindow {
  readonly signed: SignedCommitment;
  /** Retained by the caller, so proofs can be produced later from the journal. */
  readonly ticks: readonly Tick[];
}

export class CommitmentPublisher {
  readonly #assetId: string;
  readonly #windowTicks: number;
  readonly #privateKey: KeyObject;
  #open: Tick[] = [];
  #previousRoot: string;
  #nextSequence: number | null;

  constructor(options: PublisherOptions) {
    if (!Number.isInteger(options.windowTicks) || options.windowTicks < 1) {
      throw new CommitmentError(
        `Window size must be a positive integer, received ${options.windowTicks}.`,
      );
    }
    // Validated at construction, not at first commit: a publisher that accepted a
    // hostile id and only failed once a window filled would already have created
    // its directory (Cycle Audit 4, M-5).
    assertAssetId(options.assetId);
    if (options.previousRoot !== undefined) assertPreviousRoot(options.previousRoot);
    if (options.previousRoot !== undefined && options.nextSequence === undefined) {
      throw new CommitmentError(
        'A publisher resuming from a chain tip must be told the sequence the next window ' +
          'starts at. Guessing would leave a hole or an overlap, and once published neither ' +
          'is distinguishable from tampering.',
      );
    }
    this.#assetId = options.assetId;
    this.#windowTicks = options.windowTicks;
    this.#privateKey = options.privateKey;
    this.#previousRoot = options.previousRoot ?? '';
    this.#nextSequence = options.nextSequence ?? null;
  }

  /** Ticks published but not yet inside a committed window. */
  get pendingTicks(): number {
    return this.#open.length;
  }

  /** Root of the most recently closed window, or `''` before the first. */
  get chainTip(): string {
    return this.#previousRoot;
  }

  /** Sequence the next window will start at, once one is known. */
  get nextSequence(): number | null {
    return this.#nextSequence;
  }

  /**
   * Consume published ticks, closing and signing every window that fills.
   *
   * Input must be contiguous and in sequence order. A gap is refused rather than
   * bridged: a publisher that quietly committed across a hole would produce a
   * chain that looks complete and is not, which is worse than no chain.
   */
  observe(ticks: readonly Tick[]): ClosedWindow[] {
    for (const tick of ticks) {
      const expected = this.#expectedSequence();
      if (expected !== null && tick.sequence !== expected) {
        throw new CommitmentError(
          `Publisher for ${this.#assetId} expected sequence ${expected} and received ` +
            `${tick.sequence}. A commitment chain cannot bridge a gap: the result would look ` +
            `complete and would not be.`,
        );
      }
      this.#open.push(tick);
      if (this.#nextSequence === null) this.#nextSequence = tick.sequence;
    }

    const closed: ClosedWindow[] = [];
    while (this.#open.length >= this.#windowTicks) {
      const window = this.#open.splice(0, this.#windowTicks);
      const commitment = commit(this.#assetId, window, this.#previousRoot);
      const signed = signCommitment(commitment, this.#privateKey);
      this.#previousRoot = commitment.root;
      this.#nextSequence = commitment.toSequence + 1;
      closed.push({ signed, ticks: window });
    }
    return closed;
  }

  #expectedSequence(): number | null {
    if (this.#open.length > 0) return this.#open[this.#open.length - 1]!.sequence + 1;
    return this.#nextSequence;
  }
}
