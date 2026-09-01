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
import { LeaderSession, LeadershipLostError } from './failover.js';
import { DEFAULT_LEASE_TERM_MS, MemoryCoordinatedStore } from './lease.js';
import type { MarketStateRecord } from './state.js';

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('failover-spec');
const asset = ASSET_CATALOGUE[0]!;
const ASSET = asset.definition.id;
/** These tests declare their catch-up bursts; see the note in `hosted.test.ts`. */
const TEST_CATCH_UP_MS = 86_400_000;
const STEP_MS = 5_000;

function base(store: MemoryCoordinatedStore, clock: SteppableClock, holder: string) {
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
  store: MemoryCoordinatedStore,
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
    for (const entry of entries) {
      if (entry.kind !== 'tick') continue;
      expect(seen.has(entry.tick.sequence)).toBe(false);
      seen.add(entry.tick.sequence);
    }
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
