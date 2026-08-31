// Invariant evidence: INV-002 (shared market), INV-008 (continuous market state).
import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  logPrice,
  MasterKeyring,
  SteppableClock,
  type Tick,
} from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine, type MarketEngine } from '@otc/engine';
import { CatchUpTooLargeError, DEFAULT_MAX_CATCH_UP_MS, HostedMarket } from './hosted.js';
import { Venue } from './venue.js';

const START = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('runtime-spec');

function engineFor(index = 0, maxTicks?: number): MarketEngine {
  const asset = ASSET_CATALOGUE[index]!;
  return createMarketEngine({
    config: configFor(asset),
    keyring,
    environment: 'test',
    start: { instant: START, price: logPrice(0) },
    ...(maxTicks === undefined ? {} : { maxTicks }),
  });
}

function hosted(index = 0, maxTicks?: number): { market: HostedMarket; clock: SteppableClock } {
  const clock = new SteppableClock(START);
  return { market: new HostedMarket({ engine: engineFor(index, maxTicks), clock }), clock };
}

describe('a hosted market advances with the clock, not with polling', () => {
  it('publishes nothing before the first tick is due', () => {
    const { market } = hosted();
    expect(market.advance()).toEqual([]);
    expect(market.lastPublished).toBeNull();
  });

  it('publishes every tick due, in order, once', () => {
    const { market, clock } = hosted();
    clock.advance(durationMillis(60_000));
    const first = market.advance();
    expect(first.length).toBeGreaterThan(10);
    for (let i = 1; i < first.length; i += 1) {
      expect(first[i]!.sequence).toBe(first[i - 1]!.sequence + 1);
      expect(first[i]!.instant).toBeGreaterThanOrEqual(first[i - 1]!.instant);
      expect(first[i]!.instant).toBeLessThanOrEqual(clock.now());
    }
    // Idempotent at the same instant: the market did not move, so nothing is due.
    expect(market.advance()).toEqual([]);
  });

  it('is identical however often it is polled', () => {
    // The property that makes the market shared rather than per-observer. One
    // observer polls once a minute, another every second; they must see exactly
    // the same ticks at the same instants.
    const lazy = hosted();
    lazy.clock.advance(durationMillis(600_000));
    const lazyTicks = lazy.market.advance();

    const eager = hosted();
    const eagerTicks: Tick[] = [];
    for (let step = 0; step < 600; step += 1) {
      eager.clock.advance(durationMillis(1_000));
      eagerTicks.push(...eager.market.advance());
    }

    expect(eagerTicks).toEqual(lazyTicks);
  });

  it('never publishes a tick before its instant', () => {
    const { market, clock } = hosted();
    for (let step = 0; step < 300; step += 1) {
      clock.advance(durationMillis(500));
      for (const tick of market.advance()) {
        expect(tick.instant).toBeLessThanOrEqual(clock.now());
      }
    }
  });

  it('reports how long until the next tick, so a scheduler need not poll blindly', () => {
    const { market, clock } = hosted();
    market.prime();
    const wait = market.msUntilNextTick();
    expect(wait).not.toBeNull();
    expect(wait!).toBeGreaterThan(0);

    clock.advance(durationMillis(wait!));
    expect(market.advance().length).toBeGreaterThan(0);
  });

  it('stops cleanly when the engine is exhausted', () => {
    const { market, clock } = hosted(0, 50);
    clock.advance(durationMillis(3_600_000 - 1));
    expect(market.advance()).toHaveLength(50);
    expect(market.exhausted).toBe(true);
    expect(market.advance()).toEqual([]);
  });
});

describe('catch-up is bounded', () => {
  it('refuses to invent a gap larger than its bound', () => {
    // Not a safety property — a policy one. The runtime will happily generate
    // three weeks of ticks in seconds; the question is whether a venue that was
    // down that long should publish them as though they had happened.
    const { market, clock } = hosted();
    clock.advance(durationMillis(60_000));
    market.advance();
    clock.advance(durationMillis(DEFAULT_MAX_CATCH_UP_MS + 60_000));
    expect(() => market.advance()).toThrow(CatchUpTooLargeError);
  });

  it('reports how far behind it was', () => {
    const clock = new SteppableClock(START);
    // The bound must exceed the first advance: it now applies from the engine's
    // start instant rather than from the first publication, so a 30s step under
    // a 10s bound is itself a refusal.
    const market = new HostedMarket({ engine: engineFor(), clock, maxCatchUpMs: 45_000 });
    // Far enough in that ticks have certainly been published: the arrival
    // process starts with no excitation, so the first intervals run near the
    // 3000ms baseline rather than the 1380ms stationary mean.
    clock.advance(durationMillis(30_000));
    expect(market.advance().length).toBeGreaterThan(0);
    clock.advance(durationMillis(60_000));
    try {
      market.advance();
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(CatchUpTooLargeError);
      expect((error as CatchUpTooLargeError).limitMs).toBe(45_000);
      expect((error as CatchUpTooLargeError).behindMs).toBeGreaterThan(45_000);
    }
  });

  it('applies the bound before anything has been published', () => {
    // The defect this closes: the bound read only what THIS process had
    // published, so it was inert until the first tick. A fresh market whose
    // genesis sat a day in the past published 68,160 ticks against a
    // one-second bound without complaint.
    const clock = new SteppableClock(START);
    const market = new HostedMarket({ engine: engineFor(), clock, maxCatchUpMs: 60_000 });
    clock.advance(durationMillis(86_400_000));
    expect(() => market.advance()).toThrow(CatchUpTooLargeError);
    expect(market.lastPublished).toBeNull();
  });

  it('rejects a nonsensical bound', () => {
    const clock = new SteppableClock(START);
    expect(() => new HostedMarket({ engine: engineFor(), clock, maxCatchUpMs: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('a venue hosts the catalogue', () => {
  function venue(): { venue: Venue; clock: SteppableClock } {
    const clock = new SteppableClock(START);
    const markets = ASSET_CATALOGUE.map((asset, index) => ({
      asset,
      market: new HostedMarket({ engine: engineFor(index), clock }),
    }));
    return { venue: new Venue({ clock, markets }), clock };
  }

  it('advances every asset together', () => {
    const { venue: v, clock } = venue();
    clock.advance(durationMillis(120_000));
    const published = v.advanceTo(clock.now());
    expect(published).toHaveLength(ASSET_CATALOGUE.length);
    for (const { assetId, ticks } of published) {
      expect(ticks.length, assetId).toBeGreaterThan(10);
    }
  });

  it('gives the fast assets more ticks than the slow ones', () => {
    // btcusd ticks at ~333ms and spx at ~3352ms, so over the same wall-clock
    // window the venue must publish roughly ten times as many btcusd ticks.
    const { venue: v, clock } = venue();
    clock.advance(durationMillis(600_000));
    const counts = new Map(v.advanceTo(clock.now()).map((e) => [e.assetId, e.ticks.length]));
    expect(counts.get('btcusd')!).toBeGreaterThan(counts.get('spx')! * 5);
  });

  it('waits for the soonest deadline across all assets', () => {
    const { venue: v, clock } = venue();
    v.prime();
    const wait = v.msUntilNextTick();
    expect(wait).not.toBeNull();
    for (const id of v.assetIds) {
      const perMarket = v.marketFor(id).msUntilNextTick(clock.now());
      if (perMarket !== null) expect(wait!).toBeLessThanOrEqual(perMarket);
    }
  });

  it('gives an asset exactly the market it would have alone', () => {
    // Equality, not shape. Cross-asset independence is the property the venue
    // docstring calls out as the obvious route for one asset's state to reach
    // another's prices, and Cycle Audit 2 found it had zero test enforcement: a
    // planted defect that shifted each asset's effective clock by the earlier
    // assets' tick counts passed all 769 unit tests. None of the venue tests
    // compared an asset hosted in a venue against the same asset hosted alone.
    //
    // What this detects, stated honestly: any coupling that changes which ticks
    // are published. A skew bounded below the fastest asset's tick interval
    // (~334ms) shifts only which advance() call a tick arrives on, not the set —
    // and a coupling that cannot change the published set has not changed the
    // market. Scaling that same plant to 500ms per earlier tick fails this
    // assertion at 3,298 ticks against 3,211.
    const soloClock = new SteppableClock(START);
    const solo = new HostedMarket({ engine: engineFor(2), clock: soloClock });

    const { venue: v, clock } = venue();

    const soloTicks: Tick[] = [];
    const venueTicks: Tick[] = [];
    for (let step = 0; step < 120; step += 1) {
      soloClock.advance(durationMillis(5_000));
      soloTicks.push(...solo.advance());
      clock.advance(durationMillis(5_000));
      for (const entry of v.advanceTo(clock.now())) {
        if (entry.assetId === ASSET_CATALOGUE[2]!.definition.id) venueTicks.push(...entry.ticks);
      }
    }

    expect(venueTicks.length).toBeGreaterThan(500);
    expect(venueTicks, 'hosting changed the market').toEqual(soloTicks);
  });

  it('does not let one asset failing take the others down', () => {
    // A throw from one market used to discard ticks the earlier markets had
    // already consumed and skip every later market — on every call after, so a
    // single asset breaching its bound froze the venue permanently.
    const clock = new SteppableClock(START);
    const markets = ASSET_CATALOGUE.slice(0, 3).map((asset, index) => ({
      asset,
      market: new HostedMarket({
        engine: engineFor(index),
        clock,
        // The middle asset is given a bound it will breach immediately.
        ...(index === 1 ? { maxCatchUpMs: 5_000 } : {}),
      }),
    }));
    const v = new Venue({ clock, markets });

    clock.advance(durationMillis(600_000));
    const result = v.advanceDetailed(clock.now());

    expect(result.failures.map((f) => f.assetId)).toEqual([ASSET_CATALOGUE[1]!.definition.id]);
    // The healthy assets still published, and their ticks reached the caller.
    expect(result.published.length).toBe(2);
    for (const entry of result.published) {
      expect(entry.ticks.length, entry.assetId).toBeGreaterThan(10);
    }
  });

  it('rejects duplicates and unknown assets', () => {
    const clock = new SteppableClock(START);
    const asset = ASSET_CATALOGUE[0]!;
    expect(
      () =>
        new Venue({
          clock,
          markets: [
            { asset, market: new HostedMarket({ engine: engineFor(), clock }) },
            { asset, market: new HostedMarket({ engine: engineFor(), clock }) },
          ],
        }),
    ).toThrow(/Duplicate asset/);
    expect(() => new Venue({ clock, markets: [] })).toThrow(/at least one market/);
    expect(() => venue().venue.marketFor('nope')).toThrow(/Unknown asset nope/);
  });
});
