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
  type RecordedSeam,
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

/**
 * Consecutive failed passes before this venue stops calling itself ready
 * (Cycle Audit 10: a3-06, a6-05).
 *
 * Not one, and not never. A pass that throws once — an `EIO` on a checkpoint,
 * a transient the next pass clears — should not pull a single-node venue out
 * of an orchestrator's rotation; a pass that has thrown three times running is
 * a process that is not completing a pass at all, is writing no checkpoint,
 * and cannot say which market is affected because the failure is not
 * asset-scoped. At four passes a second that is under a second of blindness,
 * where the measured failure lasted for the life of the process.
 *
 * A publish failure that *is* asset-scoped never waits for this: it goes
 * through `stalled`, which makes the venue unready on the first one.
 */
const FAILED_PASSES_BEFORE_UNREADY = 3;

/**
 * What this service needs from the state directory's writer lock.
 *
 * Structural rather than `StateDirectoryLock` itself, so a test can hand the
 * venue a lock that loses on demand without a filesystem — and narrow on
 * purpose: `renew()` is the whole contract. The lock's own `lost` flag is not
 * read here, because `lease.ts` is right about what it means (`false` is "no
 * refusal has been seen yet", not "we lead"), and a refused renewal is the only
 * evidence this service acts on.
 */
interface WriterLock {
  /** Who this process claims to be, for the log line and the refusal. */
  readonly holder: string;
  /** Beat the heart. False means another process holds the directory now. */
  renew(): Promise<boolean>;
}

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
  /**
   * Passes that threw: every one since boot, and the run of them ending now.
   *
   * `total` is what `/metrics` exports and never goes down; `consecutive` is
   * what readiness reads and is cleared by the first pass that completes.
   */
  private readonly passFailures = { total: 0, consecutive: 0 };
  /** The message of the last pass that threw, or null when the last one completed. */
  private lastPassError: string | null = null;
  /** The `name` of that error, so the log line is written once per kind. */
  private lastPassErrorKind: string | null = null;
  /**
   * The state directory's writer lock, once `holdWriterLock` has been given one.
   *
   * Structural rather than the class from `@otc/runtime`, so a test can hand
   * this a lock that loses on demand without a filesystem.
   */
  private writerLock: WriterLock | null = null;
  /** Why this process is no longer the directory's writer, or null. */
  private lostDirectory: string | null = null;

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
    return this.notReadyReason === null;
  }

  /** Why the venue is not ready, or null when it is. */
  get notReadyReason(): string | null {
    if (!this.ready) return 'the markets have not finished resuming';
    if (this.stopping) return 'the venue is shutting down';
    // Before the stalls, because it subsumes them: a process that is not the
    // directory's writer must not be routed to at all (Cycle Audit 10: a6-05).
    if (this.lostDirectory !== null) return this.lostDirectory;
    if (this.stalled.size > 0) {
      return `stalled: ${[...this.stalled.keys()].join(', ')}`;
    }
    if (this.passFailures.consecutive >= FAILED_PASSES_BEFORE_UNREADY) {
      return (
        `${String(this.passFailures.consecutive)} consecutive publish passes have failed; ` +
        `the last said: ${this.lastPassError ?? 'nothing'}`
      );
    }
    return null;
  }

  /**
   * The message of the last pass that threw, or null when the last one
   * completed (Cycle Audit 10: a3-06). What makes `/health` say `degraded` on
   * the first one.
   */
  get lastFailedPass(): string | null {
    return this.lastPassError;
  }

  /** Why this process stopped being the writer, or null (Cycle Audit 10: a6-05). */
  get lostWriterLock(): string | null {
    return this.lostDirectory;
  }

  /**
   * Take the state directory's writer lock (Cycle Audit 10: a3-07, a6-05).
   *
   * Given by `main.ts` after the lock is acquired and before `start()`, rather
   * than through `AppModule.register()`: production registers the module bare
   * and `composition.test.ts` holds it to that. The venue renews the lock on
   * its checkpoint cadence — five seconds against a fifteen-second term, the
   * lease's three-attempts-per-term — and stops publishing the moment a renewal
   * is refused.
   */
  holdWriterLock(lock: WriterLock): void {
    this.writerLock = lock;
  }

  /** What `/metrics` reads, from what this service already counts (PH-30.1). */
  get counters(): {
    readonly ticksPublished: number;
    readonly uptimeMs: number;
    readonly subscribers: number;
    readonly failedPasses: number;
  } {
    let subscribers = 0;
    for (const id of this.assetIds) subscribers += this.feed.subscriberCount(id);
    return {
      ticksPublished: this.ticksPublished,
      uptimeMs: this.startedAt === null ? 0 : this.clock.now() - this.startedAt,
      subscribers,
      failedPasses: this.passFailures.total,
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
    // A market that seamed at this boot publishes its next tick a lease
    // beyond the record's head, and the feed is gapless by contract: primed
    // with the pre-seam tail it refused every post-seam pass, and the release
    // run's venue served nothing after its first deploy-length restart
    // (PH-30.4). So a seamed market's feed begins at the seam — what the
    // previous process served stays in the record, reachable by sequence and
    // by instant, and a client resuming from before the seam is told the
    // window starts after it, which is the refusal the resume contract is
    // built on.
    const seamed = this.recovery.get(assetId)?.kind === 'seam';
    const tail = await this.record.tail(assetId, DEFAULT_RETAIN_TICKS);
    if (tail.length > 0) {
      if (!seamed) this.feed.publish(assetId, tail);
      const newest = tail[tail.length - 1]!;
      const known = this.latest.get(assetId);
      if (known === undefined || newest.sequence > known.sequence) this.latest.set(assetId, newest);
    }
    const folded = await this.history?.prime(assetId, this.record);
    // And the commitment chain, which the record lets continue across the
    // boundary rather than restart at every boot (PH-28.3) — and which a seam
    // restarts (PH-30.4).
    await this.publication.prime(assetId, this.record, seamed);
    const head = tail.length > 0 ? tail[tail.length - 1]!.sequence : null;
    this.logger.log(
      head === null
        ? `${assetId}: no published record to prime from`
        : seamed
          ? `${assetId}: seamed; the record ends at sequence ${head} and the feed begins at ` +
            `the seam; ${folded ?? 0} folded into the open minute`
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

  /**
   * Every discontinuity the record holds for an asset, oldest first (PH-31).
   *
   * From the record, not from `recoveryFor`: `recovery` is this boot's outcome
   * in this process's memory, and a broker settling a contract from last
   * month needs the seam a deploy three restarts ago left behind. The record is
   * the only thing that remembers those.
   */
  seams(assetId: string): Promise<readonly RecordedSeam[]> {
    if (this.record === null) return Promise.resolve([]);
    return this.record.seams(assetId);
  }

  /** The recorded seam whose interval contains an instant, or null (PH-31). */
  seamAt(assetId: string, instant: number): Promise<RecordedSeam | null> {
    if (this.record === null) return Promise.resolve(null);
    return this.record.seamAt(assetId, instant);
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

  /**
   * Publish everything due, then persist if the cadence has elapsed.
   *
   * The accounting wrapper, and it is the finding (Cycle Audit 10: a3-06,
   * a6-05). `schedule()` caught whatever this rejected with, wrote
   * `tick failed: ...` and dropped
   * it — so a venue whose every pass threw for minutes answered
   * `{"status":"ok","stalled":[],"ready":true}` with `otc_markets_stalled` 0
   * and a climbing tick counter, while every subscriber received nothing.
   * Measured on the release build: 900+ ticks recorded, zero bytes served in
   * eight seconds, 6,795 failed passes, green throughout.
   *
   * A pass that throws is now a fact the process carries: `/health` is
   * `degraded` on the first one, `/health/ready` refuses after
   * {@link FAILED_PASSES_BEFORE_UNREADY} consecutive ones, and
   * `otc_tick_pass_failures_total` counts every one of them. The rejection is
   * still a rejection — `stop()` and any direct caller see it — it simply is
   * not the only trace any more.
   */
  async tick(): Promise<void> {
    try {
      await this.#pass();
    } catch (error) {
      this.#passFailed(error);
      throw error;
    }
    this.passFailures.consecutive = 0;
    this.lastPassError = null;
    this.lastPassErrorKind = null;
  }

  /**
   * Record a failed pass where the operator surface can see it.
   *
   * The log line is deduped on the error's *kind*, for the reason the stall
   * line is: an auditor counted 6,795 identical `tick failed` lines in 45
   * seconds, and the one that mattered was the first. The count that was lost
   * with them is in `/metrics`.
   */
  #passFailed(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof Error ? error.name : 'unknown';
    this.passFailures.total += 1;
    this.passFailures.consecutive += 1;
    this.lastPassError = message;
    if (this.lastPassErrorKind !== kind) {
      this.lastPassErrorKind = kind;
      this.logger.error(
        `tick failed: ${message} (logged once per ${kind}; the count is in ` +
          `otc_tick_pass_failures_total and the state is in /health)`,
      );
    }
  }

  async #pass(): Promise<void> {
    if (this.venue === null) return;
    // Not the writer any more: publish nothing, record nothing (Cycle Audit 10: a6-05).
    if (this.lostDirectory !== null) return;
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
      // **Isolated per asset, and unrecoverable in this process (Cycle Audit 10:
      // a3-06).**
      // `advanceDetailed` above is isolated for CA6-33's reason; this loop was
      // not, so one asset's throw abandoned every asset after it in the pass —
      // ticks already in the record, never offered to the feed, the chain or
      // the history, and never offerable again because `append` is a comparing
      // append and returns a recorded tick as "not fresh" for ever.
      //
      // **There is no honest retry from inside the pass.** `append` compares:
      // a sequence it already holds is not returned as fresh again, ever
      // (`tickRecord.ts`, "Ticks the record already holds are not returned as
      // fresh"). So offering the same batch a second time yields nothing, and
      // the only way to move those ticks onward would be to read them back out
      // of the record and hand them to the feed directly.
      //
      // That machinery exists — `feed.forget` then `#primeFromRecord`, which
      // is exactly what a boot does — and it is deliberately **not** wired
      // here, for three reasons. It evicts every subscriber of that market on
      // every occurrence. The refusal is itself evidence that the record moved
      // without this process's feed seeing it — in the measured case a second
      // writer on the state directory — so healing it silently hides the
      // writer and leaves two engines interleaving one id, which is INV-002
      // broken where nobody can see it. And because the other writer keeps
      // appending, the heal would repeat every pass: a market that drops its
      // subscribers four times a second while `/health` says `ok` is worse
      // than one that stops and says so.
      //
      // So the market is marked unserving, exactly as a record refusal marks
      // one: stalled by name, unhosted so it stops generating what it cannot
      // serve, `/health` degraded, `/health/ready` refusing, and
      // `otc_markets_stalled` counting it. The recovery is a restart, where
      // `#primeFromRecord` reconciles the feed, the chain and the history with
      // the record in the one place that knows how — and the state directory's
      // writer lock is what stops the second writer causing it again.
      try {
        this.feed.publish(assetId, ticks);
        // The counter after the publish, never before (Cycle Audit 10: a6-05): it read
        // `otc_ticks_published_total` climbing past a thousand on a process
        // whose feed had not accepted a tick in minutes.
        this.ticksPublished += ticks.length;
        // After publication, never before: the publisher sees the record, it does
        // not participate in producing it (INV-001). The same is true of the
        // history: a chart is a view of what happened, and a view that could
        // influence what happens next would be the whole product broken.
        this.publication.observe(assetId, ticks);
        this.history?.observe(assetId, ticks);
      } catch (error) {
        this.#publishRefused(assetId, error);
      }
    }
    if (this.clock.now() - this.lastCheckpointAt >= this.checkpointEveryMs) {
      await this.checkpoint();
    }
  }

  /**
   * A market whose publish path refused: unserving, by name, until a restart.
   *
   * The same treatment a record refusal gets, because it is the same class of
   * fact — this process cannot serve what it recorded. Unhosting stops the
   * engine advancing a market nobody receives; the stall is what `/health`,
   * `/health/ready` and `otc_markets_stalled` read.
   */
  #publishRefused(assetId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.stalled.set(assetId, `refused by the publish path — ${message}`);
    this.stalledLogged.set(assetId, 'PublishRefusal');
    this.venue?.unhost(assetId);
    this.logger.error(
      `${assetId}: REFUSED BY THE PUBLISH PATH and unhosted — ${message} ` +
        `(the ticks are in the record and cannot be offered to the feed again; ` +
        `a restart primes the feed from the record)`,
    );
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

  /**
   * Renew the writer lock, and say whether this process still leads.
   *
   * True when no lock was given — a test, or a deployment that has not been
   * pointed at a directory. False once a renewal has been refused, and false
   * for ever after: the venue stops publishing, `/health` goes `degraded` and
   * `/health/ready` refuses, which is what an orchestrator needs to stop
   * routing to a process whose directory belongs to somebody else.
   */
  async #stillTheWriter(): Promise<boolean> {
    if (this.writerLock === null) return true;
    if (this.lostDirectory !== null) return false;
    if (await this.writerLock.renew()) return true;
    this.lostDirectory =
      `the state directory's writer lock was lost by ${this.writerLock.holder}; ` +
      `another process holds it, so this one has stopped publishing`;
    this.logger.error(
      `LOST THE STATE DIRECTORY — ${this.lostDirectory}. Nothing further is published, ` +
        `checkpointed or recorded by this process.`,
    );
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return false;
  }

  /**
   * Persist every market that is actually publishing, and renew the lock.
   *
   * Two things are deliberately *not* checkpointed: a market that is stalled
   * (see below), and anything at all once this process has lost the state
   * directory's writer lock.
   */
  async checkpoint(): Promise<void> {
    if (this.venue === null) return;
    // The heartbeat, and the check, before anything is written (Cycle Audit 10:
    // a6-05). A process that has lost the state directory must not write a
    // checkpoint, trim the record or flush a bar into it: whoever holds the lock
    // now is the writer, and two writers on one directory is the failure this
    // exists to prevent.
    if (!(await this.#stillTheWriter())) return;
    const now = this.clock.now();
    for (const assetId of this.venue.assetIds) {
      // **A stalled market's checkpoint is not refreshed (Cycle Audit 10:
      // ops-observed).** `resumeMarket` decides between continuing and seaming
      // on `clock.now() - record.savedAt`, and this loop was writing `savedAt =
      // now` for every hosted market on every cadence — including one that had
      // refused every advance for hours. So the checkpoint stayed *fresh* while
      // the market it described stayed *stale*, the next boot chose `resumed`,
      // `HostedMarket` floored on the old `lastPublished` and refused again,
      // and the stall survived every restart. Measured on the operator's own
      // panel after the host was suspended: thirty markets stalled with
      // "Market is 11326s behind the clock", a clean restart changed nothing,
      // and the only remedy anyone had was to move the state directory aside —
      // which throws the record away.
      //
      // This is CA7-09's wedge with a different way in, and the same answer: a
      // checkpoint is a claim that this market was here at this instant, and a
      // market that published nothing because it is past its catch-up bound was
      // not. Leaving its last true checkpoint alone means the next boot sees a
      // checkpoint older than the bound and takes the seam ADR-0010 already
      // decided on — visible, recorded, and keeping every tick. A restart
      // becomes the remedy it always looked like.
      //
      // Nothing else is skipped by omission: `trim` is bounded maintenance on a
      // market that is producing nothing, and `checkpointTaken` is skipped with
      // the save it belongs to, which leaves the control mark set — the
      // conservative direction, since the mark makes the next boot seam.
      if (this.stalled.has(assetId)) continue;
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
    if (this.stopping || this.venue === null || this.lostDirectory !== null) return;
    this.timer = setTimeout(() => {
      // Kept so `stop()` can wait for it rather than checkpointing on top of
      // an advance that is still writing.
      this.inFlight = this.tick()
        .catch(() => {
          // **Swallowed here, but no longer swallowed (Cycle Audit 10: a3-06).**
          // This used to
          // be the only trace a failed pass left: a log line, and a health
          // surface that went on saying `ok` with an empty `stalled` list
          // while the venue served nothing for the life of the process.
          // `tick()` has already counted it, logged it once per kind, and put
          // it where `/health`, `/health/ready` and `/metrics` read it. The
          // rejection is absorbed only so the scheduler's chain continues.
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
