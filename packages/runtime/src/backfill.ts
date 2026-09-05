import { epochMillis, logPrice, SteppableClock, type EpochMillis, type Tick } from '@otc/core';
import { yieldToLoop } from '@otc/core';
import { configFor, createMarketEngine, type RegisteredAsset } from '@otc/engine';
import type { Environment, MasterKeyring } from '@otc/core';
import { DEFAULT_MAX_CATCH_UP_MS, HostedMarket } from './hosted.js';
import { personalityFingerprint } from './personality.js';
import {
  HistoryRecorder,
  HISTORY_BASE_TIMEFRAME,
  refreshRollup,
  type CandleHistory,
} from './history.js';
import { checkpointMarket, DEFAULT_LEASE_BLOCKS } from './resume.js';
import type { StateStore } from './state.js';

/**
 * A market that already has a past on the day it opens.
 *
 * The product wants a chart with ninety days on it from the first frame. The
 * process is deterministic given a keyring, a genesis instant and a genesis
 * price, so a market whose genesis is ninety days ago and which has been
 * advanced to now is not a simulation of history: it is the history, generated
 * once, recorded once, and continued live from the same latent state.
 *
 * ## Why this is the live path and not a special one
 *
 * The obvious implementation drives the engine directly and skips the runtime.
 * That would be a second way of producing prices, and the property the whole
 * product rests on is that there is exactly one (INV-003). Any divergence
 * between the two would appear as a chart that disagrees with the record at
 * precisely the seam where the backfill ends.
 *
 * So this uses `HostedMarket.advanceTo` in steps no larger than the catch-up
 * bound, against a clock that moves faster than wall time. Every tick is
 * published by the same code that will publish the next one after the backfill
 * finishes, and `backfill.test.ts` asserts that a backfilled-then-continued
 * market is tick-for-tick identical to one that ran live throughout.
 *
 * ## Why it refuses to run twice
 *
 * A backfill is genesis. If a record already exists, the market has a past and
 * generating another one would publish a second, different history under the
 * same asset id (INV-002), spend keystream positions twice (INV-010), and make
 * every settlement recorded against the old series unreproducible (INV-009).
 *
 * It also closes a subtler door. A backfill that could be repeated could be
 * repeated *until the chart looked good*, and the operator choosing the seed
 * would be choosing the prices. Refusing once a record exists means the history
 * an asset gets is the first one it was given.
 */

export class BackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillError';
  }
}

export interface BackfillOptions {
  readonly asset: RegisteredAsset;
  readonly keyring: MasterKeyring;
  readonly environment: Environment;
  /** The instant the market is to have started. */
  readonly genesisInstant: EpochMillis;
  /** The instant it is to have reached. */
  readonly targetInstant: EpochMillis;
  readonly store: StateStore;
  readonly history: CandleHistory;
  /**
   * Simulated clock step.
   *
   * Must not exceed the catch-up bound, because exceeding it is exactly what
   * the bound forbids and a backfill has no more authority to invent an
   * unobserved interval than a running venue does. Smaller steps cost more
   * calls and change nothing about the output.
   */
  readonly stepMs?: number;
  /**
   * How much of the tick tail to hand back, in milliseconds before the target.
   *
   * Ticks older than this are folded into candles and dropped. What is kept is
   * what a settlement can still be disputed against; `retention.ts` owns that
   * policy and this only needs to be told the answer.
   */
  readonly tickRetentionMs?: number;
  /** Called with each batch of ticks as they are produced, oldest first. */
  readonly onTicks?: (ticks: readonly Tick[]) => void | Promise<void>;
  /** Steps between yields to the event loop. */
  readonly chunkSteps?: number;
}

export interface BackfillResult {
  readonly assetId: string;
  readonly genesisInstant: EpochMillis;
  readonly targetInstant: EpochMillis;
  readonly ticksGenerated: number;
  readonly baseCandles: number;
  readonly rollupCandles: number;
  /** The tail of the tick record, within `tickRetentionMs` of the target. */
  readonly retainedTicks: readonly Tick[];
  /**
   * The recorder that folded every tick of the backfill, still holding the
   * minute containing the target open.
   *
   * Handed on for the same reason the market is (a5-01). The caller that
   * carries this market forward must carry *this* recorder forward too: a fresh
   * one started at the join opens the target's minute wherever the first live
   * tick lands and stores it as whole. Measured at a join thirty seconds into a
   * minute: that minute stored with 8 of its 18 ticks, its open 713 against a
   * true 672 and its high 743 missing — in the permanent base tier, from which
   * the hourly tier is then faithfully derived.
   */
  readonly recorder: HistoryRecorder;
  /**
   * The market itself, at the target instant.
   *
   * Returned because the checkpoint is not the only way to hand it on, and the
   * round trip through one is what **Cycle Audit 6 (F1)** falsified: generating
   * a past costs wall-clock time, so by the time `resumeMarket` reads that
   * checkpoint it is older than the catch-up bound and the market seams — the
   * latent state the backfill spent ninety simulated days building, discarded at
   * exactly the join it exists to make. Measured on the running service: four of
   * five markets seamed after a three-day provisioning.
   *
   * A caller that is going to keep running this market should keep *this* and
   * advance it, rather than write a checkpoint and read it back.
   */
  readonly market: HostedMarket;
}

/** Ticks retained by default: one hour, comfortably past the longest contract. */
export const DEFAULT_BACKFILL_TICK_RETENTION_MS = 60 * 60 * 1000;

/** Steps between event-loop yields. At a 15s step this is about nine hours. */
export const DEFAULT_BACKFILL_CHUNK_STEPS = 2_048;

export async function backfillMarket(options: BackfillOptions): Promise<BackfillResult> {
  const assetId = options.asset.definition.id;
  const stepMs = options.stepMs ?? DEFAULT_MAX_CATCH_UP_MS;
  const retentionMs = options.tickRetentionMs ?? DEFAULT_BACKFILL_TICK_RETENTION_MS;
  const chunkSteps = options.chunkSteps ?? DEFAULT_BACKFILL_CHUNK_STEPS;

  if (options.targetInstant <= options.genesisInstant) {
    throw new BackfillError(
      `A backfill needs a target after its genesis, got ${options.genesisInstant} to ` +
        `${options.targetInstant}.`,
    );
  }
  if (!Number.isFinite(stepMs) || stepMs <= 0) {
    throw new BackfillError(`A backfill step must be positive, got ${stepMs}.`);
  }
  if (stepMs > DEFAULT_MAX_CATCH_UP_MS) {
    throw new BackfillError(
      `A backfill step of ${stepMs}ms exceeds the ${DEFAULT_MAX_CATCH_UP_MS}ms catch-up bound. ` +
        `The bound exists so no unobserved burst can span a contract (ADR-0010), and a ` +
        `backfill has no more authority to invent one than a running venue does.`,
    );
  }
  if (!Number.isFinite(retentionMs) || retentionMs < 0) {
    throw new BackfillError(`Tick retention must be a non-negative number, got ${retentionMs}.`);
  }

  const existing = await options.store.load(assetId);
  if (existing !== null) {
    throw new BackfillError(
      `${assetId} already has a record, last saved at ${existing.savedAt}. A backfill is ` +
        `genesis: generating a second history would publish a different market under the same ` +
        `id, spend keystream positions twice, and leave every settlement already recorded ` +
        `against the first series unreproducible.`,
    );
  }
  // **Cycle Audit 6, CA6-28.** The guard consulted the state store while the
  // damage happens in the history one — and the two are written at different
  // times: candles flush throughout, the checkpoint is written once at the end.
  // A crash between them left history rows and no record, and the guard then
  // admitted a re-run which either died on the first append (leaving the asset
  // permanently unprovisionable) or, with a later genesis, **spliced a second
  // market into the same id**: an auditor measured 5,070 minute rows spanning
  // two histories with a 2,130-minute hole and a 3,984-step price jump.
  //
  // Both stores are consulted now. The refusal names the repair, because there
  // is no safe automatic one: deleting the history of an asset is an operator's
  // decision, and it is the same decision `CorruptRecordError` describes.
  const storedHistory = await options.history.head(assetId, HISTORY_BASE_TIMEFRAME);
  if (storedHistory !== null) {
    throw new BackfillError(
      `${assetId} has no state record but its history already holds candles through ` +
        `${storedHistory}. That is a backfill which did not finish, or a record deleted from ` +
        `under one. Generating again would splice a second market into the same id. To start ` +
        `this asset over, delete its history as well as its record — deliberately, because ` +
        `doing so discards a past that settlements may already have been recorded against.`,
    );
  }

  const clock = new SteppableClock(options.genesisInstant);
  const market = new HostedMarket({
    // The checkpoint this backfill writes must say what wrote it (PH-26.3).
    personality: personalityFingerprint(options.asset),
    engine: createMarketEngine({
      config: configFor(options.asset),
      keyring: options.keyring,
      environment: options.environment,
      start: { instant: options.genesisInstant, price: logPrice(0) },
    }),
    clock,
  });

  // Nothing is stored — the guard above established it — and the first tick
  // the market produces is the first tick there is, so the recorder's first
  // bucket is whole from its start.
  const recorder = new HistoryRecorder({ continuesAfter: null });
  const retained: Tick[] = [];
  const retentionFrom = options.targetInstant - retentionMs;
  let ticksGenerated = 0;
  let baseCandles = 0;
  let rollupCandles = 0;

  const flush = async (): Promise<void> => {
    const closed = recorder.drain();
    if (closed.length > 0) {
      await options.history.append(assetId, closed[0]!.timeframe, closed);
      baseCandles += closed.length;
    }
    // Derived from the stored minute series rather than from this recorder's
    // memory, so the two tiers agree by construction (Cycle Audit 6, F2).
    rollupCandles += await refreshRollup(options.history, assetId);
  };

  let now = options.genesisInstant;
  let sinceYield = 0;
  while (now < options.targetInstant) {
    now = epochMillis(Math.min(now + stepMs, options.targetInstant));
    const ticks = market.advanceTo(now);
    if (ticks.length > 0) {
      ticksGenerated += ticks.length;
      recorder.accept(ticks);
      if (options.onTicks !== undefined) await options.onTicks(ticks);
      for (const tick of ticks) {
        if (tick.instant >= retentionFrom) retained.push(tick);
      }
    }
    sinceYield += 1;
    if (sinceYield >= chunkSteps) {
      sinceYield = 0;
      await flush();
      await yieldToLoop();
    }
  }
  await flush();

  // The checkpoint is the join. The live market resumes from this exact latent
  // state, so the first tick after the backfill is the one the backfill would
  // have produced next.
  await options.store.save(
    checkpointMarket(market, assetId, options.targetInstant, DEFAULT_LEASE_BLOCKS),
  );

  return {
    assetId,
    genesisInstant: options.genesisInstant,
    targetInstant: options.targetInstant,
    ticksGenerated,
    baseCandles,
    rollupCandles,
    retainedTicks: retained,
    market,
    recorder,
  };
}
