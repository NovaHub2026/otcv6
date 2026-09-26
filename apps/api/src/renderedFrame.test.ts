// Invariant evidence: INV-002 (shared market), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord } from '@otc/runtime';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/**
 * A read route renders a recorded price on the frame it was **published** on,
 * against a record that holds more than one (PH-38.3).
 *
 * **Cycle Audit 13, a2-01, and it is Cycle Audit 12's lesson in a second
 * costume.** PH-38.3's whole subject is a record whose integers were written
 * under two different lattices, and every fixture in `apps/api` built a record
 * with exactly **one** frame, equal to the asset's current instrument. So
 * `frameAt` and `asset.instrument` were the same object in every test, and the
 * auditor restored the entire pre-PH-38 defect — `frameOf` answering with the
 * live instrument unconditionally — with all 361 tests in this package still
 * green. The guard existed; the **input** did not.
 *
 * What the defect costs on the live venue was measured before the phase: 49.7%
 * of retained ticks rendering wrong, median 31.8%, worst 1,483%.
 */
const asset = ASSET_CATALOGUE[0]!;
const ID = asset.definition.id;
const GENESIS = epochMillis(1_776_000_000_000);

/** The lattice this asset was on before PH-37 coarsened it: 12.9x finer. */
const OLD_FRAME = {
  logQuantum: asset.instrument.logQuantum / 12.9,
  referencePrice: asset.instrument.referencePrice,
  displayPrecision: asset.instrument.displayPrecision + 1,
};

async function venueWithTwoFrames(): Promise<{
  controller: MarketController;
  service: VenueService;
  record: MemoryTickRecord;
  boundary: number;
  oldest: number;
}> {
  const clock = new SteppableClock(GENESIS);
  const record = new MemoryTickRecord();
  const service = new VenueService(
    new MemoryStateStore(),
    MasterKeyring.fromSecret('rendered-frame-spec', new Uint8Array(32).fill(11)),
    clock,
    [asset],
    5_000,
    new PublicationService([asset], 20, {}),
    null,
    GENESIS,
    0,
    null,
    null,
    null,
    record,
  );
  await service.start();
  for (let i = 0; i < 90; i += 1) {
    clock.advance(durationMillis(1_000));
    await service.tick();
  }
  const held = await record.since(ID, 1, 1_000_000);
  expect(held.length, 'the venue published nothing to declare over').toBeGreaterThan(20);
  const oldest = held[0]!.sequence;
  const boundary = held[Math.floor(held.length / 2)]!.sequence;
  // The shape the live venue has: an older, finer frame, then the current one
  // from a relattice boundary onwards. `replace` because the record has already
  // written the epoch of this process's own first append (PH-38.1).
  await record.declareLattice(
    ID,
    [
      { assetId: ID, fromSequence: oldest, fromInstant: held[0]!.instant, ...OLD_FRAME },
      {
        assetId: ID,
        fromSequence: boundary,
        fromInstant: held[Math.floor(held.length / 2)]!.instant,
        ...asset.instrument,
      },
    ],
    true,
  );
  return { controller: new MarketController(service), service, record, boundary, oldest };
}

describe('a recorded price is rendered on the frame it was published on', () => {
  it('renders a pre-boundary tick on the old frame, not on the current one', async () => {
    const { controller, service, boundary } = await venueWithTwoFrames();
    const before = (await controller.recordedTick(ID, String(boundary - 1))) as {
      price: number;
      logQuantum: number | null;
      displayPrice: string | null;
    };

    expect(before.logQuantum, 'the old frame was not used').toBeCloseTo(OLD_FRAME.logQuantum, 15);
    expect(before.logQuantum).not.toBe(asset.instrument.logQuantum);
    // And the rendered string is the one the old frame gives, which differs from
    // what today's frame would produce for the same integer — that difference is
    // the whole defect, so assert it rather than assume it.
    const onToday = OLD_FRAME.referencePrice * Math.exp(asset.instrument.logQuantum * before.price);
    const rendered = Number(before.displayPrice);
    expect(rendered).toBeGreaterThan(0);
    expect(
      Math.abs(rendered - onToday) / onToday,
      'the integer was rendered on the current lattice',
    ).toBeGreaterThan(1e-6);
    await service.stop();
  });

  it('renders a post-boundary tick on the current frame', async () => {
    const { controller, service, boundary } = await venueWithTwoFrames();
    const after = (await controller.recordedTick(ID, String(boundary + 1))) as {
      logQuantum: number | null;
    };
    expect(after.logQuantum).toBe(asset.instrument.logQuantum);
    await service.stop();
  });

  it('answers the same frame through the instant route as through the sequence route', async () => {
    // INV-002: one moment, one price, whichever door a client comes through.
    const { controller, service, boundary } = await venueWithTwoFrames();
    const bySequence = (await controller.recordedTick(ID, String(boundary - 1))) as {
      instant: number;
      displayPrice: string | null;
      logQuantum: number | null;
    };
    const byInstant = (await controller.priceAt(ID, String(bySequence.instant))) as {
      displayPrice: string | null;
      logQuantum: number | null;
    };
    expect(byInstant.logQuantum).toBe(bySequence.logQuantum);
    expect(byInstant.displayPrice).toBe(bySequence.displayPrice);
    await service.stop();
  });

  it('publishes both frames where a broker can join them to archived integers', async () => {
    const { controller, service, boundary, oldest } = await venueWithTwoFrames();
    const lattices = (await controller.lattices(ID)) as {
      fromSequence: number;
      logQuantum: number;
    }[];
    expect(lattices.map((l) => l.fromSequence)).toEqual([oldest, boundary]);
    expect(lattices[0]!.logQuantum).toBeCloseTo(OLD_FRAME.logQuantum, 15);
    expect(lattices[1]!.logQuantum).toBe(asset.instrument.logQuantum);
    await service.stop();
  });
});
