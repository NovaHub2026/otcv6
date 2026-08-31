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
    const market = new HostedMarket({ engine: engineFor(), clock, maxCatchUpMs: 10_000 });
    // Far enough in that ticks have certainly been published: the arrival
    // process starts with no excitation, so the first intervals run near the
    // 3000ms baseline rather than the 1295ms stationary mean.
    clock.advance(durationMillis(30_000));
    expect(market.advance().length).toBeGreaterThan(0);
    clock.advance(durationMillis(60_000));
    try {
      market.advance();
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(CatchUpTooLargeError);
      expect((error as CatchUpTooLargeError).limitMs).toBe(10_000);
      expect((error as CatchUpTooLargeError).behindMs).toBeGreaterThan(10_000);
    }
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
    // btcusd ticks at ~334ms and spx at ~3187ms, so over the same wall-clock
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
