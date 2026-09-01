import { Injectable, Logger } from '@nestjs/common';
import { epochMillis, type Candle, type EpochMillis, type Tick, type TimeframeId } from '@otc/core';
import type { MasterKeyring } from '@otc/core';
import type { RegisteredAsset } from '@otc/engine';
import {
  backfillMarket,
  HistoryRecorder,
  readTimeframe,
  type CandleHistory,
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
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);
  private readonly recorders = new Map<string, HistoryRecorder>();
  private readonly provisioned = new Map<string, { from: EpochMillis; to: EpochMillis }>();

  constructor(
    private readonly history: CandleHistory,
    private readonly assets: readonly RegisteredAsset[],
  ) {}

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
    readonly now: EpochMillis;
  }): Promise<readonly string[]> {
    if (!Number.isFinite(options.days) || options.days <= 0) return [];
    const done: string[] = [];
    for (const asset of this.assets) {
      const id = asset.definition.id;
      if ((await options.store.load(id)) !== null) continue;
      const genesisInstant = epochMillis(options.now - options.days * 86_400_000);
      const started = Date.now();
      const result = await backfillMarket({
        asset,
        keyring: options.keyring,
        environment: options.environment,
        genesisInstant,
        targetInstant: options.now,
        store: options.store,
        history: this.history,
      });
      this.provisioned.set(id, { from: genesisInstant, to: options.now });
      done.push(id);
      this.logger.log(
        `${id}: provisioned ${options.days} days — ${result.ticksGenerated.toLocaleString()} ` +
          `ticks, ${result.baseCandles.toLocaleString()} minute bars, ` +
          `${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    }
    return done;
  }

  /** Fold published ticks into candles. Never called before publication. */
  observe(assetId: string, ticks: readonly Tick[]): void {
    if (ticks.length === 0) return;
    let recorder = this.recorders.get(assetId);
    if (recorder === undefined) {
      recorder = new HistoryRecorder();
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
   * until they are drained, and a process that dies before a flush simply
   * re-derives them when the resumed market republishes those ticks.
   */
  async flush(): Promise<void> {
    for (const [assetId, recorder] of this.recorders) {
      const { base, rollup } = recorder.drain();
      if (base.length > 0) await this.history.append(assetId, base[0]!.timeframe, base);
      if (rollup.length > 0) await this.history.append(assetId, rollup[0]!.timeframe, rollup);
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
}
