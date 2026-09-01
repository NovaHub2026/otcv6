// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, logPrice, SteppableClock, type Tick } from '@otc/core';
import { StaleFenceError } from './fence.js';
import { DEFAULT_LEASE_TERM_MS, MemoryCoordinatedStore } from './lease.js';
import { RecordForkError, sameTick } from './replication.js';

const GENESIS = epochMillis(1_776_000_000_000);
const ASSET = 'eurusd';

function tick(sequence: number, price = 100_000 + sequence): Tick {
  return {
    sequence,
    instant: epochMillis(GENESIS + sequence * 1_000),
    price: logPrice(price),
  };
}

function harness() {
  const clock = new SteppableClock(GENESIS);
  return { clock, store: new MemoryCoordinatedStore(clock) };
}

async function lead(store: MemoryCoordinatedStore, holder = 'api-1#aa'): Promise<number> {
  const outcome = await store.acquire(ASSET, holder);
  if (outcome.kind !== 'granted') throw new Error('expected a grant');
  return outcome.grant.token;
}

describe('appending to the record', () => {
  it('records ticks in order and reports the head', async () => {
    const { store } = harness();
    const token = await lead(store);
    expect(await store.recordHead(ASSET)).toBeNull();
    await store.appendTicks(ASSET, token, [tick(1), tick(2), tick(3)]);
    expect(await store.recordHead(ASSET)).toBe(3);
    expect(await store.readTicks(ASSET, 1, 10)).toEqual([tick(1), tick(2), tick(3)]);
  });

  it('reads from an offset and respects the limit', async () => {
    const { store } = harness();
    const token = await lead(store);
    await store.appendTicks(
      ASSET,
      token,
      Array.from({ length: 10 }, (_, i) => tick(i + 1)),
    );
    expect((await store.readTicks(ASSET, 4, 3)).map((t) => t.sequence)).toEqual([4, 5, 6]);
    expect(await store.readTicks(ASSET, 11, 5)).toEqual([]);
  });

  it('accepts an empty batch as a no-op', async () => {
    const { store } = harness();
    const token = await lead(store);
    await store.appendTicks(ASSET, token, []);
    expect(await store.recordHead(ASSET)).toBeNull();
  });
});

describe('the append is fenced', () => {
  it('refuses a leader that has lost its lease', async () => {
    const { clock, store } = harness();
    const stranded = await lead(store, 'api-1#aa');
    await store.appendTicks(ASSET, stranded, [tick(1)]);

    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    const successor = await lead(store, 'api-2#bb');
    await store.appendTicks(ASSET, successor, [tick(2)]);

    await expect(store.appendTicks(ASSET, stranded, [tick(3)])).rejects.toBeInstanceOf(
      StaleFenceError,
    );
    expect(await store.recordHead(ASSET)).toBe(2);
  });

  it('refuses an append under an expired grant nobody has taken', async () => {
    const { clock, store } = harness();
    const token = await lead(store);
    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    await expect(store.appendTicks(ASSET, token, [tick(1)])).rejects.toBeInstanceOf(
      StaleFenceError,
    );
    expect(await store.recordHead(ASSET)).toBeNull();
  });

  it('refuses an append to an asset that has never been led', async () => {
    const { store } = harness();
    await expect(store.appendTicks(ASSET, 1, [tick(1)])).rejects.toBeInstanceOf(StaleFenceError);
  });
});

describe('replay is not a fork', () => {
  it('accepts identical ticks at sequences already recorded', async () => {
    const { store } = harness();
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1), tick(2), tick(3)]);
    // Exactly what a resumed leader does: it regenerates ticks it published
    // before the crash, and deterministic replay reproduces them identically.
    await store.appendTicks(ASSET, token, [tick(2), tick(3), tick(4)]);
    expect(await store.recordHead(ASSET)).toBe(4);
    expect((await store.readTicks(ASSET, 1, 10)).map((t) => t.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('re-appending the whole record changes nothing', async () => {
    const { store } = harness();
    const token = await lead(store);
    const ticks = Array.from({ length: 20 }, (_, i) => tick(i + 1));
    await store.appendTicks(ASSET, token, ticks);
    await store.appendTicks(ASSET, token, ticks);
    expect(await store.readTicks(ASSET, 1, 100)).toEqual(ticks);
  });

  it('refuses a different price at a recorded sequence', async () => {
    const { store } = harness();
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1), tick(2)]);
    await expect(store.appendTicks(ASSET, token, [tick(2, 999_999)])).rejects.toBeInstanceOf(
      RecordForkError,
    );
    expect(await store.readTicks(ASSET, 2, 1)).toEqual([tick(2)]);
  });

  it('refuses a different instant at a recorded sequence', async () => {
    const { store } = harness();
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1)]);
    const moved: Tick = { ...tick(1), instant: epochMillis(GENESIS + 500) };
    await expect(store.appendTicks(ASSET, token, [moved])).rejects.toBeInstanceOf(RecordForkError);
  });

  it('names the asset and sequence in the fork report', async () => {
    const { store } = harness();
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1), tick(2)]);
    const error = await store.appendTicks(ASSET, token, [tick(2, 5)]).then(
      () => null,
      (e: unknown) => e as RecordForkError,
    );
    expect(error?.assetId).toBe(ASSET);
    expect(error?.sequence).toBe(2);
    expect(error?.message).toContain('The record was not modified.');
  });
});

describe('gaps are refused, never closed', () => {
  it('refuses a batch that skips a sequence at the head', async () => {
    const { store } = harness();
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1)]);
    await expect(store.appendTicks(ASSET, token, [tick(3)])).rejects.toBeInstanceOf(RangeError);
    expect(await store.recordHead(ASSET)).toBe(1);
  });

  it('refuses a gap inside a batch', async () => {
    const { store } = harness();
    const token = await lead(store);
    await expect(
      store.appendTicks(ASSET, token, [tick(1), tick(2), tick(4)]),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('applies nothing at all when part of a batch is bad', async () => {
    const { store } = harness();
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1)]);
    await expect(
      store.appendTicks(ASSET, token, [tick(2), tick(3), tick(9)]),
    ).rejects.toBeInstanceOf(RangeError);
    // A partial append would leave the record in a state no single writer could
    // have produced, which is exactly what the single-writer rule is protecting.
    expect(await store.recordHead(ASSET)).toBe(1);
  });

  it('refuses a first append that does not start at the sequence it claims to continue', async () => {
    const { store } = harness();
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(7), tick(8)]);
    // The first append defines the window; the next must continue it.
    await expect(store.appendTicks(ASSET, token, [tick(10)])).rejects.toBeInstanceOf(RangeError);
  });
});

describe('reads refuse what they cannot account for', () => {
  it.each([0, -1, 1.5, Number.NaN])('refuses sequence %s', async (from) => {
    const { store } = harness();
    await expect(store.readTicks(ASSET, from, 10)).rejects.toBeInstanceOf(RangeError);
  });

  it.each([0, -5, 2.5])('refuses limit %s', async (limit) => {
    const { store } = harness();
    await expect(store.readTicks(ASSET, 1, limit)).rejects.toBeInstanceOf(RangeError);
  });

  it('returns nothing for an asset with no record rather than inventing one', async () => {
    const { store } = harness();
    expect(await store.readTicks(ASSET, 1, 10)).toEqual([]);
    expect(await store.recordHead(ASSET)).toBeNull();
  });
});

describe('assets do not share a record', () => {
  it('one leader appending cannot reach another asset', async () => {
    const { store } = harness();
    const eur = await lead(store, 'api-1#aa');
    const gbpOutcome = await store.acquire('gbpusd', 'api-2#bb');
    if (gbpOutcome.kind !== 'granted') throw new Error('expected a grant');

    await store.appendTicks(ASSET, eur, [tick(1), tick(2)]);
    await store.appendTicks('gbpusd', gbpOutcome.grant.token, [tick(1)]);

    expect(await store.recordHead(ASSET)).toBe(2);
    expect(await store.recordHead('gbpusd')).toBe(1);
    await expect(store.appendTicks('gbpusd', eur + 1, [tick(2)])).rejects.toBeInstanceOf(
      StaleFenceError,
    );
  });
});

describe('sameTick', () => {
  it('compares every field that makes a tick what it is', () => {
    expect(sameTick(tick(1), tick(1))).toBe(true);
    expect(sameTick(tick(1), tick(1, 5))).toBe(false);
    expect(sameTick(tick(1), { ...tick(1), instant: epochMillis(GENESIS + 7) })).toBe(false);
    expect(sameTick(tick(1), { ...tick(1), sequence: 2 })).toBe(false);
  });
});
