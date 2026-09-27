// Invariant evidence: INV-008 (continuous market state), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord, type MarketStateRecord } from '@otc/runtime';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { trimEvery, VenueService } from './venue.service.js';

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

  /**
   * On the live venue the first pass after a seamed boot came 39 s late, and
   * every market was reopened as a second outage even with the re-arm above in
   * place. A market that booted on a seam is awaiting its first tick, so past its
   * bound it is re-armed (PH-39), not reopened.
   */
  it('re-arms rather than reopens when the first pass after a seamed boot is late', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new SlowStore(clock, 0);
    const record = new MemoryTickRecord();
    const first = service(store, record, clock);
    await first.start();
    await run(first, clock, 60);
    await first.checkpoint();
    await first.stop();
    const heads = new Map<string, number>();
    for (const asset of assets) {
      heads.set(
        asset.definition.id,
        (await record.since(asset.definition.id, 1, 1_000_000)).at(-1)!.sequence,
      );
    }

    clock.advance(durationMillis(120_000));
    const second = service(store, record, clock);
    await second.start();
    // The first pass, forty seconds late.
    clock.advance(durationMillis(40_000));
    await second.tick();
    await run(second, clock, 30);

    const controller = new MarketController(second);
    expect(second.counters.reopenings, 'a late first pass reopened a seamed boot').toBe(0);
    expect(second.counters.rearms).toBeGreaterThan(0);
    for (const asset of assets) {
      const id = asset.definition.id;
      const seams = (await controller.seams(id)) as { resumesAtSequence: number }[];
      expect(seams, `${id}: still one seam`).toHaveLength(1);
      expect(seams[0]!.resumesAtSequence, `${id}: no sequence reused`).toBeGreaterThan(
        heads.get(id)!,
      );
    }
    await second.stop();
  });
});

describe('the record is trimmed once a hundredth of its window has been appended (PH-40.5)', () => {
  it('waits for the window to grow by a hundredth, and never trims below it', () => {
    expect(trimEvery(250_000)).toBe(2_500);
    expect(trimEvery(20)).toBe(1);
    expect(trimEvery(1)).toBe(1);
  });

  it('trims on the first checkpoint of a process, then only when enough has been appended', async () => {
    const clock = new SteppableClock(GENESIS);
    const record = new MemoryTickRecord();
    let trims = 0;
    const original = record.trim.bind(record);
    record.trim = (assetId: string, keep: number): Promise<void> => {
      trims += 1;
      return original(assetId, keep);
    };
    const venue = new VenueService(
      new MemoryStateStore(),
      MasterKeyring.fromSecret('boot-seam-trim', new Uint8Array(32).fill(53)),
      clock,
      [assets[0]!],
      5_000,
      new PublicationService([assets[0]!], 20, {}),
      null,
      GENESIS,
      0,
      null,
      null,
      null,
      record,
      2_000,
    );
    await venue.start();
    await run(venue, clock, 6);
    // The first checkpoint trims whatever was appended.
    expect(trims).toBe(1);
    // A window of 2,000 waits for twenty appended ticks between trims — several
    // checkpoints' worth on this asset — not for every checkpoint. (A window of
    // 400 waits for four, fewer than one checkpoint appends, and a plant that
    // trimmed on every checkpoint passed against it.)
    await run(venue, clock, 60);
    const appended = venue.counters.ticksPublished;
    expect(trims).toBeGreaterThan(1);
    expect(trims).toBeLessThanOrEqual(1 + Math.ceil(appended / trimEvery(2_000)));
    const held = (await record.since(assets[0]!.definition.id, 1, 1_000_000)).length;
    expect(held, 'trimmed below its window').toBeGreaterThanOrEqual(Math.min(2_000, appended));
    expect(held, 'more than a hundredth past its window').toBeLessThanOrEqual(
      2_000 + trimEvery(2_000) + 50,
    );
    await venue.stop();
  });
});
