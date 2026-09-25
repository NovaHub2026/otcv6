// Invariant evidence: INV-002 (shared market), INV-008 (continuous market state), INV-009 (reproducible settlement), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from './fileStore.js';
import { CatchUpTooLargeError, DEFAULT_MAX_CATCH_UP_MS, type HostedMarket } from './hosted.js';
import { NothingPublishedError, reopenStalledMarket } from './reopen.js';
import { resumeMarket } from './resume.js';
import { DEFAULT_SEQUENCE_LEASE } from './state.js';

/**
 * A stall is an outage, and an outage is a seam (ADR-0020).
 *
 * The catch-up bound refuses a market that has fallen more than fifteen seconds
 * behind the clock, and the refusal is permanent: the bound is measured from the
 * last time the runtime *looked* at the clock, and that moves only after the
 * check it just failed. Before this, the only exit was a person restarting the
 * process — which does not repair the outage, it accepts it, by reopening the
 * market at the clock from its last published price on a fresh keystream.
 *
 * These tests drive a real market past its bound with a jumping clock, which is
 * what a suspended host does, and hold the reopening to what a restart would
 * have produced.
 */
const keyring = MasterKeyring.forTesting('reopen-spec');
const asset = ASSET_CATALOGUE[0]!;
const GENESIS = epochMillis(1_776_000_000_000);

function baseOptions(clock: SteppableClock) {
  return { asset, keyring, environment: 'test' as const, clock };
}

/** Advance in steps well inside the bound until `count` ticks have landed. */
function pump(market: HostedMarket, clock: SteppableClock, count: number): Tick[] {
  const ticks: Tick[] = [];
  while (ticks.length < count) {
    clock.advance(durationMillis(5_000));
    ticks.push(...market.advance());
  }
  return ticks;
}

/** A live market that has published, and the clock that drives it. */
async function running(): Promise<{ market: HostedMarket; clock: SteppableClock }> {
  const clock = new SteppableClock(GENESIS);
  const { market } = await resumeMarket({
    ...baseOptions(clock),
    store: new MemoryStateStore(),
    genesisInstant: GENESIS,
  });
  // Inside the bound the whole way: this is an ordinary market, advanced the way
  // the scheduler advances it.
  pump(market, clock, 20);
  return { market, clock };
}

describe('a market past its catch-up bound reopens itself', () => {
  it('refuses first — the stall this reopening exists for is real', async () => {
    const { market, clock } = await running();
    clock.advance(durationMillis(3_600_000));
    expect(() => market.advance()).toThrow(CatchUpTooLargeError);
    // And again, which is the part that makes a restart the only exit: the
    // refusal moves nothing forward, so every later advance is further behind.
    clock.advance(durationMillis(1_000));
    expect(() => market.advance()).toThrow(CatchUpTooLargeError);
  });

  it('publishes again, from the last price anyone saw', async () => {
    const { market, clock } = await running();
    const last = market.lastPublishedState!;
    clock.advance(durationMillis(3_600_000));
    expect(() => market.advance()).toThrow(CatchUpTooLargeError);

    const reopened = reopenStalledMarket({ ...baseOptions(clock), market });
    const ticks = pump(reopened.market, clock, 1);

    // The price carries over: an observer's chart continues from where it
    // stopped rather than jumping to a price nobody published (INV-002).
    expect(reopened.from.price).toBe(last.price);
    // The gap stays a gap: the market reopens at the clock, not at the instant
    // it stopped, so nothing is invented for the hours nobody observed.
    expect(ticks[0]!.instant).toBeGreaterThan(last.instant + 3_600_000);
    // Past every reserved position, by a whole lease, so no sequence is ever
    // published twice under one asset id.
    expect(ticks[0]!.sequence).toBe(last.sequence + DEFAULT_SEQUENCE_LEASE + 1);
    // Stated before anything was drawn, which is what the feed needs and what
    // keeps the engine's pending tick private (INV-010).
    expect(reopened.outcome.resumesAtSequence).toBe(ticks[0]!.sequence);
    expect(reopened.outcome.kind).toBe('seam');
    expect(reopened.outcome.fromSequence).toBe(last.sequence);
  });

  it('opens a keystream nothing has been drawn from (ADR-0019)', async () => {
    const { market, clock } = await running();
    clock.advance(durationMillis(3_600_000));
    expect(() => market.advance()).toThrow(CatchUpTooLargeError);
    const reopened = reopenStalledMarket({ ...baseOptions(clock), market });
    expect(reopened.market.keyEpoch).toBeGreaterThan(market.keyEpoch);
  });

  it('is a different market each time, not one replay of the same outage', async () => {
    // Two outages on one asset under one secret. If the reopening keyed its
    // streams by anything but the instant it happens at, the second would play
    // the first's increments from the first's price — the defect ADR-0019 was
    // written for, arriving through a new door.
    const directions = async (gapMs: number): Promise<number[]> => {
      const { market, clock } = await running();
      clock.advance(durationMillis(3_600_000 + gapMs));
      expect(() => market.advance()).toThrow(CatchUpTooLargeError);
      const reopened = reopenStalledMarket({ ...baseOptions(clock), market });
      let previous = reopened.from.price;
      return pump(reopened.market, clock, 200)
        .slice(0, 200)
        .map((tick) => {
          const step = Math.sign(tick.price - previous);
          previous = tick.price;
          return step;
        });
    };
    const first = await directions(0);
    const second = await directions(20_000);
    const agreed = first.filter((step, i) => step === second[i]!).length / first.length;
    expect(agreed).toBeLessThan(0.6);
  });

  it('reserves the same sequence again when it published nothing in between', async () => {
    // The property the venue's re-arming rests on (PH-39). A reopened market
    // that starves again before its first tick is reopened a second time, and
    // that second reopening must be indistinguishable from the first as far as
    // anything outside the market can see: the same carried tick, the same
    // reserved sequence, the same window the feed and the commitment chain were
    // already told about. If it moved, the venue would have to declare a second
    // seam for an outage that never ended.
    const { market, clock } = await running();
    clock.advance(durationMillis(3_600_000));
    expect(() => market.advance()).toThrow(CatchUpTooLargeError);
    const first = reopenStalledMarket({ ...baseOptions(clock), market });
    first.market.prime();

    // Starved again, and further into the outage than the first time.
    clock.advance(durationMillis(3_600_000));
    expect(() => first.market.advance()).toThrow(CatchUpTooLargeError);
    const second = reopenStalledMarket({ ...baseOptions(clock), market: first.market });

    expect(second.from.sequence).toBe(first.from.sequence);
    expect(second.from.price).toBe(first.from.price);
    expect(second.outcome.fromSequence).toBe(first.outcome.fromSequence);
    expect(second.outcome.resumesAtSequence).toBe(first.outcome.resumesAtSequence);
    // On a keystream of its own all the same: the first reopening drew a tick
    // nobody was served, and a discontinuity never reuses an epoch (ADR-0019).
    expect(second.market.keyEpoch).toBeGreaterThan(first.market.keyEpoch);
    // And it opens at the clock, so it is inside the bound and can publish.
    expect(pump(second.market, clock, 1).length).toBeGreaterThan(0);
  });

  it('keeps the bound it was refused by, so the next outage is refused too', async () => {
    const { market, clock } = await running();
    clock.advance(durationMillis(3_600_000));
    expect(() => market.advance()).toThrow(CatchUpTooLargeError);
    const reopened = reopenStalledMarket({ ...baseOptions(clock), market });
    expect(pump(reopened.market, clock, 1).length).toBeGreaterThan(0);
    // The bound is a product invariant, not something a reopening relaxes:
    // no burst may span a contract (ADR-0010).
    clock.advance(durationMillis(DEFAULT_MAX_CATCH_UP_MS + 1_000));
    expect(() => reopened.market.advance()).toThrow(CatchUpTooLargeError);
  });

  it('never reopens behind the last instant it published at', async () => {
    // A clock that has been rewound — a platform resynchronising the wrong way
    // — must not reopen a market before the last instant it served, which would
    // put two prices on one instant for observers either side of it (INV-002).
    const { market, clock } = await running();
    const last = market.lastPublishedState!;
    clock.advance(durationMillis(3_600_000));
    expect(() => market.advance()).toThrow(CatchUpTooLargeError);
    const rewound = new SteppableClock(epochMillis(last.instant - 600_000));
    const reopened = reopenStalledMarket({
      ...baseOptions(rewound),
      clock: rewound,
      market,
    });
    const ticks = pump(reopened.market, rewound, 1);
    expect(ticks[0]!.instant).toBeGreaterThanOrEqual(last.instant);
  });

  it('refuses a market that has published nothing', async () => {
    const clock = new SteppableClock(GENESIS);
    const { market } = await resumeMarket({
      ...baseOptions(clock),
      store: new MemoryStateStore(),
      genesisInstant: GENESIS,
    });
    expect(() => reopenStalledMarket({ ...baseOptions(clock), market })).toThrow(
      NothingPublishedError,
    );
  });
});
