// Invariant evidence: INV-004 (timeframe observer independence), INV-001 (economic independence).
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { epochMillis, FixedClock, logPrice, MasterKeyring, type Tick } from '@otc/core';
import { ASSET_ARCHETYPES, ASSET_CATALOGUE, assetById } from '@otc/engine';
import { InMemoryCandleHistory, MemoryStateStore } from '@otc/runtime';
import { HistoryService } from './history.service.js';
import { MarketController } from './market.controller.js';
import type { VenueService } from './venue.service.js';

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

async function populated(assetId = 'eurusd'): Promise<HistoryService> {
  const service = new HistoryService(new InMemoryCandleHistory(), ASSET_CATALOGUE);
  service.observe(assetId, ticks(1_800));
  await service.flush();
  return service;
}

describe('health says whether the venue is publishing, not merely running', () => {
  it('is ok when every market is advancing', () => {
    expect(new MarketController(venueStub(['eurusd'])).health()).toEqual({
      status: 'ok',
      assets: 1,
      stalled: [],
    });
  });

  it('is degraded when a market has stopped, and says which and why', () => {
    // **Cycle Audit 6, CA6-33.** A market past its catch-up bound refuses every
    // later advance — `#lastAdvancedAt` only moves after the check — so it stops
    // for good. `Venue.advance()` drops the failure list and this service called
    // only that, so the venue reported `ok` while every chart froze.
    const stalled = [{ assetId: 'btcusd', reason: 'Market is 20s behind the clock' }];
    expect(new MarketController(venueStub(['eurusd', 'btcusd'], stalled)).health()).toEqual({
      status: 'degraded',
      assets: 2,
      stalled,
    });
  });
});

describe('the catalogue an operator picks from', () => {
  it('reports every asset with the evidence its registration produced', () => {
    const controller = new MarketController(venueStub(['eurusd', 'spx']));
    const rows = controller.catalogue() as {
      id: string;
      live: boolean;
      dispersion: { quarterlyLogSigma: number; quarterlyPercent: number };
      meanIntervalMs: number;
      tieRate: number;
    }[];
    expect(rows).toHaveLength(ASSET_CATALOGUE.length);
    for (const row of rows) {
      expect(row.dispersion.quarterlyLogSigma).toBeGreaterThan(0);
      expect(row.dispersion.quarterlyPercent).toBeGreaterThan(0);
      expect(row.meanIntervalMs).toBeGreaterThan(0);
      expect(row.tieRate).toBeGreaterThan(0);
    }
    // Registered and hosted are different questions, and an operator needs both.
    expect(rows.filter((row) => row.live).map((row) => row.id)).toEqual(['eurusd', 'spx']);
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
    const controller = new MarketController(venueStub(['eurusd']), await populated());
    const body = (await controller.history_('eurusd', '15m', window.from, window.to)) as {
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
    const controller = new MarketController(venueStub(['eurusd']), await populated());
    await expect(controller.history_('eurusd', '1s', window.from, window.to)).rejects.toThrow(
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
    const controller = new MarketController(venueStub(['eurusd']), await populated());
    await expect(controller.history_('eurusd', timeframe, from, to)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a window larger than one request may return', async () => {
    // Measured: a 90-day minute request is 20.5 MB of JSON and 1,496 ms of
    // blocked event loop, and sixty concurrent ones took the process from
    // 100 MB to 1.86 GB. No cap, no pagination, no auth.
    const controller = new MarketController(venueStub(['eurusd']), await populated());
    await expect(controller.history_('eurusd', '1m', '0', String(ORIGIN))).rejects.toThrow(
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
    const controller = new MarketController(venueStub(['eurusd']));
    await expect(controller.history_('eurusd', '1h', window.from, window.to)).rejects.toThrow(
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
    service.observe('eurusd', ticks(5, 6_000));
    await service.flush();
    const empty = await service.read('eurusd', '1m', epochMillis(0), epochMillis(ORIGIN + 1e9));
    expect(empty).toEqual([]);

    service.observe('eurusd', ticks(1_800).slice(5));
    await service.flush();
    const bars = await service.read('eurusd', '1m', epochMillis(0), epochMillis(ORIGIN + 1e9));
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
    for (let i = 0; i < stream.length; i += 7) batched.observe('eurusd', stream.slice(i, i + 7));
    wholesale.observe('eurusd', stream);
    await batched.flush();
    await wholesale.flush();

    const window = [epochMillis(0), epochMillis(ORIGIN + 1e9)] as const;
    const fromBatches = await batched.read('eurusd', '1m', ...window);
    expect(fromBatches).toEqual(await wholesale.read('eurusd', '1m', ...window));
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
      service.observe('eurusd', batch);
      service.observe('spx', batch);
    }
    await service.flush();
    const window = [epochMillis(0), epochMillis(ORIGIN + 1e9)] as const;
    const eurusd = await service.read('eurusd', '1m', ...window);
    const spx = await service.read('spx', '1m', ...window);
    expect(eurusd.length).toBeGreaterThan(170);
    expect(spx).toEqual(eurusd);
  });

  it('keeps assets apart', async () => {
    const service = new HistoryService(new InMemoryCandleHistory(), ASSET_CATALOGUE);
    service.observe('eurusd', ticks(1_800));
    await service.flush();
    expect(await service.read('spx', '1m', epochMillis(0), epochMillis(ORIGIN + 1e9))).toEqual([]);
  });
});

describe('provisioning a market that has no past', () => {
  const keyring = MasterKeyring.forTesting('admin-surface');
  const asset = assetById('spx');

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
    expect(await store.load('spx')).toBeNull();
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
    expect(await service.provision(options)).toEqual(['spx']);
    expect(await store.load('spx')).not.toBeNull();
    const bars = await service.read('spx', '1h', epochMillis(0), epochMillis(ORIGIN + 1));
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
      controller: new MarketController(venueStub(['eurusd']), null, null, registry),
      written,
    };
  }

  it('renames, and stores only the name', async () => {
    const { controller, written } = editable();
    expect(await controller.editAsset('eurusd', { displayName: 'Euro / Dollar' })).toEqual({
      id: 'eurusd',
      displayName: 'Euro / Dollar',
    });
    expect(written).toEqual([{ id: 'eurusd', patch: { displayName: 'Euro / Dollar' } }]);
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
      await expect(
        controller.editAsset('eurusd', { [field]: value }),
        field,
      ).rejects.toBeInstanceOf(BadRequestException);
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
    await expect(controller.editAsset('eurusd', { retiredAt: 1 })).rejects.toThrow(
      /POST \/assets\/:id\/retire/,
    );
  });

  it('refuses an edit with nothing in it, saying what is editable', async () => {
    const { controller } = editable();
    await expect(controller.editAsset('eurusd', {})).rejects.toThrow(/displayName/);
  });

  it('refuses an unknown asset before it refuses the body', async () => {
    const { controller } = editable();
    await expect(controller.editAsset('nope', { displayName: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
