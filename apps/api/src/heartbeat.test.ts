// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream), INV-009 (reproducible settlement).
import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord } from '@otc/runtime';
import { heartbeatOwed, MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/**
 * PH-40.2 — a market that is open says so.
 *
 * The broker this phase serves refuses to open a contract on a quote older than
 * fifteen seconds unless a heartbeat refreshes it, so a quiet market — or a seam,
 * during which the price in force is the last tick before it (ADR-0021) — read
 * to it as closed. The heartbeat answers that, and the one thing it must never do
 * is claim more than the record will stand behind: `asOf` is how far the market
 * has been published and recorded, not the wall clock.
 */

const asset = [...ASSET_CATALOGUE].sort(
  (a, b) => a.evidence.meanIntervalMs - b.evidence.meanIntervalMs,
)[0]!;
const ID = asset.definition.id;
/** The slowest market: a reopened one takes a while to publish its first tick. */
const slow = [...ASSET_CATALOGUE].sort(
  (a, b) => b.evidence.meanIntervalMs - a.evidence.meanIntervalMs,
)[0]!;
const GENESIS = epochMillis(1_776_000_000_000);

interface InForce {
  sequence: number;
  instant: number;
  price: number;
  asOf: number;
}

async function venue(hosted = asset): Promise<{
  service: VenueService;
  controller: MarketController;
  clock: SteppableClock;
}> {
  const clock = new SteppableClock(GENESIS);
  const service = new VenueService(
    new MemoryStateStore(),
    MasterKeyring.fromSecret('heartbeat-spec', new Uint8Array(32).fill(41)),
    clock,
    [hosted],
    5_000,
    new PublicationService([hosted], 20, {}),
    null,
    GENESIS,
    0,
    null,
    null,
    null,
    new MemoryTickRecord(),
  );
  await service.start();
  return { service, controller: new MarketController(service), clock };
}

async function run(
  v: { service: VenueService; clock: SteppableClock },
  seconds: number,
  stepMs = 1_000,
): Promise<void> {
  for (let i = 0; i < seconds; i += 1) {
    v.clock.advance(durationMillis(stepMs));
    await v.service.tick();
  }
}

/** A response that records what a stream writes, and ends when told. */
function recording(): { res: Response; frames: () => { event: string; data: unknown }[] } {
  let ended = false;
  const chunks: string[] = [];
  const res = {
    writeHead: () => res,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: () => {
      ended = true;
    },
    get writableEnded() {
      return ended;
    },
    on: () => undefined,
    once: (event: string, handler: () => void) => {
      if (event === 'drain') handler();
      return res;
    },
    get writableNeedDrain() {
      return false;
    },
    get writableLength() {
      return 0;
    },
  } as unknown as Response;
  const frames = (): { event: string; data: unknown }[] =>
    chunks
      .join('')
      .split('\n\n')
      .filter((block) => block.length > 0)
      .map((block) => {
        let event = 'message';
        let data = 'null';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        return { event, data: JSON.parse(data) as unknown };
      });
  return { res, frames };
}

const request = (): Request => ({ headers: {} }) as Request;

afterEach(() => {
  vi.useRealTimers();
});

describe('the price in force, and the instant it is final through (PH-40.2)', () => {
  it('is the last clean pass, never the wall clock', async () => {
    const v = await venue();
    await run(v, 30);
    const inForce = v.service.priceInForce(ID)!;
    const last = v.service.feed.since(ID, 1).at(-1)!;
    expect(inForce).toEqual({
      sequence: last.sequence,
      instant: last.instant,
      price: last.price,
      asOf: v.clock.now(),
    });
    // Time passing with no pass is not knowledge: nothing was advanced, so
    // nothing is final past where the last pass got to.
    v.clock.advance(durationMillis(5_000));
    expect(v.service.priceInForce(ID)).toEqual(inForce);
    await v.service.stop();
  });

  it('never changes once stated — a short freeze is caught up behind it, not in front of it', async () => {
    const v = await venue();
    await run(v, 30);
    const stated = v.service.priceInForce(ID)!;
    // Ten seconds without the CPU, inside the 15 s catch-up bound: the next pass
    // publishes the missed ticks with past instants. Everything after `asOf`
    // may move; nothing at or before it may.
    v.clock.advance(durationMillis(10_000));
    await v.service.tick();
    const later = v.service.priceInForce(ID)!;
    expect(later.asOf).toBe(v.clock.now());
    expect(later.sequence, 'the catch-up published nothing').toBeGreaterThan(stated.sequence);
    const atStated = (await v.controller.priceAt(ID, String(stated.asOf))) as { sequence: number };
    expect(atStated.sequence).toBe(stated.sequence);
    await v.service.stop();
  });

  it('lets /price answer every instant up to it, and refuses the next millisecond', async () => {
    const v = await venue();
    await run(v, 30);
    // A pass that leaves room between the last tick and the clock.
    let inForce = v.service.priceInForce(ID)!;
    for (let i = 0; i < 50 && inForce.asOf === inForce.instant; i += 1) {
      await run(v, 1, 7);
      inForce = v.service.priceInForce(ID)!;
    }
    expect(inForce.asOf).toBeGreaterThan(inForce.instant);
    for (const at of [inForce.instant, inForce.instant + 1, inForce.asOf]) {
      const answer = (await v.controller.priceAt(ID, String(at))) as { sequence: number };
      expect(answer.sequence, `at ${String(at)}`).toBe(inForce.sequence);
    }
    await expect(v.controller.priceAt(ID, String(inForce.asOf + 1))).rejects.toThrow(
      new RegExp(`final through ${String(inForce.asOf)}`),
    );
    await expect(v.controller.priceAt(ID, String(inForce.asOf + 1))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await v.service.stop();
  });

  it('holds still through an outage until the reopened market publishes, then names the seam', async () => {
    const v = await venue(slow);
    const id = slow.definition.id;
    await run(v, 120);
    const before = v.service.priceInForce(id)!;
    // Past the catch-up bound: the market reopens itself at the clock (ADR-0020)
    // and has published nothing since, so its price past `before.asOf` is not
    // known — until the first tick after the gap, the gap is not yet a seam.
    v.clock.advance(durationMillis(3 * 60 * 60 * 1_000));
    await v.service.tick();
    expect(v.service.priceInForce(id)).toEqual(before);
    // A clean pass a moment later in which the reopened market publishes
    // nothing: it advanced, but the gap is not yet a seam the record can name, so
    // nothing past `before.asOf` is stated as final yet.
    const published = v.service.lastTick(id)!.sequence;
    await run(v, 1, 5);
    expect(v.service.lastTick(id)!.sequence, 'the window this asks about').toBe(published);
    expect(v.service.priceInForce(id)).toEqual(before);
    for (let i = 0; i < 600 && v.service.lastTick(id)!.sequence === published; i += 1) {
      await run(v, 1);
    }
    const after = v.service.priceInForce(id)!;
    expect(after.asOf).toBe(v.clock.now());
    expect(after.sequence).toBeGreaterThan(before.sequence);
    // And now the gap is a seam, the price inside it is the one `before` stated.
    const inside = (await v.controller.priceAt(id, String(before.asOf + 60_000))) as {
      sequence: number;
      seam: { lastSequence: number } | null;
    };
    expect(inside.sequence).toBe(before.sequence);
    expect(inside.seam?.lastSequence).toBe(before.sequence);
    await v.service.stop();
  });
});

describe('the heartbeat a stream carries when asked (PH-40.2)', () => {
  it('writes the price in force between ticks, on one market and on many', async () => {
    const v = await venue();
    await run(v, 30);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const one = recording();
    v.controller.stream(ID, one.res, request(), undefined, undefined, '1000');
    const many = recording();
    v.controller.multiplexed(many.res, request(), ID, undefined, undefined, '1000');
    vi.advanceTimersByTime(1_000);
    const inForce = v.service.priceInForce(ID)!;
    expect(one.frames().filter((f) => f.event === 'heartbeat')).toEqual([
      { event: 'heartbeat', data: inForce },
    ]);
    expect(many.frames().filter((f) => f.event === 'heartbeat')).toEqual([
      { event: 'heartbeat', data: { asset: ID, ...inForce } },
    ]);
    // A pass moves both the tick and `asOf`, and the next beat says so.
    await run(v, 1);
    vi.advanceTimersByTime(1_000);
    const beats = one.frames().filter((f) => f.event === 'heartbeat');
    expect(beats.at(-1)?.data).toEqual(v.service.priceInForce(ID));
    await v.controller.beforeApplicationShutdown();
    await v.service.stop();
  });

  it('is never written unless asked for, and refuses an interval outside its bounds', async () => {
    const v = await venue();
    await run(v, 10);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const quiet = recording();
    v.controller.stream(ID, quiet.res, request());
    vi.advanceTimersByTime(60_000);
    expect(quiet.frames().filter((f) => f.event === 'heartbeat')).toEqual([]);
    for (const bad of ['499', '30001', 'abc', '1e3', '-1', '']) {
      expect(() =>
        v.controller.stream(ID, recording().res, request(), undefined, undefined, bad),
      ).toThrow(BadRequestException);
      expect(() =>
        v.controller.multiplexed(recording().res, request(), ID, undefined, undefined, bad),
      ).toThrow(BadRequestException);
    }
    await v.controller.beforeApplicationShutdown();
    await v.service.stop();
  });

  it('stops beating once the stream has ended', async () => {
    const v = await venue();
    await run(v, 10);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const one = recording();
    v.controller.stream(ID, one.res, request(), undefined, undefined, '500');
    await v.controller.beforeApplicationShutdown();
    const written = one.frames().length;
    vi.advanceTimersByTime(5_000);
    expect(one.frames()).toHaveLength(written);
    expect(vi.getTimerCount(), 'the interval outlived its stream').toBe(0);
    await v.service.stop();
  });
});

describe('a heartbeat never runs ahead of the connection it is written to', () => {
  const inForce: InForce = { sequence: 41, instant: 1_000, price: -7, asOf: 1_900 };
  const open = { writableEnded: false, writableNeedDrain: false };

  it('is owed on a live join, and when the last tick delivered is the one in force', () => {
    expect(heartbeatOwed(inForce, null, open)).toEqual(inForce);
    expect(heartbeatOwed(inForce, 41, open)).toEqual(inForce);
  });

  it('is not owed to a connection still being handed earlier ticks, or into a socket that said stop', () => {
    expect(heartbeatOwed(inForce, 40, open)).toBeNull();
    expect(heartbeatOwed(inForce, 12, open)).toBeNull();
    expect(
      heartbeatOwed(inForce, 41, { writableEnded: false, writableNeedDrain: true }),
    ).toBeNull();
    expect(
      heartbeatOwed(inForce, 41, { writableEnded: true, writableNeedDrain: false }),
    ).toBeNull();
    expect(heartbeatOwed(null, null, open)).toBeNull();
  });
});
