import { epochMillis, type EpochMillis, type Tick } from '@otc/core';
import { StaleFenceError } from './fence.js';
import type { HostedMarket } from './hosted.js';
import { AssetLease, type CoordinatedStore, type LeaseGrant } from './lease.js';
import {
  resumeMarket,
  checkpointMarket,
  type RecoveryOutcome,
  type ResumeOptions,
} from './resume.js';
import type { SeamMarker } from './replication.js';

/**
 * How often a running session checkpoints, in market milliseconds.
 *
 * **Strictly inside the catch-up bound, and that is the constraint.** At 30
 * seconds — twice `DEFAULT_MAX_CATCH_UP_MS` — a successor routinely resumed
 * from a checkpoint already too stale to catch up from, and the asset stopped
 * permanently and silently (Cycle Audit 5, finding 1). Five seconds is the
 * cadence `apps/api` had chosen for itself all along; the default now agrees
 * with it, and `failoverBound.test.ts` asserts the relationship rather than
 * leaving two constants to drift.
 */
export const DEFAULT_CHECKPOINT_INTERVAL_MS = 5_000;

/**
 * Consecutive failures to append to the record a session tolerates before it
 * gives leadership up.
 *
 * A shared store is allowed to be busy: `SqliteCoordinatedStore` refuses with
 * "database is locked" after its busy timeout, and one such refusal is not a
 * discontinuity. But a leader that cannot write is a leader whose observers
 * see a market the record does not hold, and after a few consecutive refusals
 * the honest outcome is the one ADR-0012 names for any discontinuity — a
 * visible seam under a successor — rather than a node publishing ticks it
 * never records. Three at the five-second cadence is fifteen seconds, the
 * catch-up bound: a store unreachable for longer than that has already cost
 * the successor a seam, so nothing is lost by stepping aside there.
 */
export const MAX_CONSECUTIVE_APPEND_FAILURES = 3;

export interface TakeOverOptions extends Omit<ResumeOptions, 'store'> {
  readonly store: CoordinatedStore;
  /** Identifies this *process*. See `PH-14.1` §6. */
  readonly holder: string;
  readonly checkpointIntervalMs?: number;
}

/** What happened when a node tried to take an asset over. */
export type TakeOverResult =
  | { readonly kind: 'led'; readonly session: LeaderSession }
  | { readonly kind: 'declined'; readonly heldBy: LeaseGrant };

/** What one advance of a leader session did. */
export interface SessionAdvance {
  readonly ticks: readonly Tick[];
  /** The seam recorded during this advance, if this was the first tick after one. */
  readonly seam: SeamMarker | null;
  readonly checkpointed: boolean;
  /**
   * Ticks this session has generated that the record does not yet hold.
   *
   * Zero in the ordinary case. Non-zero after the store refused the append
   * (a5-03): the ticks were published to this node's observers and are kept,
   * to be appended before anything newer on the next advance. No checkpoint
   * is written while any are outstanding, so a successor never resumes from a
   * position the record has not reached.
   */
  readonly unrecorded: number;
  /** The store's refusal, when `unrecorded` is non-zero. */
  readonly recordError: Error | null;
}

/**
 * Thrown when a session is asked to advance after losing its lease.
 *
 * Carries the store's refusal as `cause` when leadership was given up because
 * the record could not be written (a5-03), so the caller can say why.
 */
export class LeadershipLostError extends Error {
  constructor(
    readonly assetId: string,
    cause?: Error,
  ) {
    super(
      `Leadership of ${assetId} has been lost. This session generates nothing further: the ` +
        `keystream positions it would spend belong to whoever holds the lease now.` +
        (cause === undefined
          ? ''
          : ` Given up because the record refused writes: ${cause.message}`),
      cause === undefined ? {} : { cause },
    );
    this.name = 'LeadershipLostError';
  }
}

/**
 * One node leading one asset.
 *
 * The loop, and the order within it is the whole content:
 *
 * 1. renew the lease, and stop if it is lost — **before** generating anything;
 * 2. advance the market;
 * 3. record a pending seam, once, at the first tick that follows it;
 * 4. append under the fence — every tick generated and not yet recorded,
 *    oldest first;
 * 5. checkpoint on a cadence, and only once the record holds everything.
 *
 * Step 1 comes first because a session that advanced and renewed afterwards
 * would generate ticks it has no authority to publish, and the fence would
 * refuse them only *after* the keystream had been spent. The positions would be
 * gone, consumed by a node that no longer leads, and the rightful leader would
 * have to seam past them.
 *
 * Step 4 says "not yet recorded" rather than "just generated" because of
 * **a5-03**: the store may refuse an append — a lock timeout on a shared file
 * is an ordinary event — and the market has already advanced by then. A session
 * that appended only what it had just generated left the record behind for
 * ever: every later append was a gap, correctly refused, while the node kept
 * publishing to its observers, recorded no seam and never lost its lease.
 * Measured: record head 1, market at sequence 8, five refused appends. So what
 * the store refused is kept and retried first, and after
 * {@link MAX_CONSECUTIVE_APPEND_FAILURES} the session steps aside.
 *
 * Step 5 waits on step 4 for the successor's sake. It resumes from the
 * checkpoint and appends from that position; a checkpoint ahead of the record
 * would make its first append a gap, and the wedge would pass from one leader
 * to the next. **The record leads the checkpoint**, always.
 */
export class LeaderSession {
  readonly assetId: string;
  readonly market: HostedMarket;
  readonly recovery: RecoveryOutcome;
  readonly #lease: AssetLease;
  readonly #store: CoordinatedStore;
  readonly #checkpointIntervalMs: number;
  /**
   * A seam that has happened but cannot yet be recorded.
   *
   * `resumeMarket` reports a seam before the resuming sequence and instant
   * exist — they are properties of the first tick the seamed market produces.
   * So the seam is held until that tick arrives and recorded immediately before
   * it, which is also the only order in which the record stays readable: a seam
   * with no ticks after it would leave `expectNext` pointing at a sequence that
   * may never be produced.
   */
  #pendingSeam: { readonly reason: string } | null;
  #lastCheckpointAt: EpochMillis | null = null;
  /** Generated and published here, not yet accepted by the record. Oldest first. */
  #unrecorded: Tick[] = [];
  #consecutiveAppendFailures = 0;

  private constructor(
    assetId: string,
    market: HostedMarket,
    recovery: RecoveryOutcome,
    lease: AssetLease,
    store: CoordinatedStore,
    checkpointIntervalMs: number,
    pendingSeam: { readonly reason: string } | null,
  ) {
    this.assetId = assetId;
    this.market = market;
    this.recovery = recovery;
    this.#lease = lease;
    this.#store = store;
    this.#checkpointIntervalMs = checkpointIntervalMs;
    this.#pendingSeam = pendingSeam;
  }

  /**
   * Claim an asset and resume it from the record.
   *
   * Declines rather than waits if another node holds the lease. Waiting would
   * be a policy — how long, how often — and the caller is the one with the loop.
   */
  static async takeOver(options: TakeOverOptions): Promise<TakeOverResult> {
    const assetId = options.asset.definition.id;
    const lease = await AssetLease.acquire(options.store, assetId, options.holder);
    if (!(lease instanceof AssetLease)) return { kind: 'declined', heldBy: lease.heldBy };

    const { market, outcome } = await resumeMarket(options);
    const pendingSeam = outcome.kind === 'seam' ? { reason: outcome.reason } : null;
    return {
      kind: 'led',
      session: new LeaderSession(
        assetId,
        market,
        outcome,
        lease,
        options.store,
        options.checkpointIntervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS,
        pendingSeam,
      ),
    };
  }

  get token(): number {
    return this.#lease.token;
  }

  /** True once a renewal has been refused. */
  get lost(): boolean {
    return this.#lease.lost;
  }

  /** A seam this session owes the record, held until its first tick arrives. */
  get pendingSeam(): boolean {
    return this.#pendingSeam !== null;
  }

  /**
   * Renew, generate, record, append, checkpoint.
   *
   * Throws {@link LeadershipLostError} rather than returning empty when the
   * lease has gone. A silent empty result reads as "the market produced nothing
   * this tick", which is the ordinary case, and a leader that had lost its lease
   * would look identical to one that was simply idle.
   */
  async advance(now: EpochMillis): Promise<SessionAdvance> {
    if (!(await this.#lease.renew())) throw new LeadershipLostError(this.assetId);

    const ticks = this.market.advance();
    this.#unrecorded.push(...ticks);
    let seam: SeamMarker | null = null;

    if (this.#unrecorded.length > 0) {
      try {
        seam = await this.#recordPendingSeam(this.#unrecorded[0]!);
        await this.#store.appendTicks(this.assetId, this.#lease.token, this.#unrecorded);
      } catch (error) {
        return this.#recordRefused(ticks, seam, error);
      }
      this.#unrecorded = [];
      this.#consecutiveAppendFailures = 0;
    }

    const due =
      this.#lastCheckpointAt === null || now - this.#lastCheckpointAt >= this.#checkpointIntervalMs;
    if (due) {
      await this.#store.saveFenced(
        checkpointMarket(this.market, this.assetId, now),
        this.#lease.token,
      );
      this.#lastCheckpointAt = now;
    }
    return { ticks, seam, checkpointed: due, unrecorded: 0, recordError: null };
  }

  /**
   * Record the seam this session owes, immediately before its first tick.
   *
   * Returns the marker written, or null when none was owed.
   */
  async #recordPendingSeam(first: Tick): Promise<SeamMarker | null> {
    if (this.#pendingSeam === null) return null;
    // The record's head, not the checkpoint's last published sequence. A dead
    // leader appends every tick it publishes and checkpoints only on a
    // cadence, so the record routinely runs ahead of the state it resumed
    // from — by exactly the ticks that were published and never persisted. A
    // seam claiming the checkpoint's sequence would be refused for not
    // continuing the record, and it would be right to refuse it.
    const head = await this.#store.recordHead(this.assetId);
    const seam: SeamMarker = {
      assetId: this.assetId,
      lastSequence: head,
      lastInstant: await this.#lastRecordedInstant(head),
      resumesAtSequence: first.sequence,
      resumesAtInstant: first.instant,
      reason: this.#pendingSeam.reason,
    };
    await this.#store.recordSeam(this.assetId, this.#lease.token, seam);
    this.#pendingSeam = null;
    return seam;
  }

  /**
   * The store refused to take the record forward.
   *
   * A stale fence is not transient — the token will never be accepted again —
   * and is leadership lost, whatever the renewal a moment ago said. Anything
   * else is counted, kept for retry, and reported; at the bound the session
   * releases its lease so a successor takes over at once rather than after the
   * term, and throws rather than returns, because a leader that has stopped
   * must not look like one that was idle.
   */
  async #recordRefused(
    ticks: readonly Tick[],
    seam: SeamMarker | null,
    error: unknown,
  ): Promise<SessionAdvance> {
    const refusal = error instanceof Error ? error : new Error(String(error));
    if (refusal instanceof StaleFenceError) {
      await this.#lease.release();
      throw new LeadershipLostError(this.assetId, refusal);
    }
    this.#consecutiveAppendFailures += 1;
    if (this.#consecutiveAppendFailures >= MAX_CONSECUTIVE_APPEND_FAILURES) {
      await this.#lease.release();
      throw new LeadershipLostError(this.assetId, refusal);
    }
    return {
      ticks,
      seam,
      checkpointed: false,
      unrecorded: this.#unrecorded.length,
      recordError: refusal,
    };
  }

  /** The instant of a recorded sequence, for a seam this process did not publish. */
  async #lastRecordedInstant(sequence: number | null): Promise<EpochMillis | null> {
    if (sequence === null) return null;
    const entries = await this.#store.readRecord(this.assetId, sequence, 1);
    const entry = entries[0];
    return entry !== undefined && entry.kind === 'tick' && entry.tick.sequence === sequence
      ? entry.tick.instant
      : null;
  }

  /**
   * Checkpoint now, whatever the cadence says.
   *
   * Not before the record holds everything this session published: the
   * outstanding ticks are appended first, and if the store still refuses them
   * the checkpoint is not written. A checkpoint ahead of the record is the one
   * thing that would hand the wedge of a5-03 to the successor.
   */
  async checkpoint(now: EpochMillis): Promise<void> {
    if (this.#unrecorded.length > 0) {
      try {
        await this.#recordPendingSeam(this.#unrecorded[0]!);
        await this.#store.appendTicks(this.assetId, this.#lease.token, this.#unrecorded);
      } catch (error) {
        this.#consecutiveAppendFailures += 1;
        throw error;
      }
      this.#unrecorded = [];
      this.#consecutiveAppendFailures = 0;
    }
    await this.#store.saveFenced(
      checkpointMarket(this.market, this.assetId, epochMillis(now)),
      this.#lease.token,
    );
    this.#lastCheckpointAt = now;
  }

  /** Ticks published by this session that the record does not yet hold. */
  get unrecorded(): number {
    return this.#unrecorded.length;
  }

  /** Give leadership up, so a successor need not wait out the term. */
  async release(): Promise<void> {
    await this.#lease.release();
  }
}
