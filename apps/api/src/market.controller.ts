import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
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
