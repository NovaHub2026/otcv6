import {
  CursorLease,
  epochMillis,
  formatCursor,
  logPrice,
  parseCursor,
  type Clock,
  type Environment,
  type MasterKeyring,
  type RandomSource,
} from '@otc/core';
import {
  configFor,
  createMarketEngine,
  ENGINE_STREAM_PURPOSES,
  type RegisteredAsset,
} from '@otc/engine';
import { DEFAULT_MAX_CATCH_UP_MS, HostedMarket } from './hosted.js';
import { personalityFingerprint } from './personality.js';
import {
  assertUsableRecord,
  DEFAULT_SEQUENCE_LEASE,
  STATE_RECORD_VERSION,
  UnusableRecordError,
  type MarketStateRecord,
  type StateStore,
} from './state.js';

/** How far ahead keystream positions are reserved before being spent. */
export const DEFAULT_LEASE_BLOCKS = 4_096n;

/**
 * How a market came back.
 *
 * Named outcomes rather than a boolean, because the difference between them is
 * exactly what an operator needs to know: `resumed` means the market continued,
 * `seam` means it did not and there is a discontinuity in the record.
 */
export type RecoveryOutcome =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'resumed'; readonly fromSequence: number }
  | { readonly kind: 'seam'; readonly reason: string; readonly fromSequence: number | null };

/**
 * A hook on the engine's sign stream, for a composition that may have one.
 *
 * Given the keystream's own `sign` stream for an asset, returns the stream the
 * engine will draw its fair coin from. **The runtime's default is identity**,
 * and the production composition never supplies anything else — the Lab does
 * (PH-24.1), to play a chosen sign vector in lockstep with the keystream. Every
 * other stream is untouched: a hook here can decide which way a step goes and
 * nothing about how large it is, which is exactly the separation ADR-0003
 * rests on, and `stepIndependence.test.ts` verifies on the shipped engine.
 */
export type SignSourceFactory = (keystream: RandomSource, assetId: string) => RandomSource;

export interface ResumeOptions {
  readonly asset: RegisteredAsset;
  readonly keyring: MasterKeyring;
  readonly environment: Environment;
  readonly clock: Clock;
  readonly store: StateStore;
  readonly genesisInstant: EpochMillisLike;
  readonly leaseBlocks?: bigint;
  readonly maxCatchUpMs?: number;
  /** See {@link SignSourceFactory}. Absent means the keystream, untouched. */
  readonly signSource?: SignSourceFactory;
  /** The same, for the arrival stream (PH-24.13). Absent means the keystream, untouched. */
  readonly arrivalSource?: SignSourceFactory;
  /** See {@link HostedMarketOptions.retractable}. */
  readonly retractable?: boolean;
}

type EpochMillisLike = ReturnType<typeof epochMillis>;

export interface ResumeResult {
  readonly market: HostedMarket;
  readonly outcome: RecoveryOutcome;
}

/**
 * The streams an engine is built with: nothing, unless a sign source was given.
 *
 * The keystream sign stream is derived exactly as `createMarketEngine` derives
 * it — same environment, instrument id, purpose and epoch — so a transparent
 * wrapper is indistinguishable from no wrapper, and a cursor a caller supplies
 * is applied to the wrapper, which delegates the seek.
 */
function engineStreams(options: ResumeOptions): {
  streams?: Readonly<Partial<Record<string, RandomSource>>>;
} {
  if (options.signSource === undefined && options.arrivalSource === undefined) return {};
  const derive = (purpose: 'sign' | 'arrival'): RandomSource =>
    options.keyring.derive({
      env: options.environment,
      asset: configFor(options.asset).instrument.id,
      purpose,
      keyEpoch: 0,
    });
  const id = options.asset.definition.id;
  return {
    streams: {
      ...(options.signSource === undefined ? {} : { sign: options.signSource(derive('sign'), id) }),
      ...(options.arrivalSource === undefined
        ? {}
        : { arrival: options.arrivalSource(derive('arrival'), id) }),
    },
  };
}

/**
 * Bring a market back, choosing between continuing and admitting a seam.
 *
 * The two branches pull in opposite directions and both are correct, for
 * different failures:
 *
 * **Snapshot intact — continue.** Restore the latent state and let the clock
 * pull the market forward. Ticks that were published before the crash but never
 * persisted are regenerated, drawing the *same* keystream positions again. That
 * is not a reuse: deterministic replay reproduces the identical ticks, which is
 * precisely what INV-009 asks for and what keeps INV-002 true for an observer
 * who saw them the first time.
 *
 * **Snapshot unusable — take the seam.** Start from the last published price at
 * the leased high-water mark, discarding the reserved gap. The market jumps in
 * its internal state, but it never publishes a price derived from latent state
 * nobody can vouch for, and it never spends a keystream position twice.
 *
 * The check that separates them is executed, not assumed: a restored snapshot
 * must reproduce the record's own pending tick. If it does not, the record and
 * the engine disagree about what was drawn, and continuing would publish a
 * different market than the one observers already saw.
 */
export async function resumeMarket(options: ResumeOptions): Promise<ResumeResult> {
  const { asset, keyring, environment, clock, store } = options;
  const assetId = asset.definition.id;
  const leaseBlocks = options.leaseBlocks ?? DEFAULT_LEASE_BLOCKS;

  const personality = personalityFingerprint(asset);
  const record = await store.load(assetId);
  if (record === null) {
    return {
      market: freshMarket(options, undefined),
      outcome: { kind: 'fresh' },
    };
  }

  try {
    assertUsableRecord(record, assetId, personality);
  } catch (error) {
    if (!(error instanceof UnusableRecordError)) throw error;
    return seamFrom(options, record, error.detail, leaseBlocks);
  }

  const engine = createMarketEngine({
    config: configFor(asset),
    keyring,
    environment,
    ...engineStreams(options),
    start: { instant: options.genesisInstant, price: logPrice(0) },
  });
  try {
    engine.restore(record.snapshot);
  } catch (error) {
    return seamFrom(options, record, `snapshot rejected: ${(error as Error).message}`, leaseBlocks);
  }

  // The executed check. Restoring must reproduce the record's own pending tick;
  // a disagreement means the record does not describe this engine.
  if (record.pending !== null) {
    const engineForProbe = createMarketEngine({
      config: configFor(asset),
      keyring,
      environment,
      // Not hooked, deliberately. This engine exists to check the record against
      // the snapshot and is discarded; a sign source registered here would be
      // the one a Lab later armed, on an engine nothing hosts.
      start: { instant: options.genesisInstant, price: logPrice(0) },
    });
    engineForProbe.restore(record.snapshot);
    // `snapshot` is taken after the pending tick was drawn, so the pending tick
    // is not re-drawn — it is carried. What must agree is that the snapshot's
    // own position matches the tick the record says is outstanding.
    if (record.snapshot.sequence !== record.pending.sequence) {
      return seamFrom(
        options,
        record,
        `snapshot at sequence ${record.snapshot.sequence} but pending tick is ` +
          `${record.pending.sequence}`,
        leaseBlocks,
      );
    }
    if (record.snapshot.price !== record.pending.price) {
      return seamFrom(
        options,
        record,
        `snapshot price ${record.snapshot.price} disagrees with pending tick price ` +
          `${record.pending.price}`,
        leaseBlocks,
      );
    }
  }

  // **Cycle Audit 5, finding 1.** A checkpoint staler than the catch-up bound
  // cannot be resumed from: `HostedMarket` measures how far behind it is from
  // the checkpoint's instant, so the first advance is refused, nothing moves
  // `lastPublished` forward, and every advance after it is refused too. The
  // asset stopped for good — no seam, no lost lease, and `apps/api` discarded
  // the failure list, so nothing said why.
  //
  // ADR-0010 already decided what happens to an interval nobody observed: it is
  // refused and the record shows a gap. That rule belonged here as well as in
  // `advance`, and applying it turns a permanent wedge into the visible
  // discontinuity the failover actually is.
  // **Cycle Audit 7, CA7-07 and CA7-09.** This measured the age of the last
  // *tick*, and called it the checkpoint's age. Two consequences, in opposite
  // directions, from the same line:
  //
  // - A healthy market took a spurious seam. Markets tick irregularly by
  //   design — `spx` averages 3.4 seconds between ticks and its quiet stretches
  //   run far longer — so a checkpoint written one second ago, on a market that
  //   had been advanced every second for a minute and refused nothing, reported
  //   itself "18s old" and seamed. The message was false about its own subject.
  // - A market that had never published was declared perfectly fresh —
  //   `lastPublished === null ? 0` — however old its snapshot. `HostedMarket`
  //   then floored on that stale snapshot and refused every advance, checkpoint
  //   re-saved the same null, and the next boot repeated it. Measured: five
  //   consecutive restarts, all reporting `resumed`, all refusing, lag growing.
  //   A wedge no restart could clear.
  //
  // The record carries `savedAt`, which is the quantity the comment above
  // always described: when this checkpoint was written. Every record has one,
  // published or not, so both cases collapse into the same honest question.
  if (record.controlled === true) {
    // **Cycle Audit 8 (a6).** Continuing means regenerating the ticks that were
    // published and never persisted, and that is safe only because the
    // regeneration is deterministic — the same keystream positions give the same
    // ticks. A market whose signs a composition chose has no such guarantee: the
    // script is deliberately absent from the snapshot ("a restart is a
    // release"), so the same sequence numbers would come back with the
    // keystream's own signs and different prices. Two observers either side of
    // the restart would hold irreconcilable histories, and a position settled
    // before it would point at a price the record no longer shows.
    //
    // The seam costs a jump in latent state and spends no keystream position
    // twice, which is the trade this branch exists to make.
    return seamFrom(
      options,
      record,
      "the checkpoint was written while a composition was choosing this market's signs, so the " +
        'ticks after it cannot be regenerated as they were published',
      leaseBlocks,
    );
  }

  const maxCatchUpMs = options.maxCatchUpMs ?? DEFAULT_MAX_CATCH_UP_MS;
  const staleness = clock.now() - record.savedAt;
  if (staleness > maxCatchUpMs) {
    return seamFrom(
      options,
      record,
      `the checkpoint is ${Math.round(staleness / 1000)}s old, past the ` +
        `${Math.round(maxCatchUpMs / 1000)}s catch-up bound, so the interval since it cannot ` +
        `be generated`,
      leaseBlocks,
    );
  }

  return {
    market: new HostedMarket({
      engine,
      clock,
      personality,
      resumePending: record.pending,
      resumeLastPublished: record.lastPublished,
      ...(options.maxCatchUpMs === undefined ? {} : { maxCatchUpMs: options.maxCatchUpMs }),
      ...(options.retractable === undefined ? {} : { retractable: options.retractable }),
    }),
    outcome: {
      kind: 'resumed',
      fromSequence: record.lastPublished?.sequence ?? record.snapshot.sequence,
    },
  };
}

function freshMarket(
  options: ResumeOptions,
  cursors: Record<string, string> | undefined,
): HostedMarket {
  const engine = createMarketEngine({
    config: configFor(options.asset),
    keyring: options.keyring,
    environment: options.environment,
    ...engineStreams(options),
    start: { instant: options.genesisInstant, price: logPrice(0) },
    ...(cursors === undefined ? {} : { cursors }),
  });
  return new HostedMarket({
    engine,
    clock: options.clock,
    personality: personalityFingerprint(options.asset),
    ...(options.maxCatchUpMs === undefined ? {} : { maxCatchUpMs: options.maxCatchUpMs }),
    ...(options.retractable === undefined ? {} : { retractable: options.retractable }),
  });
}

/**
 * Restart beyond every reserved position, accepting a visible discontinuity.
 *
 * The latent state is gone, so the market resumes from the last price anyone is
 * known to have seen, with every stream moved past its lease. PH-3 measured a
 * seam of exactly this shape and found it invisible in the return statistics —
 * but the internal state genuinely restarts, and calling that "resumed" would be
 * a lie an operator would later have to debug.
 */
function seamFrom(
  options: ResumeOptions,
  record: MarketStateRecord,
  reason: string,
  leaseBlocks: bigint,
): ResumeResult {
  const cursors: Record<string, string> = {};
  for (const purpose of ENGINE_STREAM_PURPOSES) {
    // Floored at the record's OWN snapshot cursors, not merely at its leases.
    // The leases are part of the record we have just declared untrustworthy, and
    // a missing or damaged entry silently became `startAt = 0` — restarting the
    // sign stream, the one line in the engine that touches direction, at cursor
    // 0:0 against positions already spent.
    const leased = record.leasedBlocks[purpose];
    const consumed = record.snapshot?.cursors?.[purpose];
    if (leased === undefined && consumed === undefined) {
      throw new UnusableRecordError(
        record.assetId,
        `no lease or cursor evidence for stream "${purpose}", so a safe seam position is unknown`,
      );
    }
    const fromLease = leased === undefined ? 0n : parseCursor(leased).blockIndex;
    const fromSnapshot =
      consumed === undefined ? 0n : parseCursor(consumed).blockIndex + leaseBlocks;
    const floor = fromLease > fromSnapshot ? fromLease : fromSnapshot;
    const lease = CursorLease.resume(floor, leaseBlocks);
    cursors[purpose] = formatCursor({ blockIndex: lease.startAt, byteOffset: 0 });
  }

  // Forward only, in both time and sequence.
  //
  // Starting from the record's own `lastPublished.instant` rewound the clock to
  // the last checkpoint and regenerated the interval that had already been
  // published — with different prices, because the latent state is gone. An
  // audit probe measured 146 republished ticks landing inside the observed
  // window, one instant carrying two prices 935 lattice steps apart, and the
  // sequence restarting at 1. Two observers either side of that restart hold
  // irreconcilable histories, which is INV-002 broken outright.
  //
  // So the seam opens at the clock, not at the checkpoint: the gap stays a gap,
  // which is honest, because the venue really was down. The price carries over
  // so the market does not jump, and the sequence continues so no number is ever
  // published twice under one asset id.
  const now = options.clock.now();
  const start =
    record.lastPublished === null
      ? {
          // **Cycle Audit 7, CA7-07.** This opened at genesis, which contradicts
          // the paragraph immediately above it: the seam opens at the clock
          // precisely so the gap stays a gap. A record that had never published
          // — the process died before its first tick — was seamed back to
          // genesis and was therefore instantly behind by the entire elapsed
          // time, so `HostedMarket` refused its first advance and every one
          // after it. Nothing moved the floor, the checkpoint re-saved the same
          // null, and the next boot repeated it. A wedge no restart could clear.
          //
          // Forward only, here as everywhere else on this path.
          instant: epochMillis(Math.max(options.genesisInstant, now)),
          price: logPrice(0),
        }
      : {
          instant: epochMillis(Math.max(record.lastPublished.instant, now)),
          price: record.lastPublished.price,
          // The reserved number, not the recorded one: the record is stale by
          // construction after an unclean crash.
          sequence: Math.max(
            record.leasedSequence ?? 0,
            record.lastPublished.sequence + DEFAULT_SEQUENCE_LEASE,
          ),
        };

  const engine = createMarketEngine({
    config: configFor(options.asset),
    keyring: options.keyring,
    environment: options.environment,
    ...engineStreams(options),
    start,
    cursors,
  });
  return {
    market: new HostedMarket({
      engine,
      clock: options.clock,
      personality: personalityFingerprint(options.asset),
      ...(record.lastPublished === null ? {} : { resumeLastPublished: record.lastPublished }),
      ...(options.maxCatchUpMs === undefined ? {} : { maxCatchUpMs: options.maxCatchUpMs }),
      ...(options.retractable === undefined ? {} : { retractable: options.retractable }),
    }),
    outcome: { kind: 'seam', reason, fromSequence: record.lastPublished?.sequence ?? null },
  };
}

/**
 * Capture a market's state for persistence.
 *
 * Leases are written *ahead* of where the engine has reached, so a crash between
 * checkpoints can never leave a consumed position unreserved.
 */
export function checkpointMarket(
  market: HostedMarket,
  assetId: string,
  savedAt: ReturnType<typeof epochMillis>,
  leaseBlocks: bigint = DEFAULT_LEASE_BLOCKS,
  /**
   * Whether a composition chose this market's signs since the previous clean
   * checkpoint (Cycle Audit 8, a6). The runtime does not know what a Lab is; it
   * is told, and `resumeMarket` refuses to continue a record that says yes.
   */
  controlled = false,
): MarketStateRecord {
  const snapshot = market.snapshotEngine();
  const leasedBlocks: Record<string, string> = {};
  for (const [purpose, cursor] of Object.entries(snapshot.cursors)) {
    const consumed = parseCursor(cursor).blockIndex;
    leasedBlocks[purpose] = formatCursor({
      blockIndex: consumed + leaseBlocks,
      byteOffset: 0,
    });
  }
  // `lastPublishedState`, not `lastPublished`. The latter is only what THIS
  // process emitted, so a resumed market checkpointing before its first publish
  // wrote `lastPublished: null` and erased the durable history — the read path
  // was fixed in PH-5.3 and the write path was not. The measured consequences
  // were a disabled catch-up bound and a 1,347-step price reset on a later seam.
  const last = market.lastPublishedState;
  const highestKnown = Math.max(last?.sequence ?? 0, market.pending?.sequence ?? 0);
  return {
    version: STATE_RECORD_VERSION,
    assetId,
    ...(market.personality === null ? {} : { personality: market.personality }),
    savedAt,
    snapshot,
    pending: market.pending,
    lastPublished:
      last === null ? null : { sequence: last.sequence, instant: last.instant, price: last.price },
    leasedBlocks,
    leasedSequence: highestKnown + DEFAULT_SEQUENCE_LEASE,
    ...(controlled ? { controlled: true } : {}),
  };
}
