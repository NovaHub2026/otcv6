import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  epochMillis,
  SystemClock,
  type Clock,
  type EpochMillis,
  type MasterKeyring,
  type Tick,
} from '@otc/core';
import { ASSET_CATALOGUE, type RegisteredAsset } from '@otc/engine';
import {
  checkpointMarket,
  resumeMarket,
  Venue,
  type HostedMarket,
  type RecoveryOutcome,
  type StateStore,
} from '@otc/runtime';
import { TickFeed } from '@otc/distribution';
import { PublicationService } from './publication.service.js';

/**
 * The service that makes the markets run.
 *
 * All of the market logic lives below this file, in `@otc/runtime` and
 * `@otc/engine`, both of which are framework-free. This class contributes
 * exactly three things NestJS is actually needed for: a lifecycle to start and
 * stop on, a scheduler, and a place to put the checkpoint cadence.
 *
 * That division is enforced rather than intended — `dependencies.test.ts` fails
 * the build if anything under `packages/` imports a framework, which is what
 * keeps the batteries able to drive the engine from a plain Node process.
 */
@Injectable()
export class VenueService implements OnModuleDestroy {
  private readonly logger = new Logger(VenueService.name);
  private venue: Venue | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private readonly recovery = new Map<string, RecoveryOutcome>();
  /**
   * The distribution boundary.
   *
   * Every tick this service publishes goes through here, in the same order, once
   * — so what a streaming client reconstructs is the same market the REST
   * endpoints report, by construction rather than by two code paths agreeing.
   */
  readonly feed = new TickFeed();
  private readonly latest = new Map<string, Tick>();
  private lastCheckpointAt = 0;

  constructor(
    private readonly store: StateStore,
    private readonly keyring: MasterKeyring,
    private readonly clock: Clock = new SystemClock(),
    private readonly assets: readonly RegisteredAsset[] = ASSET_CATALOGUE,
    private readonly checkpointEveryMs = 5_000,
    private readonly publication: PublicationService = new PublicationService(ASSET_CATALOGUE),
    /**
     * Where a *brand new* market starts. Only ever used on a first boot: a
     * resumed market takes its position from the snapshot, and a seamed one from
     * the last published price.
     *
     * Defaults to the clock rather than a constant. A fixed genesis in the past
     * would make every first boot try to catch up from that date, which the
     * catch-up bound would correctly refuse.
     */
    private readonly genesisInstant: EpochMillis | null = null,
  ) {}

  /** Resume every asset, then begin publishing. */
  async start(): Promise<void> {
    const genesis = this.genesisInstant ?? epochMillis(this.clock.now());
    const markets: { asset: RegisteredAsset; market: HostedMarket }[] = [];
    for (const asset of this.assets) {
      const { market, outcome } = await resumeMarket({
        asset,
        keyring: this.keyring,
        environment: 'production',
        clock: this.clock,
        store: this.store,
        genesisInstant: genesis,
      });
      this.recovery.set(asset.definition.id, outcome);
      if (outcome.kind === 'seam') {
        // Loud on purpose. A seam is a discontinuity in the record, and an
        // operator learning about it from a chart later is a worse outcome than
        // learning about it here.
        this.logger.warn(
          `${asset.definition.id}: resumed with a SEAM — ${outcome.reason}. ` +
            `Internal state restarted beyond the leased cursors.`,
        );
      } else {
        this.logger.log(`${asset.definition.id}: ${outcome.kind}`);
      }
      markets.push({ asset, market });
    }
    this.venue = new Venue({ clock: this.clock, markets });
    this.venue.prime();
    this.lastCheckpointAt = this.clock.now();
    this.schedule();
  }

  onModuleDestroy(): Promise<void> {
    return this.stop();
  }

  /** Stop publishing and write a final checkpoint. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.checkpoint();
  }

  get assetIds(): readonly string[] {
    return this.venue?.assetIds ?? [];
  }

  /**
   * Where a market currently stands.
   *
   * Prefers a tick this process published, and falls back to the state inherited
   * from the checkpoint. Without the fallback a client connecting just after a
   * restart sees a market with no price, which is wrong — the price is known, it
   * simply was not produced here.
   */
  lastTick(assetId: string): { sequence: number; instant: number; price: number } | null {
    const published = this.latest.get(assetId);
    if (published !== undefined) return published;
    return this.venue?.marketFor(assetId).lastPublishedState ?? null;
  }

  recoveryFor(assetId: string): RecoveryOutcome | null {
    return this.recovery.get(assetId) ?? null;
  }

  /** Publish everything due, then persist if the cadence has elapsed. */
  async tick(): Promise<void> {
    if (this.venue === null) return;
    for (const { assetId, ticks } of this.venue.advance()) {
      const last = ticks[ticks.length - 1];
      if (last !== undefined) this.latest.set(assetId, last);
      this.feed.publish(assetId, ticks);
      // After publication, never before: the publisher sees the record, it does
      // not participate in producing it (INV-001).
      this.publication.observe(assetId, ticks);
    }
    if (this.clock.now() - this.lastCheckpointAt >= this.checkpointEveryMs) {
      await this.checkpoint();
    }
  }

  async checkpoint(): Promise<void> {
    if (this.venue === null) return;
    const now = this.clock.now();
    for (const assetId of this.venue.assetIds) {
      await this.store.save(checkpointMarket(this.venue.marketFor(assetId), assetId, now));
    }
    this.lastCheckpointAt = now;
  }

  /**
   * Sleep until the soonest deadline rather than on a fixed interval.
   *
   * The catalogue spans 333ms to 3352ms of mean interval; one interval would
   * either burn CPU on the slow assets or publish the fast ones late.
   */
  private schedule(): void {
    if (this.stopping || this.venue === null) return;
    const wait = this.venue.msUntilNextTick() ?? 50;
    this.timer = setTimeout(
      () => {
        void this.tick()
          .catch((error: unknown) => {
            this.logger.error(`tick failed: ${String(error)}`);
          })
          .finally(() => {
            this.schedule();
          });
      },
      Math.max(1, Math.min(wait, 1_000)),
    );
  }
}
