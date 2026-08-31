import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { EvictedError } from '@otc/distribution';
import { ASSET_CATALOGUE } from '@otc/engine';
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
  constructor(private readonly venue: VenueService) {}

  @Get('health')
  health(): { status: string; assets: number } {
    return { status: 'ok', assets: this.venue.assetIds.length };
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
