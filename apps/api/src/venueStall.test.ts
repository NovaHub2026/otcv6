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

describe('a stall does not survive the restart that should clear it (Cycle Audit 10)', () => {
  /**
   * The wedge an operator met on their own panel while this audit ran.
   *
   * The host was suspended and resumed. Every one of thirty markets came back
   * stalled — `Market is 11326s behind the clock, past the 15s catch-up bound` —
   * and a clean stop and start did not clear a single one. The reason is one
   * line: `checkpoint()` wrote `savedAt = now` for every hosted market on every
   * cadence, including markets that had refused every advance for hours, so the
   * checkpoint stayed fresh while the market it described stayed stale.
   * `resumeMarket` chooses between continuing and seaming on exactly that
   * quantity, chose `resumed`, `HostedMarket` floored on the old
   * `lastPublished`, and refused again. The only remedy anyone had was to move
   * the state directory aside, which throws the record away.
   */
  it('freezes the checkpoint of a market that is publishing nothing, so the next boot seams', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryStateStore();
    const first = new VenueService(store, keyring(), clock, [asset]);
    await first.start();
    clock.advance(durationMillis(2_000));
    await first.tick();
    await first.checkpoint();
    const healthy = (await store.load(asset.definition.id))!.savedAt;

    // The suspend: far past the catch-up bound, and long enough that several
    // checkpoint cadences elapse inside the stall.
    clock.advance(durationMillis(30_000));
    await first.tick();
    expect(first.stalledMarkets.map((m) => m.assetId)).toEqual([asset.definition.id]);
    clock.advance(durationMillis(10_000));
    await first.tick();
    await first.stop();

    expect(
      (await store.load(asset.definition.id))!.savedAt,
      'a market that published nothing for 40s still refreshed its checkpoint',
    ).toBe(healthy);

    // And the consequence, end to end: the restart an operator reaches for
    // first now works, and it keeps the record rather than discarding it.
    const second = new VenueService(store, keyring(), clock, [asset]);
    await second.start();
    expect(second.recoveryFor(asset.definition.id)?.kind, 'the restart resumed the wedge').toBe(
      'seam',
    );
    clock.advance(durationMillis(2_000));
    await second.tick();
    expect(second.stalledMarkets, 'the stall survived a clean restart').toEqual([]);
    expect(second.lastTick(asset.definition.id)).not.toBeNull();
    await second.stop();
  });
});
