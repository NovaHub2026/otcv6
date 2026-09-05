import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Req,
  Query,
  Res,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { EvictedError, UnknownSequenceError, type FeedSink } from '@otc/distribution';
import {
  ASSET_ARCHETYPES,
  archetypeById,
  checkIdentity,
  dispersionLogSigma,
  dispersionPercent,
  seatById,
  type AssetBrief,
} from '@otc/engine';
import { epochMillis, isTimeframeId, timeframe as timeframeById, type Tick } from '@otc/core';
import {
  assertOverlay,
  HistoryError,
  HISTORY_BASE_TIMEFRAME,
  ImmutableFieldError,
  OVERLAY_FIELDS,
  type AssetRegistry,
} from '@otc/runtime';
import { displayPrice } from '@otc/chart';
import { HistoryService } from './history.service.js';
import { RegistrationService } from './registration.service.js';
import { VenueService } from './venue.service.js';

/** Injection token for the boot nonce `/health` echoes (a6-14). */
export const BOOT_NONCE = 'BOOT_NONCE';

/**
 * The HTTP surface: observation for anyone, administration for the operator.
 *
 * Two kinds of route live here and the difference is enforced, not described.
 * The reads — health, markets, history, the tick stream, the catalogue, the
 * archetypes, the registration jobs — are open to every observer, because the
 * market is public and every observer sees the same one (INV-002). The writes —
 * creating, renaming and retiring an asset — need the operator's bearer token
 * and a JSON body, checked by `AdminWriteGuard` before any handler below runs
 * (a6-01). Until the out-of-band audit this docstring still said the controller
 * was read-only, three subphases after it stopped being.
 *
 * Nothing here is economic. There are no positions, no contracts and no
 * settlement in this service; the trading boundary lives in `packages/trading`
 * and the guardrail scan keeps that vocabulary out of `apps/api/src`. And
 * nothing here generates: every handler reads a record the venue has already
 * published, or asks a job to run, and none of them can reach the price path
 * (INV-001).
 */
/** A composite `Last-Event-ID`, when the browser reconnected on its own. */
function asLastEventId(request: Request): string | undefined {
  const header = request.headers['last-event-id'];
  return typeof header === 'string' ? header : undefined;
}

/** The injection token for the replay ceiling. */
export const REPLAY_BUDGET = Symbol('OTC_REPLAY_BUDGET');

@Controller()
export class MarketController implements BeforeApplicationShutdown {
  /**
   * Every tick stream this process is serving, so shutdown can end each one
   * with an `event: close` rather than a dropped socket (a6-09).
   */
  private readonly streams = new Set<{ cancel: (reason?: string) => void }>();

  constructor(
    private readonly venue: VenueService,
    /**
     * Declared explicitly because the type is nullable.
     *
     * Nest reads constructor types from `design:paramtypes`, and a union with
     * `null` erases to `Object` — which it then tries to resolve as a provider
     * and fails at boot. A default value does not help: the container never gets
     * far enough to leave the parameter out.
     */
    @Optional() @Inject(HistoryService) private readonly history: HistoryService | null = null,
    @Optional()
    @Inject(RegistrationService)
    private readonly registration: RegistrationService | null = null,
    @Optional() @Inject('ASSET_REGISTRY') private readonly registry: AssetRegistry | null = null,
    @Optional() @Inject(BOOT_NONCE) private readonly bootNonce: string | null = null,
    /**
     * The process-wide replay ceiling.
     *
     * A parameter rather than a constant so the behaviour at the ceiling can be
     * tested with a small number instead of by buffering sixty-four megabytes.
     * The *counter* it is compared against stays module state, because the
     * quantity really is per process: PH-22.3 measured that a per-connection
     * bound does nothing in a storm, since what matters when everyone
     * reconnects at once is the sum.
     *
     * **Injected through a token, and that is not optional.** A bare `number`
     * parameter makes Nest read `Number` from `design:paramtypes` and try to
     * resolve it as a provider: `Nest can't resolve dependencies of the
     * MarketController … argument Number at index [5]`. The service does not
     * boot at all. The same trap is documented two parameters above for a
     * nullable type, and it caught this one the same way — by refusing to
     * start, in a load run, after every unit test passed. The unit tests
     * construct this controller directly and never meet the container.
     */
    @Optional()
    @Inject(REPLAY_BUDGET)
    private readonly replayBudgetBytes: number = MAX_TOTAL_REPLAY_BYTES,
  ) {}

  /**
   * Whether the venue is actually publishing, not merely running.
   *
   * **Cycle Audit 6, CA6-33.** This returned `{"status":"ok"}` for a venue whose
   * markets had all stopped: a market past its catch-up bound refuses every
   * later advance, and the failure list that says so was being discarded. A
   * health endpoint that cannot report the one failure its process has is worse
   * than none, because it is what a monitor watches.
   *
   * `bootNonce` echoes `OTC_BOOT_NONCE` (a6-14). A test that spawns this service
   * on a port used to accept the first healthy answer on that port as its own
   * engine; a foreign engine already listening there answered at once while the
   * test's own child was still provisioning, and the suite ran its assertions
   * against somebody else's market. The nonce is how a caller knows which
   * process is answering.
   */
  @Get('health')
  health(): unknown {
    const stalled = this.venue.stalledMarkets;
    return {
      status: stalled.length === 0 ? 'ok' : 'degraded',
      assets: this.venue.assetIds.length,
      stalled,
      bootNonce: this.bootNonce,
    };
  }

  @Get('markets')
  markets(): unknown {
    return this.venue.assetIds.map((id) => this.describe(id));
  }

  /**
   * One connection, several assets, and the same resume contract per asset.
   *
   * **PH-22.2.** PH-22.1 measured the server holding two thousand observers at
   * 8.7% of a core with no gaps and no duplicates, and left one ceiling
   * standing: a browser gets **six connections per origin** on HTTP/1.1, so the
   * eight charts per client this product is for do not fit, whatever the server
   * can serve.
   *
   * The optimisation is easy and the contract is the hard part. SSE carries one
   * `Last-Event-ID` per connection; a stream carrying eight assets has eight
   * positions. The moment one number stands for eight, a reconnect either
   * replays what a client already has or skips what it does not — and a gap
   * served in silence is indistinguishable from the market (INV-002).
   *
   * So the position is per asset, everywhere:
   *
   * ```
   * GET /markets/stream?assets=eurusd,btcusd
   * GET /markets/stream?assets=eurusd,btcusd&from=eurusd:481775,btcusd:9912&onGap=live
   * ```
   *
   * - Every event names its asset in the payload, so a client demultiplexes by
   *   reading what it already parses.
   * - An asset absent from `from` starts at the live edge, which is what adding
   *   a chart mid-session means.
   * - `onGap=live` keeps its meaning, and the `gap` event **names the asset**.
   *   One asset's eviction does not tear down the other seven.
   * - The `id:` field carries the whole stream's position, `asset:sequence`
   *   comma-separated, so the browser's own `Last-Event-ID` reconnect is
   *   exactly as informative as an explicit `from` — the property CA6-32
   *   measured a 19-tick silent skip against.
   *
   * The single-asset endpoint is untouched. This is an addition.
   */
  @Get('markets/stream')
  multiplexed(
    @Res() res: Response,
    @Req() request: Request,
    @Query('assets') assets?: string,
    @Query('from') from?: string,
    @Query('onGap') onGap?: string,
  ): void {
    if (onGap !== undefined && onGap !== 'live') {
      throw new BadRequestException(`onGap must be 'live' if present, received ${onGap}.`);
    }
    const liveOnGap = onGap === 'live';

    const requested = (assets ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (requested.length === 0) {
      throw new BadRequestException('assets must name at least one asset, comma-separated.');
    }
    const duplicated = requested.filter((id, index) => requested.indexOf(id) !== index);
    if (duplicated.length > 0) {
      // Subscribing twice to one asset would deliver every tick twice on one
      // stream, which a client cannot tell from the feed doing it.
      throw new BadRequestException(`assets names ${duplicated[0]!} more than once.`);
    }
    if (requested.length > MAX_MULTIPLEXED_ASSETS) {
      throw new BadRequestException(
        `assets names ${String(requested.length)} assets; the most one stream may carry is ` +
          `${String(MAX_MULTIPLEXED_ASSETS)}.`,
      );
    }
    for (const id of requested) {
      if (!this.venue.assetIds.includes(id)) throw new NotFoundException(`Unknown asset ${id}.`);
    }

    // `from` is per asset, and a position for an asset the stream does not carry
    // is a client that believes it asked for something else.
    const resumeAt = new Map<string, number>();
    /**
     * The two spellings mean different things, and this endpoint used to
     * conflate them (Cycle Audit 8, a3).
     *
     * `?from=` is "the next sequence I want" — an inclusive start, which is what
     * `observerLoad` and the admin surface test rely on. `Last-Event-ID` is the
     * SSE mechanism, and it carries **the last event the client was given**. The
     * single-asset endpoint has always distinguished them (`parsed + 1`); this
     * one did not, so every automatic browser reconnect redelivered one tick per
     * asset. A duplicate is the mirror image of CA6-32's silent skip: the client
     * cannot tell it from the market.
     */
    const fromHeader = from === undefined;
    const composite = from ?? asLastEventId(request);
    if (composite !== undefined && composite.trim().length > 0) {
      for (const entry of composite.split(',')) {
        const [id, raw] = entry.split(':');
        if (id === undefined || raw === undefined || !/^\d+$/.test(raw)) {
          throw new BadRequestException(
            `from must be a comma-separated list of asset:sequence, received ${entry}.`,
          );
        }
        if (!requested.includes(id)) {
          throw new BadRequestException(`from names ${id}, which this stream does not carry.`);
        }
        resumeAt.set(id, Number.parseInt(raw, 10) + (fromHeader ? 1 : 0));
      }
    }

    let headersSent = false;
    let bufferedBytes = 0;
    const buffered: string[] = [];
    const write = (chunk: string): void => {
      if (headersSent) res.write(chunk);
      else {
        buffered.push(chunk);
        bufferedBytes += chunk.length;
      }
    };

    /** The stream's position: one sequence per asset, so a reconnect is exact. */
    const position = new Map<string, number>();
    const positionId = (): string =>
      requested
        .filter((id) => position.has(id))
        .map((id) => `${id}:${String(position.get(id))}`)
        .join(',');

    const subscriptions: { cancel: (reason?: string) => void }[] = [];
    const sinkFor = (assetId: string): FeedSink => ({
      deliver: (_id, ticks): boolean => {
        for (const tick of ticks) {
          if (!headersSent && bufferedBytes >= MAX_REPLAY_BYTES) return false;
          position.set(assetId, tick.sequence);
          write(`id: ${positionId()}\ndata: ${JSON.stringify({ asset: assetId, ...tick })}\n\n`);
        }
        return headersSent ? !res.writableNeedDrain : bufferedBytes < MAX_REPLAY_BYTES;
      },
      close: (reason): void => {
        // One asset ending is not the stream ending: the client is told which,
        // and the others keep delivering.
        write(`event: close\ndata: ${JSON.stringify({ asset: assetId, reason })}\n\n`);
      },
    });

    try {
      for (const assetId of requested) {
        const at = resumeAt.get(assetId);
        let budgetRefused = false;
        try {
          if (at !== undefined && replayBudgetInUse >= this.replayBudgetBytes) {
            budgetRefused = true;
            throw new EvictedError(assetId, at, at);
          }
          subscriptions.push(this.venue.feed.subscribe(assetId, sinkFor(assetId), at));
        } catch (error) {
          if (!(error instanceof EvictedError || error instanceof UnknownSequenceError))
            throw error;
          if (!liveOnGap) throw new BadRequestException(`${assetId}: ${error.message}`);
          // From the oldest retained sequence after the gap, as the
          // single-market stream does (PH-25.1); the live edge only when the
          // refusal was this process's replay budget.
          const resumesAt =
            error instanceof EvictedError && !budgetRefused ? error.oldestRetained : undefined;
          write(
            `event: gap\ndata: ${JSON.stringify({
              asset: assetId,
              requested: at,
              reason: error.message,
              resumesAt: resumesAt ?? null,
            })}\n\n`,
          );
          subscriptions.push(this.venue.feed.subscribe(assetId, sinkFor(assetId), resumesAt));
        }
      }
    } catch (error) {
      for (const subscription of subscriptions) subscription.cancel('stream refused');
      throw error;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    headersSent = true;
    let full = false;
    for (const chunk of buffered) {
      res.write(chunk);
      if (res.writableNeedDrain) full = true;
    }
    buffered.length = 0;

    chargeUndrained(res);

    const live = {
      cancel: (reason?: string): void => {
        for (const subscription of subscriptions) subscription.cancel(reason);
        // **Cycle Audit 8 (a3).** The per-asset `close` above writes its frame
        // and returns, because one asset ending is not the connection ending.
        // Cancelling `live` *is* the connection ending, and nothing ended it:
        // `beforeApplicationShutdown` left every multiplexed client holding
        // close frames on a response that stayed open, against its own
        // docstring, and what terminated them was `forceCloseConnections`
        // destroying the socket. A client can tell an ended response from a
        // network fault and reconnect; it cannot tell a destroyed one.
        if (!res.writableEnded) res.end();
      },
    };
    if (full) {
      res.write(
        `event: close\ndata: ${JSON.stringify({ reason: 'client fell behind during replay' })}\n\n`,
      );
      live.cancel('client fell behind during replay');
      res.end();
      return;
    }
    this.streams.add(live);
    res.on('close', () => {
      this.streams.delete(live);
      live.cancel('client disconnected');
    });
  }

  @Get('markets/:id')
  market(@Param('id') id: string): unknown {
    if (!this.venue.assetIds.includes(id)) {
      throw new NotFoundException(`Unknown asset ${id}.`);
    }
    return this.describe(id);
  }

  /**
   * The vocabulary an operator picks from.
   *
   * Eight archetypes, each a *region* of trait space rather than a template, so
   * two assets drawn from one of them are two markets rather than one under two
   * names (INV-007). The dispersion band is quoted both ways because log units
   * are where the arithmetic is honest and percent is where an operator thinks.
   */
  @Get('archetypes')
  archetypes(): unknown {
    return ASSET_ARCHETYPES.map((archetype) => ({
      id: archetype.id,
      label: archetype.label,
      family: archetype.family,
      character: archetype.character,
      dispersion: {
        min: archetype.dispersion.min,
        max: archetype.dispersion.max,
        minPercent: dispersionPercent(archetype.dispersion.min),
        maxPercent: dispersionPercent(archetype.dispersion.max),
      },
      excessKurtosis: archetype.excessKurtosis,
    }));
  }

  /**
   * Create an asset. Returns a **job**, not an asset.
   *
   * Four of the pipeline's six stages are simulation, and it costs between half
   * a second and twenty seconds depending on the family
   * (`RegistrationService`). Returning the asset would mean holding an HTTP
   * request open across a personality solve, a lattice calibration and a
   * dispersion fit — a proxy would time out the slow families, and a retry would
   * start a second registration of the same id.
   *
   * The body is five fields. There is no way to express a price path, a
   * direction, or a payout here, and that is structural rather than validated:
   * the only quantity an operator supplies about *movement* is a quarterly
   * dispersion budget, which is symmetric by construction (INV-001, INV-006).
   *
   * Two status codes for an identity refusal (a6-08): a **duplicate** id is a
   * conflict with something that exists, 409; a malformed, over-long or
   * otherwise unusable brief is the request's own fault, 400. The message is
   * the pipeline's in both cases.
   */
  @Post('assets')
  createAsset(@Body() body: unknown): unknown {
    if (this.registration === null) {
      throw new NotFoundException('This deployment does not register assets at runtime.');
    }
    const brief = asBrief(body);
    // The refusals that need no simulation are given now. An operator who
    // mistypes an id that already exists should not wait for a solve to hear it.
    const identity = checkIdentity(brief, this.venue.catalogue);
    if (identity !== null) {
      const duplicate = this.venue.catalogue.some((asset) => asset.definition.id === brief.id);
      throw duplicate ? new ConflictException(identity) : new BadRequestException(identity);
    }
    const job = this.registration.submit(brief);
    return { job: job.id, state: job.state, poll: `/registrations/${job.id}` };
  }

  /**
   * Edit an asset. The editable surface is one field.
   *
   * An id derives the keystream (ADR-0002), a quantum decides every settlement
   * (ADR-0004), a reference price maps those integers to the numbers a viewer
   * read, and a personality *is* the market. Each is refused **by name**, so an
   * operator who tries learns which invariant they were about to break rather
   * than that "the request was invalid".
   *
   * The store is written before the venue is renamed (a6-02). Overlay writes
   * are serialised in the registry, so twenty concurrent renames land in order;
   * applying the in-memory name only after its write resolved is what keeps the
   * catalogue this process serves equal to the one the next boot will read.
   */
  @Patch('assets/:id')
  async editAsset(@Param('id') id: string, @Body() body: unknown): Promise<unknown> {
    const registry = this.requireRegistry();
    if (this.venue.assetFor(id) === null) throw new NotFoundException(`Unknown asset ${id}.`);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Body must be a JSON object.');
    }
    // `retiredAt` is refused here even though it is a stored overlay field:
    // retiring is a decision with consequences for a running market, and it has
    // its own endpoint that performs them.
    if ('retiredAt' in body) {
      throw new BadRequestException('Use POST /assets/:id/retire to retire an asset.');
    }
    const raw = body as Record<string, unknown>;
    if (!('displayName' in raw)) {
      // The closed list first, so an immutable field is refused by name even
      // when nothing editable came with it.
      try {
        assertOverlay(body);
      } catch (error) {
        if (error instanceof ImmutableFieldError) throw new BadRequestException(error.message);
        throw new BadRequestException((error as Error).message);
      }
      throw new BadRequestException(`Nothing to change. Editable: ${OVERLAY_FIELDS.join(', ')}.`);
    }
    // Shape before the store sees it (a6-13): the registry's own check assumed
    // a string and answered `123` with "trim is not a function".
    const displayName = displayNameParam(raw['displayName']);
    try {
      assertOverlay({ ...raw, displayName });
    } catch (error) {
      if (error instanceof ImmutableFieldError) throw new BadRequestException(error.message);
      throw new BadRequestException((error as Error).message);
    }
    await registry.putOverlay(id, { displayName });
    this.venue.rename(id, displayName);
    return { id, displayName };
  }

  /**
   * Retire an asset: stop hosting it, keep everything it published.
   *
   * Final, and deliberately. A market resumed after a gap either invents the
   * interval nobody generated — which this runtime refuses outright — or takes a
   * seam in a published record, which an operator would be choosing to put into
   * a market that had already printed prices. The history, the settlements and
   * the publication journal remain exactly as they were and stay readable.
   */
  @Post('assets/:id/retire')
  async retireAsset(@Param('id') id: string): Promise<unknown> {
    const registry = this.requireRegistry();
    if (this.venue.assetFor(id) === null) throw new NotFoundException(`Unknown asset ${id}.`);
    if (this.venue.isRetired(id)) {
      throw new ConflictException(`Asset ${id} is already retired. Retirement is final.`);
    }
    const retiredAt = this.venue.now();
    // The venue first: if writing the overlay failed after the market had been
    // dropped, a restart would silently host it again and print a tick after a
    // gap. This order fails the other way — stored but still hosted until the
    // next restart, which is visible and harmless.
    await this.venue.retire(id);
    await registry.putOverlay(id, { retiredAt });
    return { id, retiredAt };
  }

  private requireRegistry(): AssetRegistry {
    if (this.registry === null) {
      throw new NotFoundException('This deployment does not administer assets at runtime.');
    }
    return this.registry;
  }

  /** Every registration this process has run, newest first. */
  @Get('registrations')
  registrations(): unknown {
    if (this.registration === null) return [];
    return this.registration.list();
  }

  @Get('registrations/:id')
  registration_(@Param('id') id: string): unknown {
    const job = this.registration?.get(id) ?? null;
    if (job === null) throw new NotFoundException(`Unknown registration job ${id}.`);
    return job;
  }

  /**
   * Every registered asset, with the evidence its registration produced.
   *
   * More than {@link MarketController.markets} reports, and deliberately: that
   * endpoint answers "where is this market now" for anyone, this one answers
   * "what kind of market is this" for whoever runs it. Both are read-only and
   * neither is economic.
   */
  @Get('catalogue')
  catalogue(): unknown {
    const live = new Set(this.venue.assetIds);
    return this.venue.catalogue.map((asset) => ({
      // The seat a compiled asset was drawn from, or null for one registered
      // at runtime (PH-26.4): a broker's screen wants to say what an
      // instrument is without a second lookup, and the seat's prose is the only
      // place that lives. Archetype, prose and a citation — no trait, no label,
      // no cursor (INV-010).
      seat: seatOf(asset.definition.id),
      id: asset.definition.id,
      displayName: asset.definition.displayName,
      family: asset.definition.family,
      live: live.has(asset.definition.id),
      retired: this.venue.isRetired(asset.definition.id),
      referencePrice: asset.instrument.referencePrice,
      displayPrecision: asset.instrument.displayPrecision,
      logQuantum: asset.instrument.logQuantum,
      meanIntervalMs: asset.evidence.meanIntervalMs,
      tieRate: asset.evidence.tieRate,
      excessKurtosis: asset.evidence.predictedExcessKurtosis,
      dispersion: {
        quarterlyLogSigma: dispersionLogSigma(asset.evidence),
        quarterlyPercent: dispersionPercent(dispersionLogSigma(asset.evidence)),
      },
    }));
  }

  /**
   * Stored candle history, at any timeframe the product offers.
   *
   * Reading, never generating: the bars come from what was recorded, folded up
   * from the tier that nests into the requested timeframe. Asking for something
   * finer than the stored base is a 400 rather than a coarser series returned
   * under the requested name — the displayed timeframe never changes the market
   * (INV-004), and it must not change what the market appears to have been.
   */
  @Get('markets/:id/history')
  async history_(
    @Param('id') id: string,
    @Query('timeframe') timeframe?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<unknown> {
    if (this.history === null) {
      throw new NotFoundException('This deployment keeps no candle history.');
    }
    if (this.venue.assetFor(id) === null) {
      throw new NotFoundException(`Unknown asset ${id}.`);
    }
    if (timeframe === undefined || !isTimeframeId(timeframe)) {
      throw new BadRequestException(`timeframe must be one of the offered ids, got ${timeframe}.`);
    }
    const fromInstant = instantParam('from', from);
    const toInstant = instantParam('to', to);
    if (toInstant <= fromInstant) {
      throw new BadRequestException(`to must be after from, got ${from} and ${to}.`);
    }
    // **Cycle Audit 6, CA6-34.** No window cap, no pagination, no rate limit,
    // no auth. `node:sqlite`'s `.all()` is synchronous, so a single 90-day
    // minute request measured **20.5 MB of JSON and 1,496 ms of blocked event
    // loop**, and sixty concurrent ones took the process from 100 MB to 1.86 GB.
    // The venue survived only because Node yields between handlers, which is
    // the one thing separating that finding from the market-stalls-for-ever one
    // beside it.
    //
    // A bound on bars rather than on time, because that is what the cost scales
    // with. The panel's largest view is ninety days of daily bars — ninety of
    // them — so this is two orders of magnitude above any legitimate request.
    // The availability refusal comes first, and deliberately. A one-second
    // window is also an enormous number of bars, and answering "too many bars"
    // to a request for a timeframe that is not served at all would send the
    // caller shortening a window that will never work.
    if (timeframeMs(timeframe) < timeframeMs(HISTORY_BASE_TIMEFRAME)) {
      throw new BadRequestException(
        `History is stored from ${HISTORY_BASE_TIMEFRAME} up, so ${timeframe} is available only ` +
          `from the tick record and only as far back as retention keeps it.`,
      );
    }
    const bars = Math.ceil((toInstant - fromInstant) / timeframeMs(timeframe));
    if (bars > MAX_CANDLES_PER_REQUEST) {
      throw new BadRequestException(
        `That window is ${bars.toLocaleString()} ${timeframe} bars, past the ` +
          `${MAX_CANDLES_PER_REQUEST.toLocaleString()} a single request may return. Ask for a ` +
          `shorter window or a coarser timeframe: ninety days of daily bars is ninety rows.`,
      );
    }
    try {
      const candles = await this.history.read(id, timeframe, fromInstant, toInstant);
      return { assetId: id, timeframe, from: fromInstant, to: toInstant, candles };
    } catch (error) {
      if (error instanceof HistoryError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /**
   * Server-sent tick stream, resumable by sequence.
   *
   * `?from=N` asks for sequence N onwards. A client that was delivered through M
   * resumes with `from=M+1` and gets an exact continuation — no gap, no repeat.
   * Asking for something the replay window has evicted is a 400 rather than a
   * silent jump forward, because a client cannot detect what it never received.
   * So is asking for a sequence that has not been published (a6-04): the feed
   * refuses it in its own words, and a browser's `EventSource` closes for good
   * on any non-200, so the status has to be the refusal and not a 500 with a
   * stack trace in the log.
   *
   * Backpressure disconnects. `res.write` returning false means the socket
   * buffer is full, and the two honest responses are to deliver everything in
   * order or to stop; sending this client a summary of what it missed would give
   * it a different market than everyone else has (INV-002).
   */
  @Get('markets/:id/stream')
  stream(
    @Param('id') id: string,
    @Res() res: Response,
    @Req() request: Request,
    @Query('from') from?: string,
    @Query('onGap') onGap?: string,
  ): void {
    if (!this.venue.assetIds.includes(id)) {
      throw new NotFoundException(`Unknown asset ${id}.`);
    }
    // Only one value, and it must be spelled: a mistyped policy that silently
    // meant "refuse" would be a client believing it had asked to be told.
    if (onGap !== undefined && onGap !== 'live') {
      throw new BadRequestException(`onGap must be 'live' if present, received ${onGap}.`);
    }
    const liveOnGap = onGap === 'live';
    let fromSequence: number | undefined;
    if (from !== undefined) {
      fromSequence = Number.parseInt(from, 10);
      if (!Number.isInteger(fromSequence) || fromSequence < 0 || !/^\d+$/.test(from)) {
        // **Cycle Audit 6, minor.** `Number.parseInt` discards the tail before
        // the check runs, so `1.9`, `12abc` and `1e3` were all accepted as 1 —
        // and `1e3` in particular asked for a sequence long since evicted, which
        // then produced a silent empty stream.
        throw new BadRequestException(`from must be a non-negative integer, received ${from}.`);
      }
    } else {
      // **Cycle Audit 6, CA6-32.** This endpoint emits `id: <sequence>` on every
      // event — the SSE mechanism a browser uses to resume automatically — and
      // read only `?from=`. Measured after a 15-second disconnect: a reconnect
      // carrying `Last-Event-ID` skipped 19 ticks in silence, while the same
      // reconnect written as `?from=` skipped none. A client cannot detect what
      // it never received, which is the whole reason the resume exists.
      const resume = request.headers['last-event-id'];
      const parsed = typeof resume === 'string' && /^\d+$/.test(resume) ? Number(resume) : null;
      if (parsed !== null) fromSequence = parsed + 1;
    }

    // **Cycle Audit 6, CA6-31.** `writeHead(200)` used to run *before*
    // `subscribe`, so `EvictedError` could not become a status code: an evicted
    // `?from=` produced `200` with a zero-length body and an error in the server
    // log, and `marketStream.ts` reconnected with the same evicted sequence for
    // ever. The endpoint's own docstring says such a request is a 400 "because a
    // client cannot detect what it never received".
    //
    // So nothing is written until the subscription exists. Replay delivered
    // during `subscribe` is buffered and flushed after the headers.
    let headersSent = false;
    let bufferedBytes = 0;
    const buffered: string[] = [];
    const write = (chunk: string): void => {
      if (headersSent) res.write(chunk);
      else {
        buffered.push(chunk);
        bufferedBytes += chunk.length;
      }
    };

    const sink = {
      deliver: (_assetId: string, ticks: readonly Tick[]): boolean => {
        for (const tick of ticks) {
          // The bound is checked *inside* the loop, because the whole replay
          // arrives as a single `deliver` call: the feed hands over the entire
          // retained backlog at once, so a check on the way out bounds nothing.
          if (!headersSent && bufferedBytes >= MAX_REPLAY_BYTES) return false;
          // One event per tick, carrying the sequence as the SSE id so a
          // reconnecting client knows exactly where it stopped.
          write(`id: ${tick.sequence}\ndata: ${JSON.stringify(tick)}\n\n`);
        }
        // False once the client cannot keep up: the feed then disconnects
        // rather than degrading this client's view.
        //
        // **Cycle Audit 7, CA7-04.** This read `!headersSent || ...`, so during
        // replay — the single largest write this endpoint ever makes — it was
        // unconditionally true. Measured against a socket full from its first
        // byte: 50,000 frames and 3.46 MiB accumulated in this process's heap,
        // the handler blocked for 143 ms, and the subscription was neither
        // cancelled nor ended. The live path honoured backpressure correctly on
        // the same run, which is what made it easy to miss: the contract was
        // kept everywhere except where it cost the most.
        //
        // Before the headers there is no socket to ask, so the bound is the
        // buffer itself.
        return headersSent ? !res.writableNeedDrain : bufferedBytes < MAX_REPLAY_BYTES;
      },
      close: (reason: string): void => {
        write(`event: close\ndata: ${JSON.stringify({ reason })}\n\n`);
        if (headersSent) res.end();
      },
    };

    let subscription: { cancel: (reason?: string) => void } | null = null;
    let budgetRefused = false;
    try {
      if (fromSequence !== undefined && replayBudgetInUse >= this.replayBudgetBytes) {
        // The process is already replaying to as many clients as it will hold.
        // Treated exactly like an eviction, because from the client's side it is
        // one: the ticks it asked for are not coming (PH-22.3).
        budgetRefused = true;
        throw new EvictedError(id, fromSequence, fromSequence);
      }
      subscription = this.venue.feed.subscribe(id, sink, fromSequence);
    } catch (error) {
      if (error instanceof EvictedError || error instanceof UnknownSequenceError) {
        if (!liveOnGap) throw new BadRequestException(error.message);
        // Asked to be told rather than refused. The client gets **an explicit
        // `gap` event naming what it will not receive**, which is the whole
        // difference between this and a silent jump forward: a gap a client is
        // told about is not a gap it mistakes for the market (INV-002).
        //
        // And then everything the feed still holds, from the oldest sequence it
        // retains — not the live edge. **PH-25.1's first served-record run
        // found the difference**: after a restart an observer holding sequence
        // 1803 was refused (the window began at 1899), asked to be told, and
        // was joined at 1908 — nine ticks the venue retained and never served,
        // inside a hole the gap frame said started at 1804. `resumesAt` names
        // where the record picks up, so a client can bound the hole exactly.
        // When the refusal is this process's replay budget there is nothing
        // to replay with, and the live edge is what remains.
        const resumesAt =
          error instanceof EvictedError && !budgetRefused ? error.oldestRetained : undefined;
        // The gap first, then the replay: `subscribe` delivers what it retains
        // synchronously, and a hole told after the ticks that follow it is a
        // hole told too late.
        write(
          `event: gap\ndata: ${JSON.stringify({
            requested: fromSequence,
            reason: error.message,
            resumesAt: resumesAt ?? null,
          })}\n\n`,
        );
        subscription = this.venue.feed.subscribe(id, sink, resumesAt);
      } else {
        throw error;
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    headersSent = true;
    // The flush honours backpressure too. It used to ignore every return value
    // and push the whole replay at a socket that had already said stop.
    let full = false;
    for (const chunk of buffered) {
      res.write(chunk);
      if (res.writableNeedDrain) full = true;
    }
    buffered.length = 0;

    // What this connection still owes the socket, charged to the process until
    // it drains. This is the quantity a reconnect storm grows.
    chargeUndrained(res);

    const live = subscription;
    if (full) {
      // Told rather than truncated: a client that is handed a short stream and
      // no reason cannot tell it from a quiet market.
      res.write(
        `event: close\ndata: ${JSON.stringify({ reason: 'client fell behind during replay' })}\n\n`,
      );
      live.cancel('client fell behind during replay');
      res.end();
      return;
    }
    this.streams.add(live);
    res.on('close', () => {
      this.streams.delete(live);
      live.cancel('client disconnected');
    });
  }

  /**
   * Tell every connected stream the service is going away (a6-09).
   *
   * Runs after every `onModuleDestroy` — the venue has checkpointed and is not
   * publishing — and before the listener is closed. Each client receives an
   * `event: close` naming the reason and then the end of its response, which is
   * what a client needs to know that a reconnect is in order rather than a
   * gap. Without this the listener's own close waited on these connections for
   * ever, or `forceCloseConnections` destroyed them with nothing said.
   */
  async beforeApplicationShutdown(): Promise<void> {
    for (const stream of this.streams) stream.cancel('server shutting down');
    this.streams.clear();
    // One turn of the loop, so the close frames reach the sockets before the
    // listener's own close destroys them.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  private describe(id: string): unknown {
    const asset = this.venue.assetFor(id) ?? undefined;
    const tick = this.venue.lastTick(id);
    return {
      id,
      displayName: asset?.definition.displayName ?? id,
      family: asset?.definition.family,
      // The canonical integer is what settles; the display price is derived for
      // presentation only and is never compared against (ADR-0004).
      price: tick === null ? null : tick.price,
      displayPrice:
        tick === null || asset === undefined
          ? null
          : renderPrice(
              tick.price,
              asset.instrument.logQuantum,
              asset.instrument.referencePrice,
              asset.instrument.displayPrecision,
            ),
      sequence: tick?.sequence ?? null,
      instant: tick?.instant ?? null,
      recovery: this.venue.recoveryFor(id),
    };
  }
}

/**
 * A canonical integer, rendered for a screen.
 *
 * **Cycle Audit 7, CA7-34.** This was a second, independent implementation of
 * `@otc/chart`'s `displayPrice`, and it used `Math.exp` where the portable
 * kernel exists precisely because ECMAScript does not specify that function
 * exactly — two engines may disagree on the last bits, and a display price that
 * differed between a viewer's browser and an operator's would be two answers to
 * one question about one market (INV-002).
 *
 * Measured across 20,475 sampled prices on all five catalogue assets, the two
 * agreed bit for bit on this V8 build. That is what a latent divergence looks
 * like before it happens: the agreement was a property of one engine version,
 * nothing tested it, and the copy lived in the one directory the portability
 * scan did not open (CA7-14, fixed alongside this).
 *
 * There is one conversion now, and it is the portable one.
 */
function renderPrice(
  price: number,
  logQuantum: number,
  referencePrice: number,
  precision: number,
): string {
  return displayPrice(price, { logQuantum, referencePrice, displayPrecision: precision }).toFixed(
    precision,
  );
}

/**
 * The most bars one request may return.
 *
 * Chosen against what the panel actually asks for — its largest view is ninety
 * daily bars, its densest is a few hundred minute bars — with two orders of
 * magnitude of slack, rather than against what the storage can survive.
 */
const MAX_CANDLES_PER_REQUEST = 20_000;

/**
 * The most replay this process will hold in memory for one connecting client.
 *
 * A resume is served from the feed's retained window, which is 50,000 ticks per
 * asset by default — about 3.5 MiB of SSE frames. Before the response headers
 * exist there is no socket to apply backpressure against, so that whole window
 * accumulates in the handler's heap, once per connecting client. Ten thousand
 * observers reconnecting after a deploy is the case that matters, and it is
 * PH-22's subject.
 *
 * One megabyte is roughly fifteen thousand ticks — a generous resume, and far
 * short of what a fan-out of reconnects would cost (Cycle Audit 7, CA7-04).
 */
const MAX_REPLAY_BYTES = 1_000_000;

/**
 * The most assets one stream may carry.
 *
 * Sized against what a client is for — the panel's densest view is a handful of
 * charts, and the Human Owner's plan is eight — with room to spare, rather than
 * against what the server survives. What it bounds is *subscriptions*: without
 * it a single GET is a subscription to every asset in the catalogue, so a
 * hundred-asset venue answers one request with a hundred fan-out targets on one
 * socket, and N requests with 100N.
 *
 * **The reason it used to give was not the reason (Cycle Audit 8, a3).** It
 * claimed an unbounded list would put the replay bound above a per-asset
 * quantity rather than a per-connection one — but `bufferedBytes` is a single
 * counter for the whole connection however many assets it carries, so replay was
 * never what this protects. Exported so the refusal is testable.
 */
/** The seat a compiled asset was drawn from, or null for a runtime registration. */
function seatOf(id: string): { archetype: string; character: string; priceSource: string } | null {
  try {
    const seat = seatById(id);
    return { archetype: seat.archetype, character: seat.character, priceSource: seat.priceSource };
  } catch {
    return null;
  }
}

export const MAX_MULTIPLEXED_ASSETS = 32;

/**
 * The most replay this **process** will hold at once, across every connection.
 *
 * `MAX_REPLAY_BYTES` bounds one client. PH-22.3 measured what happens when they
 * all arrive together: two thousand clients resuming five assets each, five
 * thousand sequences back, took the engine from 252 MB to **1,470 MB** of
 * resident memory and 5.1 seconds to connect. The per-connection bound was
 * working exactly as designed and did nothing, because the quantity that
 * matters in a storm is the sum.
 *
 * Ten thousand clients on the same shape is roughly six gigabytes, past the
 * heap Node gives itself by default and past the machine this was measured on.
 * A deploy is precisely when every client reconnects, so this is not a rare
 * case; it is the case.
 *
 * Sixty-four megabytes is about sixty simultaneous full-depth replays, and a
 * storm larger than that is served at the live edge **with a `gap` event that
 * says so** — the same answer an eviction gets, for the same reason. A client
 * told it has a gap can refetch; a client silently jumped forward cannot tell
 * the difference from a quiet market (INV-002).
 */
const MAX_TOTAL_REPLAY_BYTES = 64_000_000;

/**
 * Bytes this process has handed to sockets for replay that have not drained.
 *
 * **The first version of this counted the wrong thing**, and the test that was
 * meant to exercise it said so: it counted bytes buffered *before* the response
 * headers, and the whole handler is synchronous, so only one connection is ever
 * in that state and the counter was always zero when the next one checked it.
 *
 * The 1,470 MB PH-22.3 measured was never in that buffer. It was in the
 * kernel-and-Node write buffers of two thousand sockets that could not drain as
 * fast as a replay filled them — which is a quantity Node exposes directly, as
 * `writableLength`, and which is the thing a storm actually grows.
 */
let replayBudgetInUse = 0;

/**
 * Charge a response's undrained bytes to the process, and release them when the
 * socket catches up or the client goes away.
 */
function chargeUndrained(res: Response): void {
  const owed = res.writableLength;
  if (owed <= 0) return;
  replayBudgetInUse += owed;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    replayBudgetInUse -= owed;
  };
  res.once('drain', release);
  res.once('close', release);
  res.once('finish', release);
}

/** For tests: what the process currently has committed to replay. */
export function replayBudgetUsed(): number {
  return replayBudgetInUse;
}

/** For tests: the process-wide ceiling. */
export const REPLAY_BUDGET_BYTES = MAX_TOTAL_REPLAY_BYTES;

/**
 * The longest display name an asset may carry.
 *
 * A name is rendered in every viewer's sidebar and in the manage table; the
 * audit stored a 100,000-character one and served it to everyone (a6-13). The
 * longest name in the catalogue is fourteen characters; sixty-four is room for
 * "Sterling / Japanese Yen (London fixing)" and not for a paragraph.
 */
export const MAX_DISPLAY_NAME_LENGTH = 64;

function timeframeMs(id: Parameters<typeof timeframeById>[0]): number {
  return timeframeById(id).durationMs;
}

/**
 * An instant from the query string: digits only.
 *
 * **a6-12.** `Number.parseInt` discards the tail before the check runs, so
 * `1788349926509abc` was accepted as the instant, `1.9` as 1 and `0x10` as 0 —
 * the same defect Cycle Audit 6 corrected on the stream's `from` and left here.
 */
function instantParam(name: string, raw: string | undefined): ReturnType<typeof epochMillis> {
  if (raw === undefined) throw new BadRequestException(`${name} is required.`);
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(
      `${name} must be a non-negative integer instant in milliseconds, got ${raw}.`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new BadRequestException(`${name} is beyond the safe integer range, got ${raw}.`);
  }
  return epochMillis(value);
}

/**
 * A display name off an untrusted body: a string, trimmed, one to sixty-four
 * characters (a6-13). Every refusal says what it was given.
 */
function displayNameParam(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(
      `displayName must be a string, got ${value === null ? 'null' : typeof value}.`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new BadRequestException('displayName must not be empty.');
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new BadRequestException(
      `displayName is ${trimmed.length.toLocaleString()} characters; the most a name may ` +
        `hold is ${MAX_DISPLAY_NAME_LENGTH}. It is rendered in every viewer's sidebar.`,
    );
  }
  return trimmed;
}

/** The fields a brief may carry. A closed set, refused by name otherwise (a6-07). */
const BRIEF_FIELDS = [
  'id',
  'archetypeId',
  'displayName',
  'referencePrice',
  'dispersion',
  'displayPrecision',
] as const;

/**
 * Read a brief off an untrusted body, refusing anything that is not one.
 *
 * Hand-written rather than decorator-validated, because this is the only body
 * this service accepts and a validation library would be a dependency carrying
 * one rule. Every refusal says what was wrong with the field it names — a 400
 * reading "validation failed" is a support ticket.
 *
 * Two things this parser does not see. Unknown fields *are* refused by name
 * (a6-07): a brief that quietly accepted `drift` would be INV-006 broken by an
 * administrative form, and ignoring is not the same as refusing. `null` for an
 * optional number is refused too, because the panel used to send it for a
 * budget the operator had typed and could not parse, and "not supplied" is not
 * what they meant. What it cannot see is a **duplicate key** (a6-17): the body
 * arrives through the standard `JSON.parse`, in which the last of two
 * `referencePrice` keys wins silently. Refusing that needs the raw bytes and a
 * second parser, which is more machinery than the one field it protects
 * warrants; the reference price a job used is on the job record for anyone who
 * needs to check.
 */
function asBrief(body: unknown): AssetBrief {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Body must be a JSON object.');
  }
  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(BRIEF_FIELDS as readonly string[]).includes(key)) {
      throw new BadRequestException(
        `Unknown field ${JSON.stringify(key)}. A brief is ${BRIEF_FIELDS.slice(0, 4).join(', ')}, ` +
          `and optionally ${BRIEF_FIELDS.slice(4).join(' and ')}; nothing else is read, so ` +
          `nothing else is accepted.`,
      );
    }
  }
  const id = raw['id'];
  const archetypeId = raw['archetypeId'];
  const referencePrice = raw['referencePrice'];
  if (typeof id !== 'string') throw new BadRequestException('id must be a string.');
  if (typeof archetypeId !== 'string') {
    throw new BadRequestException('archetypeId must be a string.');
  }
  try {
    archetypeById(archetypeId);
  } catch {
    throw new BadRequestException(
      `Unknown archetype ${archetypeId}. GET /archetypes lists the families.`,
    );
  }
  const displayName = displayNameParam(raw['displayName']);
  if (
    typeof referencePrice !== 'number' ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0
  ) {
    throw new BadRequestException('referencePrice must be a finite positive number.');
  }
  const brief: {
    id: string;
    archetypeId: string;
    displayName: string;
    referencePrice: number;
    dispersion?: number;
    displayPrecision?: number;
  } = { id, archetypeId, displayName, referencePrice };
  if ('dispersion' in raw) {
    const dispersion = raw['dispersion'];
    if (typeof dispersion !== 'number' || !Number.isFinite(dispersion) || dispersion <= 0) {
      throw new BadRequestException(
        'dispersion is σ of the quarterly log return and must be a positive number, or left ' +
          `out to take the family's own draw; got ${JSON.stringify(dispersion)}.`,
      );
    }
    brief.dispersion = dispersion;
  }
  if ('displayPrecision' in raw) {
    const displayPrecision = raw['displayPrecision'];
    if (!Number.isInteger(displayPrecision) || (displayPrecision as number) < 0) {
      throw new BadRequestException(
        'displayPrecision must be a non-negative integer, or left out to take the ' +
          `lattice's own; got ${JSON.stringify(displayPrecision)}.`,
      );
    }
    brief.displayPrecision = displayPrecision as number;
  }
  return brief;
}
