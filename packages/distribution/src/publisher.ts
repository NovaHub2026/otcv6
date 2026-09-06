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
 *
 * ## …until the chain stops, and then it is closed short
 *
 * The rationale above is about *extending* a committed window, and it holds
 * only while more ticks are coming. Where the chain ends — a clean stop, a
 * retirement, a seam that starts the coverage again somewhere else — the open
 * window is never extended, so leaving it open buys nothing and costs the
 * record its own tail. Cycle Audit 10 (a6-03) measured that cost in the
 * release run's artefacts: **5,749 ticks served, in no committed window, in
 * all thirty markets**, permanently, because every deploy abandoned what was
 * open. {@link sealChain} closes it, however short, and the next window starts
 * after it — a short link mid-chain, never two roots over one range.
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
  /**
   * Resume the chain after an interval nobody published (Cycle Audit 10).
   *
   * Given alongside `previousRoot` and *instead of* `nextSequence`: this is
   * the case where the next sequence is genuinely unknown, because a seam or
   * a trimmed record put a gap ahead. The first window this publisher closes
   * binds `previousRoot` and declares `resumesAfter`, so the gap is stated by
   * a signed link rather than left as two chains bound by nothing.
   *
   * If the first tick turns out to continue `resumesAfter` exactly, there is
   * no gap and an ordinary link is written instead.
   */
  readonly resumesAfter?: number;
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
  #tipSequence: number | null;
  #resumesAfter: number | null;

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
    if (
      options.previousRoot !== undefined &&
      options.nextSequence === undefined &&
      options.resumesAfter === undefined
    ) {
      throw new CommitmentError(
        'A publisher resuming from a chain tip must be told the sequence the next window ' +
          'starts at, or the sequence it resumes after. Guessing would leave a hole or an ' +
          'overlap, and once published neither is distinguishable from tampering.',
      );
    }
    if (options.resumesAfter !== undefined) {
      if (options.previousRoot === undefined || options.previousRoot === '') {
        throw new CommitmentError(
          'A publisher told what it resumes after must be told the root it resumes after too: ' +
            'the point of a resume link is that it binds the head the earlier run ended at.',
        );
      }
      if (options.nextSequence !== undefined) {
        throw new CommitmentError(
          'A publisher cannot both resume after a gap and know the sequence its next window ' +
            'starts at. One of those is a claim about a gap and the other denies there is one.',
        );
      }
    }
    this.#assetId = options.assetId;
    this.#windowTicks = options.windowTicks;
    this.#privateKey = options.privateKey;
    this.#previousRoot = options.previousRoot ?? '';
    this.#nextSequence = options.nextSequence ?? null;
    this.#resumesAfter = options.resumesAfter ?? null;
    this.#tipSequence =
      options.nextSequence !== undefined
        ? options.nextSequence - 1
        : (options.resumesAfter ?? null);
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

  /** Last sequence the chain tip covers, or null before any window is closed. */
  get tipSequence(): number | null {
    return this.#tipSequence;
  }

  /**
   * Close the open window now, however short, and return it.
   *
   * For the moment the chain stops growing here: a clean stop, a retirement,
   * or a seam that resumes the coverage somewhere else. The window is never
   * extended afterwards — the next window starts at the sequence after this
   * one — so the objection to committing a partial window does not apply, and
   * the record's tail is provable instead of abandoned (Cycle Audit 10,
   * a6-03).
   *
   * Idempotent, and null when nothing is open.
   */
  sealChain(): ClosedWindow | null {
    if (this.#open.length === 0) return null;
    const window = this.#open.splice(0, this.#open.length);
    return this.#close(window);
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
      // The first tick a resuming publisher sees decides which of three shapes
      // the link takes, and only the first two are resumes.
      //
      // - **beyond the head** — a gap: bind it and declare it ({@link #close}).
      // - **the head plus one** — no gap after all: an ordinary link, and a
      //   declaration with nothing behind it would be noise in the record.
      // - **at or before the head** — the record has gone backwards, which is
      //   PH-28.3's own case: a market resumed from a checkpoint that lies
      //   behind the chain's tip because the record it would have been folded
      //   from is gone. One chain cannot hold two roots over one range, and a
      //   resume link that declared this would be a lie about where its
      //   predecessor ended. So the chain restarts at an empty root, exactly as
      //   it did before Cycle Audit 10, and the file verifier reports the break
      //   as **unbound** — which is what an unbound break is for. Refusing
      //   instead would stop the market rather than record what happened to it,
      //   and a chain a verifier can read beats a market that will not run.
      if (this.#resumesAfter !== null && this.#nextSequence === null) {
        if (tick.sequence <= this.#resumesAfter) {
          this.#previousRoot = '';
          this.#resumesAfter = null;
          this.#tipSequence = null;
        } else if (tick.sequence === this.#resumesAfter + 1) {
          this.#resumesAfter = null;
        }
      }
      this.#open.push(tick);
      if (this.#nextSequence === null) this.#nextSequence = tick.sequence;
    }

    const closed: ClosedWindow[] = [];
    while (this.#open.length >= this.#windowTicks) {
      closed.push(this.#close(this.#open.splice(0, this.#windowTicks)));
    }
    return closed;
  }

  /** Commit and sign one window, whatever closed it, and advance the chain. */
  #close(window: readonly Tick[]): ClosedWindow {
    // The resume declaration belongs to the first window this publisher closes
    // and to no other: after it the chain is contiguous again and an ordinary
    // link is the truth. What shape this window takes was decided by the first
    // tick, in `observe`; by here `#resumesAfter` is set only where there is a
    // gap to declare.
    const resumesAfter = this.#resumesAfter ?? undefined;
    const commitment = commit(this.#assetId, window, this.#previousRoot, resumesAfter);
    const signed = signCommitment(commitment, this.#privateKey);
    this.#previousRoot = commitment.root;
    this.#nextSequence = commitment.toSequence + 1;
    this.#tipSequence = commitment.toSequence;
    this.#resumesAfter = null;
    return { signed, ticks: [...window] };
  }

  #expectedSequence(): number | null {
    if (this.#open.length > 0) return this.#open[this.#open.length - 1]!.sequence + 1;
    return this.#nextSequence;
  }
}
