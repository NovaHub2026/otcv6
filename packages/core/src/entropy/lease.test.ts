// Invariant evidence: INV-008 (continuous market state), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import { CursorLease } from './lease.js';
import { MAX_BLOCK_INDEX } from './stream.js';

/** Stands in for durable storage. Only `value` survives a simulated crash. */
class FakeStore {
  value: bigint | null = null;
  writes = 0;

  persist(highWater: bigint): void {
    this.value = highWater;
    this.writes += 1;
  }
}

/**
 * Run one process lifetime, crashing after exactly `crashAfterSteps` observable
 * steps. Every step boundary is a point where power could be lost.
 */
function runEpoch(store: FakeStore, leaseBlocks: bigint, crashAfterSteps: number): bigint[] {
  const lease = CursorLease.resume(store.value, leaseBlocks);
  const consumed: bigint[] = [];
  let block = lease.startAt;
  let steps = 0;

  const crashed = (): boolean => {
    steps += 1;
    return steps >= crashAfterSteps;
  };

  for (;;) {
    const reservation = lease.ensure(block);
    if (crashed()) return consumed;

    if (reservation !== null) {
      store.persist(reservation); // durable BEFORE consuming
      if (crashed()) return consumed;
      lease.confirm(reservation);
      if (crashed()) return consumed;
    }

    if (!lease.canConsume(block)) {
      throw new Error(`protocol violation: block ${block} not consumable`);
    }
    consumed.push(block);
    block += 1n;
    if (crashed()) return consumed;
  }
}

describe('CursorLease — no block is ever consumed twice', () => {
  it('holds for every crash point across repeated restarts', () => {
    for (const leaseBlocks of [1n, 2n, 5n, 64n]) {
      const store = new FakeStore();
      const seen = new Set<string>();
      let totalConsumed = 0;

      // Crash after 1, 2, 3, ... steps in successive process lifetimes, so every
      // point in the consume/persist cycle is exercised as a failure point.
      for (let crashAfter = 1; crashAfter <= 40; crashAfter += 1) {
        for (const block of runEpoch(store, leaseBlocks, crashAfter)) {
          const key = block.toString();
          expect(seen.has(key), `block ${key} consumed twice (lease ${leaseBlocks})`).toBe(false);
          seen.add(key);
          totalConsumed += 1;
        }
      }
      expect(totalConsumed).toBeGreaterThan(0);
      expect(seen.size).toBe(totalConsumed);
    }
  });

  it('never restarts below the persisted high-water mark', () => {
    const store = new FakeStore();
    store.persist(1000n);
    const lease = CursorLease.resume(store.value, 10n);
    expect(lease.startAt).toBe(1000n);
    expect(lease.canConsume(999n)).toBe(false);
    expect(() => lease.ensure(999n)).toThrow(RangeError);
  });

  it('bounds the gap discarded by a restart to one lease', () => {
    const leaseBlocks = 100n;
    const store = new FakeStore();

    const first = CursorLease.resume(store.value, leaseBlocks);
    const reservation = first.ensure(first.startAt)!;
    store.persist(reservation);
    first.confirm(reservation);
    // Consume a single block, then crash.
    expect(first.canConsume(first.startAt)).toBe(true);

    const second = CursorLease.resume(store.value, leaseBlocks);
    const skipped = second.startAt - (first.startAt + 1n);
    expect(skipped).toBeLessThanOrEqual(leaseBlocks);
    expect(skipped).toBe(99n);
  });
});

describe('CursorLease — protocol', () => {
  it('starts at zero for a stream that has never run', () => {
    const lease = CursorLease.resume(null, 8n);
    expect(lease.startAt).toBe(0n);
    expect(lease.confirmedTo).toBe(0n);
    expect(lease.canConsume(0n)).toBe(false);
  });

  it('reserves a whole lease ahead on the first request', () => {
    const lease = CursorLease.resume(null, 8n);
    expect(lease.ensure(0n)).toBe(8n);
    lease.confirm(8n);
    expect(lease.canConsume(7n)).toBe(true);
    expect(lease.canConsume(8n)).toBe(false);
    expect(lease.ensure(7n)).toBeNull();
    expect(lease.ensure(8n)).toBe(16n);
  });

  it('reserves far enough for a large jump', () => {
    const lease = CursorLease.resume(null, 8n);
    expect(lease.ensure(1000n)).toBe(1001n);
  });

  it('keeps the high-water mark monotonic', () => {
    const lease = CursorLease.resume(null, 8n);
    lease.confirm(8n);
    expect(() => lease.confirm(7n)).toThrow(RangeError);
    expect(() => lease.confirm(8n)).not.toThrow();
  });

  it('reports its state', () => {
    const lease = CursorLease.resume(42n, 8n);
    lease.confirm(50n);
    expect(lease.state()).toEqual({ startAt: 42n, confirmedTo: 50n, leaseBlocks: 8n });
  });
});

describe('CursorLease — bounds', () => {
  it('rejects a non-positive lease size', () => {
    expect(() => CursorLease.resume(null, 0n)).toThrow(RangeError);
    expect(() => CursorLease.resume(null, -1n)).toThrow(RangeError);
  });

  it('rejects an out-of-range persisted mark', () => {
    expect(() => CursorLease.resume(-1n, 8n)).toThrow(RangeError);
    expect(() => CursorLease.resume(MAX_BLOCK_INDEX + 1n, 8n)).toThrow(RangeError);
  });

  it('refuses to extend past the end of the stream', () => {
    const lease = CursorLease.resume(MAX_BLOCK_INDEX - 1n, 1000n);
    expect(() => lease.ensure(MAX_BLOCK_INDEX)).toThrow(RangeError);
  });

  it('rejects confirming past the end of the stream', () => {
    const lease = CursorLease.resume(null, 8n);
    expect(() => lease.confirm(MAX_BLOCK_INDEX + 1n)).toThrow(RangeError);
  });
});
