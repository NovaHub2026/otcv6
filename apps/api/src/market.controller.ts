import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { EvictedError } from '@otc/distribution';
import {
  ASSET_ARCHETYPES,
  ASSET_CATALOGUE,
  dispersionLogSigma,
  dispersionPercent,
} from '@otc/engine';
import { epochMillis, isTimeframeId, timeframe as timeframeById } from '@otc/core';
import { HistoryError } from '@otc/runtime';
import { HistoryService } from './history.service.js';
import { VenueService } from './venue.service.js';

/**
 * Read-only observation of the running venue.
 *
 * Deliberately thin. Public market distribution and multi-user consistency are
 * PH-7; what PH-5 needs is enough surface to see that the runtime is alive, what
 * it recovered as, and where each market currently is.
 *
 * Nothing here is economic. There are no positions, no payouts and no contracts
 * in this service at all — PH-6 introduces the trading boundary, and until then
 * the guardrail scan is what keeps that true.
 */
@Controller()
export class MarketController {
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
  ) {}

  /**
   * Whether the venue is actually publishing, not merely running.
   *
   * **Cycle Audit 6, CA6-33.** This returned `{"status":"ok"}` for a venue whose
   * markets had all stopped: a market past its catch-up bound refuses every
   * later advance, and the failure list that says so was being discarded. A
   * health endpoint that cannot report the one failure its process has is worse
   * than none, because it is what a monitor watches.
   */
  @Get('health')
  health(): unknown {
    const stalled = this.venue.stalledMarkets;
    return {
      status: stalled.length === 0 ? 'ok' : 'degraded',
      assets: this.venue.assetIds.length,
      stalled,
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
   * Server-sent tick stream, resumable by sequence.
   *
   * `?from=N` asks for sequence N onwards. A client that was delivered through M
   * resumes with `from=M+1` and gets an exact continuation — no gap, no repeat.
   * Asking for something the replay window has evicted is a 400 rather than a
   * silent jump forward, because a client cannot detect what it never received.
   *
   * Backpressure disconnects. `res.write` returning false means the socket
   * buffer is full, and the two honest responses are to deliver everything in
   * order or to stop; sending this client a summary of what it missed would give
   * it a different market than everyone else has (INV-002).
   */
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
    return ASSET_CATALOGUE.map((asset) => ({
      id: asset.definition.id,
      displayName: asset.definition.displayName,
      family: asset.definition.family,
      live: live.has(asset.definition.id),
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
    if (!ASSET_CATALOGUE.some((asset) => asset.definition.id === id)) {
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

  @Get('markets/:id/stream')
  stream(@Param('id') id: string, @Res() res: Response, @Query('from') from?: string): void {
    if (!this.venue.assetIds.includes(id)) {
      throw new NotFoundException(`Unknown asset ${id}.`);
    }
    let fromSequence: number | undefined;
    if (from !== undefined) {
      fromSequence = Number.parseInt(from, 10);
      if (!Number.isInteger(fromSequence) || fromSequence < 0) {
        throw new BadRequestException(`from must be a non-negative integer, received ${from}.`);
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    let subscription: { cancel: (reason?: string) => void } | null = null;
    try {
      subscription = this.venue.feed.subscribe(
        id,
        {
          deliver: (_assetId, ticks): boolean => {
            for (const tick of ticks) {
              // One event per tick, carrying the sequence as the SSE id so a
              // reconnecting client knows exactly where it stopped.
              res.write(`id: ${tick.sequence}\ndata: ${JSON.stringify(tick)}\n\n`);
            }
            // False once the socket buffer is full: the feed then disconnects
            // rather than degrading this client's view.
            return !res.writableNeedDrain;
          },
          close: (reason): void => {
            res.write(`event: close\ndata: ${JSON.stringify({ reason })}\n\n`);
            res.end();
          },
        },
        fromSequence,
      );
    } catch (error) {
      if (error instanceof EvictedError) {
        res.end();
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    res.on('close', () => {
      subscription?.cancel('client disconnected');
    });
  }

  private describe(id: string): unknown {
    const asset = ASSET_CATALOGUE.find((a) => a.definition.id === id);
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

function timeframeMs(id: Parameters<typeof timeframeById>[0]): number {
  return timeframeById(id).durationMs;
}

function instantParam(name: string, raw: string | undefined): ReturnType<typeof epochMillis> {
  if (raw === undefined) throw new BadRequestException(`${name} is required.`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException(`${name} must be a non-negative integer instant, got ${raw}.`);
  }
  return epochMillis(value);
}
