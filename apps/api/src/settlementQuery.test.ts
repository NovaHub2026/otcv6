// Invariant evidence: INV-009 (reproducible settlement), INV-010 (private generator state).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterAll, describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import {
  commit,
  publicKeyHex,
  publishingKeyFromSeed,
  readJournalFile,
  signCommitment,
  verifyCommitment,
  verifyInclusion,
  type InclusionProof,
  type SignedCommitment,
} from '@otc/distribution';
import { ASSET_CATALOGUE, type RegisteredAsset } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord } from '@otc/runtime';
import { NotSettleableError, settle } from '@otc/trading';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

const GENESIS = epochMillis(1_776_000_000_000);
const asset = [...ASSET_CATALOGUE].sort(
  (a, b) => a.evidence.meanIntervalMs - b.evidence.meanIntervalMs,
)[0]!;
const ID = asset.definition.id;
/**
 * A second market, so the restart leg has something to host.
 *
 * A venue needs at least one market, and the asset under test is retired by
 * then — a catalogue of one would refuse the boot rather than answer the
 * question this test asks.
 */
const other = [...ASSET_CATALOGUE].sort(
  (a, b) => a.evidence.meanIntervalMs - b.evidence.meanIntervalMs,
)[1]!;
const SEED = '66'.repeat(32);
const directories: string[] = [];
afterAll(async () => {
  await Promise.all(directories.map((d) => rm(d, { recursive: true, force: true })));
});

interface Published {
  sequence: number;
  instant: number;
  price: number;
  displayPrice: string;
  at?: number;
  rule?: string;
}
interface SeamBody {
  assetId: string;
  lastSequence: number;
  lastInstant: number;
  resumesAtSequence: number;
  resumesAtInstant: number;
}
interface ProofBody {
  publisherPublicKey: string | null;
  commitment: SignedCommitment;
  proof: InclusionProof;
  linksRead: number;
}

interface Composition {
  readonly store?: MemoryStateStore;
  readonly record?: MemoryTickRecord;
  readonly clock?: SteppableClock;
  readonly seconds?: number;
  /** The catalogue this venue hosts; the fastest asset alone by default. */
  readonly assets?: readonly RegisteredAsset[];
  /** Assets an operator retired in an earlier boot, as the overlays carry them. */
  readonly retired?: readonly string[];
}

async function venue(
  publishing: boolean,
  composition: Composition = {},
): Promise<{
  venue: VenueService;
  controller: MarketController;
  clock: SteppableClock;
  directory: string | null;
}> {
  const directory = publishing ? await mkdtemp(path.join(tmpdir(), 'otc-query-')) : null;
  if (directory !== null) directories.push(directory);
  const clock = composition.clock ?? new SteppableClock(GENESIS);
  const catalogue = [...(composition.assets ?? [asset])];
  const service = new VenueService(
    composition.store ?? new MemoryStateStore(),
    MasterKeyring.fromSecret('settlement-query', new Uint8Array(32).fill(29)),
    clock,
    catalogue,
    5_000,
    new PublicationService(
      catalogue,
      20,
      directory === null ? {} : { OTC_PUBLICATION_DIR: directory, OTC_PUBLISHING_KEY: SEED },
    ),
    null,
    GENESIS,
    0,
    null,
    null,
    null,
    composition.record ?? new MemoryTickRecord(),
  );
  // Before `start`, as `main.ts` does it: the decision not to host something has
  // to be known before the resume loop runs.
  if (composition.retired !== undefined) {
    service.applyOverlays(
      new Map(composition.retired.map((id) => [id, { retiredAt: GENESIS - 1 }])),
    );
  }
  await service.start();
  for (let i = 0; i < (composition.seconds ?? 90); i += 1) {
    clock.advance(durationMillis(1_000));
    await service.tick();
  }
  return { venue: service, controller: new MarketController(service), clock, directory };
}

/**
 * A venue that stopped and came back 120 s later: past the 15 s catch-up bound,
 * so every market seams (PH-30.4 saw exactly this on the release build's
 * deploy-length restart). The store and the record are shared across the two
 * boots, so the record keeps both sides of an interval nobody generated.
 */
async function seamedVenue(): Promise<{
  controller: MarketController;
  service: VenueService;
  record: MemoryTickRecord;
  seam: SeamBody;
  ticks: readonly Tick[];
}> {
  const store = new MemoryStateStore();
  const record = new MemoryTickRecord();
  const first = await venue(false, { store, record, seconds: 90 });
  await first.venue.checkpoint();
  await first.venue.stop();
  const clock = new SteppableClock(epochMillis(first.clock.now() + 120_000));
  const second = await venue(false, { store, record, clock, seconds: 5 });
  const seams = (await second.controller.seams(ID)) as SeamBody[];
  expect(seams, 'the restart seamed the record').toHaveLength(1);
  return {
    controller: second.controller,
    service: second.venue,
    record,
    seam: seams[0]!,
    ticks: await record.since(ID, 1, 1_000_000),
  };
}

/** The rule, computed from the served ticks: the last at or before the instant. */
function lastAtOrBefore(ticks: readonly Tick[], instant: number): Tick | null {
  let found: Tick | null = null;
  for (const tick of ticks) {
    if (tick.instant <= instant) found = tick;
    else break;
  }
  return found;
}

describe('the settlement query (PH-29.1)', () => {
  it('serves the recorded tick at a sequence, and names the bounds outside them', async () => {
    const { venue: service, controller } = await venue(false);
    const served = service.feed.since(ID, 1);
    expect(served.length).toBeGreaterThan(50);
    const wanted = served[Math.floor(served.length / 2)]!;
    const body = (await controller.recordedTick(ID, String(wanted.sequence))) as Published;
    expect(body).toMatchObject({
      sequence: wanted.sequence,
      instant: wanted.instant,
      price: wanted.price,
    });
    expect(body.displayPrice).toMatch(/^\d+\.\d+$/);
    await expect(controller.recordedTick(ID, String(served.length + 100))).rejects.toThrow(
      new RegExp(`holds 1–${String(served.length)}`),
    );
    await expect(controller.recordedTick(ID, '0')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.recordedTick(ID, '1.5')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.recordedTick('nope', '1')).rejects.toBeInstanceOf(NotFoundException);
    await service.stop();
  });

  it('answers the price in force at an instant by the rule settle() uses, for a thousand instants', async () => {
    const { venue: service, controller } = await venue(false);
    const served = service.feed.since(ID, 1);
    const first = served[0]!;
    const last = served[served.length - 1]!;
    const span = last.instant - first.instant;
    let checked = 0;
    for (let i = 0; i <= 1_000; i += 1) {
      const at = first.instant + Math.floor((span * i) / 1_000);
      const expected = lastAtOrBefore(served, at)!;
      const body = (await controller.priceAt(ID, String(at))) as Published;
      expect(body, `at ${String(at)}`).toMatchObject({
        at,
        rule: 'last-tick-at-or-before',
        sequence: expected.sequence,
        price: expected.price,
      });
      checked += 1;
    }
    expect(checked).toBe(1_001);
    // Exactly on a tick, and one millisecond before it.
    const onTick = served[10]!;
    expect(((await controller.priceAt(ID, String(onTick.instant))) as Published).sequence).toBe(
      onTick.sequence,
    );
    expect(((await controller.priceAt(ID, String(onTick.instant - 1))) as Published).sequence).toBe(
      lastAtOrBefore(served, onTick.instant - 1)!.sequence,
    );
    // Before the record: refused; after the newest published instant: refused.
    await expect(controller.priceAt(ID, String(first.instant - 1))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.priceAt(ID, String(last.instant + 1))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.priceAt(ID, undefined)).rejects.toBeInstanceOf(BadRequestException);
    // And it is what the reference settlement uses for an entry price.
    const record = {
      instants: Float64Array.from(served.map((t) => t.instant)),
      prices: Int32Array.from(served.map((t) => t.price)),
    };
    for (const entryAt of [first.instant + 7_000, first.instant + 31_337, first.instant + 60_001]) {
      const settlement = settle(
        {
          id: `c-${String(entryAt)}`,
          assetId: ID,
          direction: 'up',
          stake: 10,
          entryInstant: epochMillis(entryAt),
          horizonMs: durationMillis(15_000),
          payoutRatio: 0.8,
        },
        record,
      );
      const body = (await controller.priceAt(ID, String(entryAt))) as Published;
      expect(body.price).toBe(settlement.entryPrice);
      const expiry = (await controller.priceAt(ID, String(entryAt + 15_000))) as Published;
      expect(expiry.price).toBe(settlement.expiryPrice);
    }
    await service.stop();
  });

  /**
   * **Cycle Audit 10, a4-01 and a1-01 — the critical one.** A restart longer
   * than the 15 s catch-up bound is what every deploy is, and it seams the
   * record. `GET /markets/:id/price?at=` answered an instant inside the seam
   * with the pre-seam tick and `"rule":"last-tick-at-or-before"`, naming
   * nothing; `settle()` refuses the same window as `NotSettleableError`, but
   * only when it is given the seams, and no route exposed them. The
   * money-losing shape the refuter measured is entry before the seam and
   * expiry inside it: net −100 against a price from before a gap nobody
   * generated.
   */
  describe('a recorded seam (PH-31)', () => {
    it('refuses the price of an instant inside it, naming both sides, and answers the boundaries', async () => {
      const { controller, seam, service } = await seamedVenue();
      const inside = Math.floor((seam.lastInstant + seam.resumesAtInstant) / 2);
      expect(inside).toBeGreaterThan(seam.lastInstant);
      expect(inside).toBeLessThan(seam.resumesAtInstant);
      await expect(controller.priceAt(ID, String(inside))).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(controller.priceAt(ID, String(inside))).rejects.toThrow(
        new RegExp(
          `falls inside a recorded discontinuity.*sequence ${String(seam.lastSequence)} ` +
            `\\(instant ${String(seam.lastInstant)}\\).*sequence ${String(seam.resumesAtSequence)} ` +
            `\\(instant ${String(seam.resumesAtInstant)}\\)`,
          's',
        ),
      );
      // One millisecond either side of the boundary instants: refused inside,
      // answered on the ticks themselves.
      await expect(controller.priceAt(ID, String(seam.lastInstant + 1))).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(
        controller.priceAt(ID, String(seam.resumesAtInstant - 1)),
      ).rejects.toBeInstanceOf(ConflictException);
      const before = (await controller.priceAt(ID, String(seam.lastInstant))) as Published;
      expect(before.sequence, 'the last tick before the gap is still a price').toBe(
        seam.lastSequence,
      );
      const after = (await controller.priceAt(ID, String(seam.resumesAtInstant))) as Published;
      expect(after.sequence, 'and so is the first one after it').toBe(seam.resumesAtSequence);
      await service.stop();
    });

    it('lists itself where a broker can read it, in the instants settle() takes', async () => {
      const { controller, seam, record, service } = await seamedVenue();
      expect(Object.keys(seam).sort()).toEqual([
        'assetId',
        'lastInstant',
        'lastSequence',
        'resumesAtInstant',
        'resumesAtSequence',
      ]);
      expect(seam.assetId).toBe(ID);
      // The seam the route names is the jump the record actually holds.
      const held = await record.since(ID, seam.lastSequence, 2);
      expect(held.map((t) => t.sequence)).toEqual([seam.lastSequence, seam.resumesAtSequence]);
      expect(held[0]!.instant).toBe(seam.lastInstant);
      expect(held[1]!.instant).toBe(seam.resumesAtInstant);
      expect(seam.resumesAtInstant - seam.lastInstant).toBeGreaterThan(100_000);
      await expect(controller.seams('nope')).rejects.toBeInstanceOf(NotFoundException);
      await service.stop();
    });

    it('is what stops settle() computing a loss against a price from before the gap', async () => {
      const { controller, seam, ticks, service } = await seamedVenue();
      const instants = Float64Array.from(ticks.map((t) => t.instant));
      const prices = Int32Array.from(ticks.map((t) => t.price));
      // The money-losing shape: entry before the seam, expiry inside it.
      const entryInstant = epochMillis(seam.lastInstant - 5_000);
      const expiryInstant = Math.floor((seam.lastInstant + seam.resumesAtInstant) / 2);
      const contract = {
        id: 'across-the-seam',
        assetId: ID,
        direction: 'up' as const,
        stake: 100,
        entryInstant,
        horizonMs: durationMillis(expiryInstant - entryInstant),
        payoutRatio: 0.85,
      };
      // The record a broker could build from the API before this route
      // existed: the ticks, and no seams.
      const blind = settle(contract, { instants, prices });
      const lastBeforeTheGap = ticks.find((t) => t.sequence === seam.lastSequence)!;
      expect(blind.expiryPrice, 'settled against the last tick before a gap nobody generated').toBe(
        lastBeforeTheGap.price,
      );
      // The record the route now lets it build.
      const seams = ((await controller.seams(ID)) as SeamBody[]).map((one) => ({
        lastInstant: one.lastInstant,
        resumesAtInstant: one.resumesAtInstant,
      }));
      expect(() => settle(contract, { instants, prices, seams })).toThrow(NotSettleableError);
      expect(() => settle(contract, { instants, prices, seams })).toThrow(
        /touches a recorded discontinuity/,
      );
      // And the same window through the API refuses rather than serving the
      // price `blind` used: the two agree now.
      await expect(controller.priceAt(ID, String(expiryInstant))).rejects.toBeInstanceOf(
        ConflictException,
      );
      // Either side of the seam the two still agree exactly.
      const wholly = {
        ...contract,
        id: 'before-the-seam',
        entryInstant: epochMillis(seam.lastInstant - 20_000),
        horizonMs: durationMillis(10_000),
      };
      const settled = settle(wholly, { instants, prices, seams });
      const entry = (await controller.priceAt(ID, String(wholly.entryInstant))) as Published;
      const expiry = (await controller.priceAt(
        ID,
        String(wholly.entryInstant + 10_000),
      )) as Published;
      expect(entry.price).toBe(settled.entryPrice);
      expect(expiry.price).toBe(settled.expiryPrice);
      await service.stop();
    });

    it('a venue that never seamed lists none, and answers every instant', async () => {
      const { venue: service, controller } = await venue(false);
      expect(await controller.seams(ID)).toEqual([]);
      const served = service.feed.since(ID, 1);
      const middle = served[Math.floor(served.length / 2)]!;
      expect(((await controller.priceAt(ID, String(middle.instant))) as Published).sequence).toBe(
        middle.sequence,
      );
      await service.stop();
    });
  });

  /**
   * **Cycle Audit 10, a4-06 and a6-08.** `POST /assets/:id/retire` is summarised
   * in the contract as "its record stays readable", and the docstring promises
   * that the history, the settlements and the journal "remain exactly as they
   * were". `/markets/:id/ticks/:sequence` kept that promise; `/markets/:id/price`
   * did not. It bounds the query with `VenueService.lastTick`, whose fallback
   * was `venue.marketFor(assetId).lastPublishedState` — and `marketFor` throws a
   * bare `RangeError` for an asset the venue no longer hosts, which is not an
   * `HttpException`, so a broker settling an open contract on a retired market
   * got `500 Internal server error`: no message, and nothing that says whether
   * to retry. The one settlement figure a broker cannot reconstruct without the
   * sequence was unavailable for exactly the markets whose contracts are
   * running out.
   */
  describe('a retired market (a4-06, a6-08)', () => {
    it('answers the settlement query from its record, hosted, retired and after a restart', async () => {
      const store = new MemoryStateStore();
      const record = new MemoryTickRecord();
      const first = await venue(false, { store, record, assets: [asset, other], seconds: 90 });
      const served = await record.since(ID, 1, 1_000_000);
      expect(served.length).toBeGreaterThan(50);
      const wanted = served[Math.floor(served.length / 2)]!;
      const head = served[served.length - 1]!;
      const answered = (await first.controller.priceAt(ID, String(wanted.instant))) as Published;
      expect(answered.sequence, 'hosted, the query answers').toBe(wanted.sequence);

      await first.venue.retire(ID);
      expect(first.venue.isRetired(ID)).toBe(true);
      expect(first.venue.assetIds, 'no longer hosted').not.toContain(ID);
      // The record stays readable — the part that already worked.
      expect(
        ((await first.controller.recordedTick(ID, String(wanted.sequence))) as Published).price,
      ).toBe(wanted.price);
      // And so does the price in force at an instant, which is the part that
      // answered 500.
      expect(await first.controller.priceAt(ID, String(wanted.instant))).toMatchObject({
        assetId: ID,
        at: wanted.instant,
        rule: 'last-tick-at-or-before',
        sequence: wanted.sequence,
        price: wanted.price,
      });
      // Bounded by the record's own head, since there is no live tick to bound
      // it with: the newest recorded instant answers, one millisecond past it
      // is the same "not yet" a hosted market gives.
      expect(
        ((await first.controller.priceAt(ID, String(head.instant))) as Published).sequence,
      ).toBe(head.sequence);
      await expect(first.controller.priceAt(ID, String(head.instant + 1))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // Before the record: still the 404 that says the record cannot say.
      await expect(
        first.controller.priceAt(ID, String(served[0]!.instant - 1)),
      ).rejects.toBeInstanceOf(NotFoundException);
      await first.venue.stop();

      // And after a restart, where the asset is never hosted at all: the
      // overlay is read before the resume loop, so nothing about it is in
      // memory beyond the catalogue entry.
      const second = await venue(false, {
        store,
        record,
        assets: [asset, other],
        retired: [ID],
        clock: new SteppableClock(epochMillis(first.clock.now() + 1_000)),
        seconds: 5,
      });
      expect(second.venue.assetIds).toEqual([other.definition.id]);
      expect(
        ((await second.controller.recordedTick(ID, String(wanted.sequence))) as Published).price,
      ).toBe(wanted.price);
      expect(await second.controller.priceAt(ID, String(wanted.instant))).toMatchObject({
        rule: 'last-tick-at-or-before',
        sequence: wanted.sequence,
        price: wanted.price,
      });
      await second.venue.stop();
    });
  });

  it('serves a proof a counterparty can verify, says "not yet" for the open window, and "no" without publication', async () => {
    const { venue: service, controller, directory } = await venue(true);
    const served = service.feed.since(ID, 1);
    const committedThrough = Math.floor(served.length / 20) * 20;
    expect(committedThrough).toBeGreaterThanOrEqual(40);
    const body = (await controller.proofFor(ID, String(committedThrough - 5))) as ProofBody;
    expect(body.publisherPublicKey).toBe(publicKeyHex(publishingKeyFromSeed(SEED)));
    expect(verifyCommitment(body.commitment, body.publisherPublicKey!)).toBe(true);
    expect(verifyInclusion(body.commitment.commitment, body.proof)).toBe(true);
    const recorded = served[committedThrough - 6]!;
    expect(body.proof).toMatchObject({
      sequence: recorded.sequence,
      instant: recorded.instant,
      price: recorded.price,
    });
    expect(
      verifyInclusion(body.commitment.commitment, { ...body.proof, price: body.proof.price + 1 }),
    ).toBe(false);
    // The open window: published, not archived.
    await expect(controller.proofFor(ID, String(committedThrough + 1))).rejects.toThrow(
      new RegExp(`not yet committed; the chain reaches ${String(committedThrough)}`),
    );
    await expect(controller.proofFor(ID, String(committedThrough + 1))).rejects.toBeInstanceOf(
      ConflictException,
    );
    // A journal an operator edited: no proof is served from that window at
    // all.
    //
    // **Cycle Audit 10, a4-05.** This case used to be asserted for the edited
    // line only, and the route only compared the *requested* tick with the
    // record — so `/proof/5` after an edit on line 3 was a `200` carrying a
    // signature that verifies and an inclusion proof that does not, and the
    // same `200` was served for the edited tick itself once it had left the
    // record's retention. The window is now checked against the root it is
    // committed to before anything is served from it.
    const file = path.join(directory!, ID, `1-20.journal`);
    const original = await readFile(file, 'utf8');
    const lines = original.split('\n');
    const row = JSON.parse(lines[3]!) as [number, number, number];
    expect(row[0]).toBe(3);
    lines[3] = JSON.stringify([row[0], row[1], row[2] + 1]);
    await writeFile(file, lines.join('\n'));
    for (const sequence of ['3', '5', '20']) {
      await expect(controller.proofFor(ID, sequence)).rejects.toThrow(
        /does not hash to the root its commitment signs/,
      );
      await expect(controller.proofFor(ID, sequence)).rejects.toBeInstanceOf(ConflictException);
    }
    // An operator who holds the publishing key and re-signs the window they
    // edited leaves an archive that is internally consistent and still
    // contradicts what the venue published. That is the case the record
    // cross-check is for, and it is the one that keeps it reachable: the
    // edited tick is refused by comparison with the record, and the chain
    // that binds this window's root into its successor is broken for anyone
    // who verifies the file.
    const chain = path.join(directory!, ID, 'commitments.ndjson');
    const links = (await readFile(chain, 'utf8')).split('\n');
    const first = JSON.parse(links[0]!) as SignedCommitment;
    links[0] = JSON.stringify(
      signCommitment(
        commit(ID, readJournalFile(file).ticks, first.commitment.previousRoot),
        publishingKeyFromSeed(SEED),
      ),
    );
    await writeFile(chain, links.join('\n'));
    await expect(controller.proofFor(ID, '3')).rejects.toThrow(/disagrees with the record/);
    await expect(controller.proofFor(ID, '3')).rejects.toBeInstanceOf(ConflictException);
    await service.stop();

    const plain = await venue(false);
    await expect(plain.controller.proofFor(ID, '1')).rejects.toBeInstanceOf(NotFoundException);
    await plain.venue.stop();
  });
});
