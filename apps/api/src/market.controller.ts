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
import { EvictedError, UnknownSequenceError } from '@otc/distribution';
import {
  ASSET_ARCHETYPES,
  archetypeById,
  checkIdentity,
  dispersionLogSigma,
  dispersionPercent,
  type AssetBrief,
} from '@otc/engine';
import { epochMillis, isTimeframeId, timeframe as timeframeById } from '@otc/core';
import {
  assertOverlay,
  HistoryError,
  HISTORY_BASE_TIMEFRAME,
  ImmutableFieldError,
  OVERLAY_FIELDS,
  type AssetRegistry,
} from '@otc/runtime';
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
  ): void {
    if (!this.venue.assetIds.includes(id)) {
      throw new NotFoundException(`Unknown asset ${id}.`);
    }
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
    const buffered: string[] = [];
    const write = (chunk: string): void => {
      if (headersSent) res.write(chunk);
      else buffered.push(chunk);
    };

    let subscription: { cancel: (reason?: string) => void } | null = null;
    try {
      subscription = this.venue.feed.subscribe(
        id,
        {
          deliver: (_assetId, ticks): boolean => {
            for (const tick of ticks) {
              // One event per tick, carrying the sequence as the SSE id so a
              // reconnecting client knows exactly where it stopped.
              write(`id: ${tick.sequence}\ndata: ${JSON.stringify(tick)}\n\n`);
            }
            // False once the socket buffer is full: the feed then disconnects
            // rather than degrading this client's view.
            return !headersSent || !res.writableNeedDrain;
          },
          close: (reason): void => {
            write(`event: close\ndata: ${JSON.stringify({ reason })}\n\n`);
            if (headersSent) res.end();
          },
        },
        fromSequence,
      );
    } catch (error) {
      if (error instanceof EvictedError || error instanceof UnknownSequenceError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    headersSent = true;
    for (const chunk of buffered) res.write(chunk);

    const live = subscription;
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
          : displayPrice(
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

function displayPrice(
  price: number,
  logQuantum: number,
  referencePrice: number,
  precision: number,
): string {
  return (referencePrice * Math.exp(price * logQuantum)).toFixed(precision);
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
