// Invariant evidence: INV-002 (shared market), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, SteppableClock } from '@otc/core';
import {
  AssetLease,
  assertHolder,
  DEFAULT_LEASE_RENEWAL_MS,
  DEFAULT_LEASE_TERM_MS,
  LeaseHolderError,
  MemoryCoordinatedStore,
  StaleFenceError,
} from './lease.js';
import { DEFAULT_MAX_CATCH_UP_MS } from './hosted.js';
import { stubRecord } from './leaseConformance.test.js';

const GENESIS = epochMillis(1_776_000_000_000);

function harness(termMs: number = DEFAULT_LEASE_TERM_MS) {
  const clock = new SteppableClock(GENESIS);
  return { clock, store: new MemoryCoordinatedStore(clock, termMs) };
}

describe('the lease term is tied to the catch-up bound', () => {
  it('equals it, so losing a lease takes nothing the bound had not already taken', () => {
    // ADR-0010 refuses a catch-up burst longer than this. A leader out of
    // contact for a full term could not have advanced anyway, so failover costs
    // no ticks that were still legally producible.
    expect(DEFAULT_LEASE_TERM_MS).toBe(DEFAULT_MAX_CATCH_UP_MS);
  });

  it('leaves room for two lost renewal round-trips', () => {
    expect(DEFAULT_LEASE_TERM_MS / DEFAULT_LEASE_RENEWAL_MS).toBeGreaterThanOrEqual(3);
  });
});

describe('holder identity', () => {
  it('accepts a printable process identifier', () => {
    expect(() => assertHolder('api-7#0f3c9ab1')).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['an embedded space', 'node a'],
    ['a newline', 'node\nb'],
    ['a control character', 'node' + String.fromCharCode(7) + 'b'],
    ['too long', 'x'.repeat(129)],
  ])('refuses %s', (_label, holder) => {
    expect(() => assertHolder(holder)).toThrow(LeaseHolderError);
  });

  it('is refused at acquisition, not silently normalised', async () => {
    const { store } = harness();
    await expect(store.acquire('eurusd', 'node 1')).rejects.toBeInstanceOf(LeaseHolderError);
  });
});

describe('the store refuses an unusable term', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (termMs) => {
    expect(() => new MemoryCoordinatedStore(new SteppableClock(GENESIS), termMs)).toThrow(
      RangeError,
    );
  });
});

describe('expiry cannot recycle a token', () => {
  it('keeps the high-water mark across a full expiry cycle with no holder', async () => {
    const { clock, store } = harness();
    const first = await store.acquire('eurusd', 'node-a#1');
    if (first.kind !== 'granted') throw new Error('unreachable');
    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS * 10));
    // Nobody held it for ten terms. The next grant still moves the token on,
    // because a stranded writer's token must never be able to match a live one.
    const second = await store.acquire('eurusd', 'node-a#1');
    if (second.kind !== 'granted') throw new Error('unreachable');
    expect(second.grant.token).toBe(first.grant.token + 1);
  });
});

describe('the unfenced write path is distinguishable from the fenced one', () => {
  it('save writes without a lease and saveFenced does not', async () => {
    const { store } = harness();
    await store.save(stubRecord('eurusd', epochMillis(1)));
    expect((await store.load('eurusd'))?.savedAt).toBe(1);
    await expect(store.saveFenced(stubRecord('eurusd', epochMillis(2)), 1)).rejects.toBeInstanceOf(
      StaleFenceError,
    );
    expect((await store.load('eurusd'))?.savedAt).toBe(1);
  });
});

describe('the stranded-leader scenario end to end', () => {
  it('a partitioned leader keeps writing and changes nothing', async () => {
    const { clock, store } = harness();
    const stranded = await AssetLease.acquire(store, 'eurusd', 'api-1#aa');
    if (!(stranded instanceof AssetLease)) throw new Error('expected a lease');
    await store.saveFenced(stubRecord('eurusd', epochMillis(1_000)), stranded.token);

    // The network goes. The store expires the lease; the stranded node learns
    // nothing, because learning requires reaching the store.
    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    const successor = await AssetLease.acquire(store, 'eurusd', 'api-2#bb');
    if (!(successor instanceof AssetLease)) throw new Error('expected a lease');
    await store.saveFenced(stubRecord('eurusd', epochMillis(2_000)), successor.token);

    // It comes back and flushes everything it generated while stranded.
    for (const savedAt of [1_100, 1_200, 1_300]) {
      await expect(
        store.saveFenced(stubRecord('eurusd', epochMillis(savedAt)), stranded.token),
      ).rejects.toBeInstanceOf(StaleFenceError);
    }
    expect((await store.load('eurusd'))?.savedAt).toBe(2_000);
    expect(stranded.lost).toBe(false); // it still believes it leads
    expect(await stranded.renew()).toBe(false); // until it asks
    expect(stranded.lost).toBe(true);
  });
});

describe('leases on different assets do not interact', () => {
  it('one node may lead some assets while another leads the rest', async () => {
    const { store } = harness();
    const assets = ['eurusd', 'gbpusd', 'usdjpy', 'btcusd', 'xauusd'];
    const leases = new Map<string, AssetLease>();
    for (const [index, assetId] of assets.entries()) {
      const holder = index % 2 === 0 ? 'api-1#aa' : 'api-2#bb';
      const lease = await AssetLease.acquire(store, assetId, holder);
      if (!(lease instanceof AssetLease)) throw new Error('expected a lease');
      leases.set(assetId, lease);
    }
    // Every asset is written by its own leader and none fences another.
    for (const [assetId, lease] of leases) {
      await store.saveFenced(stubRecord(assetId, epochMillis(5)), lease.token);
    }
    expect(await store.list()).toEqual([...assets].sort());

    // A leader of one asset cannot write another, even with a valid token of
    // its own — this is where a per-node rather than per-asset fence would leak.
    const eurusd = leases.get('eurusd')!;
    await expect(
      store.saveFenced(stubRecord('gbpusd', epochMillis(9)), eurusd.token + 1),
    ).rejects.toBeInstanceOf(StaleFenceError);
  });
});
