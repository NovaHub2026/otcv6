import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  epochMillis,
  logPrice,
  SystemClock,
  type Clock,
  type EpochMillis,
  type LogPrice,
  type MasterKeyring,
  type RandomSource,
  type Tick,
  yieldToLoop,
} from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine, type RegisteredAsset } from '@otc/engine';
import {
  checkpointMarket,
  resumeMarket,
  Venue,
  type HostedMarket,
  type RecoveryOutcome,
  type SignSourceFactory,
  type StateStore,
  type AssetOverlay,
} from '@otc/runtime';
import { TickFeed } from '@otc/distribution';
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
  ) {}

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
    this.lastCheckpointAt = this.clock.now();
    this.schedule();
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

  /**
   * The hosted market for an asset, or null.
   *
   * Exposed for the Lab, which reads engine state the product never publishes.
   * The boundary that makes that safe is composition — `AppModule` does not
   * import `LabModule` — rather than a check here, because a check here would
   * be a flag (ADR-0015 §3).
   */
  hostedMarket(assetId: string): HostedMarket | null {
    if (this.venue === null || !this.assetIds.includes(assetId)) return null;
    try {
      return this.venue.marketFor(assetId);
    } catch {
      return null;
    }
  }

  /**
   * The unsigned step sizes the next `spanMs` of this market will produce.
   *
   * Read from a **fork**: the engine is snapshotted and a copy is run forward,
   * so the live market is not advanced and no keystream position is consumed
   * twice. The steps are the same whatever signs are drawn — that is ADR-0003's
   * theorem, and `stepIndependence.test.ts` verifies it on the shipped engine —
   * which is what makes an exact close cost two milliseconds instead of minutes.
   */
  labStepsAhead(assetId: string, spanMs: number): number[] {
    const market = this.hostedMarket(assetId);
    const asset = this.assetFor(assetId);
    if (market === null || asset === null) return [];
    const snapshot = market.snapshotEngine();
    const fork = createMarketEngine({
      config: configFor(asset),
      keyring: this.keyring,
      environment: 'production',
      start: { instant: epochMillis(snapshot.instant), price: logPrice(snapshot.price) },
    });
    fork.restore(snapshot);
    const steps: number[] = [];
    let price = snapshot.price;
    const until = snapshot.instant + spanMs;
    for (;;) {
      const tick = fork.next();
      if (tick === null || tick.instant > until) break;
      steps.push(Math.abs(tick.price - price));
      price = tick.price;
    }
    return steps;
  }

  /**
   * The next `count` ticks this market will produce, from a fork.
   *
   * Same fork discipline as {@link VenueService.labStepsAhead}: the live engine
   * is snapshotted and a copy run forward, so the market is not advanced and no
   * keystream position is consumed twice. The Lab reads the future; it does not
   * spend it.
   */
  /**
   * `labTicksAhead`, yielding to the event loop every `chunk` ticks (PH-24.17).
   *
   * The quality sample is a span in the asset's own ticks — millions at the
   * finer grain — and a synchronous walk of that length held the process for
   * seconds: the panel's polls answered 502 and the screen read the Lab as
   * gone. The venue keeps ticking between chunks.
   */
  async labTicksAheadAsync(assetId: string, count: number, chunk = 250_000): Promise<Tick[]> {
    const market = this.hostedMarket(assetId);
    const asset = this.assetFor(assetId);
    if (market === null || asset === null) return [];
    const snapshot = market.snapshotEngine();
    const fork = createMarketEngine({
      config: configFor(asset),
      keyring: this.keyring,
      environment: 'production',
      start: { instant: epochMillis(snapshot.instant), price: logPrice(snapshot.price) },
    });
    fork.restore(snapshot);
    const ticks: Tick[] = [];
    for (let i = 0; i < count; i += 1) {
      const tick = fork.next();
      if (tick === null) break;
      ticks.push(tick);
      if (ticks.length % chunk === 0) await yieldToLoop();
    }
    return ticks;
  }

  labTicksAhead(assetId: string, count: number): Tick[] {
    const market = this.hostedMarket(assetId);
    const asset = this.assetFor(assetId);
    if (market === null || asset === null) return [];
    const snapshot = market.snapshotEngine();
    const fork = createMarketEngine({
      config: configFor(asset),
      keyring: this.keyring,
      environment: 'production',
      start: { instant: epochMillis(snapshot.instant), price: logPrice(snapshot.price) },
    });
    fork.restore(snapshot);
    const ticks: Tick[] = [];
    for (let i = 0; i < count; i += 1) {
      const tick = fork.next();
      if (tick === null) break;
      ticks.push(tick);
    }
    return ticks;
  }

  /**
   * A fork of a hosted market, positioned where the live engine stands.
   *
   * Same discipline as {@link VenueService.labStepsAhead}: snapshot, copy,
   * restore — the live market is not advanced and no keystream position is
   * spent twice. The fork stands at the engine's current price, which is the
   * pending tick's when one is drawn (the snapshot is taken after that draw),
   * and its first `next()` is the tick the live engine will draw next. That is
   * exactly the alignment PH-24.2 needs for an armed vector to begin on the
   * right tick.
   */
  labFork(
    assetId: string,
    wrapSign?: (keystream: RandomSource) => RandomSource,
    wrapArrival?: (keystream: RandomSource) => RandomSource,
  ): {
    readonly price: LogPrice;
    readonly instant: EpochMillis;
    next(): Tick | null;
  } | null {
    const market = this.hostedMarket(assetId);
    const asset = this.assetFor(assetId);
    if (market === null || asset === null) return null;
    const snapshot = market.snapshotEngine();
    const config = configFor(asset);
    // PH-24.10: a fork whose signs the Lab chooses — the landing of a push is
    // the engine's own magnitudes under the pushed signs. Only the sign stream
    // is substituted, as the mirror harness does; `restore` seeks it, so a
    // wrapper that releases on seek must be armed after this returns.
    const derive = (purpose: 'sign' | 'arrival'): RandomSource =>
      this.keyring.derive({ env: 'production', asset: config.instrument.id, purpose, keyEpoch: 0 });
    const streams =
      wrapSign === undefined && wrapArrival === undefined
        ? {}
        : {
            streams: {
              ...(wrapSign === undefined ? {} : { sign: wrapSign(derive('sign')) }),
              ...(wrapArrival === undefined ? {} : { arrival: wrapArrival(derive('arrival')) }),
            },
          };
    const fork = createMarketEngine({
      config,
      keyring: this.keyring,
      environment: 'production',
      start: { instant: epochMillis(snapshot.instant), price: logPrice(snapshot.price) },
      ...streams,
    });
    fork.restore(snapshot);
    return {
      price: snapshot.price,
      instant: epochMillis(snapshot.instant),
      next: () => fork.next(),
    };
  }

  /** A Lab-only randomness stream: never a market one. */
  labRandom(assetId: string): RandomSource {
    return this.keyring.derive({
      env: 'simulation',
      asset: assetId,
      purpose: 'lab-close-selection',
      keyEpoch: 0,
    });
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
    for (const { assetId, ticks } of published) {
      if (this.stalled.delete(assetId)) {
        this.stalledLogged.delete(assetId);
        this.logger.log(`${assetId}: publishing again`);
      }
      const last = ticks[ticks.length - 1];
      if (last !== undefined) this.latest.set(assetId, last);
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

  async checkpoint(): Promise<void> {
    if (this.venue === null) return;
    const now = this.clock.now();
    for (const assetId of this.venue.assetIds) {
      await this.store.save(checkpointMarket(this.venue.marketFor(assetId), assetId, now));
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
