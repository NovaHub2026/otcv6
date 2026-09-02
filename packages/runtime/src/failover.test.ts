// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream), INV-008 (continuous market state), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  MasterKeyring,
  parseCursor,
  SteppableClock,
  type Tick,
} from '@otc/core';
import { ASSET_CATALOGUE, ENGINE_STREAM_PURPOSES } from '@otc/engine';
import { StaleFenceError } from './fence.js';
import { FollowerMarket } from './follower.js';
import { LeaderSession, LeadershipLostError, MAX_CONSECUTIVE_APPEND_FAILURES } from './failover.js';
import { DEFAULT_LEASE_TERM_MS, MemoryCoordinatedStore, type CoordinatedStore } from './lease.js';
import type { MarketStateRecord } from './state.js';

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('failover-spec');
const asset = ASSET_CATALOGUE[0]!;
const ASSET = asset.definition.id;
/** These tests declare their catch-up bursts; see the note in `hosted.test.ts`. */
const TEST_CATCH_UP_MS = 86_400_000;
const STEP_MS = 5_000;

function base(store: CoordinatedStore, clock: SteppableClock, holder: string) {
  return {
    asset,
    keyring,
    environment: 'test' as const,
    clock,
    store,
    holder,
    genesisInstant: GENESIS,
    maxCatchUpMs: TEST_CATCH_UP_MS,
  };
}

async function lead(
  store: CoordinatedStore,
  clock: SteppableClock,
  holder: string,
): Promise<LeaderSession> {
  const result = await LeaderSession.takeOver(base(store, clock, holder));
  if (result.kind !== 'led') {
    throw new Error(`expected to lead, but it is held by ${result.heldBy.holder}`);
  }
  return result.session;
}

/** Run a session forward, returning everything it published. */
async function run(session: LeaderSession, clock: SteppableClock, steps: number): Promise<Tick[]> {
  const published: Tick[] = [];
  for (let step = 0; step < steps; step += 1) {
    clock.advance(durationMillis(STEP_MS));
    const advance = await session.advance(clock.now());
    published.push(...advance.ticks);
  }
  return published;
}

/** Damage a checkpoint so the resume path must seam rather than continue. */
async function forceSeam(store: MemoryCoordinatedStore): Promise<MarketStateRecord> {
  const record = await store.load(ASSET);
  if (record === null) throw new Error('no checkpoint to damage');
  if (record.pending === null) throw new Error('no pending tick to disagree with');
  // The executed check in `resumeMarket`: a restored snapshot must agree with
  // the record's own pending tick. Disagreement means the record does not
  // describe this engine, which is exactly the condition a seam exists for.
  const damaged: MarketStateRecord = {
    ...record,
    snapshot: { ...record.snapshot, sequence: record.pending.sequence + 7 },
  };
  await store.save(damaged);
  return record;
}

describe('two nodes cannot both take over', () => {
  it('declines the second and names the holder', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    await lead(store, clock, 'api-1#aa');
    const second = await LeaderSession.takeOver(base(store, clock, 'api-2#bb'));
    expect(second.kind).toBe('declined');
    if (second.kind !== 'declined') throw new Error('unreachable');
    expect(second.heldBy.holder).toBe('api-1#aa');
  });

  it('lets a successor in once the lease is released', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const first = await lead(store, clock, 'api-1#aa');
    await first.release();
    const second = await lead(store, clock, 'api-2#bb');
    expect(second.token).toBeGreaterThan(first.token);
  });

  it('lets a successor in once the lease expires', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const first = await lead(store, clock, 'api-1#aa');
    await run(first, clock, 2);
    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    const second = await lead(store, clock, 'api-2#bb');
    expect(second.token).toBeGreaterThan(first.token);
  });
});

describe('a session that has lost its lease generates nothing', () => {
  it('refuses to advance rather than returning empty', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const stranded = await lead(store, clock, 'api-1#aa');
    await run(stranded, clock, 2);

    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    await lead(store, clock, 'api-2#bb');

    clock.advance(durationMillis(STEP_MS));
    // Not an empty result. A leader that had lost its lease would look
    // identical to one that was simply idle, which is the ordinary case.
    await expect(stranded.advance(clock.now())).rejects.toBeInstanceOf(LeadershipLostError);
    expect(stranded.lost).toBe(true);
  });

  it('renews before generating, so no keystream is spent without authority', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const stranded = await lead(store, clock, 'api-1#aa');
    await run(stranded, clock, 2);
    const before = stranded.market.snapshotEngine().cursors;

    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    await lead(store, clock, 'api-2#bb');
    clock.advance(durationMillis(STEP_MS));
    await expect(stranded.advance(clock.now())).rejects.toBeInstanceOf(LeadershipLostError);

    // The market did not move. Had the session advanced first and renewed
    // afterwards, the fence would have refused the append only after the
    // positions were already gone.
    expect(stranded.market.snapshotEngine().cursors).toEqual(before);
  });
});

describe('a takeover that resumes changes the record by nothing', () => {
  it('re-appends the ticks the dead leader published but never checkpointed', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    // A long checkpoint interval, so the record runs well ahead of the state.
    const dying = await LeaderSession.takeOver({
      ...base(store, clock, 'api-1#aa'),
      checkpointIntervalMs: 1_000_000,
    });
    if (dying.kind !== 'led') throw new Error('expected to lead');
    const published = await run(dying.session, clock, 20);
    expect(published.length).toBeGreaterThan(10);

    const headBefore = await store.recordHead(ASSET);
    const recordBefore = await store.readRecord(ASSET, 1, 10_000);

    // The node dies. Nothing is released; the lease simply expires.
    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    const successor = await lead(store, clock, 'api-2#bb');
    expect(successor.recovery.kind).toBe('resumed');

    // The successor regenerates what the dead leader published beyond its
    // checkpoint. Deterministic replay reproduces them identically, so the
    // append is idempotent and the record is unchanged over that range.
    await run(successor, clock, 5);
    const recordAfter = await store.readRecord(ASSET, 1, 10_000);
    expect(recordAfter.slice(0, recordBefore.length)).toEqual(recordBefore);
    expect(await store.recordHead(ASSET)).toBeGreaterThanOrEqual(headBefore!);
    expect(await store.seams(ASSET)).toEqual([]);
  });

  it('never lets the record hold two ticks at one sequence', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const dying = await LeaderSession.takeOver({
      ...base(store, clock, 'api-1#aa'),
      checkpointIntervalMs: 1_000_000,
    });
    if (dying.kind !== 'led') throw new Error('expected to lead');
    await run(dying.session, clock, 30);

    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    const successor = await lead(store, clock, 'api-2#bb');
    await run(successor, clock, 30);

    const entries = await store.readRecord(ASSET, 1, 100_000);
    const seen = new Set<number>();
    let duplicated = 0;
    for (const entry of entries) {
      if (entry.kind !== 'tick') continue;
      if (seen.has(entry.tick.sequence)) duplicated += 1;
      seen.add(entry.tick.sequence);
    }
    expect(duplicated).toBe(0);
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe('a takeover that seams records the seam', () => {
  it('records it before the first tick, and it names the record head', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const dying = await lead(store, clock, 'api-1#aa');
    await run(dying, clock, 20);
    const headBefore = await store.recordHead(ASSET);
    await forceSeam(store);

    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    const successor = await lead(store, clock, 'api-2#bb');
    expect(successor.recovery.kind).toBe('seam');
    expect(successor.pendingSeam).toBe(true);

    clock.advance(durationMillis(STEP_MS));
    const advance = await successor.advance(clock.now());
    expect(advance.ticks.length).toBeGreaterThan(0);
    expect(advance.seam).not.toBeNull();
    expect(successor.pendingSeam).toBe(false);

    const seams = await store.seams(ASSET);
    expect(seams).toHaveLength(1);
    const seam = seams[0]!;
    expect(seam.assetId).toBe(ASSET);
    expect(seam.lastSequence).toBe(headBefore);
    expect(seam.resumesAtSequence).toBe(advance.ticks[0]!.sequence);
    expect(seam.resumesAtSequence).toBeGreaterThan(headBefore!);
    expect(seam.reason).toContain('pending tick');
  });

  it('records exactly one seam however long the successor runs', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const dying = await lead(store, clock, 'api-1#aa');
    await run(dying, clock, 20);
    await forceSeam(store);

    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    const successor = await lead(store, clock, 'api-2#bb');
    await run(successor, clock, 20);
    expect(await store.seams(ASSET)).toHaveLength(1);
  });

  it('moves every stream cursor beyond what the dead leader reserved', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const dying = await lead(store, clock, 'api-1#aa');
    await run(dying, clock, 20);
    const dead = await forceSeam(store);

    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    const successor = await lead(store, clock, 'api-2#bb');
    await run(successor, clock, 2);

    const cursors = successor.market.snapshotEngine().cursors;
    for (const purpose of ENGINE_STREAM_PURPOSES) {
      const reserved = parseCursor(dead.leasedBlocks[purpose]!).blockIndex;
      const resumed = parseCursor(cursors[purpose]!).blockIndex;
      // Not merely different: strictly at or beyond every position the dead
      // leader had reserved. Anything less would spend a keystream position a
      // second time, under a second latent state, which is INV-003 broken.
      expect(resumed).toBeGreaterThanOrEqual(reserved);
    }
  });
});

describe('a follower sees the seam, and cannot read across it', () => {
  it('replicates the discontinuity and reports it', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const follower = new FollowerMarket({ assetId: ASSET });

    const dying = await lead(store, clock, 'api-1#aa');
    await run(dying, clock, 20);
    await follower.pull(store);
    const beforeSeam = follower.head!;
    await forceSeam(store);

    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    const successor = await lead(store, clock, 'api-2#bb');
    await run(successor, clock, 10);
    await follower.pull(store);

    expect(follower.seams).toHaveLength(1);
    const seam = follower.seams[0]!;
    expect(seam.lastSequence).toBe(beforeSeam);
    expect(follower.head).toBe(
      seam.resumesAtSequence + countAfter(follower, seam.resumesAtSequence),
    );

    // The price inside the gap is null: nothing was published there and no node
    // was generating.
    const midpoint = epochMillis(Math.floor((seam.lastInstant! + seam.resumesAtInstant) / 2));
    if (midpoint > seam.lastInstant! && midpoint < seam.resumesAtInstant) {
      expect(follower.priceAt(midpoint)).toBeNull();
    }
    expect(follower.priceAt(seam.lastInstant!)).not.toBeNull();
    expect(follower.priceAt(seam.resumesAtInstant)).not.toBeNull();

    // A contract opening before the seam and expiring after it crosses one.
    expect(follower.spansSeam(seam.lastInstant!, seam.resumesAtInstant)).toBe(true);
    expect(follower.spansSeam(seam.resumesAtInstant, epochMillis(seam.resumesAtInstant + 1))).toBe(
      false,
    );
  });

  it('hands a client the seam rather than two runs of ticks', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const follower = new FollowerMarket({ assetId: ASSET });

    const dying = await lead(store, clock, 'api-1#aa');
    await run(dying, clock, 20);
    await forceSeam(store);
    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    const successor = await lead(store, clock, 'api-2#bb');
    await run(successor, clock, 10);
    await follower.pull(store);

    const result = follower.serve(1, await store.recordHead(ASSET));
    expect(result.kind).toBe('entries');
    if (result.kind !== 'entries') throw new Error('unreachable');
    expect(result.entries.filter((e) => e.kind === 'seam')).toHaveLength(1);

    // And a client resuming from a sequence inside the gap is given the seam
    // first, so it cannot conclude the record simply continued.
    const seam = follower.seams[0]!;
    const inGap = follower.serve(seam.lastSequence! + 1, await store.recordHead(ASSET));
    if (inGap.kind !== 'entries') throw new Error('expected entries');
    expect(inGap.entries[0]?.kind).toBe('seam');
  });
});

describe('the record refuses a seam that does not continue it', () => {
  it('refuses one under a stale token', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const stranded = await lead(store, clock, 'api-1#aa');
    await run(stranded, clock, 5);
    const head = await store.recordHead(ASSET);
    const staleToken = stranded.token;

    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS));
    await lead(store, clock, 'api-2#bb');

    await expect(
      store.recordSeam(ASSET, staleToken, {
        assetId: ASSET,
        lastSequence: head,
        lastInstant: GENESIS,
        resumesAtSequence: head! + 100_000,
        resumesAtInstant: clock.now(),
        reason: 'forged',
      }),
    ).rejects.toBeInstanceOf(StaleFenceError);
    expect(await store.seams(ASSET)).toEqual([]);
  });
});

/** How many ticks the follower holds at or beyond a sequence, minus one. */
function countAfter(follower: FollowerMarket, sequence: number): number {
  return follower.retained.filter((tick) => tick.sequence >= sequence).length - 1;
}

/**
 * A store whose `appendTicks` fails on demand.
 *
 * The shape of a lock timeout on a shared SQLite file: `acquire()` under a held
 * write lock was measured refusing with "database is locked" after 5,019ms
 * (a5-06). Everything else is the in-memory reference, so what is under test is
 * the session's response and nothing about the store.
 */
class FailingAppendStore implements CoordinatedStore {
  failNext = 0;
  appendCalls = 0;

  constructor(private readonly inner: MemoryCoordinatedStore) {}

  get termMs(): number {
    return this.inner.termMs;
  }

  acquire(assetId: string, holder: string) {
    return this.inner.acquire(assetId, holder);
  }
  renew(grant: Parameters<CoordinatedStore['renew']>[0]) {
    return this.inner.renew(grant);
  }
  release(grant: Parameters<CoordinatedStore['release']>[0]) {
    return this.inner.release(grant);
  }
  inspect(assetId: string) {
    return this.inner.inspect(assetId);
  }
  saveFenced(record: MarketStateRecord, token: number) {
    return this.inner.saveFenced(record, token);
  }
  save(record: MarketStateRecord) {
    return this.inner.save(record);
  }
  load(assetId: string) {
    return this.inner.load(assetId);
  }
  list() {
    return this.inner.list();
  }
  appendTicks(assetId: string, token: number, ticks: readonly Tick[]) {
    this.appendCalls += 1;
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new Error('SQLITE_BUSY: database is locked (simulated)'));
    }
    return this.inner.appendTicks(assetId, token, ticks);
  }
  recordSeam(assetId: string, token: number, seam: Parameters<CoordinatedStore['recordSeam']>[2]) {
    return this.inner.recordSeam(assetId, token, seam);
  }
  readRecord(assetId: string, fromSequence: number, limit: number) {
    return this.inner.readRecord(assetId, fromSequence, limit);
  }
  recordHead(assetId: string) {
    return this.inner.recordHead(assetId);
  }
  seams(assetId: string) {
    return this.inner.seams(assetId);
  }
}

/** Advance until the market publishes something, so an append is attempted. */
async function advanceUntilTicks(session: LeaderSession, clock: SteppableClock) {
  for (let step = 0; step < 100; step += 1) {
    clock.advance(durationMillis(STEP_MS));
    const advance = await session.advance(clock.now());
    if (advance.ticks.length > 0) return advance;
  }
  throw new Error('the market published nothing in a hundred steps');
}

describe('a transient store failure does not wedge the leader (a5-03)', () => {
  it('keeps the unappended ticks and retries them first, so the record catches up', async () => {
    // Before this test: one failing append left the market advanced and the
    // record behind for ever. Every later advance appended only the new ticks,
    // which the store correctly refused as a gap — measured as a record head of
    // 1 against a market at sequence 8, five append calls, no seam recorded and
    // the lease never lost. A leader publishing to its observers and writing
    // none of it, indefinitely.
    const clock = new SteppableClock(GENESIS);
    const store = new FailingAppendStore(new MemoryCoordinatedStore(clock));
    const session = await lead(store, clock, 'api-1#aa');
    await advanceUntilTicks(session, clock);

    store.failNext = 1;
    const failed = await advanceUntilTicks(session, clock);
    expect(failed.unrecorded).toBe(failed.ticks.length);
    expect(failed.recordError?.message).toMatch(/SQLITE_BUSY/);
    // The record is behind the market, and the session knows it.
    expect(await store.recordHead(ASSET)).toBeLessThan(session.market.lastPublishedSequence!);
    expect(session.lost).toBe(false);

    const recovered = await advanceUntilTicks(session, clock);
    expect(recovered.unrecorded).toBe(0);
    expect(recovered.recordError).toBeNull();
    expect(await store.recordHead(ASSET)).toBe(session.market.lastPublishedSequence);
    // Gapless, and no seam: nothing was discontinuous, the store was merely
    // busy for one call.
    const entries = await store.readRecord(ASSET, 1, 100_000);
    const sequences = entries.map((entry) => (entry.kind === 'tick' ? entry.tick.sequence : -1));
    expect(sequences).toEqual(Array.from({ length: sequences.length }, (_, i) => i + 1));
    expect(await store.seams(ASSET)).toEqual([]);
  });

  it('never writes a checkpoint the record has not caught up with', async () => {
    // A successor resumes from the checkpoint and appends from its
    // `lastPublished` onward. A checkpoint ahead of the record would make that
    // first append a gap, refused for ever — the same wedge, handed to the next
    // leader. So while ticks are unrecorded the checkpoint waits, on the
    // cadence and on demand alike.
    const clock = new SteppableClock(GENESIS);
    const store = new FailingAppendStore(new MemoryCoordinatedStore(clock));
    const session = await LeaderSession.takeOver({
      ...base(store, clock, 'api-1#aa'),
      checkpointIntervalMs: 1,
    });
    if (session.kind !== 'led') throw new Error('expected to lead');
    await advanceUntilTicks(session.session, clock);
    const before = await store.load(ASSET);

    store.failNext = 2;
    const failed = await advanceUntilTicks(session.session, clock);
    expect(failed.checkpointed).toBe(false);
    expect(await store.load(ASSET)).toEqual(before);
    await expect(session.session.checkpoint(clock.now())).rejects.toThrow(/SQLITE_BUSY/);
    expect(await store.load(ASSET)).toEqual(before);

    // Once the record has caught up, the checkpoint follows it.
    const recovered = await advanceUntilTicks(session.session, clock);
    expect(recovered.unrecorded).toBe(0);
    expect(recovered.checkpointed).toBe(true);
    expect((await store.load(ASSET))?.lastPublished?.sequence).toBe(await store.recordHead(ASSET));
  });

  it('gives leadership up after repeated failures, so a successor takes over rather than nobody noticing', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new FailingAppendStore(new MemoryCoordinatedStore(clock));
    const session = await lead(store, clock, 'api-1#aa');
    await advanceUntilTicks(session, clock);

    store.failNext = MAX_CONSECUTIVE_APPEND_FAILURES;
    let failures = 0;
    let lost: unknown = null;
    for (let step = 0; step < 100 && lost === null; step += 1) {
      clock.advance(durationMillis(STEP_MS));
      try {
        const advance = await session.advance(clock.now());
        if (advance.recordError !== null) failures += 1;
      } catch (error) {
        lost = error;
      }
    }
    expect(lost).toBeInstanceOf(LeadershipLostError);
    expect((lost as Error).cause).toBeInstanceOf(Error);
    expect(failures).toBe(MAX_CONSECUTIVE_APPEND_FAILURES - 1);
    expect(session.lost).toBe(true);
    // Released, not merely lost: a successor need not wait out the term, and
    // it resumes from a checkpoint the record is not behind.
    expect(await store.inspect(ASSET)).toBeNull();
    const successor = await lead(store, clock, 'api-2#bb');
    expect(successor.recovery.kind).toBe('resumed');
    await advanceUntilTicks(successor, clock);
    expect(await store.recordHead(ASSET)).toBe(successor.market.lastPublishedSequence);
  });
});
