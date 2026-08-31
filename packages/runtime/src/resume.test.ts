// Invariant evidence: INV-008 (continuous market state), INV-009 (reproducible settlement), INV-010 (private generator state).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { FileStateStore, MemoryStateStore } from './fileStore.js';
import { checkpointMarket, resumeMarket } from './resume.js';
import { CorruptRecordError, findSecretShapedValues, STATE_RECORD_VERSION } from './state.js';

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('persistence-spec');
const asset = ASSET_CATALOGUE[0]!;

function base(store: MemoryStateStore | FileStateStore, clock: SteppableClock) {
  return {
    asset,
    keyring,
    environment: 'test' as const,
    clock,
    store,
    genesisInstant: GENESIS,
  };
}

describe('a market with no history starts fresh', () => {
  it('reports fresh and produces ticks', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryStateStore();
    const { market, outcome } = await resumeMarket(base(store, clock));
    expect(outcome.kind).toBe('fresh');
    clock.advance(durationMillis(60_000));
    expect(market.advance().length).toBeGreaterThan(0);
  });
});

describe('restarting from an intact snapshot continues the same market', () => {
  it('produces exactly the ticks an uninterrupted market would have', async () => {
    // The property the whole design exists for. One market runs straight
    // through; another is checkpointed, destroyed, and resumed. Their published
    // ticks must be identical — same instants, same prices, same sequence.
    const straightClock = new SteppableClock(GENESIS);
    const straight = await resumeMarket(base(new MemoryStateStore(), straightClock));

    const store = new MemoryStateStore();
    const firstClock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, firstClock));

    const straightTicks: Tick[] = [];
    const restartedTicks: Tick[] = [];

    // Both run for five minutes.
    for (let minute = 0; minute < 5; minute += 1) {
      straightClock.advance(durationMillis(60_000));
      straightTicks.push(...straight.market.advance());
      firstClock.advance(durationMillis(60_000));
      restartedTicks.push(...first.market.advance());
    }

    // Checkpoint and "crash".
    await store.save(checkpointMarket(first.market, asset.definition.id, firstClock.now()));

    const secondClock = new SteppableClock(firstClock.now());
    const second = await resumeMarket(base(store, secondClock));
    expect(second.outcome.kind).toBe('resumed');

    for (let minute = 0; minute < 5; minute += 1) {
      straightClock.advance(durationMillis(60_000));
      straightTicks.push(...straight.market.advance());
      secondClock.advance(durationMillis(60_000));
      restartedTicks.push(...second.market.advance());
    }

    expect(restartedTicks).toEqual(straightTicks);
  });

  it('carries the pending tick across the restart', async () => {
    // Restoring the snapshot alone would skip it: the snapshot is taken after
    // every draw, so the restored engine's next tick is the one *after* the
    // pending one. Losing it is the quietest way to break replay.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    first.market.advance();
    first.market.prime();
    const pending = first.market.pending;
    expect(pending).not.toBeNull();

    await store.save(checkpointMarket(first.market, asset.definition.id, clock.now()));
    const resumedClock = new SteppableClock(clock.now());
    const second = await resumeMarket(base(store, resumedClock));

    resumedClock.advance(durationMillis(60_000));
    const next = second.market.advance();
    expect(next[0]).toEqual(pending);
  });

  it('replays the gap when the clock moved while the process was down', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(60_000));
    first.market.advance();
    await store.save(checkpointMarket(first.market, asset.definition.id, clock.now()));

    // Down for ten minutes. The market did not stop.
    const later = new SteppableClock(epochMillis(clock.now() + 600_000));
    const second = await resumeMarket({ ...base(store, later), maxCatchUpMs: 3_600_000 });
    const replayed = second.market.advance();
    expect(replayed.length).toBeGreaterThan(100);
    for (const tick of replayed) expect(tick.instant).toBeLessThanOrEqual(later.now());
  });
});

describe('an unusable record takes the seam, and says so', () => {
  it('refuses to start at all when the record will not parse', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    first.market.advance();
    await store.save(checkpointMarket(first.market, asset.definition.id, clock.now()));
    store.corrupt(asset.definition.id);

    // Not 'fresh'. A corrupt record means something ran and its lease marks are
    // gone; restarting at genesis would re-consume keystream from block zero and
    // publish a second, different market under the same id. There is no safe
    // automatic recovery, so the market refuses to start.
    await expect(resumeMarket(base(store, new SteppableClock(clock.now())))).rejects.toThrow(
      CorruptRecordError,
    );
  });

  it('seams when the record is structurally wrong', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    first.market.advance();
    const record = checkpointMarket(first.market, asset.definition.id, clock.now());
    await store.save({ ...record, version: STATE_RECORD_VERSION + 1 });

    const second = await resumeMarket(base(store, new SteppableClock(clock.now())));
    expect(second.outcome.kind).toBe('seam');
    if (second.outcome.kind === 'seam') {
      expect(second.outcome.reason).toMatch(/version/);
    }
  });

  it('never spends a keystream position twice across a seam', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    first.market.advance();
    const record = checkpointMarket(first.market, asset.definition.id, clock.now());
    await store.save({ ...record, version: STATE_RECORD_VERSION + 1 });

    const second = await resumeMarket(base(store, new SteppableClock(clock.now())));
    const resumedSnapshot = second.market.snapshotEngine();
    for (const [purpose, cursor] of Object.entries(record.snapshot.cursors)) {
      const consumedBefore = BigInt(cursor.split(':')[0]!);
      const startsAt = BigInt(resumedSnapshot.cursors[purpose]!.split(':')[0]!);
      expect(startsAt, purpose).toBeGreaterThan(consumedBefore);
    }
  });

  it('continues from the last published price rather than jumping', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    const before = first.market.advance();
    const lastPrice = before[before.length - 1]!.price;
    const record = checkpointMarket(first.market, asset.definition.id, clock.now());
    await store.save({ ...record, version: STATE_RECORD_VERSION + 1 });

    const laterClock = new SteppableClock(epochMillis(clock.now() + 60_000));
    const second = await resumeMarket(base(store, laterClock));
    const after = second.market.advance();
    expect(after.length).toBeGreaterThan(0);
    expect(Math.abs(after[0]!.price - lastPrice)).toBeLessThan(5_000);
  });
});

describe('persisted state carries no key material', () => {
  it('contains no long hex runs anywhere', async () => {
    // PH-1 found exactly this defect in memory: a keyring whose `private` field
    // was compile-time only serialised its entire master secret. On disk it
    // would be considerably worse.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const { market } = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(300_000));
    market.advance();
    const record = checkpointMarket(market, asset.definition.id, clock.now());
    expect(findSecretShapedValues(record)).toEqual([]);
    expect(JSON.stringify(record)).not.toMatch(/[0-9a-f]{32,}/i);
  });

  it('stays small', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const { market } = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(600_000));
    market.advance();
    const record = checkpointMarket(market, asset.definition.id, clock.now());
    expect(JSON.stringify(record).length).toBeLessThan(4_000);
  });
});

describe('the file store survives a real filesystem', () => {
  const directories: string[] = [];

  afterAll(async () => {
    for (const directory of directories) await rm(directory, { recursive: true, force: true });
  });

  it('round-trips a record through disk', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-state-'));
    directories.push(directory);
    const store = new FileStateStore(directory);
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    const before = first.market.advance();
    await store.save(checkpointMarket(first.market, asset.definition.id, clock.now()));

    expect(await store.list()).toEqual([asset.definition.id]);

    const second = await resumeMarket(base(store, new SteppableClock(clock.now())));
    expect(second.outcome.kind).toBe('resumed');
    expect(second.market.lastPublishedSequence).toBe(before[before.length - 1]!.sequence);
  });

  it('returns null for an asset it has never seen', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-state-'));
    directories.push(directory);
    expect(await new FileStateStore(directory).load('eurusd')).toBeNull();
    expect(await new FileStateStore(directory).list()).toEqual([]);
  });

  it('refuses an asset id that is not safe as a filename', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-state-'));
    directories.push(directory);
    await expect(new FileStateStore(directory).load('../escape')).rejects.toThrow(
      /Unsafe asset id/,
    );
  });
});
