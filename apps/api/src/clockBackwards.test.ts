// Invariant evidence: INV-006 (no exploitable directional rule), INV-008 (continuous market state).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord } from '@otc/runtime';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/**
 * **A market does not follow the clock backwards** (2026-09-28).
 *
 * `advanceTo` refused only a `behind` *above* the bound, so a negative one — the
 * host's clock stepped back, which a chrony or timesyncd step after a bad RTC at
 * boot does — was absorbed: the marker moved back, every pending tick was
 * suddenly in the future, and the market published nothing until the wall clock
 * climbed back. Reproduced against the built runtime with a thirty-minute step:
 * five minutes of passes, zero ticks and zero throws, while `/health` said `ok`,
 * `stalled` was empty and `otc_seconds_since_last_pass` stayed near zero.
 *
 * What made it a money defect rather than an outage: `/price?at=` went on
 * answering instants inside the frozen window from ticks published *before* the
 * step — a realised path any client can read forward through `/ticks/:sequence`.
 * A client who noticed the freeze would win with certainty, which is the one
 * thing INV-006 exists to deny. The broker's documented safety net is the
 * heartbeat's `asOf`, and it kept advancing because the pass kept completing.
 */
const assets = ASSET_CATALOGUE.slice(0, 2);
const GENESIS = epochMillis(1_776_000_000_000);

async function venue(clock: SteppableClock): Promise<VenueService> {
  const service = new VenueService(
    new MemoryStateStore(),
    MasterKeyring.fromSecret('clock-backwards-spec', new Uint8Array(32).fill(81)),
    clock,
    [...assets],
    5_000,
    new PublicationService([...assets], 20, {}),
    null,
    GENESIS,
    0,
    null,
    null,
    null,
    new MemoryTickRecord(),
  );
  await service.start();
  return service;
}

describe('a clock that steps backwards stalls the market rather than freezing it silently', () => {
  it('refuses by name, keeps every operator surface honest, and recovers when the clock returns', async () => {
    const clock = new SteppableClock(GENESIS);
    const service = await venue(clock);
    for (let i = 0; i < 40; i += 1) {
      clock.advance(durationMillis(1_000));
      await service.tick();
    }
    const before = service.priceInForce(assets[0]!.definition.id)!;
    const publishedBefore = service.counters.ticksPublished;
    expect(publishedBefore).toBeGreaterThan(0);

    // Thirty minutes back, the shape a time step takes.
    const returnTo = epochMillis(clock.now());
    clock.set(epochMillis(clock.now() - 1_800_000));
    await service.tick().catch(() => undefined);

    const why = service.notReadyReason;
    expect(why, 'a frozen venue answered ready').not.toBeNull();
    for (const asset of assets) expect(why ?? '').toContain(asset.definition.id);
    // `/health`'s own source: `status` is degraded when anything is stalled.
    const health = (await new MarketController(service).health()) as {
      status: string;
      stalled: { assetId: string; reason: string }[];
    };
    expect(health.status, 'a frozen venue called itself ok').toBe('degraded');
    expect(JSON.stringify(health.stalled)).toMatch(/clock went back/i);
    // It is not an outage a reopening can help: reopening would publish nothing
    // until the clock returned, and would burn a seam and a sequence lease saying so.
    expect(service.counters.reopenings, 'a backwards clock was treated as an outage').toBe(0);
    // Nothing was published into the frozen window…
    expect(service.counters.ticksPublished).toBe(publishedBefore);
    // …and the price in force did not move, so a broker's freshness rule on `asOf`
    // sees the market stop, which is what ORBIT.md §4 promises it.
    expect(service.priceInForce(assets[0]!.definition.id)).toEqual(before);

    // A wobble that returns is not a discontinuity: the marker never moved back,
    // so the market picks up where it left off, with no seam.
    clock.set(epochMillis(returnTo + 2_000));
    await service.tick();
    expect(service.notReadyReason, 'the venue did not recover when the clock returned').toBeNull();
    expect(service.counters.ticksPublished).toBeGreaterThan(publishedBefore);
    const controller = new MarketController(service);
    for (const asset of assets) {
      expect(await controller.seams(asset.definition.id)).toEqual([]);
    }
    await service.stop();
  });
});
