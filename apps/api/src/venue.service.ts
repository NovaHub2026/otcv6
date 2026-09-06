import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@nestjs/common';
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
  DEFAULT_RECORD_TICKS,
  resumeMarket,
  Venue,
  type AssetBatch,
  type HostedMarket,
  type RecoveryOutcome,
  type SignSourceFactory,
  type StateStore,
  type AssetOverlay,
  type TickRecord,
} from '@otc/runtime';
import { DEFAULT_RETAIN_TICKS, TickFeed, type PublicationProof } from '@otc/distribution';
import { EngineAccess } from './engineAccess.js';
import { HistoryService } from './history.service.js';
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
/**
 * How long the scheduler waits when the only thing due is a stalled market.
 *
 * A stall never resolves on its own — `#lastAdvancedAt` moves only after the
 * bound check the stall fails — so the loop would otherwise spin at 1 ms
 * for the life of the process (Cycle Audit 7, CA7-10). A quarter second still
 * notices a market that starts publishing again within one of its own
 * intervals, and costs four passes a second instead of eight hundred.
 */
const STALLED_BACKOFF_MS = 250;

@Injectable()
export class VenueService implements OnModuleDestroy, OnApplicationShutdown {
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

  /** Assets that published on the last pass; 0 with a stall means spinning. */
  private lastPublishedCount = 0;
  /**
   * Markets that failed their last advance, and why.
   *
   * Read by `/health`, so an operator learns from the service rather than from
   * a chart that stopped moving (CA6-33).
   */
  private readonly stalled = new Map<string, string>();
  /**
   * The class of failure last logged per asset, so the log line is written once
   * per *kind* of stall rather than once per scheduler tick (a6-05).
   *
   * The dedup used to key on the message, and the message carries the seconds
   * behind the clock, which grows every tick: five stalled assets wrote five
   * ERROR lines a second for the life of the process — 270 lines in 54 s
   * measured — and the one line that mattered was the first. The changing
   * number is still available, in `/health`.
   */
  private readonly stalledLogged = new Map<string, string>();
  private lastCheckpointAt = 0;
  /** The advance currently running, so shutdown can wait for it. */
  private inFlight: Promise<void> = Promise.resolve();
  /** Assets an operator has retired. Read at `start`, never hosted. */
  private readonly retired = new Set<string>();
  /** Set once every market has resumed and primed (PH-30.1): what `/health/ready` reads. */
  private ready = false;
  /** Ticks published by this process, every asset, for `/metrics` (PH-30.1). */
  private ticksPublished = 0;
  /** The venue clock's reading when `start()` finished, for uptime. */
  private startedAt: EpochMillis | null = null;

  constructor(
    private readonly store: StateStore,
    private readonly keyring: MasterKeyring,
    private readonly clock: Clock = new SystemClock(),
    private readonly assets: RegisteredAsset[] = [...ASSET_CATALOGUE],
    private readonly checkpointEveryMs = 5_000,
    private readonly publication: PublicationService = new PublicationService(ASSET_CATALOGUE),
    /**
     * The long history, or null when this deployment keeps none.
     *
     * Optional because the venue's job is to publish a market, and it published
     * one for three phases before a history tier existed. Null is a deployment
     * that streams and settles without keeping a chart.
     */
    private readonly history: HistoryService | null = null,
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
    /**
     * Days of history a brand-new asset is given before the venue starts.
     *
     * Zero by default, and that is a decision rather than an oversight: a
     * backfill is genesis and refuses to run twice, so it is irreversible.
     * Making an irreversible act the default behaviour of a process start would
     * let booting the service in the wrong directory permanently decide what a
     * market's past is.
     */
    private readonly backfillDays = 0,
    /**
     * A hook on every hosted engine's sign stream, or null (PH-24.1).
     *
     * Null in production, always: `AppModule.register()` is called bare by
     * `main.ts`. The Lab composes a `SelectableSigns` factory here so it can
     * play a chosen vector into a hosted engine — and `composition.test.ts`
     * asserts the production path never does.
     */
    private readonly signSource: SignSourceFactory | null = null,
    /** PH-24.13: the arrival stream's wrapper, Lab only. With either source the markets are retractable. */
    private readonly arrivalSource: SignSourceFactory | null = null,
    /**
     * Whether a composition chose this market's signs since its last clean
     * checkpoint, and a way to tell it one was written (Cycle Audit 8, a6).
     *
     * Two plain functions rather than a type from the Lab: this file may not
     * name the Lab's wrapper, and `composition.test.ts` enforces that. Null in
     * production, where nothing chooses signs and every checkpoint says so.
     */
    private readonly control: {
      readonly controlledSince: (assetId: string) => boolean;
      readonly checkpointTaken: (assetId: string) => void;
    } | null = null,
    /**
     * The persisted published record, or null when this deployment keeps none
     * (PH-28.1).
     *
     * Written in `tick()` before the feed, the publisher and the history see a
     * batch, and read at `start()` to prime the feed's window and the history
     * recorder — so a client's resume sequence is honoured across a restart and
     * the minute a kill fell in is stored whole. Optional for the reason the
     * history is: the venue published a market for nine phases before the record
     * outlived the process, and a test that wants neither should not have to
     * build one.
     */
    private readonly record: TickRecord | null = null,
    /** Ticks the record keeps per asset; trimmed on the checkpoint cadence. */
    private readonly recordTicks = DEFAULT_RECORD_TICKS,
    /**
     * Where the engine-touching surface goes, or null (PH-28.2).
     *
     * The market, fork and lookahead methods lived on this class, and every
     * production controller held them. They live on `EngineAccess` now, which
     * this constructor builds and hands to the callback **once**; nothing on
     * this class returns a market, a snapshot or a fork. Null in production —
     * `main.ts` registers bare — and the Lab's composition passes a handle
     * (`composition.test.ts`, `labSurface.test.ts` assert both).
     */
    engineAccess: ((access: EngineAccess) => void) | null = null,
  ) {
    engineAccess?.(
      new EngineAccess({
        marketFor: (assetId) => this.#marketOrNull(assetId),
        assetFor: (assetId) => this.assetFor(assetId),
        keyring: this.keyring,
      }),
    );
  }

  /** The hosted market, or null when the asset is not hosted. Reachable only through `EngineAccess`. */
  #marketOrNull(assetId: string): HostedMarket | null {
    if (this.venue === null || !this.assetIds.includes(assetId)) return null;
    try {
      return this.venue.marketFor(assetId);
    } catch {
      return null;
    }
  }

  /** Resume every asset, then begin publishing. */
  async start(): Promise<void> {
    const genesis = this.genesisInstant ?? epochMillis(this.clock.now());
    // Provisioning first, and here rather than in a caller: the checkpoint a
    // backfill leaves is exactly what `resumeMarket` then continues from, so
    // the ordering is a property of this method rather than something a caller
    // has to remember.
    if (this.history !== null && this.backfillDays > 0) {
      const provisioned = await this.history.provision({
        store: this.store,
        keyring: this.keyring,
        environment: 'production',
        days: this.backfillDays,
        clock: this.clock,
      });
      this.logger.log(
        provisioned.length === 0
          ? 'no asset needed provisioning; every market already has a record'
          : `provisioned ${provisioned.length} market(s) with ${this.backfillDays} days: ` +
              provisioned.join(', '),
      );
    }
    const markets: { asset: RegisteredAsset; market: HostedMarket }[] = [];
    for (const asset of this.assets) {
      // A retired market is not resumed. Resuming one would either invent the
      // interval since it stopped or take a seam in a published record, and an
      // operator who retired an asset asked for neither.
      if (this.retired.has(asset.definition.id)) {
        this.logger.log(`${asset.definition.id}: retired, not hosted`);
        continue;
      }
      const { market, outcome } = await resumeMarket({
        ...(this.signSource === null ? {} : { signSource: this.signSource }),
        ...(this.arrivalSource === null ? {} : { arrivalSource: this.arrivalSource }),
        retractable: this.signSource !== null || this.arrivalSource !== null,
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
    // The record before the first pass: what the previous process served is
    // what this one's feed resumes from, and what its recorder folds first.
    for (const { asset } of markets) await this.#primeFromRecord(asset.definition.id);
    this.lastCheckpointAt = this.clock.now();
    this.startedAt = epochMillis(this.clock.now());
    this.ready = true;
    this.schedule();
  }

  /**
   * Whether an orchestrator may route traffic here (PH-30.1): every market
   * resumed and primed, the scheduler running, nothing stalled. Distinct from
   * liveness — a process that answers HTTP while a market is stalled is alive
   * and not ready — and from `/health`'s `status`, which a human reads.
   */
  get isReady(): boolean {
    return this.ready && !this.stopping && this.stalled.size === 0;
  }

  /** Why the venue is not ready, or null when it is. */
  get notReadyReason(): string | null {
    if (!this.ready) return 'the markets have not finished resuming';
    if (this.stopping) return 'the venue is shutting down';
    if (this.stalled.size > 0) {
      return `stalled: ${[...this.stalled.keys()].join(', ')}`;
    }
    return null;
  }

  /** What `/metrics` reads, from what this service already counts (PH-30.1). */
  get counters(): {
    readonly ticksPublished: number;
    readonly uptimeMs: number;
    readonly subscribers: number;
  } {
    let subscribers = 0;
    for (const id of this.assetIds) subscribers += this.feed.subscriberCount(id);
    return {
      ticksPublished: this.ticksPublished,
      uptimeMs: this.startedAt === null ? 0 : this.clock.now() - this.startedAt,
      subscribers,
    };
  }

  /** The record's head per hosted asset, for `/metrics`; empty without a record. */
  async recordHeads(): Promise<ReadonlyMap<string, number>> {
    const heads = new Map<string, number>();
    if (this.record === null) return heads;
    for (const id of this.assetIds) {
      const head = await this.record.head(id);
      if (head !== null) heads.set(id, head);
    }
    return heads;
  }

  /**
   * Close the record, last (PH-28.1).
   *
   * `onApplicationShutdown`, not `onModuleDestroy`, for the reason the history
   * closes there (a6-09): the venue's own destroy hook is the final checkpoint
   * and it trims the record, and Nest runs a module's destroy hooks
   * concurrently. This runs after every destroy hook has resolved.
   */
  onApplicationShutdown(): void {
    if (this.record !== null && isClosable(this.record)) {
      this.record.close();
      this.logger.log('tick record closed');
    }
  }

  /**
   * Hand a market what the record holds for it, before it publishes here.
   *
   * Two readers, both of the same tail. The **feed** takes the newest contiguous
   * run up to its own window, so a client holding a sequence the previous
   * process served resumes from it rather than being refused as evicted
   * (PH-25.1 finding a). The **history recorder** takes every tick after the
   * newest stored minute bar, so its first tick is the one that follows the
   * stored head and the minute the previous process died inside is seen from
   * its start and stored whole (finding c). Neither reaches the engine: this is
   * the published record read back, and INV-001 is untouched.
   */
  async #primeFromRecord(assetId: string): Promise<void> {
    if (this.record === null) return;
    const tail = await this.record.tail(assetId, DEFAULT_RETAIN_TICKS);
    if (tail.length > 0) {
      this.feed.publish(assetId, tail);
      const newest = tail[tail.length - 1]!;
      const known = this.latest.get(assetId);
      if (known === undefined || newest.sequence > known.sequence) this.latest.set(assetId, newest);
    }
    const folded = await this.history?.prime(assetId, this.record);
    // And the commitment chain, which the record lets continue across the
    // boundary rather than restart at every boot (PH-28.3).
    await this.publication.prime(assetId, this.record);
    const head = tail.length > 0 ? tail[tail.length - 1]!.sequence : null;
    this.logger.log(
      head === null
        ? `${assetId}: no published record to prime from`
        : `${assetId}: feed primed from the record through sequence ${head} ` +
            `(${tail.length} ticks); ${folded ?? 0} folded into the open minute`,
    );
  }

  onModuleDestroy(): Promise<void> {
    return this.stop();
  }

  /** Stop publishing and write a final checkpoint. */
  async stop(): Promise<void> {
    this.stopping = true;
    // Wait for a tick that is already running before checkpointing on top of it.
    // Cycle Audit 6 found `stop()` clearing the timer and then racing an
    // in-flight `checkpoint()`; the loser threw `ENOENT` on its own temporary
    // file and aborted the loop, so the remaining markets got no final
    // checkpoint at all.
    await this.inFlight;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.checkpoint();
  }

  get assetIds(): readonly string[] {
    return this.venue?.assetIds ?? [];
  }

  /** Every asset this deployment knows about, hosted or not. */
  get catalogue(): readonly RegisteredAsset[] {
    return this.assets;
  }

  /**
   * Take the operator's overlays before anything is hosted.
   *
   * A rename is applied to the in-memory asset; a retirement is remembered so
   * `start` does not resume that market. Called before `start`, because the
   * decision not to host something must be known before the resume loop runs.
   */
  applyOverlays(overlays: ReadonlyMap<string, AssetOverlay>): void {
    for (const [id, overlay] of overlays) {
      if (overlay.displayName !== undefined && this.assetFor(id) !== null) {
        this.rename(id, overlay.displayName);
      }
      if (overlay.retiredAt !== undefined) this.retired.add(id);
    }
  }

  /** Whether an asset has been retired by an operator. */
  isRetired(assetId: string): boolean {
    return this.retired.has(assetId);
  }

  /**
   * The venue's clock, for a caller that needs to stamp an instant.
   *
   * `apps/api/src` is inside the replayable set, so nothing here may read
   * ambient time — the guardrail scan enforces it, and it caught a bare
   * `Date.now()` in the retire handler. A retirement instant comes from the same
   * clock the markets are advanced against or it is not the same timeline.
   */
  now(): EpochMillis {
    return this.clock.now();
  }

  /**
   * Rename an asset, and nothing else.
   *
   * The display name is the one thing about a market that is presentation. It is
   * never used in a comparison, never derived from, and never part of a record —
   * so changing it changes what an operator reads and nothing that happened.
   */
  rename(assetId: string, displayName: string): void {
    const index = this.assets.findIndex((asset) => asset.definition.id === assetId);
    if (index < 0) throw new RangeError(`Unknown asset ${assetId}.`);
    const asset = this.assets[index]!;
    this.assets[index] = {
      ...asset,
      definition: { ...asset.definition, displayName },
    };
  }

  /**
   * Stop hosting a market.
   *
   * Between advances, like {@link VenueService.host}: removing a market from
   * under the tick loop would drop a batch that had already been consumed from
   * its engine. Everything it published stays readable — this is a decision to
   * stop generating, not to forget.
   */
  async retire(assetId: string): Promise<void> {
    if (!this.assetIds.includes(assetId)) {
      throw new RangeError(`Asset ${assetId} is not hosted.`);
    }
    await this.inFlight;
    // A final checkpoint before it leaves, so the last tick it published is the
    // last tick its record holds.
    await this.checkpoint();
    this.venue?.unhost(assetId);
    this.retired.add(assetId);
    // **Cycle Audit 7, CA7-15.** Everything this service remembers *about* a
    // market has to go with it. `tick()` clears `stalled` only for an asset that
    // appears in `published`, and an unhosted asset never appears there — so
    // retiring a stalled market left `/health` reporting `degraded` about it for
    // the life of the process, next to `assets: 0`, with nothing able to clear
    // it. That is CA6-33's failure with the sign flipped: a monitor permanently
    // red about an asset the operator deliberately removed is a monitor an
    // operator learns to ignore.
    this.stalled.delete(assetId);
    this.stalledLogged.delete(assetId);
    this.latest.delete(assetId);
    this.recovery.delete(assetId);
    // And the feed's window, which is 5 MB per asset (CA7-35). Its subscribers
    // are told rather than left holding a stream that will never tick again.
    this.feed.forget(assetId, 'asset retired');
    this.logger.log(`${assetId}: retired — no longer hosted, record untouched`);
  }

  /**
   * Run `fn` with no advance in flight and none able to start before it returns.
   *
   * PH-24.2. Arming a sign source is only correct against the future the fork
   * described, and the fork was read from a snapshot: if the venue advanced in
   * between, the vector begins one tick late and an exact close lands one step
   * off. So the read, the selection and the arming happen in one synchronous
   * `fn`, after the in-flight advance has settled — and the wait loops, because
   * the timer that starts the next advance can fire while this is awaiting the
   * last one. `fn` runs synchronously the moment the check passes, and a new
   * advance can only start from a timer, which cannot interleave with it.
   *
   * Economically blind and Lab-agnostic: this knows nothing about `fn`. It is
   * the same discipline `retire` and `host` use, offered as a function.
   */
  async betweenAdvances<T>(fn: () => T): Promise<T> {
    for (;;) {
      const current = this.inFlight;
      await current;
      if (current === this.inFlight) return fn();
    }
  }

  assetFor(id: string): RegisteredAsset | null {
    return this.assets.find((asset) => asset.definition.id === id) ?? null;
  }

  /**
   * Host a market registered while the service was running.
   *
   * Four things have to happen in one order, and the order is the substance:
   *
   * 1. the asset joins the catalogue and the history service, so a provisioning
   *    pass can see it;
   * 2. it is given a past, if this deployment gives one — `provision` skips
   *    every asset that already has a state record, so this backfills the new
   *    asset and nothing else, and the catch-up that follows leaves a current
   *    checkpoint;
   * 3. `resumeMarket` continues from that checkpoint, exactly as a restart
   *    would, so there is one way a market comes into existence (INV-003);
   * 4. only then does the venue host it, and the publisher begin committing to
   *    its ticks.
   *
   * It runs between advances. `tick()` iterates the venue's markets, and adding
   * one underneath that loop would publish an asset's first tick into a batch
   * whose checkpoint had already been decided.
   */
  async host(asset: RegisteredAsset): Promise<void> {
    const id = asset.definition.id;
    if (this.assets.some((entry) => entry.definition.id === id)) {
      throw new RangeError(`Asset ${id} is already in this venue's catalogue.`);
    }
    await this.inFlight;
    this.assets.push(asset);
    this.history?.register(asset);
    if (this.history !== null && this.backfillDays > 0) {
      await this.history.provision({
        store: this.store,
        keyring: this.keyring,
        environment: 'production',
        days: this.backfillDays,
        clock: this.clock,
      });
    }
    const { market, outcome } = await resumeMarket({
      ...(this.signSource === null ? {} : { signSource: this.signSource }),
      ...(this.arrivalSource === null ? {} : { arrivalSource: this.arrivalSource }),
      retractable: this.signSource !== null || this.arrivalSource !== null,
      asset,
      keyring: this.keyring,
      environment: 'production',
      clock: this.clock,
      store: this.store,
      genesisInstant: this.genesisInstant ?? epochMillis(this.clock.now()),
    });
    this.recovery.set(id, outcome);
    market.prime();
    this.venue?.host(asset, market);
    await this.#primeFromRecord(id);
    this.publication.register(asset);
    this.logger.log(`${id}: hosted at runtime — ${outcome.kind}`);
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

  /** Whether this deployment keeps the published record (PH-28.1). */
  get keepsRecord(): boolean {
    return this.record !== null;
  }

  /**
   * The published tick at a sequence, from the record, or null when the record
   * does not hold it (PH-29.1). The record, not the feed: the feed's window is
   * the record's newest run, primed from it, and a sequence the feed no longer
   * retains may still be recorded.
   */
  async recordedTick(assetId: string, sequence: number): Promise<Tick | null> {
    if (this.record === null) return null;
    const [tick] = await this.record.since(assetId, sequence, 1);
    return tick !== undefined && tick.sequence === sequence ? tick : null;
  }

  /** The record's oldest and newest sequence, or null when it holds nothing. */
  async recordBounds(assetId: string): Promise<{ oldest: number; newest: number } | null> {
    if (this.record === null) return null;
    const oldest = await this.record.oldest(assetId);
    const newest = await this.record.head(assetId);
    return oldest === null || newest === null ? null : { oldest, newest };
  }

  /** The last published tick at or before an instant, from the record (PH-29.1). */
  priceAt(assetId: string, instant: number): Promise<Tick | null> {
    if (this.record === null) return Promise.resolve(null);
    return this.record.atOrBefore(assetId, instant);
  }

  /** The proof of a published sequence from the publication archive (PH-29.1). */
  proofFor(assetId: string, sequence: number): Promise<PublicationProof> {
    return this.publication.proofFor(assetId, sequence);
  }

  /** The publisher's public key, or null when this deployment does not publish. */
  get publishingKey(): string | null {
    return this.publication.publicKey;
  }

  recoveryFor(assetId: string): RecoveryOutcome | null {
    return this.recovery.get(assetId) ?? null;
  }

  /** Markets that failed their last advance, newest reason first. */
  get stalledMarkets(): readonly { assetId: string; reason: string }[] {
    return [...this.stalled].map(([assetId, reason]) => ({ assetId, reason }));
  }

  /** Publish everything due, then persist if the cadence has elapsed. */
  async tick(): Promise<void> {
    if (this.venue === null) return;
    // `advanceDetailed`, not `advance`. **Cycle Audit 6, CA6-33:** `advance()`
    // returns `advanceDetailed(now).published` and drops the failures, and this
    // service called only that. A market past its catch-up bound therefore
    // stopped publishing **permanently and silently** — `#lastAdvancedAt` only
    // moves after the bound check, so every later advance is refused too —
    // while `/health` returned `{"status":"ok"}`, `/markets/:id` returned the
    // frozen last price, and the panel showed a chart that had stopped moving
    // with the status `live`.
    //
    // The failure list is the one thing that says so, and it was being thrown
    // away by the only caller that mattered.
    const { published, failures } = this.venue.advanceDetailed(epochMillis(this.clock.now()));
    this.lastPublishedCount = published.length;
    for (const failure of failures) {
      this.stalled.set(failure.assetId, failure.error.message);
      // Logged once per distinct *kind* of failure, keyed on the error's name:
      // a market that has stopped emits this on every scheduler tick, and a log
      // nobody can read is a log nobody reads (a6-05). The message is not the
      // key because it carries the lag, and the lag changes every tick.
      const kind = failure.error.name;
      if (this.stalledLogged.get(failure.assetId) !== kind) {
        this.stalledLogged.set(failure.assetId, kind);
        this.logger.error(
          `${failure.assetId}: STALLED — ${failure.error.message} ` +
            `(logged once per ${kind}; the current lag is in /health)`,
        );
      }
    }
    // The record first (PH-28.1). What comes back is which ticks were new:
    // a resumed market republishes the ticks between its checkpoint and the
    // kill, the record verifies them against what it served and returns
    // nothing for them, and the feed, the publisher and the history never see
    // a tick twice. A tick the record refuses is not published at all.
    const fresh = await this.#recordPass(published);
    for (const { assetId, ticks: generated } of published) {
      const ticks = fresh.get(assetId);
      if (ticks === undefined) continue; // Refused by the record; stalled by name.
      if (this.stalled.delete(assetId)) {
        this.stalledLogged.delete(assetId);
        this.logger.log(`${assetId}: publishing again`);
      }
      const last = generated[generated.length - 1];
      if (last !== undefined) this.latest.set(assetId, last);
      if (ticks.length === 0) continue;
      this.ticksPublished += ticks.length;
      this.feed.publish(assetId, ticks);
      // After publication, never before: the publisher sees the record, it does
      // not participate in producing it (INV-001). The same is true of the
      // history: a chart is a view of what happened, and a view that could
      // influence what happens next would be the whole product broken.
      this.publication.observe(assetId, ticks);
      this.history?.observe(assetId, ticks);
    }
    if (this.clock.now() - this.lastCheckpointAt >= this.checkpointEveryMs) {
      await this.checkpoint();
    }
  }

  /**
   * Append a pass to the record and say, per asset, what was new.
   *
   * One transaction for the pass; if it is refused, each asset is appended on
   * its own so the refusal is isolated to the market that caused it. A
   * refusal — a fork, or a sequence the record cannot compare — means this
   * market's stream disagrees with the record it published under this id.
   * It is unhosted and stalled by name: `/health` reports it, nothing is
   * published for it, and an operator decides. Publishing over the record
   * would be a second market under one id, which is INV-002 broken where a
   * client cannot see it.
   */
  async #recordPass(
    published: readonly { assetId: string; ticks: readonly Tick[] }[],
  ): Promise<ReadonlyMap<string, readonly Tick[]>> {
    if (this.record === null) {
      return new Map(published.map(({ assetId, ticks }) => [assetId, ticks]));
    }
    const batches: AssetBatch[] = published.map(({ assetId, ticks }) => ({ assetId, ticks }));
    try {
      return await this.record.append(batches);
    } catch {
      const fresh = new Map<string, readonly Tick[]>();
      for (const batch of batches) {
        try {
          const one = await this.record.append([batch]);
          fresh.set(batch.assetId, one.get(batch.assetId) ?? []);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.stalled.set(batch.assetId, `refused by the record — ${message}`);
          this.stalledLogged.set(batch.assetId, 'RecordRefusal');
          this.venue?.unhost(batch.assetId);
          this.logger.error(
            `${batch.assetId}: REFUSED BY THE RECORD and unhosted — ${message} ` +
              `(nothing was published for it; the record was not modified)`,
          );
        }
      }
      return fresh;
    }
  }

  async checkpoint(): Promise<void> {
    if (this.venue === null) return;
    const now = this.clock.now();
    for (const assetId of this.venue.assetIds) {
      // The mark goes into the record before it is cleared, so a checkpoint
      // taken mid-push carries it and the next boot seams rather than
      // regenerating ticks the keystream would sign differently.
      const controlled = this.control?.controlledSince(assetId) ?? false;
      await this.store.save(
        checkpointMarket(this.venue.marketFor(assetId), assetId, now, undefined, controlled),
      );
      this.control?.checkpointTaken(assetId);
      // The record's bound, on the same cadence: a handful of rows past the
      // window every five seconds, never a sweep.
      await this.record?.trim(assetId, this.recordTicks);
    }
    // Bars that closed since the last checkpoint. On the same cadence because a
    // minute bar closes at most once a minute: flushing per tick would be
    // thousands of empty writes for each real one.
    await this.history?.flush();
    this.lastCheckpointAt = now;
  }

  /**
   * Sleep until the soonest deadline rather than on a fixed interval.
   *
   * The catalogue spans 333ms to 3352ms of mean interval; one interval would
   * either burn CPU on the slow assets or publish the fast ones late.
   */
  /**
   * How long the next pass waits, as a value rather than a side effect.
   *
   * Its own method so the decision can be asserted: `schedule()` ends in a
   * `setTimeout`, and a scheduler that spins is invisible to a test that can
   * only observe a timer being set (Cycle Audit 7, CA7-10).
   */
  nextWaitMs(): number {
    let wait = this.venue?.msUntilNextTick() ?? 50;
    // **Cycle Audit 7, CA7-10.** A stalled market keeps a pending tick whose
    // instant recedes further into the past on every pass, so its
    // `msUntilNextTick` is 0 for ever — and the venue takes the minimum across
    // markets, so one stalled asset pinned the whole scheduler to a 1 ms timer.
    // Measured: 4 scheduler passes per real second healthy, 839 after a 20 s
    // skew — a 210x increase, sustained for the life of the process, each pass
    // walking every market and constructing a `CatchUpTooLargeError`. Nothing
    // in the logs grew to say so, because the per-asset line is deduped on the
    // error's name (a6-05), so the only visible symptom was a hot core.
    //
    // The condition is narrow on purpose: a pass that published nothing while
    // something is stalled is the stall spinning. A healthy venue always
    // publishes when it is due, so this never engages on one.
    if (this.lastPublishedCount === 0 && this.stalled.size > 0) {
      wait = Math.max(wait, STALLED_BACKOFF_MS);
    }
    return Math.max(1, Math.min(wait, 1_000));
  }

  /**
   * Run the next pass now (PH-24.13). A push retracts the pending tick and arms
   * a burst whose first instant is already in the past; the pass that publishes
   * it should not wait for a timer set before the push existed.
   */
  wake(): void {
    if (this.stopping || this.venue === null) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.schedule(0);
  }

  private schedule(waitMs: number = this.nextWaitMs()): void {
    if (this.stopping || this.venue === null) return;
    this.timer = setTimeout(() => {
      // Kept so `stop()` can wait for it rather than checkpointing on top of
      // an advance that is still writing.
      this.inFlight = this.tick()
        .catch((error: unknown) => {
          this.logger.error(`tick failed: ${String(error)}`);
        })
        .finally(() => {
          this.schedule();
        });
      void this.inFlight;
    }, waitMs);
  }
}

function isClosable(value: object): value is { close(): void } {
  return 'close' in value && typeof value.close === 'function';
}
