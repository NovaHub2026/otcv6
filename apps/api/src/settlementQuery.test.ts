// Invariant evidence: INV-005 (expiration independence), INV-009 (reproducible settlement), INV-010 (private generator state).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterAll, describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import {
  publicKeyHex,
  publishingKeyFromSeed,
  verifyCommitment,
  verifyInclusion,
  type InclusionProof,
  type SignedCommitment,
} from '@otc/distribution';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord } from '@otc/runtime';
import { settle } from '@otc/trading';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

const GENESIS = epochMillis(1_776_000_000_000);
const asset = [...ASSET_CATALOGUE].sort(
  (a, b) => a.evidence.meanIntervalMs - b.evidence.meanIntervalMs,
)[0]!;
const ID = asset.definition.id;
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
interface ProofBody {
  publisherPublicKey: string | null;
  commitment: SignedCommitment;
  proof: InclusionProof;
  linksRead: number;
}

async function venue(publishing: boolean): Promise<{
  venue: VenueService;
  controller: MarketController;
  clock: SteppableClock;
  directory: string | null;
}> {
  const directory = publishing ? await mkdtemp(path.join(tmpdir(), 'otc-query-')) : null;
  if (directory !== null) directories.push(directory);
  const clock = new SteppableClock(GENESIS);
  const service = new VenueService(
    new MemoryStateStore(),
    MasterKeyring.fromSecret('settlement-query', new Uint8Array(32).fill(29)),
    clock,
    [asset],
    5_000,
    new PublicationService(
      [asset],
      20,
      directory === null ? {} : { OTC_PUBLICATION_DIR: directory, OTC_PUBLISHING_KEY: SEED },
    ),
    null,
    GENESIS,
    0,
    null,
    null,
    null,
    new MemoryTickRecord(),
  );
  await service.start();
  for (let i = 0; i < 90; i += 1) {
    clock.advance(durationMillis(1_000));
    await service.tick();
  }
  return { venue: service, controller: new MarketController(service), clock, directory };
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
    // A journal an operator edited disagrees with the record: no proof is served for it.
    const file = path.join(directory!, ID, `1-20.journal`);
    const lines = (await readFile(file, 'utf8')).split('\n');
    const row = JSON.parse(lines[3]!) as [number, number, number];
    lines[3] = JSON.stringify([row[0], row[1], row[2] + 1]);
    await writeFile(file, lines.join('\n'));
    await expect(controller.proofFor(ID, '3')).rejects.toThrow(/disagrees with the record/);
    await service.stop();

    const plain = await venue(false);
    await expect(plain.controller.proofFor(ID, '1')).rejects.toBeInstanceOf(NotFoundException);
    await plain.venue.stop();
  });
});
