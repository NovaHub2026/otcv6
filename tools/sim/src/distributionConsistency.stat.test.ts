// Invariant evidence: INV-002 (shared market), INV-001 (economic independence).
import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  logPrice,
  MasterKeyring,
  SteppableClock,
  type Tick,
} from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine } from '@otc/engine';
import { HostedMarket, Venue } from '@otc/runtime';
import { EvictedError, TickFeed, type FeedSink } from '@otc/distribution';

/**
 * INV-002 across the distribution boundary.
 *
 * Until now the invariant has been true for an uninteresting reason: one
 * observer, one process, one array. This is the first place it can actually
 * fail, and the failure would look like performance work — a slow client
 * "helpfully" fast-forwarded, a replay window quietly truncated.
 *
 * INV-001 also has to be re-established here. PH-6 showed the tick stream is
 * byte-identical whether or not the market is traded, in a single process. Client
 * behaviour is a new input reaching a running server: how many are connected,
 * when they subscribe, how fast they read. None of it may change the market.
 */

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('distribution-consistency');
const ASSET = ASSET_CATALOGUE[0]!;
const STEP_MS = 5_000;
const STEPS = 400;

function market(clock: SteppableClock): HostedMarket {
  return new HostedMarket({
    engine: createMarketEngine({
      config: configFor(ASSET),
      keyring,
      environment: 'simulation',
      start: { instant: GENESIS, price: logPrice(0) },
    }),
    clock,
    maxCatchUpMs: 86_400_000,
  });
}

/** An observer that records what it is given, optionally refusing after a point. */
function observer(acceptUpTo = Number.POSITIVE_INFINITY): FeedSink & {
  received: Tick[];
  closedWith: string | null;
} {
  const state = {
    received: [] as Tick[],
    closedWith: null as string | null,
    deliver(_assetId: string, batch: readonly Tick[]): boolean {
      if (state.received.length + batch.length > acceptUpTo) return false;
      state.received.push(...batch);
      return true;
    },
    close(reason: string): void {
      state.closedWith = reason;
    },
  };
  return state;
}

/** Drive a market for the standard span, publishing into a feed. */
function run(feed: TickFeed, hosted: HostedMarket, clock: SteppableClock): Tick[] {
  const all: Tick[] = [];
  for (let step = 0; step < STEPS; step += 1) {
    clock.advance(durationMillis(STEP_MS));
    const published = hosted.advance();
    if (published.length > 0) {
      feed.publish(ASSET.definition.id, published);
      all.push(...published);
    }
  }
  return all;
}

describe('every observer holds the same market', () => {
  it('gives concurrent observers byte-identical streams', () => {
    const clock = new SteppableClock(GENESIS);
    const feed = new TickFeed();
    const hosted = market(clock);

    const observers = Array.from({ length: 25 }, () => observer());
    for (const sink of observers) feed.subscribe(ASSET.definition.id, sink);

    const server = run(feed, hosted, clock);
    expect(server.length).toBeGreaterThan(2_000);

    console.info(
      `consistency: ${observers.length} observers, ${server.length} ticks each, identical`,
    );

    for (const [index, sink] of observers.entries()) {
      expect(sink.received, `observer ${index} diverged`).toEqual(server);
    }
  });

  it('gives a late joiner a correct suffix, and a resumer an exact continuation', () => {
    const clock = new SteppableClock(GENESIS);
    const feed = new TickFeed();
    const hosted = market(clock);

    const early = observer();
    feed.subscribe(ASSET.definition.id, early);

    // Half the run, then a late joiner and a reconnection.
    const first: Tick[] = [];
    for (let step = 0; step < STEPS / 2; step += 1) {
      clock.advance(durationMillis(STEP_MS));
      const published = hosted.advance();
      if (published.length > 0) {
        feed.publish(ASSET.definition.id, published);
        first.push(...published);
      }
    }

    const late = observer();
    feed.subscribe(ASSET.definition.id, late);
    const resumed = observer();
    // Resume exactly where `early` had got to.
    feed.subscribe(ASSET.definition.id, resumed, early.received.length + first[0]!.sequence);

    const second: Tick[] = [];
    for (let step = 0; step < STEPS / 2; step += 1) {
      clock.advance(durationMillis(STEP_MS));
      const published = hosted.advance();
      if (published.length > 0) {
        feed.publish(ASSET.definition.id, published);
        second.push(...published);
      }
    }

    const server = [...first, ...second];
    expect(early.received).toEqual(server);
    // A late joiner sees a suffix — a correct one, contiguous with the whole.
    expect(late.received).toEqual(second);
    expect(second.length).toBeGreaterThan(500);
    // A resumer's history plus its continuation reconstructs the server exactly.
    expect([...first, ...resumed.received]).toEqual(server);
  });

  it('leaves a healthy observer untouched when a neighbour collapses', () => {
    const clock = new SteppableClock(GENESIS);
    const feed = new TickFeed();
    const hosted = market(clock);

    const healthy = observer();
    const doomed = observer(300);
    feed.subscribe(ASSET.definition.id, healthy);
    const doomedSub = feed.subscribe(ASSET.definition.id, doomed);

    const server = run(feed, hosted, clock);

    expect(doomedSub.active).toBe(false);
    expect(doomed.closedWith).toMatch(/backpressure/);
    expect(healthy.received).toEqual(server);
    // What the disconnected observer holds is a correct PREFIX — never a
    // fast-forwarded, and therefore different, market.
    expect(server.slice(0, doomed.received.length)).toEqual(doomed.received);
  });
});

describe('the market does not know it is being watched', () => {
  it('produces identical ticks under no observers and under hostile ones', () => {
    // The PH-6 demonstration rebuilt on this side of the boundary. Client
    // behaviour is a new input reaching a running server, and none of it may
    // change what is generated.
    const quietClock = new SteppableClock(GENESIS);
    const quiet = run(new TickFeed(), market(quietClock), quietClock);

    const watchedClock = new SteppableClock(GENESIS);
    const feed = new TickFeed({ retainTicks: 500 });
    const hosted = market(watchedClock);

    const sinks: ReturnType<typeof observer>[] = [];
    const watched: Tick[] = [];
    for (let step = 0; step < STEPS; step += 1) {
      watchedClock.advance(durationMillis(STEP_MS));
      const published = hosted.advance();
      if (published.length > 0) {
        feed.publish(ASSET.definition.id, published);
        watched.push(...published);
      }

      // Hostile churn: subscribe, unsubscribe, resume from arbitrary points,
      // and keep several sinks deliberately too slow to survive.
      if (step % 3 === 0) {
        const sink = observer(step % 7 === 0 ? 50 : Number.POSITIVE_INFINITY);
        sinks.push(sink);
        const retained = feed.retained(ASSET.definition.id);
        const from = retained !== null && step % 5 === 0 ? retained.oldest : undefined;
        try {
          feed.subscribe(ASSET.definition.id, sink, from);
        } catch (error) {
          // An evicted request is an expected outcome of hostile behaviour.
          expect(error).toBeInstanceOf(EvictedError);
        }
      }
    }

    expect(sinks.length).toBeGreaterThan(100);
    expect(watched.length).toBeGreaterThan(2_000);
    expect(watched, 'watching the market changed it').toEqual(quiet);
  });

  it('is unchanged by how many assets are hosted alongside it', () => {
    // The venue-level analogue: an asset distributed as part of a catalogue must
    // be the same market it is alone.
    const soloClock = new SteppableClock(GENESIS);
    const solo = run(new TickFeed(), market(soloClock), soloClock);

    const venueClock = new SteppableClock(GENESIS);
    const feed = new TickFeed();
    const markets = ASSET_CATALOGUE.map((asset) => ({
      asset,
      market: new HostedMarket({
        engine: createMarketEngine({
          config: configFor(asset),
          keyring,
          environment: 'simulation',
          start: { instant: GENESIS, price: logPrice(0) },
        }),
        clock: venueClock,
        maxCatchUpMs: 86_400_000,
      }),
    }));
    const venue = new Venue({ clock: venueClock, markets });
    for (const { asset } of markets) feed.subscribe(asset.definition.id, observer());

    const fromVenue: Tick[] = [];
    for (let step = 0; step < STEPS; step += 1) {
      venueClock.advance(durationMillis(STEP_MS));
      for (const entry of venue.advanceTo(venueClock.now())) {
        feed.publish(entry.assetId, entry.ticks);
        if (entry.assetId === ASSET.definition.id) fromVenue.push(...entry.ticks);
      }
    }

    expect(fromVenue).toEqual(solo);
  });
});
