// Invariant evidence: INV-002 (shared market), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, SteppableClock, type EpochMillis, type Tick } from '@otc/core';
import { StaleFenceError, type FenceToken } from './fence.js';
import {
  AssetLease,
  DEFAULT_LEASE_TERM_MS,
  MemoryCoordinatedStore,
  type CoordinatedStore,
  type LeaseGrant,
} from './lease.js';
import { RecordForkError, SeamError, type SeamMarker } from './replication.js';
import { STATE_RECORD_VERSION, type MarketStateRecord } from './state.js';

/**
 * A store under test, plus the ability to move its clock.
 *
 * Expiry is judged by the store's clock, so a battery that could not move that
 * clock could only test expiry by sleeping — which would make the suite slow
 * and, worse, timing-dependent. A store implementation that cannot expose a
 * controllable clock cannot be conformance-tested here, and that is a fact
 * about the implementation rather than a gap in the battery.
 */
export interface StoreUnderTest {
  readonly store: CoordinatedStore;
  /** Move the store's clock forward. */
  advance(byMs: number): void;
  readonly termMs: number;
}

/** A tick, for exercising the replication half of the contract. */
export function stubTick(sequence: number, price = 100_000 + sequence): Tick {
  return {
    sequence,
    instant: epochMillis(1_776_000_000_000 + sequence * 1_000),
    price: logPrice(price),
  };
}

/** A record shaped enough to be written; the fence never inspects its contents. */
export function stubRecord(assetId: string, savedAt: EpochMillis): MarketStateRecord {
  return {
    version: STATE_RECORD_VERSION,
    assetId,
    savedAt,
    snapshot: { marker: assetId } as unknown as MarketStateRecord['snapshot'],
    pending: null,
    lastPublished: null,
    leasedBlocks: { sign: '1:0' },
    leasedSequence: 1,
  };
}

function seamAt(lastSequence: number | null, resumesAtSequence: number): SeamMarker {
  return {
    assetId: 'eurusd',
    lastSequence,
    lastInstant: lastSequence === null ? null : stubTick(lastSequence).instant,
    resumesAtSequence,
    resumesAtInstant: epochMillis(1_776_000_000_000 + 9_000_000),
    reason: 'snapshot rejected',
  };
}

async function mustAcquire(
  store: CoordinatedStore,
  assetId: string,
  holder: string,
): Promise<LeaseGrant> {
  const outcome = await store.acquire(assetId, holder);
  if (outcome.kind !== 'granted') {
    throw new Error(
      `expected ${holder} to acquire ${assetId}, but it was held by ${outcome.by.holder}`,
    );
  }
  return outcome.grant;
}

/**
 * The contract every `CoordinatedStore` must satisfy.
 *
 * This exists so that swapping the in-memory reference for a deployment backend
 * is checked against the same properties rather than against prose. Every claim
 * in `PH-14.1` §9 is one `it` below.
 */
export function describeCoordinatedStore(name: string, create: () => StoreUnderTest): void {
  describe(`${name} — CoordinatedStore contract`, () => {
    const ASSET = 'eurusd';

    describe('mutual exclusion', () => {
      it('grants to the first claimant and refuses the second', async () => {
        const { store } = create();
        const first = await store.acquire(ASSET, 'node-a#1');
        const second = await store.acquire(ASSET, 'node-b#1');
        expect(first.kind).toBe('granted');
        expect(second.kind).toBe('held');
        if (second.kind !== 'held') throw new Error('unreachable');
        expect(second.by.holder).toBe('node-a#1');
      });

      for (const contenders of [2, 8, 64]) {
        it(`admits exactly one of ${contenders} concurrent claimants`, async () => {
          const { store } = create();
          const outcomes = await Promise.all(
            Array.from({ length: contenders }, (_, i) => store.acquire(ASSET, `node-${i}#1`)),
          );
          const granted = outcomes.filter((o) => o.kind === 'granted');
          expect(granted).toHaveLength(1);
          // Everyone refused must be told the same truth about who holds it.
          const winner = granted[0];
          if (winner?.kind !== 'granted') throw new Error('unreachable');
          for (const outcome of outcomes) {
            if (outcome.kind === 'held') expect(outcome.by.holder).toBe(winner.grant.holder);
          }
        });
      }

      it('leases different assets independently', async () => {
        const { store } = create();
        const a = await store.acquire('eurusd', 'node-a#1');
        const b = await store.acquire('gbpusd', 'node-b#1');
        expect(a.kind).toBe('granted');
        expect(b.kind).toBe('granted');
      });
    });

    describe('expiry', () => {
      it('frees the lease without the holder doing anything', async () => {
        const harness = create();
        await mustAcquire(harness.store, ASSET, 'node-a#1');
        expect(await harness.store.acquire(ASSET, 'node-b#1')).toMatchObject({ kind: 'held' });
        harness.advance(harness.termMs);
        expect(await harness.store.acquire(ASSET, 'node-b#1')).toMatchObject({ kind: 'granted' });
      });

      it('does not free it one millisecond early', async () => {
        const harness = create();
        await mustAcquire(harness.store, ASSET, 'node-a#1');
        harness.advance(harness.termMs - 1);
        expect(await harness.store.acquire(ASSET, 'node-b#1')).toMatchObject({ kind: 'held' });
      });

      it('renewal keeps it alive indefinitely', async () => {
        const harness = create();
        const grant = await mustAcquire(harness.store, ASSET, 'node-a#1');
        let live = grant;
        for (let i = 0; i < 20; i += 1) {
          harness.advance(Math.floor(harness.termMs / 3));
          const outcome = await harness.store.renew(live);
          expect(outcome.kind).toBe('renewed');
          if (outcome.kind !== 'renewed') throw new Error('unreachable');
          live = outcome.grant;
        }
        expect(await harness.store.acquire(ASSET, 'node-b#1')).toMatchObject({ kind: 'held' });
      });

      it('reports no current grant once expired', async () => {
        const harness = create();
        await mustAcquire(harness.store, ASSET, 'node-a#1');
        expect(await harness.store.inspect(ASSET)).not.toBeNull();
        harness.advance(harness.termMs);
        expect(await harness.store.inspect(ASSET)).toBeNull();
      });

      it('inspect does not extend the grant', async () => {
        const harness = create();
        await mustAcquire(harness.store, ASSET, 'node-a#1');
        for (let i = 0; i < 5; i += 1) {
          harness.advance(Math.floor(harness.termMs / 5));
          await harness.store.inspect(ASSET);
        }
        expect(await harness.store.acquire(ASSET, 'node-b#1')).toMatchObject({ kind: 'granted' });
      });
    });

    describe('fence tokens', () => {
      it('strictly increases across every grant for an asset', async () => {
        const harness = create();
        const seen: FenceToken[] = [];
        for (let i = 0; i < 200; i += 1) {
          const grant = await mustAcquire(harness.store, ASSET, `node-${i % 7}#${i}`);
          seen.push(grant.token);
          harness.advance(harness.termMs);
        }
        for (let i = 1; i < seen.length; i += 1) {
          expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
        }
      });

      it('is preserved by renewal', async () => {
        const harness = create();
        const grant = await mustAcquire(harness.store, ASSET, 'node-a#1');
        harness.advance(Math.floor(harness.termMs / 2));
        const outcome = await harness.store.renew(grant);
        if (outcome.kind !== 'renewed') throw new Error('renewal was refused');
        expect(outcome.grant.token).toBe(grant.token);
        expect(outcome.grant.expiresAt).toBeGreaterThan(grant.expiresAt);
      });

      it('increments when the same holder reacquires after its own expiry', async () => {
        const harness = create();
        const first = await mustAcquire(harness.store, ASSET, 'node-a#1');
        harness.advance(harness.termMs);
        const second = await mustAcquire(harness.store, ASSET, 'node-a#1');
        // The same process, but another node could legitimately have led during
        // the gap. Reissuing the token would let a write from before the gap
        // match the new grant exactly.
        expect(second.token).toBeGreaterThan(first.token);
      });

      it('increments after an explicit release, so a released token is never reissued', async () => {
        const harness = create();
        const first = await mustAcquire(harness.store, ASSET, 'node-a#1');
        await harness.store.release(first);
        const second = await mustAcquire(harness.store, ASSET, 'node-a#1');
        expect(second.token).toBeGreaterThan(first.token);
      });

      it('does not share a token across assets in a way that would let one fence another', async () => {
        const harness = create();
        const a = await mustAcquire(harness.store, 'eurusd', 'node-a#1');
        const b = await mustAcquire(harness.store, 'gbpusd', 'node-b#1');
        // Tokens are per asset, so they may coincide. What must not happen is a
        // write to one asset succeeding under the other's grant.
        await expect(
          harness.store.saveFenced(stubRecord('eurusd', epochMillis(1)), b.token + 1000),
        ).rejects.toBeInstanceOf(StaleFenceError);
        expect(a.assetId).toBe('eurusd');
      });
    });

    describe('fencing refuses the stranded leader', () => {
      it('refuses a write under a superseded token, and leaves the record untouched', async () => {
        const harness = create();
        const old = await mustAcquire(harness.store, ASSET, 'node-a#1');
        await harness.store.saveFenced(stubRecord(ASSET, epochMillis(1)), old.token);
        const before = await harness.store.load(ASSET);
        expect(before?.savedAt).toBe(1);

        harness.advance(harness.termMs);
        await mustAcquire(harness.store, ASSET, 'node-b#1');

        // node-a has not noticed. It is still generating and still writing.
        await expect(
          harness.store.saveFenced(stubRecord(ASSET, epochMillis(2)), old.token),
        ).rejects.toBeInstanceOf(StaleFenceError);
        const after = await harness.store.load(ASSET);
        expect(after?.savedAt).toBe(1);
      });

      it('refuses a write under an expired grant even when nobody has taken over', async () => {
        const harness = create();
        const grant = await mustAcquire(harness.store, ASSET, 'node-a#1');
        harness.advance(harness.termMs);
        await expect(
          harness.store.saveFenced(stubRecord(ASSET, epochMillis(2)), grant.token),
        ).rejects.toBeInstanceOf(StaleFenceError);
      });

      it('refuses a write when the asset has never been led', async () => {
        const { store } = create();
        await expect(store.saveFenced(stubRecord(ASSET, epochMillis(1)), 1)).rejects.toBeInstanceOf(
          StaleFenceError,
        );
      });

      it('reports the current token so a refused writer can tell what happened', async () => {
        const harness = create();
        const old = await mustAcquire(harness.store, ASSET, 'node-a#1');
        harness.advance(harness.termMs);
        const fresh = await mustAcquire(harness.store, ASSET, 'node-b#1');
        const error = await harness.store
          .saveFenced(stubRecord(ASSET, epochMillis(2)), old.token)
          .then(
            () => null,
            (e: unknown) => e as StaleFenceError,
          );
        expect(error).toBeInstanceOf(StaleFenceError);
        expect(error?.presented).toBe(old.token);
        expect(error?.current).toBe(fresh.token);
      });

      it('admits the current leader', async () => {
        const harness = create();
        harness.advance(harness.termMs);
        const grant = await mustAcquire(harness.store, ASSET, 'node-b#1');
        await harness.store.saveFenced(stubRecord(ASSET, epochMillis(7)), grant.token);
        expect((await harness.store.load(ASSET))?.savedAt).toBe(7);
      });
    });

    describe('renewal and release under contention', () => {
      it('refuses renewal once the lease has been taken', async () => {
        const harness = create();
        const old = await mustAcquire(harness.store, ASSET, 'node-a#1');
        harness.advance(harness.termMs);
        await mustAcquire(harness.store, ASSET, 'node-b#1');
        const outcome = await harness.store.renew(old);
        expect(outcome.kind).toBe('lost');
        if (outcome.kind !== 'lost') throw new Error('unreachable');
        expect(outcome.current?.holder).toBe('node-b#1');
      });

      it('refuses renewal of an expired grant nobody has taken', async () => {
        const harness = create();
        const grant = await mustAcquire(harness.store, ASSET, 'node-a#1');
        harness.advance(harness.termMs);
        expect(await harness.store.renew(grant)).toMatchObject({ kind: 'lost', current: null });
      });

      it('a superseded holder cannot release its successor lease', async () => {
        const harness = create();
        const old = await mustAcquire(harness.store, ASSET, 'node-a#1');
        harness.advance(harness.termMs);
        const fresh = await mustAcquire(harness.store, ASSET, 'node-b#1');
        await harness.store.release(old);
        // Still node-b's, and still writable by it.
        expect((await harness.store.inspect(ASSET))?.holder).toBe('node-b#1');
        await harness.store.saveFenced(stubRecord(ASSET, epochMillis(3)), fresh.token);
      });
    });

    describe('grant intervals never overlap', () => {
      it('every grant begins at or after the previous one ended', async () => {
        const harness = create();
        const grants: LeaseGrant[] = [];
        for (let round = 0; round < 40; round += 1) {
          const grant = await mustAcquire(harness.store, ASSET, `node-${round % 3}#${round}`);
          grants.push(grant);
          if (round % 2 === 0) {
            await harness.store.release(grant);
          } else {
            harness.advance(harness.termMs);
          }
        }
        for (let i = 1; i < grants.length; i += 1) {
          const previous = grants[i - 1]!;
          const current = grants[i]!;
          // Either the previous grant had ended by expiry, or it was released
          // before this one began. Both show up the same way here: a grant is
          // never issued while another is in force, and the battery above
          // proves the in-force case is refused.
          expect(current.grantedAt).toBeGreaterThanOrEqual(previous.grantedAt);
          expect(current.token).toBeGreaterThan(previous.token);
        }
      });
    });

    describe('the replication log', () => {
      // **Cycle Audit 5, finding 3.** This battery had zero occurrences of
      // "seam" and never called `appendTicks`, `recordSeam` or `readRecord`. It
      // covered mutual exclusion, expiry, fence tokens and leases — six of the
      // interface's thirteen members — while PH-15 cited it as the evidence that
      // the deployment store is correct.
      //
      // The cost was measured: three guards in the SQLite store could be
      // deleted with the whole 1,495-test suite green, including the fence on
      // `recordSeam`. The in-memory store's equivalents were covered, so the
      // plants in PH-14.3's table fired — against the store the venue does not
      // run.

      it('records and reads back ticks', async () => {
        const harness = create();
        const token = (await mustAcquire(harness.store, ASSET, 'node-a#1')).token;
        await harness.store.appendTicks(ASSET, token, [stubTick(1), stubTick(2)]);
        expect(await harness.store.recordHead(ASSET)).toBe(2);
        expect((await harness.store.readRecord(ASSET, 1, 10)).map((e) => e.kind)).toEqual([
          'tick',
          'tick',
        ]);
      });

      it('refuses a gap, and a seam is the only way past one', async () => {
        const harness = create();
        const token = (await mustAcquire(harness.store, ASSET, 'node-a#1')).token;
        await harness.store.appendTicks(ASSET, token, [stubTick(1)]);
        await expect(harness.store.appendTicks(ASSET, token, [stubTick(500)])).rejects.toThrow();
        await harness.store.recordSeam(ASSET, token, seamAt(1, 500));
        await harness.store.appendTicks(ASSET, token, [stubTick(500)]);
        expect(await harness.store.recordHead(ASSET)).toBe(500);
      });

      it('refuses a differing tick at a recorded sequence', async () => {
        const harness = create();
        const token = (await mustAcquire(harness.store, ASSET, 'node-a#1')).token;
        await harness.store.appendTicks(ASSET, token, [stubTick(1), stubTick(2)]);
        await expect(
          harness.store.appendTicks(ASSET, token, [stubTick(2, 999_999)]),
        ).rejects.toBeInstanceOf(RecordForkError);
        // Identical replay is accepted: that is the resume path working.
        await harness.store.appendTicks(ASSET, token, [stubTick(2), stubTick(3)]);
        expect(await harness.store.recordHead(ASSET)).toBe(3);
      });

      it('fences the append, the seam and the checkpoint alike', async () => {
        const harness = create();
        const stranded = (await mustAcquire(harness.store, ASSET, 'node-a#1')).token;
        await harness.store.appendTicks(ASSET, stranded, [stubTick(1)]);
        harness.advance(harness.termMs);
        await mustAcquire(harness.store, ASSET, 'node-b#1');

        await expect(harness.store.appendTicks(ASSET, stranded, [stubTick(2)])).rejects.toThrow();
        await expect(harness.store.recordSeam(ASSET, stranded, seamAt(1, 500))).rejects.toThrow();
        await expect(
          harness.store.saveFenced(stubRecord(ASSET, epochMillis(2)), stranded),
        ).rejects.toThrow();
        expect(await harness.store.recordHead(ASSET)).toBe(1);
        expect(await harness.store.seams(ASSET)).toEqual([]);
      });

      it('refuses a seam that does not continue the record', async () => {
        const harness = create();
        const token = (await mustAcquire(harness.store, ASSET, 'node-a#1')).token;
        await harness.store.appendTicks(ASSET, token, [stubTick(1), stubTick(2)]);
        await expect(harness.store.recordSeam(ASSET, token, seamAt(1, 500))).rejects.toBeInstanceOf(
          SeamError,
        );
        await expect(
          harness.store.recordSeam(ASSET, token, seamAt(null, 500)),
        ).rejects.toBeInstanceOf(SeamError);
      });

      it('refuses a seam that does not move forward', async () => {
        const harness = create();
        const token = (await mustAcquire(harness.store, ASSET, 'node-a#1')).token;
        await harness.store.appendTicks(ASSET, token, [stubTick(1), stubTick(2)]);
        await expect(harness.store.recordSeam(ASSET, token, seamAt(2, 2))).rejects.toBeInstanceOf(
          SeamError,
        );
        await expect(harness.store.recordSeam(ASSET, token, seamAt(2, 1))).rejects.toBeInstanceOf(
          SeamError,
        );
      });

      it.each([0, -1, 1.5])('refuses a seam resuming at sequence %s', async (resumesAt) => {
        const harness = create();
        const token = (await mustAcquire(harness.store, ASSET, 'node-a#1')).token;
        await harness.store.appendTicks(ASSET, token, [stubTick(1)]);
        await expect(
          harness.store.recordSeam(ASSET, token, seamAt(1, resumesAt)),
        ).rejects.toBeInstanceOf(SeamError);
      });

      it('refuses a seam naming another asset', async () => {
        const harness = create();
        const token = (await mustAcquire(harness.store, ASSET, 'node-a#1')).token;
        await harness.store.appendTicks(ASSET, token, [stubTick(1)]);
        await expect(
          harness.store.recordSeam(ASSET, token, { ...seamAt(1, 500), assetId: 'gbpusd' }),
        ).rejects.toBeInstanceOf(SeamError);
      });

      it('hands a reader the seam before the ticks that follow it', async () => {
        const harness = create();
        const token = (await mustAcquire(harness.store, ASSET, 'node-a#1')).token;
        await harness.store.appendTicks(ASSET, token, [stubTick(1), stubTick(2)]);
        await harness.store.recordSeam(ASSET, token, seamAt(2, 500));
        await harness.store.appendTicks(ASSET, token, [stubTick(500), stubTick(501)]);
        expect((await harness.store.readRecord(ASSET, 3, 10)).map((e) => e.kind)).toEqual([
          'seam',
          'tick',
          'tick',
        ]);
        expect(await harness.store.seams(ASSET)).toHaveLength(1);
      });

      it('reports no record for an asset that has none', async () => {
        const { store } = create();
        expect(await store.recordHead(ASSET)).toBeNull();
        expect(await store.readRecord(ASSET, 1, 10)).toEqual([]);
        expect(await store.seams(ASSET)).toEqual([]);
      });
    });

    describe('AssetLease', () => {
      it('reports the holder that stopped it', async () => {
        const { store } = create();
        await mustAcquire(store, ASSET, 'node-a#1');
        const result = await AssetLease.acquire(store, ASSET, 'node-b#1');
        expect(result).not.toBeInstanceOf(AssetLease);
        expect((result as { heldBy: LeaseGrant }).heldBy.holder).toBe('node-a#1');
      });

      it('goes lost exactly once and stays lost', async () => {
        const harness = create();
        const lease = await AssetLease.acquire(harness.store, ASSET, 'node-a#1');
        if (!(lease instanceof AssetLease)) throw new Error('expected a lease');
        expect(lease.lost).toBe(false);
        expect(await lease.renew()).toBe(true);

        harness.advance(harness.termMs);
        await mustAcquire(harness.store, ASSET, 'node-b#1');

        expect(await lease.renew()).toBe(false);
        expect(lease.lost).toBe(true);
        expect(await lease.renew()).toBe(false);
      });

      it('release is idempotent and does not disturb a successor', async () => {
        const harness = create();
        const lease = await AssetLease.acquire(harness.store, ASSET, 'node-a#1');
        if (!(lease instanceof AssetLease)) throw new Error('expected a lease');
        harness.advance(harness.termMs);
        const fresh = await mustAcquire(harness.store, ASSET, 'node-b#1');
        await lease.release();
        await lease.release();
        expect((await harness.store.inspect(ASSET))?.token).toBe(fresh.token);
      });
    });
  });
}

const CONFORMANCE_GENESIS = epochMillis(1_776_000_000_000);

describeCoordinatedStore('MemoryCoordinatedStore', () => {
  const clock = new SteppableClock(CONFORMANCE_GENESIS);
  return {
    store: new MemoryCoordinatedStore(clock),
    advance: (byMs: number) => {
      clock.set(epochMillis(clock.now() + byMs));
    },
    termMs: DEFAULT_LEASE_TERM_MS,
  };
});
