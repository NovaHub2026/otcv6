import { epochMillis, type EpochMillis, type Tick } from '@otc/core';
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
}

/** Thrown when a session is asked to advance after losing its lease. */
export class LeadershipLostError extends Error {
  constructor(readonly assetId: string) {
    super(
      `Leadership of ${assetId} has been lost. This session generates nothing further: the ` +
        `keystream positions it would spend belong to whoever holds the lease now.`,
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
 * 4. append under the fence;
 * 5. checkpoint on a cadence.
 *
 * Step 1 comes first because a session that advanced and renewed afterwards
 * would generate ticks it has no authority to publish, and the fence would
 * refuse them only *after* the keystream had been spent. The positions would be
 * gone, consumed by a node that no longer leads, and the rightful leader would
 * have to seam past them.
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
    let seam: SeamMarker | null = null;

    if (this.#pendingSeam !== null && ticks.length > 0) {
      const first = ticks[0]!;
      // The record's head, not the checkpoint's last published sequence. A dead
      // leader appends every tick it publishes and checkpoints only on a
      // cadence, so the record routinely runs ahead of the state it resumed
      // from — by exactly the ticks that were published and never persisted. A
      // seam claiming the checkpoint's sequence would be refused for not
      // continuing the record, and it would be right to refuse it.
      const head = await this.#store.recordHead(this.assetId);
      seam = {
        assetId: this.assetId,
        lastSequence: head,
        lastInstant: await this.#lastRecordedInstant(head),
        resumesAtSequence: first.sequence,
        resumesAtInstant: first.instant,
        reason: this.#pendingSeam.reason,
      };
      await this.#store.recordSeam(this.assetId, this.#lease.token, seam);
      this.#pendingSeam = null;
    }

    if (ticks.length > 0) {
      await this.#store.appendTicks(this.assetId, this.#lease.token, ticks);
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
    return { ticks, seam, checkpointed: due };
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

  /** Checkpoint now, whatever the cadence says. */
  async checkpoint(now: EpochMillis): Promise<void> {
    await this.#store.saveFenced(
      checkpointMarket(this.market, this.assetId, epochMillis(now)),
      this.#lease.token,
    );
    this.#lastCheckpointAt = now;
  }

  /** Give leadership up, so a successor need not wait out the term. */
  async release(): Promise<void> {
    await this.#lease.release();
  }
}
