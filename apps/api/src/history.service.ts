import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  epochMillis,
  type Candle,
  type Clock,
  type EpochMillis,
  type Tick,
  type TimeframeId,
} from '@otc/core';
import type { MasterKeyring } from '@otc/core';
import type { RegisteredAsset } from '@otc/engine';
import {
  backfillMarket,
  checkpointMarket,
  DEFAULT_MAX_CATCH_UP_MS,
  HistoryRecorder,
  lastStoredSequence,
  readTimeframe,
  refreshRollup,
  type CandleHistory,
  type HostedMarket,
  type StateStore,
} from '@otc/runtime';

/**
 * The long history: written as the venue runs, and provisioned once if asked.
 *
 * Two jobs, and they are the same job at two speeds.
 *
 * **Continuously.** Every tick the venue publishes is folded into minute and
 * hour bars and appended. This observes the record *after* publication, exactly
 * as `PublicationService` does, and for the same reason: nothing on this side of
 * the boundary may reach the price path (INV-001).
 *
 * **Once, on request.** An asset with no state record can be given a past —
 * `backfillMarket` starts it ninety days ago and advances it to now through the
 * same runtime that will carry it forward.
 *
 * ## Why provisioning is not the default
 *
 * A backfill is genesis and refuses to run twice, so it is irreversible: the
 * history an asset gets is the first one it is given. Making an irreversible act
 * the default behaviour of a process start would mean that booting the service
 * in the wrong directory permanently decides what a market's past is.
 *
 * So `OTC_BACKFILL_DAYS` defaults to zero and an operator asks for it. The cost
 * is the second reason — ninety days is 2.3 to 22.8 million ticks per asset
 * (`CYCLE-6-BACKFILL-SCALE.md`), which is seconds each and roughly forty minutes
 * for a hundred-asset catalogue.
 */
@Injectable()
export class HistoryService implements OnApplicationShutdown {
  private readonly logger = new Logger(HistoryService.name);
  private readonly recorders = new Map<string, HistoryRecorder>();
  private readonly provisioned = new Map<string, { from: EpochMillis; to: EpochMillis }>();
  /** Assets whose withheld first minute has been logged, so it is logged once. */
  private readonly reportedWithheld = new Set<string>();

  readonly #assets: RegisteredAsset[];

  constructor(
    private readonly history: CandleHistory,
    assets: readonly RegisteredAsset[],
  ) {
    this.#assets = [...assets];
  }

  /**
   * Take an asset registered while the service was running.
   *
   * Provisioning skips any asset that already has a state record, so calling
   * {@link HistoryService.provision} after this gives a past to the new asset
   * and to nothing else — the catch-up that follows a backfill is the same code
   * whether it runs at boot or an hour in.
   */
  register(asset: RegisteredAsset): void {
    this.#assets.push(asset);
  }

  /**
   * Give every asset that has no record a past, and report what was done.
   *
   * Runs before the venue starts, because the checkpoint a backfill leaves is
   * what the venue then resumes from. An asset that already has a record is
   * skipped rather than refused: a restart is the ordinary case, and it is not
   * an error for a market to have been provisioned already.
   */
  async provision(options: {
    readonly store: StateStore;
    readonly keyring: MasterKeyring;
    readonly environment: Parameters<MasterKeyring['derive']>[0]['env'];
    readonly days: number;
    readonly clock: Clock;
  }): Promise<readonly string[]> {
    if (!Number.isFinite(options.days) || options.days <= 0) return [];
    const done: string[] = [];
    const built: { id: string; market: HostedMarket; cursor: number }[] = [];
    for (const asset of this.#assets) {
      const id = asset.definition.id;
      if ((await options.store.load(id)) !== null) continue;
      const targetInstant = epochMillis(options.clock.now());
      const genesisInstant = epochMillis(targetInstant - options.days * 86_400_000);
      const started = options.clock.now();
      const result = await backfillMarket({
        asset,
        keyring: options.keyring,
        environment: options.environment,
        genesisInstant,
        targetInstant,
        store: options.store,
        history: this.history,
      });
      this.provisioned.set(id, { from: genesisInstant, to: targetInstant });
      // The backfill's own recorder, not a fresh one (a5-01). It has folded
      // every tick so far and holds the target's minute open; a recorder
      // started at the join would open that minute wherever the first live
      // tick landed and store it as whole — measured at 8 of 18 ticks.
      this.recorders.set(id, result.recorder);
      built.push({ id, market: result.market, cursor: targetInstant });
      done.push(id);
      this.logger.log(
        `${id}: provisioned ${options.days} days — ${result.ticksGenerated.toLocaleString()} ` +
          `ticks, ${result.baseCandles.toLocaleString()} minute bars, ` +
          `${((options.clock.now() - started) / 1000).toFixed(1)}s`,
      );
    }
    if (built.length > 0) await this.#catchUp(built, options.store, options.clock);
    return done;
  }

  /**
   * Carry every provisioned market forward to now, before anything resumes it.
   *
   * **Cycle Audit 6, F1.** Generating a past costs wall-clock time — 115 seconds
   * for five assets at ninety days, by the project's own measurement — and
   * `resumeMarket` seams whenever a checkpoint is older than the fifteen-second
   * catch-up bound. So the checkpoint a backfill wrote was *always* stale by the
   * time the venue read it, and the latent state ninety simulated days had built
   * was discarded at exactly the join it exists to make. Measured on the running
   * service after a three-day provisioning: four of five markets seamed.
   *
   * The fix is not a longer bound. It is to keep the market this process just
   * built and advance it, in steps within the bound, through the same runtime
   * that will publish its next tick. Nothing is invented and nothing is
   * recovered — the market simply continues.
   *
   * It converges because generation runs some three hundred times faster than
   * the clock: each pass closes the gap the previous pass took to run. The bound
   * on passes is a safety net, not the mechanism; if it is ever reached the
   * checkpoint is left as it is and `resumeMarket` takes the seam and says so,
   * which is the honest outcome for an interval nobody could generate in time.
   */
  async #catchUp(
    built: readonly { id: string; market: HostedMarket; cursor: number }[],
    store: StateStore,
    clock: Clock,
  ): Promise<void> {
    const step = DEFAULT_MAX_CATCH_UP_MS;
    const cursors = new Map(built.map((entry) => [entry.id, entry.cursor]));
    for (let pass = 0; pass < 12; pass += 1) {
      let worstLagMs = 0;
      for (const { id, market } of built) {
        let cursor = cursors.get(id)!;
        for (;;) {
          const now = clock.now();
          if (cursor >= now) break;
          cursor = Math.min(cursor + step, now);
          this.observe(id, market.advanceTo(epochMillis(cursor)));
        }
        cursors.set(id, cursor);
        worstLagMs = Math.max(worstLagMs, clock.now() - cursor);
      }
      if (worstLagMs < step / 2) break;
    }
    await this.flush();
    const savedAt = epochMillis(clock.now());
    for (const { id, market } of built) await store.save(checkpointMarket(market, id, savedAt));
    this.logger.log(
      `caught ${built.length} provisioned market(s) up to now; the checkpoint the venue ` +
        `resumes from is current, so the join carries the latent state rather than seaming`,
    );
  }

  /**
   * Fold published ticks into candles. Never called before publication.
   *
   * A recorder created here does not yet know where it joins the stream. On a
   * restart the minute the checkpoint fell in was open in the process that
   * died, and this process sees only the rest of it; the recorder must not
   * store that minute as whole (a5-01), and whether it is whole is a question
   * for the store, which is asynchronous. So the recorder starts as `'unknown'`
   * and {@link HistoryService.flush} tells it what is stored before anything is
   * drained. Until then it folds and holds.
   */
  observe(assetId: string, ticks: readonly Tick[]): void {
    if (ticks.length === 0) return;
    let recorder = this.recorders.get(assetId);
    if (recorder === undefined) {
      recorder = new HistoryRecorder({ continuesAfter: 'unknown' });
      this.recorders.set(assetId, recorder);
    }
    recorder.accept(ticks);
  }

  /**
   * Write out every bar that has closed.
   *
   * On the checkpoint cadence rather than per tick: a minute bar closes once a
   * minute at most, so flushing per tick would be thousands of no-op writes for
   * each real one. Nothing is lost by waiting — the recorder holds closed bars
   * until they are drained. A process that dies before a flush loses the bars
   * closed since the last flush **only if the checkpoint precedes their
   * bucket** — then the resumed market republishes those ticks and the bars
   * are re-derived; the bucket the kill fell in is seen from inside by the
   * resumed recorder and withheld (a5-01, PH-25.1 finding c), and the hour
   * around it is withheld by the rollup (Cycle Audit 9, a6-01), until a
   * persisted tick record exists to refold from (IMPROVEMENT-REPORT-001 §4).
   */
  async flush(): Promise<void> {
    for (const [assetId, recorder] of this.recorders) {
      if (!recorder.started) {
        recorder.continueAfter(await lastStoredSequence(this.history, assetId));
      }
      const closed = recorder.drain();
      if (closed.length > 0) await this.history.append(assetId, closed[0]!.timeframe, closed);
      const withheld = recorder.withheld;
      if (withheld !== null && !this.reportedWithheld.has(assetId)) {
        this.reportedWithheld.add(assetId);
        // Once, and as a fact about the record: the minute is a hole, not a bar.
        this.logger.warn(
          `${assetId}: the minute at ${withheld.openInstant} was not stored — this process ` +
            `started inside it and saw ${withheld.tickCount} of its ticks from sequence ` +
            `${withheld.firstSequence}. A bar that began before the recorder did cannot be ` +
            `stored as whole (a5-01).`,
        );
      }
      // The hourly tier is derived from what is *stored*, never from what this
      // process remembers. Cycle Audit 6 (F2) measured the alternative: a fresh
      // recorder on every start wrote the hour it began inside from only the
      // minutes it had seen, understating that hour's high by a thousand
      // lattice steps.
      await refreshRollup(this.history, assetId);
    }
  }

  read(
    assetId: string,
    timeframe: TimeframeId,
    from: EpochMillis,
    to: EpochMillis,
  ): Promise<readonly Candle[]> {
    return readTimeframe(this.history, assetId, timeframe, from, to);
  }

  /** The span an asset was provisioned over, if this process did it. */
  provisionedSpan(assetId: string): { from: EpochMillis; to: EpochMillis } | null {
    return this.provisioned.get(assetId) ?? null;
  }

  /**
   * Close the store, last (a6-09).
   *
   * `onApplicationShutdown` rather than `onModuleDestroy`, and the difference
   * is the whole point: Nest runs every `onModuleDestroy` in a module
   * concurrently (`Promise.all`), so a close there would race the venue's own
   * `onModuleDestroy` — its final checkpoint and the flush that writes the last
   * closed bars *through this store*. This hook runs after every destroy hook
   * has resolved and after the listener is closed, so nothing can be reading or
   * writing. Before this existed the SQLite history was never closed at all: a
   * 3.6 MB WAL was left beside a 4 KB database at every shutdown.
   *
   * The interface is store-agnostic and the in-memory store has nothing to
   * close, so the method is looked for rather than required.
   */
  onApplicationShutdown(): void {
    if (isClosable(this.history)) {
      this.history.close();
      this.logger.log('candle history closed');
    }
  }
}

function isClosable(value: object): value is { close(): void } {
  return 'close' in value && typeof value.close === 'function';
}
