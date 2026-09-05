// Invariant evidence: INV-004 (timeframe observer independence), INV-001 (economic independence).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  epochMillis,
  FixedClock,
  logPrice,
  MasterKeyring,
  type Clock,
  type EpochMillis,
  type Tick,
} from '@otc/core';
import { TickFeed } from '@otc/distribution';
import { ASSET_ARCHETYPES, ASSET_CATALOGUE, MAX_ASSET_ID_LENGTH } from '@otc/engine';
import { FileAssetRegistry, InMemoryCandleHistory, MemoryStateStore } from '@otc/runtime';
import {
  AdminWriteGuard,
  bearerMatches,
  isJsonContentType,
  MIN_ADMIN_TOKEN_LENGTH,
} from './adminAuth.guard.js';
import {
  adminTokenFromEnvironment,
  backfillDaysFromEnvironment,
  MAX_BACKFILL_DAYS,
} from './app.module.js';
import { HistoryService } from './history.service.js';
import {
  MarketController,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_MULTIPLEXED_ASSETS,
  replayBudgetUsed,
} from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/** The slowest tape in the catalogue, derived rather than named (PH-26.3): a cheap backfill. */
const SLOW_ASSET = [...ASSET_CATALOGUE].sort(
  (a, b) => b.evidence.meanIntervalMs - a.evidence.meanIntervalMs,
)[0]!;

/**
 * Which compiled assets this file talks about, derived rather than named
 * (PH-26.3): the first three in the catalogue, the fourth, and the slowest
 * tape — the one a cheap backfill wants.
 */
const FIRST = ASSET_CATALOGUE[0]!.definition.id;
const SECOND = ASSET_CATALOGUE[1]!.definition.id;
const THIRD = ASSET_CATALOGUE[2]!.definition.id;
const FOURTH = ASSET_CATALOGUE[3]!.definition.id;
const SLOW = SLOW_ASSET.definition.id;

const ORIGIN = 1_776_000_000_000;

/** A venue stub: the controller reads four things from it and nothing else. */
function venueStub(
  liveIds: readonly string[],
  stalled: readonly { assetId: string; reason: string }[] = [],
): VenueService {
  // The catalogue is the venue's now, not a module constant: an asset created
  // from the panel joins it at runtime (PH-20.2), so the controller reads what
  // this deployment actually hosts rather than what was compiled in.
  return {
    assetIds: liveIds,
    catalogue: ASSET_CATALOGUE,
    assetFor: (id: string) => ASSET_CATALOGUE.find((asset) => asset.definition.id === id) ?? null,
    isRetired: () => false,
    rename: () => undefined,
    retire: () => Promise.resolve(),
    now: () => epochMillis(ORIGIN),
    lastTick: () => null,
    recoveryFor: () => null,
    stalledMarkets: stalled,
  } as unknown as VenueService;
}

function ticks(count: number, everyMs = 6_000): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: i + 1,
    instant: epochMillis(ORIGIN + i * everyMs),
    price: logPrice(1_000 + (((i * 29) % 17) - 8)),
  }));
}

async function populated(assetId = FIRST): Promise<HistoryService> {
  const service = new HistoryService(new InMemoryCandleHistory(), ASSET_CATALOGUE);
  service.observe(assetId, ticks(1_800));
  await service.flush();
  return service;
}

describe('health says whether the venue is publishing, not merely running', () => {
  it('is ok when every market is advancing', () => {
    expect(new MarketController(venueStub([FIRST])).health()).toEqual({
      status: 'ok',
      assets: 1,
      stalled: [],
      bootNonce: null,
    });
  });

  it('is degraded when a market has stopped, and says which and why', () => {
    // **Cycle Audit 6, CA6-33.** A market past its catch-up bound refuses every
    // later advance — `#lastAdvancedAt` only moves after the check — so it stops
    // for good. `Venue.advance()` drops the failure list and this service called
    // only that, so the venue reported `ok` while every chart froze.
    const stalled = [{ assetId: SECOND, reason: 'Market is 20s behind the clock' }];
    expect(new MarketController(venueStub([FIRST, SECOND], stalled)).health()).toEqual({
      status: 'degraded',
      assets: 2,
      stalled,
      bootNonce: null,
    });
  });

  it('echoes the boot nonce it was started with, so a spawning test knows whose engine answered', () => {
    // **a6-14.** Every service-booting test polled `/health` on its port and
    // took the first `ok` as its own child. A foreign engine already on that
    // port answers at once, while the child is still provisioning for minutes;
    // the suite then ran its assertions against somebody else's market.
    const controller = new MarketController(venueStub([FIRST]), null, null, null, 'nonce-1');
    expect((controller.health() as { bootNonce: string | null }).bootNonce).toBe('nonce-1');
  });
});

describe('the catalogue an operator picks from', () => {
  it('reports every asset with the evidence its registration produced', () => {
    const controller = new MarketController(venueStub([FIRST, SLOW]));
    const rows = controller.catalogue() as {
      id: string;
      live: boolean;
      dispersion: { quarterlyLogSigma: number; quarterlyPercent: number };
      meanIntervalMs: number;
      tieRate: number;
      seat: { archetype: string; character: string; priceSource: string } | null;
    }[];
    expect(rows).toHaveLength(ASSET_CATALOGUE.length);
    for (const row of rows) {
      expect(row.dispersion.quarterlyLogSigma).toBeGreaterThan(0);
      expect(row.dispersion.quarterlyPercent).toBeGreaterThan(0);
      expect(row.meanIntervalMs).toBeGreaterThan(0);
      expect(row.tieRate).toBeGreaterThan(0);
      // PH-26.4: every compiled asset says which seat it was drawn from, in
      // prose a broker can show — and nothing a trader could trade on.
      expect(row.seat, `${row.id} has no seat`).not.toBeNull();
      expect(ASSET_ARCHETYPES.map((a) => a.id)).toContain(row.seat!.archetype);
      expect(row.seat!.character.length).toBeGreaterThan(40);
      expect(row.seat!.priceSource.length).toBeGreaterThan(10);
      // Field shapes, not words: a character may say "volatility"; a JSON key
      // named after a trait may not exist (INV-010).
      expect(JSON.stringify(row.seat)).not.toMatch(
        /"(tempoMs|volatility|clustering|burstiness|cascadeDepth|logQuantum)"|cursor|registration-/,
      );
    }
    // Registered and hosted are different questions, and an operator needs both.
    expect(rows.filter((row) => row.live).map((row) => row.id)).toEqual([FIRST, SLOW]);
  });

  it('carries nothing economic', () => {
    // INV-001. The panel is an operator surface; a field here that referred to a
    // position, a payout or an exposure would be the first place the price path
    // could learn what the operator wants.
    const serialised = JSON.stringify(new MarketController(venueStub([])).catalogue());
    for (const forbidden of ['position', 'payout', 'exposure', 'balance', 'profit']) {
      expect(serialised.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('the archetypes an operator chooses between', () => {
  const rows = new MarketController(venueStub([])).archetypes() as {
    id: string;
    family: string;
    dispersion: { min: number; max: number; minPercent: number; maxPercent: number };
  }[];

  it('offers every family, with its band in both units', () => {
    expect(rows).toHaveLength(ASSET_ARCHETYPES.length);
    for (const row of rows) {
      expect(row.dispersion.max).toBeGreaterThan(row.dispersion.min);
      // Log units are where the arithmetic is honest and percent is where an
      // operator thinks. Below about 0.2 the two nearly agree; at an alt-coin's
      // 0.68 they differ by a third, which is why both are published.
      expect(row.dispersion.minPercent).toBeGreaterThanOrEqual(row.dispersion.min);
      expect(row.dispersion.maxPercent).toBeGreaterThanOrEqual(row.dispersion.max);
    }
  });

  it('spans the range the drift evidence measured', () => {
    const lowest = Math.min(...rows.map((row) => row.dispersion.min));
    const highest = Math.max(...rows.map((row) => row.dispersion.max));
    expect(highest / lowest).toBeGreaterThan(30);
  });
});

describe('reading stored history over HTTP', () => {
  // A day either side of the fixture, not "from zero": Cycle Audit 6 (CA6-34)
  // capped what one request may return, and a window starting at the epoch is
  // two million 15-minute bars.
  const window = { from: String(ORIGIN - 86_400_000), to: String(ORIGIN + 86_400_000) };

  it('returns candles at a timeframe folded from what was stored', async () => {
    const controller = new MarketController(venueStub([FIRST]), await populated());
    const body = (await controller.history_(FIRST, '15m', window.from, window.to)) as {
      timeframe: string;
      candles: { timeframe: string }[];
    };
    expect(body.timeframe).toBe('15m');
    expect(body.candles.length).toBeGreaterThan(5);
    expect(body.candles.every((candle) => candle.timeframe === '15m')).toBe(true);
  });

  it('refuses a timeframe finer than the stored base rather than coarsening it', async () => {
    // Returning a minute series under the name `1s` would put a shape on the
    // screen that no tick produced. INV-004 says the displayed timeframe never
    // changes the market; it must not change what the market appears to have
    // been either.
    const controller = new MarketController(venueStub([FIRST]), await populated());
    await expect(controller.history_(FIRST, '1s', window.from, window.to)).rejects.toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['no timeframe', undefined, window.from, window.to],
    ['an unknown timeframe', '2h', window.from, window.to],
    ['no from', '1h', undefined, window.to],
    ['no to', '1h', window.from, undefined],
    ['a negative from', '1h', '-1', window.to],
    ['a non-numeric from', '1h', 'yesterday', window.to],
    ['a window that ends before it starts', '1h', window.to, window.from],
    ['an empty window', '1h', window.from, window.from],
  ])('refuses %s', async (_label, timeframe, from, to) => {
    const controller = new MarketController(venueStub([FIRST]), await populated());
    await expect(controller.history_(FIRST, timeframe, from, to)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a window larger than one request may return', async () => {
    // Measured: a 90-day minute request is 20.5 MB of JSON and 1,496 ms of
    // blocked event loop, and sixty concurrent ones took the process from
    // 100 MB to 1.86 GB. No cap, no pagination, no auth.
    const controller = new MarketController(venueStub([FIRST]), await populated());
    await expect(controller.history_(FIRST, '1m', '0', String(ORIGIN))).rejects.toThrow(
      /past the 20,000 a single request may return/,
    );
  });

  it('refuses an asset that was never registered', async () => {
    const controller = new MarketController(venueStub([]), await populated());
    await expect(controller.history_('nope', '1h', window.from, window.to)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('says so when the deployment keeps no history at all', async () => {
    // Null is a real deployment: the venue published and settled for three
    // phases before a history tier existed. A 404 that names the reason beats an
    // empty array that reads as "this asset did nothing".
    const controller = new MarketController(venueStub([FIRST]));
    await expect(controller.history_(FIRST, '1h', window.from, window.to)).rejects.toThrow(
      /keeps no candle history/,
    );
  });
});

describe('recording history as the venue runs', () => {
  it('writes only bars that have closed', async () => {
    const service = new HistoryService(new InMemoryCandleHistory(), ASSET_CATALOGUE);
    // Half a minute of ticks: nothing has closed, so nothing may be written. A
    // stored open bar has a high and a low that are not yet true, and no reader
    // can tell the difference afterwards.
    service.observe(FIRST, ticks(5, 6_000));
    await service.flush();
    const empty = await service.read(FIRST, '1m', epochMillis(0), epochMillis(ORIGIN + 1e9));
    expect(empty).toEqual([]);

    service.observe(FIRST, ticks(1_800).slice(5));
    await service.flush();
    const bars = await service.read(FIRST, '1m', epochMillis(0), epochMillis(ORIGIN + 1e9));
    expect(bars.length).toBeGreaterThan(100);
  });

  it('accumulates across the many small batches the venue actually delivers', async () => {
    // The venue calls `observe` once per scheduler tick — a handful of ticks —
    // and flushes on the checkpoint cadence, so almost every closed bar is
    // accepted in one call and drained in a much later one. A recorder that did
    // not survive between calls would keep only the last batch, and a test that
    // fed the whole stream at once could not see it.
    const stream = ticks(1_800);
    const batched = new HistoryService(new InMemoryCandleHistory(), ASSET_CATALOGUE);
    const wholesale = new HistoryService(new InMemoryCandleHistory(), ASSET_CATALOGUE);
    for (let i = 0; i < stream.length; i += 7) batched.observe(FIRST, stream.slice(i, i + 7));
    wholesale.observe(FIRST, stream);
    await batched.flush();
    await wholesale.flush();

    const window = [epochMillis(0), epochMillis(ORIGIN + 1e9)] as const;
    const fromBatches = await batched.read(FIRST, '1m', ...window);
    expect(fromBatches).toEqual(await wholesale.read(FIRST, '1m', ...window));
    expect(fromBatches.length).toBeGreaterThan(170);
  });

  it('gives each asset its own recorder, interleaved', async () => {
    // Two markets publish alternately, which is what a venue with more than one
    // asset does on every scheduler tick. A single shared recorder would splice
    // their prices into one series and `assertTickOrder` would not necessarily
    // notice, because both are ordered.
    const service = new HistoryService(new InMemoryCandleHistory(), ASSET_CATALOGUE);
    const stream = ticks(1_800);
    for (let i = 0; i < stream.length; i += 7) {
      const batch = stream.slice(i, i + 7);
      service.observe(FIRST, batch);
      service.observe(SLOW, batch);
    }
    await service.flush();
    const window = [epochMillis(0), epochMillis(ORIGIN + 1e9)] as const;
    const eurusd = await service.read(FIRST, '1m', ...window);
    const spx = await service.read(SLOW, '1m', ...window);
    expect(eurusd.length).toBeGreaterThan(170);
    expect(spx).toEqual(eurusd);
  });

  it('keeps assets apart', async () => {
    const service = new HistoryService(new InMemoryCandleHistory(), ASSET_CATALOGUE);
    service.observe(FIRST, ticks(1_800));
    await service.flush();
    expect(await service.read(SLOW, '1m', epochMillis(0), epochMillis(ORIGIN + 1e9))).toEqual([]);
  });
});

describe('provisioning a market that has no past', () => {
  const keyring = MasterKeyring.forTesting('admin-surface');
  const asset = SLOW_ASSET;

  it('does nothing when no days are asked for', async () => {
    const store = new MemoryStateStore();
    const service = new HistoryService(new InMemoryCandleHistory(), [asset]);
    expect(
      await service.provision({
        store,
        keyring,
        environment: 'test',
        days: 0,
        clock: new FixedClock(epochMillis(ORIGIN)),
      }),
    ).toEqual([]);
    expect(await store.load(SLOW)).toBeNull();
  });

  it('gives an asset with no record a past, and leaves one that has a record alone', async () => {
    const store = new MemoryStateStore();
    const service = new HistoryService(new InMemoryCandleHistory(), [asset]);
    const options = {
      store,
      keyring,
      environment: 'test' as const,
      days: 0.25,
      clock: new FixedClock(epochMillis(ORIGIN)),
    };
    expect(await service.provision(options)).toEqual([SLOW]);
    expect(await store.load(SLOW)).not.toBeNull();
    const bars = await service.read(SLOW, '1h', epochMillis(0), epochMillis(ORIGIN + 1));
    expect(bars.length).toBeGreaterThanOrEqual(5);

    // A restart is the ordinary case and it is not an error for a market to
    // have been provisioned already. Refusing here would make every restart
    // fail; provisioning again would be a second history under one id.
    expect(await service.provision(options)).toEqual([]);
  }, 60_000);
});

describe('what an operator may edit, and what the surface refuses', () => {
  /** A controller wired to a registry that records what it was asked to store. */
  function editable(): {
    controller: MarketController;
    written: { id: string; patch: unknown }[];
  } {
    const written: { id: string; patch: unknown }[] = [];
    const registry = {
      list: () => Promise.resolve([]),
      overlays: () => Promise.resolve(new Map<string, never>()),
      putOverlay: (id: string, patch: unknown) => {
        written.push({ id, patch });
        return Promise.resolve();
      },
      add: () => Promise.resolve(),
    };
    return {
      controller: new MarketController(venueStub([FIRST]), null, null, registry),
      written,
    };
  }

  it('renames, and stores only the name', async () => {
    const { controller, written } = editable();
    expect(await controller.editAsset(FIRST, { displayName: 'Euro / Dollar' })).toEqual({
      id: FIRST,
      displayName: 'Euro / Dollar',
    });
    expect(written).toEqual([{ id: FIRST, patch: { displayName: 'Euro / Dollar' } }]);
  });

  it('refuses every field that decided what already happened, by name', async () => {
    for (const [field, value] of [
      ['id', 'other'],
      ['logQuantum', 1e-6],
      ['referencePrice', 2],
      ['displayPrecision', 2],
      ['traits', {}],
      ['family', 'forex'],
    ] as const) {
      const { controller, written } = editable();
      await expect(controller.editAsset(FIRST, { [field]: value }), field).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // Nothing was written. A refusal that half-applied would be worse than a
      // silent success, because the record and the catalogue would disagree.
      expect(written, field).toEqual([]);
    }
  });

  it('sends an operator to the retire endpoint rather than accepting retiredAt', async () => {
    const { controller } = editable();
    // Retiring has consequences for a running market — a final checkpoint, a
    // market removed from the venue — and a PATCH that only wrote the overlay
    // would leave the market publishing until the next restart.
    await expect(controller.editAsset(FIRST, { retiredAt: 1 })).rejects.toThrow(
      /POST \/assets\/:id\/retire/,
    );
  });

  it('refuses an edit with nothing in it, saying what is editable', async () => {
    const { controller } = editable();
    await expect(controller.editAsset(FIRST, {})).rejects.toThrow(/displayName/);
  });

  it('refuses an unknown asset before it refuses the body', async () => {
    const { controller } = editable();
    await expect(controller.editAsset('nope', { displayName: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('the write surface needs the operator token (a6-01)', () => {
  const token = 'operator-token-'.padEnd(32, 'k');
  const guard = new AdminWriteGuard(token);

  it('lets every read through without a credential', () => {
    // The market is public (INV-002): there is nothing origin- or
    // identity-specific in a read to protect.
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(guard.check(method, undefined, undefined), method).toBe(true);
    }
  });

  it('refuses every write when the engine has no token, naming the variable', () => {
    const closed = new AdminWriteGuard(null);
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
      expect(() => closed.check(method, `Bearer ${token}`, 'application/json'), method).toThrow(
        ForbiddenException,
      );
      expect(() => closed.check(method, `Bearer ${token}`, 'application/json'), method).toThrow(
        /OTC_ADMIN_TOKEN/,
      );
    }
  });

  it('refuses a write without the bearer, with the wrong one, and with another scheme', () => {
    for (const header of [
      undefined,
      '',
      'Bearer',
      'Bearer wrong-token-of-the-right-length',
      `Bearer ${token}x`,
      `Bearer ${token.slice(0, -1)}`,
      `Basic ${token}`,
      token,
    ]) {
      expect(() => guard.check('POST', header, 'application/json'), String(header)).toThrow(
        ForbiddenException,
      );
    }
  });

  it('refuses a write that is not JSON, after the credential', () => {
    // 415 for the shape only once the caller has proved who they are: a
    // caller without the credential learns nothing about a well-formed write.
    for (const contentType of [undefined, 'text/plain', 'application/x-www-form-urlencoded']) {
      expect(
        () => guard.check('POST', `Bearer ${token}`, contentType),
        String(contentType),
      ).toThrow(UnsupportedMediaTypeException);
    }
    expect(() => guard.check('POST', undefined, 'text/plain')).toThrow(ForbiddenException);
  });

  it('admits a write with the bearer and a JSON body', () => {
    expect(guard.check('POST', `Bearer ${token}`, 'application/json')).toBe(true);
    expect(guard.check('PATCH', `bearer ${token}`, 'application/json; charset=utf-8')).toBe(true);
    expect(guard.check('post', `Bearer  ${token}`, 'Application/JSON')).toBe(true);
  });

  it('reads the request Nest hands it', () => {
    const request = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    } as unknown as Request;
    const context = { switchToHttp: () => ({ getRequest: () => request }) };
    expect(guard.canActivate(context as never)).toBe(true);
  });

  it('compares on a digest, so a token of another length is simply wrong', () => {
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true);
    expect(bearerMatches('Bearer x', token)).toBe(false);
    expect(bearerMatches(`Bearer ${'a'.repeat(1_000)}`, token)).toBe(false);
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/jsonx')).toBe(false);
    expect(isJsonContentType(['application/json'])).toBe(false);
  });

  it('boots without a token, and refuses to boot with one too short to be one', () => {
    expect(adminTokenFromEnvironment({})).toBeNull();
    expect(adminTokenFromEnvironment({ OTC_ADMIN_TOKEN: '' })).toBeNull();
    expect(() => adminTokenFromEnvironment({ OTC_ADMIN_TOKEN: 'short' })).toThrow(
      new RegExp(`OTC_ADMIN_TOKEN is 5 characters; it must be at least ${MIN_ADMIN_TOKEN_LENGTH}`),
    );
    const exact = 't'.repeat(MIN_ADMIN_TOKEN_LENGTH);
    expect(adminTokenFromEnvironment({ OTC_ADMIN_TOKEN: exact })).toBe(exact);
  });
});

describe('twenty concurrent renames are all stored, in order, with no 500 (a6-02)', () => {
  const directories: string[] = [];
  afterAll(async () => {
    for (const directory of directories) await rm(directory, { recursive: true, force: true });
  });

  it('leaves the catalogue this process serves equal to the one the next boot will read', async () => {
    // The audit measured 4 of 20 concurrent `PATCH`es succeeding, the rest
    // `ENOENT` on a shared temporary file, and three assets whose in-memory
    // name differed from the stored one. The registry serialises its overlay
    // edits now; this is the controller's half — apply the in-memory rename
    // only after the write it belongs to has resolved, so both sides land in
    // the same order.
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-rename-race-'));
    directories.push(directory);
    const registry = new FileAssetRegistry(directory, new FixedClock(epochMillis(ORIGIN)));
    const inMemory = new Map<string, string>();
    const venue = {
      ...venueStub([FIRST, SECOND, FOURTH, SLOW]),
      rename: (id: string, displayName: string) => {
        inMemory.set(id, displayName);
      },
    } as unknown as VenueService;
    const controller = new MarketController(venue, null, null, registry);

    const ids = [FIRST, SECOND, FOURTH, SLOW];
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        controller.editAsset(ids[i % ids.length]!, { displayName: `name-${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);

    const stored = await registry.overlays();
    for (const id of ids) {
      expect(stored.get(id)?.displayName, id).toMatch(/^name-\d+$/);
      // The name this process serves is the name the next boot will read.
      expect(inMemory.get(id), `${id}: in-memory vs stored`).toBe(stored.get(id)?.displayName);
    }
  });
});

describe('the stream refuses what the feed refuses, with a status (a6-04)', () => {
  /** A venue whose feed is real, so the controller meets the feed's own errors. */
  function streaming(): { controller: MarketController; feed: TickFeed } {
    const feed = new TickFeed({ retainTicks: 5 });
    feed.publish(FIRST, ticks(10));
    const venue = { ...venueStub([FIRST]), feed } as unknown as VenueService;
    return { controller: new MarketController(venue), feed };
  }
  const untouched = (): Response =>
    ({
      writeHead: () => {
        throw new Error('headers must not be written for a refused subscription');
      },
      write: () => true,
      end: () => undefined,
      on: () => undefined,
    }) as unknown as Response;
  const request = (headers: Record<string, string> = {}): Request => ({ headers }) as Request;

  it("answers a sequence in the future with a 400 carrying the feed's message", () => {
    // A browser's `EventSource` closes for good on any non-200 and cannot see
    // which; a 500 here was an internal error for a request the feed already
    // refuses in words, and a way to fill the log with stack traces.
    const { controller } = streaming();
    expect(() => controller.stream(FIRST, untouched(), request(), '99999')).toThrow(
      BadRequestException,
    );
    expect(() => controller.stream(FIRST, untouched(), request(), '99999')).toThrow(
      /never been published/,
    );
    // And the same request written the way a browser resumes it.
    expect(() =>
      controller.stream(FIRST, untouched(), request({ 'last-event-id': '99999' })),
    ).toThrow(BadRequestException);
  });

  it('still answers an evicted sequence with a 400 (CA6-31)', () => {
    const { controller } = streaming();
    expect(() => controller.stream(FIRST, untouched(), request(), '1')).toThrow(
      BadRequestException,
    );
  });

  /** A response that records what was written, and the status it was given. */
  function recording(clientIsFull = false): {
    res: Response;
    status: () => number;
    body: () => string;
    ended: () => boolean;
    drain: () => void;
  } {
    let status = 0;
    let ended = false;
    const chunks: string[] = [];
    const pending: (() => void)[] = [];
    const res = {
      writeHead: (code: number) => {
        status = code;
        return res;
      },
      write: (chunk: string) => {
        chunks.push(chunk);
        // A socket that is full from its first byte: the case the replay path
        // ignored entirely (CA7-04).
        return !clientIsFull;
      },
      end: () => {
        ended = true;
      },
      // A real `ServerResponse` reports this, and the code under test reads it
      // before ending a connection that may already be finished (a3).
      get writableEnded() {
        return ended;
      },
      on: () => undefined,
      once: (event: string, handler: () => void) => {
        // A socket that drains immediately unless the test says it is full;
        // when it is, the handlers are kept so the test can drain it later and
        // check that the charge is actually released.
        if (event === 'drain' && !clientIsFull) handler();
        else pending.push(handler);
        return res;
      },
      get writableNeedDrain() {
        return clientIsFull && chunks.length > 0;
      },
      get writableLength() {
        // Undrained bytes: everything written, when the client cannot read.
        return clientIsFull ? chunks.join('').length : 0;
      },
    } as unknown as Response;
    return {
      res,
      status: () => status,
      body: () => chunks.join(''),
      ended: () => ended,
      /** Let the socket catch up, so a test can check the charge is released. */
      drain: () => {
        for (const handler of pending.splice(0)) handler();
      },
    };
  }

  it('tells a client about the gap instead of refusing it, when asked to (onGap=live)', () => {
    // A refused resume used to cost the panel a whole bucket: the client fell
    // back to drawing no live bar, so the price line moved while the newest
    // candle stood still — for up to an hour on the default one-hour chart.
    // Reported 2026-09-02 and reproduced by hosted CI as five 400s on `?from=`.
    //
    // The refusal was right and the fallback was not. The feed keeps a bounded
    // window and a restart empties it, so the sequence after the newest *stored*
    // candle is routinely older than anything the feed still has — through no
    // fault of the client. `onGap=live` gets the live edge **and an explicit
    // `gap` event**, which is what separates this from a silent jump forward:
    // a gap a client is told about is not one it mistakes for the market.
    const { controller, feed } = streaming();
    const evicted = recording();
    controller.stream(FIRST, evicted.res, request(), '1', 'live');
    expect(evicted.status()).toBe(200);
    expect(evicted.body()).toMatch(/^event: gap\ndata: /);
    expect(JSON.parse(/^event: gap\ndata: (.*)\n\n/.exec(evicted.body())![1]!)).toMatchObject({
      requested: 1,
      resumesAt: 6,
    });
    // **PH-25.1.** After the gap, everything the feed still holds — from the
    // oldest sequence it retains, not the live edge. The first served-record
    // run found the venue joining an observer at the live edge, nine ticks
    // past a window start it had retained and never served. The frame names
    // where the record picks up, and the ticks follow the gap, in order.
    const replayed = [...evicted.body().matchAll(/\nid: (\d+)\ndata: /g)].map((m) => Number(m[1]));
    expect(replayed).toEqual([6, 7, 8, 9, 10]);
    expect(evicted.body().indexOf('event: gap')).toBeLessThan(evicted.body().indexOf('id: 6'));
    // And it is a live subscription, not a consolation prize.
    feed.publish(FIRST, [
      { sequence: 11, instant: epochMillis(ORIGIN + 66_000), price: logPrice(1_003) },
    ]);
    expect(evicted.body()).toMatch(/\nid: 11\ndata: /);

    // A sequence that was never published is the same kind of unanswerable.
    const future = recording();
    controller.stream(FIRST, future.res, request(), '99999', 'live');
    expect(future.status()).toBe(200);
    expect(future.body()).toMatch(/event: gap/);
    // Nothing to replay for a sequence that never existed: the live edge, and
    // the frame says it names no resumption.
    expect(JSON.parse(/event: gap\ndata: (.*)\n\n/.exec(future.body())![1]!)).toMatchObject({
      resumesAt: null,
    });
    expect(future.body()).not.toMatch(/\nid: \d+\ndata: /);
  });

  it('carries several assets on one connection, each with its own position (PH-22.2)', () => {
    // The optimisation is easy and the contract is the hard part. SSE has one
    // `Last-Event-ID` per connection; eight assets have eight positions, and
    // the moment one number stands for eight, a reconnect either replays or
    // skips — and a gap served in silence is indistinguishable from the market.
    const feed = new TickFeed({ retainTicks: 50 });
    feed.publish(FIRST, ticks(6));
    feed.publish(THIRD, ticks(4));
    const venue = { ...venueStub([FIRST, THIRD]), feed } as unknown as VenueService;
    const controller = new MarketController(venue);

    const out = recording();
    controller.multiplexed(out.res, request(), `${FIRST},${THIRD}`);
    expect(out.status()).toBe(200);

    // Every event names its asset, so a client demultiplexes what it parses.
    feed.publish(FIRST, [
      { sequence: 7, instant: epochMillis(ORIGIN + 42_000), price: logPrice(1_001) },
    ]);
    feed.publish(THIRD, [
      { sequence: 5, instant: epochMillis(ORIGIN + 43_000), price: logPrice(1_002) },
    ]);
    const frames = out
      .body()
      .split('\n\n')
      .filter((entry) => entry.length > 0);
    const named = frames.map((frame) => {
      const data = /data: (.*)$/m.exec(frame)?.[1] ?? '{}';
      return JSON.parse(data) as { asset?: string; sequence?: number };
    });
    expect(named.some((entry) => entry.asset === FIRST && entry.sequence === 7)).toBe(true);
    expect(named.some((entry) => entry.asset === THIRD && entry.sequence === 5)).toBe(true);

    // And the id carries the whole stream's position, per asset.
    const lastId = [...out.body().matchAll(/^id: (.*)$/gm)].pop()?.[1] ?? '';
    expect(lastId).toContain(`${FIRST}:7`);
    expect(lastId).toContain(`${THIRD}:5`);
  });

  it('resumes each asset at its own sequence, exactly (PH-22.2)', () => {
    const feed = new TickFeed({ retainTicks: 50 });
    feed.publish(FIRST, ticks(6));
    feed.publish(THIRD, ticks(4));
    const venue = { ...venueStub([FIRST, THIRD]), feed } as unknown as VenueService;
    const controller = new MarketController(venue);

    const out = recording();
    controller.multiplexed(out.res, request(), `${FIRST},${THIRD}`, `${FIRST}:5,${THIRD}:3`);
    const delivered = [...out.body().matchAll(/data: (.*)$/gm)]
      .map((match) => JSON.parse(match[1]!) as { asset: string; sequence: number })
      .filter((entry) => entry.sequence !== undefined);
    expect(delivered.filter((e) => e.asset === FIRST).map((e) => e.sequence)).toEqual([5, 6]);
    expect(delivered.filter((e) => e.asset === THIRD).map((e) => e.sequence)).toEqual([3, 4]);
  });

  it('resumes a browser reconnect after the last event it was given, not on it (a3)', () => {
    // **Cycle Audit 8 (a3).** `?from=` is "the next sequence I want"; the
    // `Last-Event-ID` header is "the last one you gave me". This endpoint read
    // both as the first, so every automatic `EventSource` reconnect redelivered
    // one tick per asset — a duplicate the client cannot tell from the market,
    // the mirror image of CA6-32's silent skip. The single-asset endpoint has
    // always distinguished them.
    const feed = new TickFeed({ retainTicks: 50 });
    feed.publish(FIRST, ticks(6));
    feed.publish(THIRD, ticks(4));
    const venue = { ...venueStub([FIRST, THIRD]), feed } as unknown as VenueService;
    const controller = new MarketController(venue);

    const sequences = (body: string, asset: string): number[] =>
      [...body.matchAll(/data: (.*)$/gm)]
        .map((match) => JSON.parse(match[1]!) as { asset: string; sequence?: number })
        .filter((entry) => entry.asset === asset && entry.sequence !== undefined)
        .map((entry) => entry.sequence!);

    // The header names what was already delivered: the next tick is 6 and 4.
    const resumed = recording();
    controller.multiplexed(
      resumed.res,
      request({ 'last-event-id': `${FIRST}:5,${THIRD}:3` }),
      `${FIRST},${THIRD}`,
    );
    expect(sequences(resumed.body(), FIRST), `${FIRST}:5 was delivered twice`).toEqual([6]);
    expect(sequences(resumed.body(), THIRD), `${THIRD}:3 was delivered twice`).toEqual([4]);

    // And `?from=` keeps its inclusive meaning, which the harnesses rely on.
    const asked = recording();
    controller.multiplexed(asked.res, request(), `${FIRST},${THIRD}`, `${FIRST}:5,${THIRD}:3`);
    expect(sequences(asked.body(), FIRST)).toEqual([5, 6]);
    expect(sequences(asked.body(), THIRD)).toEqual([3, 4]);

    // An explicit `from` wins over a stale header, and is still inclusive.
    const both = recording();
    controller.multiplexed(
      both.res,
      request({ 'last-event-id': `${FIRST}:1,${THIRD}:1` }),
      `${FIRST},${THIRD}`,
      `${FIRST}:6,${THIRD}:4`,
    );
    expect(sequences(both.body(), FIRST)).toEqual([6]);
    expect(sequences(both.body(), THIRD)).toEqual([4]);
  });

  it('gaps one asset without tearing down the other seven (PH-22.2)', () => {
    // One asset's eviction is one asset's problem. A stream that closed for all
    // of them would make an eviction on a quiet market look like an outage on a
    // busy one.
    const feed = new TickFeed({ retainTicks: 3 });
    feed.publish(FIRST, ticks(10));
    feed.publish(THIRD, ticks(4));
    const venue = { ...venueStub([FIRST, THIRD]), feed } as unknown as VenueService;
    const controller = new MarketController(venue);

    const out = recording();
    controller.multiplexed(
      out.res,
      request(),
      `${FIRST},${THIRD}`,
      `${FIRST}:1,${THIRD}:2`,
      'live',
    );
    expect(out.status()).toBe(200);
    const gap = /event: gap\ndata: (.*)/.exec(out.body())?.[1];
    expect(gap, 'no gap event').toBeDefined();
    expect(JSON.parse(gap!)).toMatchObject({ asset: FIRST, requested: 1, resumesAt: 8 });
    // The first asset's retained window follows its gap (PH-25.1) — follows,
    // in order: the gap frame is written before the replay it explains. Cycle
    // Audit 9 (a4-04) found PH-25.1 claiming this order "watched failing" on
    // the multiplexed stream when only the single-market stream's plant had
    // been run; this is the multiplexed plant's guard.
    const firstReplay = out.body().indexOf(`"asset":"${FIRST}","sequence":8`);
    expect(firstReplay).toBeGreaterThan(-1);
    expect(out.body().indexOf('event: gap')).toBeLessThan(firstReplay);
    // The third asset was servable and was served.
    expect(out.body()).toMatch(new RegExp(`"asset":"${THIRD}","sequence":2`));
  });

  it('multiplexed: past the replay budget a resume is told a gap and joined at the live edge, not replayed (CA9 a4-03)', () => {
    // The single-market stream's budget check has a guard above; the
    // multiplexed stream's had none — deleting it left every test green. A
    // budget of one byte: the first resume that holds bytes fills it, and the
    // next multiplexed resume must be joined at the live edge with a gap that
    // names no resumption, never handed the retained window.
    const feed = new TickFeed({ retainTicks: 50 });
    feed.publish(FIRST, ticks(20));
    const venue = { ...venueStub([FIRST]), feed } as unknown as VenueService;
    const controller = new MarketController(venue, null, null, null, null, 1);
    const stalled = recording(true);
    controller.stream(FIRST, stalled.res, request(), '5', 'live');
    expect(replayBudgetUsed()).toBeGreaterThan(0);

    const told = recording();
    controller.multiplexed(told.res, request(), FIRST, `${FIRST}:5`, 'live');
    expect(told.status()).toBe(200);
    const gap = /event: gap\ndata: (.*)/.exec(told.body())?.[1];
    expect(gap, 'no gap event').toBeDefined();
    expect(JSON.parse(gap!)).toMatchObject({ asset: FIRST, requested: 5, resumesAt: null });
    expect(told.body()).not.toMatch(/"sequence":5\b/);
    expect(told.body()).not.toMatch(/"sequence":19\b/);
    // And refused outright without the policy.
    expect(() => controller.multiplexed(untouched(), request(), FIRST, `${FIRST}:5`)).toThrow(
      BadRequestException,
    );
  });

  it('refuses a from that names an asset the stream does not carry (PH-22.2)', () => {
    const { feed } = streaming();
    const venue = { ...venueStub([FIRST, THIRD]), feed } as unknown as VenueService;
    const controller = new MarketController(venue);
    expect(() => controller.multiplexed(untouched(), request(), FIRST, `${THIRD}:3`)).toThrow(
      /does not carry/,
    );
    expect(() => controller.multiplexed(untouched(), request(), FIRST, `${FIRST}:x`)).toThrow(
      /asset:sequence/,
    );
    expect(() => controller.multiplexed(untouched(), request(), '')).toThrow(/at least one asset/);
    expect(() => controller.multiplexed(untouched(), request(), `${FIRST},${FIRST}`)).toThrow(
      /more than once/,
    );
    // **Cycle Audit 8 (a3).** The cap was the only bound between one GET and a
    // subscription to the whole catalogue, and nothing asserted it: deleting the
    // check left every test green, so a hundred-asset venue would have answered
    // one request with a hundred fan-out targets on one socket, and N requests
    // with 100N.
    const overCap = Array.from({ length: MAX_MULTIPLEXED_ASSETS + 1 }, (_, i) => `a${i}`);
    expect(() => controller.multiplexed(untouched(), request(), overCap.join(','))).toThrow(
      /the most one stream may carry is 32/,
    );
    // And the cap itself is servable: one under it is refused for the asset
    // being unknown, not for the length.
    expect(() =>
      controller.multiplexed(untouched(), request(), overCap.slice(1).join(',')),
    ).toThrow(/Unknown asset/);
  });

  it('ends a multiplexed response on shutdown, not only its close frames (a3)', async () => {
    // `beforeApplicationShutdown` promises each client "an `event: close` naming
    // the reason and then the end of its response". The single-asset sink ends
    // the response; the multiplexed sink deliberately does not, because one
    // asset closing is not the connection closing — and nothing ended it at the
    // connection level either. So a multiplexed client was left holding close
    // frames on a response that stayed open, and what actually terminated it was
    // `forceCloseConnections` in `main.ts` destroying the socket, which from the
    // client's side is the network failing rather than the server leaving.
    // `restart.stat.test.ts` watches the promise on the single-asset endpoint
    // only, which is why this went unseen.
    const feed = new TickFeed({ retainTicks: 50 });
    feed.publish(FIRST, ticks(6));
    feed.publish(THIRD, ticks(4));
    const venue = { ...venueStub([FIRST, THIRD]), feed } as unknown as VenueService;
    const controller = new MarketController(venue);

    const many = recording();
    controller.multiplexed(many.res, request(), `${FIRST},${THIRD}`);
    const one = recording();
    controller.stream(FIRST, one.res, request());
    expect(many.ended(), 'ended before the shutdown').toBe(false);

    await controller.beforeApplicationShutdown();

    for (const asset of [FIRST, THIRD]) {
      expect(many.body(), `${asset} was not told why`).toContain(
        `event: close\ndata: ${JSON.stringify({ asset, reason: 'server shutting down' })}`,
      );
    }
    expect(many.ended(), 'the multiplexed response was never ended').toBe(true);
    expect(one.ended(), 'the single-asset response was never ended').toBe(true);
  });

  it('charges undrained socket bytes to the process, and releases them (PH-22.3)', () => {
    // **The first version of this counted the wrong thing**, and this test is
    // what said so. It counted bytes buffered *before* the response headers —
    // but the handler is synchronous, so only one connection is ever in that
    // state and the counter was always zero when the next one looked.
    //
    // The 1,470 MB PH-22.3 measured was never there. It was in the write
    // buffers of two thousand sockets that could not drain as fast as a replay
    // filled them, which Node exposes as `writableLength`.
    const { controller } = streaming();
    const startedAt = replayBudgetUsed();

    // A client that drains: nothing owed.
    const fast = recording();
    controller.stream(FIRST, fast.res, request(), '10');
    expect(replayBudgetUsed(), 'a draining client owes nothing').toBe(startedAt);

    // A client that cannot read: its undrained bytes are charged, then released
    // when the connection closes.
    const slow = recording(true);
    controller.stream(FIRST, slow.res, request(), '10');
    expect(replayBudgetUsed(), 'a stalled client owes its buffer').toBeGreaterThan(startedAt);

    // And it stops owing when the socket catches up. A budget that is charged
    // and never released is worse than no budget: it would refuse every resume
    // for the life of the process after one busy minute.
    slow.drain();
    expect(replayBudgetUsed(), 'the charge outlived the drain').toBe(startedAt);
  });

  it('serves the live edge with a gap when the process is out of replay budget (PH-22.3)', () => {
    // Past the ceiling a resume is treated exactly like an eviction, because
    // from the client's side it is one: the ticks it asked for are not coming.
    // Told, it can refetch. Silently jumped forward, it cannot tell the
    // difference from a quiet market (INV-002).
    const feed = new TickFeed({ retainTicks: 50 });
    feed.publish(FIRST, ticks(20));
    const venue = { ...venueStub([FIRST]), feed } as unknown as VenueService;
    const controller = new MarketController(venue, null, null, null, null, 1);

    // Fill the budget with one client that cannot read.
    const stalled = recording(true);
    controller.stream(FIRST, stalled.res, request(), '5', 'live');
    expect(replayBudgetUsed()).toBeGreaterThan(0);

    // The live edge still works: no resume, no budget needed.
    const live = recording();
    controller.stream(FIRST, live.res, request());
    expect(live.status()).toBe(200);
    expect(live.body()).not.toMatch(/event: gap/);

    // A resume past the ceiling is refused without a gap policy...
    expect(() => controller.stream(FIRST, untouched(), request(), '5')).toThrow(
      BadRequestException,
    );
    // ...and served at the live edge, with a gap, when asked to be told.
    const told = recording();
    controller.stream(FIRST, told.res, request(), '5', 'live');
    expect(told.status()).toBe(200);
    expect(told.body()).toMatch(/event: gap/);
    expect(told.body()).not.toMatch(/"sequence":5/);
  });

  it('refuses a gap policy it does not have, by name', () => {
    // A mistyped policy that fell through to "refuse" would be a client
    // believing it had asked to be told, and finding out as a dead stream.
    const { controller } = streaming();
    expect(() => controller.stream(FIRST, untouched(), request(), '1', 'lives')).toThrow(
      /onGap must be 'live'/,
    );
  });

  it('refuses a from that is not a whole number, by name (CA6 fix, CA7-18 guard)', () => {
    // The Cycle Audit 6 fix — `!/^\d+$/.test(from)` — had no test anywhere.
    // Reverting it left 2,203 tests green, and `1e3` in particular parses to 1
    // and asks for a sequence long since evicted, which used to produce a
    // silent empty stream.
    const { controller } = streaming();
    for (const bad of ['1.9', '12abc', '1e3', '0x2', ' 3', '+3', '-1', '']) {
      expect(() => controller.stream(FIRST, untouched(), request(), bad), bad).toThrow(
        /from must be a non-negative integer/,
      );
    }
    // And the honest forms still pass through.
    const served = recording();
    controller.stream(FIRST, served.res, request(), '10');
    expect(served.status()).toBe(200);
  });

  it('stops replaying at a client that cannot keep up, and says so (CA7-04)', () => {
    // Measured by an auditor against a socket full from its first byte: 50,000
    // frames and 3.46 MiB accumulated in this process's heap, the handler
    // blocked 143 ms, and the subscription was neither cancelled nor ended.
    // `deliver` returned `!headersSent || ...`, so during replay — the single
    // largest write this endpoint ever makes — backpressure was ignored.
    const feed = new TickFeed({ retainTicks: 100_000 });
    feed.publish(FIRST, ticks(40_000));
    const venue = { ...venueStub([FIRST]), feed } as unknown as VenueService;
    const controller = new MarketController(venue);

    const full = recording(true);
    controller.stream(FIRST, full.res, request(), '1');

    expect(full.status()).toBe(200);
    // Far short of the 40,000 the window holds, and short of the byte bound.
    expect(full.body().length).toBeLessThan(2_000_000);
    expect(full.body()).toMatch(/event: close/);
    expect(full.body()).toMatch(/fell behind during replay/);
    expect(full.ended()).toBe(true);
  });

  it('leaves a resume the feed can serve exactly alone, gap policy or not', () => {
    const { controller } = streaming();
    const served = recording();
    controller.stream(FIRST, served.res, request(), '10', 'live');
    expect(served.status()).toBe(200);
    expect(served.body()).not.toMatch(/event: gap/);
    expect(served.body()).toMatch(/^id: 10\ndata: /);
  });
});

describe('what the brief parser refuses by name (a6-07, a6-08)', () => {
  /** A controller whose registration service records what it was handed. */
  function creating(): { controller: MarketController; submitted: unknown[] } {
    const submitted: unknown[] = [];
    const registration = {
      submit: (brief: unknown) => {
        submitted.push(brief);
        return { id: 'job-1', state: 'queued' };
      },
    };
    return {
      controller: new MarketController(venueStub([]), null, registration as never, null),
      submitted,
    };
  }
  const brief = {
    id: 'newmetal',
    archetypeId: 'metal',
    displayName: 'New Metal',
    referencePrice: 1,
  };

  it('refuses an unknown field by name rather than ignoring it', () => {
    // A brief that quietly accepted `drift` would be INV-006 broken by an
    // administrative form; the closed set is enforced by refusing, not by
    // reading only what is known.
    const { controller, submitted } = creating();
    for (const field of ['drift', 'target', 'direction']) {
      expect(() => controller.createAsset({ ...brief, [field]: 1 }), field).toThrow(
        new RegExp(`Unknown field "${field}"`),
      );
    }
    expect(submitted).toEqual([]);
  });

  it('refuses null for an optional number rather than reading it as "not supplied"', () => {
    const { controller } = creating();
    expect(() => controller.createAsset({ ...brief, dispersion: null })).toThrow(/dispersion/);
    expect(() => controller.createAsset({ ...brief, dispersion: null })).toThrow(/null/);
    expect(() => controller.createAsset({ ...brief, displayPrecision: null })).toThrow(
      /displayPrecision/,
    );
  });

  it('answers a malformed id with 400 and a duplicate with 409', () => {
    const { controller } = creating();
    expect(() => controller.createAsset({ ...brief, id: 'X-BAD' })).toThrow(BadRequestException);
    expect(() =>
      controller.createAsset({ ...brief, id: 'a'.repeat(MAX_ASSET_ID_LENGTH + 1) }),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.createAsset({ ...brief, id: 'a'.repeat(MAX_ASSET_ID_LENGTH + 1) }),
    ).toThrow(new RegExp(`maximum is ${MAX_ASSET_ID_LENGTH}`));
    expect(() => controller.createAsset({ ...brief, id: FIRST })).toThrow(ConflictException);
    expect(() => controller.createAsset({ ...brief, id: FIRST })).toThrow(/already registered/);
  });

  it('trims and bounds the display name here too', () => {
    const { controller, submitted } = creating();
    expect(() =>
      controller.createAsset({ ...brief, displayName: 'n'.repeat(MAX_DISPLAY_NAME_LENGTH + 1) }),
    ).toThrow(new RegExp(`most a name may hold is ${MAX_DISPLAY_NAME_LENGTH}`));
    controller.createAsset({ ...brief, displayName: '  New Metal  ' });
    expect(submitted).toEqual([{ ...brief, displayName: 'New Metal' }]);
  });
});

describe('history instants are digits and nothing else (a6-12)', () => {
  it.each(['1788349926509abc', '1.9', '0x10', '1e12', ' 1', '+1'])('refuses %s', async (from) => {
    // `Number.parseInt` discarded the tail before the check ran, so the first
    // was accepted as an instant, `1.9` as 1 and `0x10` as 0 — the defect
    // Cycle Audit 6 corrected on the stream's `from` and left here.
    const controller = new MarketController(venueStub([FIRST]), await populated());
    await expect(controller.history_(FIRST, '1h', from, String(ORIGIN))).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.history_(FIRST, '1h', '0', from)).rejects.toThrow(BadRequestException);
  });
});

describe('a display name is a string of bounded length (a6-13)', () => {
  function editable(): { controller: MarketController; written: unknown[] } {
    const written: unknown[] = [];
    const registry = {
      list: () => Promise.resolve([]),
      overlays: () => Promise.resolve(new Map<string, never>()),
      putOverlay: (_id: string, patch: unknown) => {
        written.push(patch);
        return Promise.resolve();
      },
      add: () => Promise.resolve(),
    };
    return {
      controller: new MarketController(venueStub([FIRST]), null, null, registry),
      written,
    };
  }

  it('refuses a non-string with a message that names the field, not the stack', async () => {
    // The registry's own check assumed a string: `123` was answered with
    // "named.displayName.trim is not a function" and `null` with "Cannot read
    // properties of null".
    const { controller, written } = editable();
    await expect(controller.editAsset(FIRST, { displayName: 123 })).rejects.toThrow(
      /displayName must be a string, got number/,
    );
    await expect(controller.editAsset(FIRST, { displayName: null })).rejects.toThrow(
      /displayName must be a string, got null/,
    );
    await expect(controller.editAsset(FIRST, { displayName: '   ' })).rejects.toThrow(
      /must not be empty/,
    );
    expect(written).toEqual([]);
  });

  it('refuses a name longer than the bound, and stores a trimmed one', async () => {
    // A 100,000-character name was stored and rendered in every viewer's
    // sidebar.
    const { controller, written } = editable();
    await expect(
      controller.editAsset(FIRST, { displayName: 'n'.repeat(MAX_DISPLAY_NAME_LENGTH + 1) }),
    ).rejects.toThrow(BadRequestException);
    await controller.editAsset(FIRST, { displayName: '  Euro / Dollar  ' });
    expect(written).toEqual([{ displayName: 'Euro / Dollar' }]);
    await controller.editAsset(FIRST, { displayName: 'n'.repeat(MAX_DISPLAY_NAME_LENGTH) });
    expect(written).toHaveLength(2);
  });
});

describe('OTC_BACKFILL_DAYS is whole days with a ceiling (a6-15)', () => {
  it.each(['1e3', 'abc', '-1', '1.5', '2 x', '0x2', String(MAX_BACKFILL_DAYS + 1)])(
    'refuses %s by name',
    (raw) => {
      // `Number('1e3')` is a thousand-day, irreversible genesis from a typo.
      expect(() => backfillDaysFromEnvironment({ OTC_BACKFILL_DAYS: raw })).toThrow(
        /OTC_BACKFILL_DAYS/,
      );
    },
  );

  it('reads whole days, and nothing when unset', () => {
    expect(backfillDaysFromEnvironment({})).toBe(0);
    expect(backfillDaysFromEnvironment({ OTC_BACKFILL_DAYS: '' })).toBe(0);
    expect(backfillDaysFromEnvironment({ OTC_BACKFILL_DAYS: '2' })).toBe(2);
    expect(backfillDaysFromEnvironment({ OTC_BACKFILL_DAYS: ' 3 ' })).toBe(3);
    expect(backfillDaysFromEnvironment({ OTC_BACKFILL_DAYS: String(MAX_BACKFILL_DAYS) })).toBe(
      MAX_BACKFILL_DAYS,
    );
  });
});

describe('a stalled market is logged once per kind of failure (a6-05)', () => {
  it('writes one STALLED line while the lag keeps changing, and keeps the lag in health', async () => {
    // The dedup keyed on the message, and the message carries the seconds
    // behind, which grows every tick: five assets wrote five ERROR lines a
    // second for the life of the process, and the line that mattered — the
    // first — was buried.
    const asset = SLOW_ASSET;
    const clock: Clock & { current: EpochMillis } = {
      current: epochMillis(ORIGIN),
      now() {
        return this.current;
      },
    };
    // A production keyring, because the venue derives `production` streams and
    // a test keyring refuses to; the secret is public because this is a test.
    const venue = new VenueService(
      new MemoryStateStore(),
      MasterKeyring.fromSecret('a6-05', new Uint8Array(32).fill(5)),
      clock,
      [asset],
      3_600_000,
      new PublicationService([asset], 500, {}),
      null,
      epochMillis(ORIGIN),
      0,
    );
    await venue.start();
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      for (const lagMs of [20_000, 21_000, 22_000]) {
        clock.current = epochMillis(ORIGIN + lagMs);
        await venue.tick();
      }
      const stalledLines = errors.mock.calls.filter(([message]) =>
        String(message).includes('STALLED'),
      );
      expect(stalledLines).toHaveLength(1);
      expect(String(stalledLines[0]![0])).toContain('CatchUpTooLargeError');
      // The changing number lives in `/health`, where a monitor reads it.
      expect(venue.stalledMarkets).toEqual([
        { assetId: SLOW, reason: expect.stringMatching(/22s behind the clock/) as string },
      ]);
    } finally {
      errors.mockRestore();
      await venue.stop();
    }
  });
});

describe('a fresh HistoryService after a restart (a5-01)', () => {
  it('withholds the minute it began inside and stores the next whole one', async () => {
    // Ten ticks a minute. The first process stores minutes 0..99 and dies with
    // minute 100 open after three of its ticks; the second process sees the
    // other seven. A recorder that stored those seven as minute 100 would
    // label a partial bar whole — the a5-01 shape, measured at 13 of 15 ticks.
    const store = new InMemoryCandleHistory();
    const stream = ticks(1_800);
    const first = new HistoryService(store, ASSET_CATALOGUE);
    first.observe(FIRST, stream.slice(0, 1_003));
    await first.flush();

    const second = new HistoryService(store, ASSET_CATALOGUE);
    second.observe(FIRST, stream.slice(1_003));
    await second.flush();

    const window = [epochMillis(0), epochMillis(ORIGIN + 1e9)] as const;
    const bars = await second.read(FIRST, '1m', ...window);
    const minute = (index: number): EpochMillis => epochMillis(ORIGIN + index * 60_000);
    const opens = new Set(bars.map((bar) => bar.openInstant));
    expect(opens.has(minute(99)), 'the last whole minute before the restart').toBe(true);
    expect(opens.has(minute(100)), 'the restart minute is a hole, not a short bar').toBe(false);
    expect(opens.has(minute(101)), 'the first whole minute after the restart').toBe(true);

    // And the bars either side of the hole are exactly the bars an unbroken
    // process would have stored.
    const wholesale = new HistoryService(new InMemoryCandleHistory(), ASSET_CATALOGUE);
    wholesale.observe(FIRST, stream);
    await wholesale.flush();
    const reference = new Map(
      (await wholesale.read(FIRST, '1m', ...window)).map((bar) => [bar.openInstant, bar]),
    );
    for (const bar of bars)
      expect(bar, String(bar.openInstant)).toEqual(reference.get(bar.openInstant));
    expect(bars.length).toBe(reference.size - 1);
  });
});
