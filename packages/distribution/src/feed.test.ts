// Invariant evidence: INV-002 (shared market), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { EvictedError, TickFeed, type FeedSink } from './feed.js';

function tick(sequence: number): Tick {
  return {
    sequence,
    instant: epochMillis(1_776_000_000_000 + sequence * 1_000),
    price: logPrice(sequence * 3),
  };
}

function ticks(from: number, count: number): Tick[] {
  return Array.from({ length: count }, (_, i) => tick(from + i));
}

/** A sink that records everything, and can be told to start refusing. */
function recorder(acceptUpTo = Number.POSITIVE_INFINITY): FeedSink & {
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

describe('the feed delivers every tick, in order, once', () => {
  it('fans out to every subscriber identically', () => {
    // The core of INV-002 at this layer: concurrent observers of one asset must
    // hold the same market, not merely similar ones.
    const feed = new TickFeed();
    const a = recorder();
    const b = recorder();
    feed.subscribe('eurusd', a);
    feed.subscribe('eurusd', b);

    feed.publish('eurusd', ticks(1, 40));
    feed.publish('eurusd', ticks(41, 60));

    expect(a.received).toHaveLength(100);
    expect(a.received, 'observers diverged').toEqual(b.received);
    expect(a.received.map((t) => t.sequence)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('does not deliver to an asset a subscriber did not ask for', () => {
    const feed = new TickFeed();
    const sink = recorder();
    feed.subscribe('eurusd', sink);
    feed.publish('btcusd', ticks(1, 10));
    expect(sink.received).toEqual([]);
  });

  it('refuses a gap rather than propagating it', () => {
    // A gap here reaches every observer at once. The feed cannot invent what the
    // runtime did not give it, so it refuses.
    const feed = new TickFeed();
    feed.publish('eurusd', ticks(1, 5));
    expect(() => feed.publish('eurusd', ticks(7, 5))).toThrow(/gap or reordering/);
  });

  it('refuses reordering', () => {
    const feed = new TickFeed();
    feed.publish('eurusd', ticks(1, 5));
    expect(() => feed.publish('eurusd', [tick(3)])).toThrow(RangeError);
  });
});

describe('a slow subscriber is disconnected, never degraded', () => {
  it('closes the subscription instead of dropping ticks', () => {
    // The decision this class exists to make. Dropping, coalescing, or jumping
    // to the latest price all give this client a different market — invisibly,
    // because a client cannot know what it never received.
    const feed = new TickFeed();
    const healthy = recorder();
    const slow = recorder(30);
    feed.subscribe('eurusd', healthy);
    const slowSub = feed.subscribe('eurusd', slow);

    feed.publish('eurusd', ticks(1, 20));
    feed.publish('eurusd', ticks(21, 20)); // pushes the slow sink past its limit

    expect(slowSub.active).toBe(false);
    expect(slow.closedWith).toMatch(/backpressure/);
    // Whatever it did receive is a correct prefix — never a skipped-ahead view.
    expect(slow.received.map((t) => t.sequence)).toEqual(
      Array.from({ length: slow.received.length }, (_, i) => i + 1),
    );
    // The healthy subscriber is untouched by its neighbour's failure.
    expect(healthy.received).toHaveLength(40);
  });

  it('tells a disconnected client where it got to', () => {
    const feed = new TickFeed();
    const slow = recorder(10);
    const subscription = feed.subscribe('eurusd', slow);
    feed.publish('eurusd', ticks(1, 10));
    expect(subscription.deliveredThrough).toBe(10);
    feed.publish('eurusd', ticks(11, 10));
    expect(subscription.active).toBe(false);
    // Resumption is exact: the client asks for deliveredThrough + 1.
    expect(subscription.deliveredThrough).toBe(10);
  });

  it('stops fanning out to a cancelled subscription', () => {
    const feed = new TickFeed();
    const sink = recorder();
    const subscription = feed.subscribe('eurusd', sink);
    feed.publish('eurusd', ticks(1, 5));
    subscription.cancel();
    feed.publish('eurusd', ticks(6, 5));
    expect(sink.received).toHaveLength(5);
    expect(feed.subscriberCount('eurusd')).toBe(0);
  });
});

describe('resumption is exact', () => {
  it('replays from the requested sequence with no gap and no repeat', () => {
    const feed = new TickFeed();
    const first = recorder();
    const subscription = feed.subscribe('eurusd', first);
    feed.publish('eurusd', ticks(1, 50));
    subscription.cancel('client went away');

    feed.publish('eurusd', ticks(51, 50));

    const resumed = recorder();
    feed.subscribe('eurusd', resumed, subscription.deliveredThrough! + 1);
    feed.publish('eurusd', ticks(101, 10));

    const reconstruction = [...first.received, ...resumed.received];
    expect(reconstruction.map((t) => t.sequence)).toEqual(
      Array.from({ length: 110 }, (_, i) => i + 1),
    );
  });

  it('refuses to guess at history it has evicted', () => {
    // Explicit retention, explicit failure. Quiet truncation would turn a
    // resumable feed into one that silently skips.
    const feed = new TickFeed({ retainTicks: 100 });
    feed.publish('eurusd', ticks(1, 500));
    expect(feed.retained('eurusd')).toEqual({ oldest: 401, newest: 500 });
    expect(() => feed.since('eurusd', 200)).toThrow(EvictedError);
    expect(() => feed.subscribe('eurusd', recorder(), 200)).toThrow(EvictedError);
    expect(feed.since('eurusd', 401)).toHaveLength(100);
  });

  it('rejects a nonsensical retention bound', () => {
    expect(() => new TickFeed({ retainTicks: 0 })).toThrow(RangeError);
  });
});

describe('the guards have teeth', () => {
  // Standing rule from Cycle Audit 2: a guard nobody has watched fail is not
  // evidence. Each of these reproduces the defect the guard exists to catch.
  it('a fan-out that skipped ahead would break observer equality', () => {
    const feed = new TickFeed();
    const a = recorder();
    const b = recorder(25); // will refuse partway
    feed.subscribe('eurusd', a);
    feed.subscribe('eurusd', b);
    feed.publish('eurusd', ticks(1, 20));
    feed.publish('eurusd', ticks(21, 20));

    // b was disconnected rather than fast-forwarded, so what it holds is a
    // prefix of what a holds — never a different market.
    expect(b.received.length).toBeLessThan(a.received.length);
    expect(a.received.slice(0, b.received.length)).toEqual(b.received);
  });

  it('a subscriber only ever holds a contiguous prefix, even under partial acceptance', () => {
    // The sink that makes a fast-forward plant *work*: it refuses large batches
    // but would happily accept a single tick. That is the realistic shape of
    // backpressure, and it is exactly the client a "helpfully" skip-ahead feed
    // would corrupt — it keeps receiving, so it never notices the hole.
    //
    // An earlier version of this suite could not catch that plant, because its
    // only slow sink refused cumulatively and so refused the skip too.
    const received: Tick[] = [];
    const pickySink: FeedSink = {
      deliver(_assetId, batch) {
        if (batch.length > 3) return false; // large batches refused
        received.push(...batch);
        return true;
      },
      close() {},
    };

    const feed = new TickFeed();
    feed.subscribe('eurusd', pickySink);
    feed.publish('eurusd', ticks(1, 2)); // accepted
    feed.publish('eurusd', ticks(3, 40)); // refused -> must disconnect

    expect(received.map((t) => t.sequence)).toEqual([1, 2]);
    // If the feed had skipped ahead to keep this client alive, `received` would
    // contain a jump — a different market, invisibly.
    for (let i = 1; i < received.length; i += 1) {
      expect(received[i]!.sequence, 'a gap reached a subscriber').toBe(
        received[i - 1]!.sequence + 1,
      );
    }
  });

  it('a retention window that truncated silently would be undetectable', () => {
    const feed = new TickFeed({ retainTicks: 10 });
    feed.publish('eurusd', ticks(1, 100));
    // The client asks for 50; the honest answer is an error, not ticks 91-100
    // presented as though they followed 49.
    let threw = false;
    try {
      feed.since('eurusd', 50);
    } catch (error) {
      threw = error instanceof EvictedError;
    }
    expect(threw, 'silent truncation would be invisible to the client').toBe(true);
  });
});
