import { describe, expect, it } from 'vitest';
import { durationMillis, MasterKeyring, SteppableClock, epochMillis } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { VenueService } from './venue.service.js';

/**
 * What a stalled market costs the process it is stalled in.
 *
 * A market more than the catch-up bound behind the clock refuses every advance
 * for the life of the process — by design, ADR-0010 — and Cycle Audit 7 found
 * two things that follow from it and were nobody's design.
 */
const asset = ASSET_CATALOGUE[0]!;
const GENESIS = epochMillis(1_776_000_000_000);

/** The venue derives production streams, so a test keyring will not do. */
const keyring = (): MasterKeyring =>
  MasterKeyring.fromSecret('venue-stall-spec', new Uint8Array(32).fill(7));

async function stalledVenue(): Promise<{ venue: VenueService; clock: SteppableClock }> {
  const clock = new SteppableClock(GENESIS);
  const venue = new VenueService(new MemoryStateStore(), keyring(), clock, [asset]);
  await venue.start();
  // Publish normally once, so the market is demonstrably healthy first.
  clock.advance(durationMillis(2_000));
  await venue.tick();
  // Then skew past the 15 s catch-up bound.
  clock.advance(durationMillis(30_000));
  await venue.tick();
  return { venue, clock };
}

describe('a stalled market does not take the scheduler with it (CA7-10)', () => {
  it('backs the scheduler off instead of spinning at 1 ms', async () => {
    // A stalled market keeps a pending tick whose instant recedes further into
    // the past on every pass, so `msUntilNextTick` is 0 for ever — and the
    // venue takes the minimum across markets, so one stalled asset pinned the
    // whole scheduler to a 1 ms timer. Measured by an auditor: 4 passes per
    // real second healthy, 839 after a 20 s skew, sustained, each pass walking
    // every market and constructing an error. The log said nothing, because the
    // per-asset line is deduped on the error's name (a6-05).
    const { venue } = await stalledVenue();
    expect(venue.stalledMarkets.map((m) => m.assetId)).toEqual([asset.definition.id]);
    expect(
      venue.nextWaitMs(),
      'the scheduler is spinning on a stalled market',
    ).toBeGreaterThanOrEqual(250);
    await venue.stop();
  });

  it('lifts the backoff again as soon as nothing is stalled', async () => {
    // The floor must be conditional, not a blanket slow-down: the catalogue
    // spans 333 ms to 3352 ms of mean interval, and publishing the fast assets
    // late is what the deadline scheduler exists to avoid. Retiring the stalled
    // market is the shortest way to reach "nothing is stalled" deterministically.
    const { venue } = await stalledVenue();
    expect(venue.nextWaitMs()).toBeGreaterThanOrEqual(250);
    await venue.retire(asset.definition.id);
    expect(venue.stalledMarkets).toEqual([]);
    expect(venue.nextWaitMs(), 'the backoff outlived the stall').toBeLessThan(250);
    await venue.stop();
  });
});

describe('retiring a market takes what the service remembers about it (CA7-15)', () => {
  it('clears the stall, so health does not stay red about an asset that is gone', async () => {
    // `tick()` clears `stalled` only for an asset that appears in `published`,
    // and an unhosted asset never appears there — so `/health` reported
    // `degraded` about a retired market for the life of the process, beside
    // `assets: 0`, with nothing able to clear it. CA6-33's failure with the
    // sign flipped: a monitor permanently red about a deliberate removal is a
    // monitor an operator learns to ignore.
    const { venue } = await stalledVenue();
    expect(venue.stalledMarkets).toHaveLength(1);

    await venue.retire(asset.definition.id);

    expect(venue.stalledMarkets, 'health is still red about a retired asset').toEqual([]);
    expect(venue.recoveryFor(asset.definition.id)).toBeNull();
    await venue.stop();
  });
});
