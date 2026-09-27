// Invariant evidence: INV-008 (continuous market state), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord, type MarketStateRecord } from '@otc/runtime';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/**
 * PH-40.5, issue #23 — one restart writes one seam.
 *
 * A boot resumes its markets one after another, and on a full record that took
 * 26 s on the live venue: the markets seamed first were already past their own
 * 15 s catch-up bound when the first pass ran, and ADR-0020 reopened them — two
 * recorded discontinuities per asset for one restart, and
 * `otc_market_reopenings_total` reading 30 after every clean boot. No test saw it
 * because every boot in the suite takes milliseconds. This one does not.
 */

const assets = ASSET_CATALOGUE.slice(0, 3);
const GENESIS = epochMillis(1_776_000_000_000);

/** A store whose every read costs the clock `costMs` once `slow` is set. */
class SlowStore extends MemoryStateStore {
  slow = false;
  constructor(
    private readonly clock: SteppableClock,
    private readonly costMs: number,
  ) {
    super();
  }

  override load(assetId: string): Promise<MarketStateRecord | null> {
    if (this.slow) this.clock.advance(durationMillis(this.costMs));
    return super.load(assetId);
  }
}

function service(
  store: MemoryStateStore,
  record: MemoryTickRecord,
  clock: SteppableClock,
): VenueService {
  return new VenueService(
    store,
    MasterKeyring.fromSecret('boot-seam-spec', new Uint8Array(32).fill(52)),
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
    record,
  );
}

async function run(venue: VenueService, clock: SteppableClock, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i += 1) {
    clock.advance(durationMillis(1_000));
    await venue.tick();
  }
}

describe('one restart writes one seam, however long the boot takes (PH-40.5, #23)', () => {
  it('re-arms a seamed market at the clock the scheduler starts from', async () => {
    const clock = new SteppableClock(GENESIS);
    // Nine seconds a read: three markets read twice over — the resume, then
    // the re-arm's own read — is fifty-four seconds of boot, far past the bound.
    const store = new SlowStore(clock, 9_000);
    const record = new MemoryTickRecord();
    const first = service(store, record, clock);
    await first.start();
    await run(first, clock, 60);
    await first.checkpoint();
    await first.stop();

    // Down for two minutes: past the bound, so every market seams at the boot.
    clock.advance(durationMillis(120_000));
    store.slow = true;
    const second = service(store, record, clock);
    await second.start();
    store.slow = false;
    await run(second, clock, 30);

    const controller = new MarketController(second);
    for (const asset of assets) {
      const id = asset.definition.id;
      const seams = (await controller.seams(id)) as { resumesAtSequence: number }[];
      expect(seams, `${id}: one restart, one seam`).toHaveLength(1);
      // And it resumed at the sequence the boot declared — the number the feed
      // had already announced to any client connected during the boot. A second
      // reopening moves it a whole lease on, which the record alone cannot show:
      // nothing was published between the two, so it holds a single gap either way.
      const declared = (controller.market(id) as { recovery: { resumesAtSequence?: number } })
        .recovery.resumesAtSequence;
      expect(seams[0]!.resumesAtSequence, `${id}: resumed where the boot said`).toBe(declared);
    }
    expect(second.counters.reopenings, 'the boot was reopened as an outage').toBe(0);
    await second.stop();
  });
});
