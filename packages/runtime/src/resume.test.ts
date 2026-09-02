// Invariant evidence: INV-008 (continuous market state), INV-009 (reproducible settlement), INV-010 (private generator state).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { FileStateStore, MemoryStateStore } from './fileStore.js';
import { checkpointMarket, resumeMarket } from './resume.js';
import {
  CorruptRecordError,
  findSecretShapedValues,
  STATE_RECORD_VERSION,
  UnusableRecordError,
} from './state.js';

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('persistence-spec');
const asset = ASSET_CATALOGUE[0]!;

/** See the note in `hosted.test.ts`: these tests declare their catch-up bursts. */
const TEST_CATCH_UP_MS = 86_400_000;

function base(store: MemoryStateStore | FileStateStore, clock: SteppableClock) {
  return {
    asset,
    keyring,
    environment: 'test' as const,
    clock,
    store,
    genesisInstant: GENESIS,
    maxCatchUpMs: TEST_CATCH_UP_MS,
  };
}

/**
 * Two saves of one asset at once must not destroy each other.
 *
 * **Cycle Audit 6, minor.** The temporary path was unique per *process*, not per
 * call, so the first `rename` moved the file the second was still writing and
 * the second failed with `ENOENT` — 200 times out of 200, and observed on two
 * ordinary SIGTERM shutdowns of the shipped configuration.
 */
describe('a file store survives concurrent saves of one asset', () => {
  it('writes both without either failing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-race-'));
    try {
      const store = new FileStateStore(directory);
      // A real record, taken from a real market: the shape has to survive
      // `assertUsableRecord` on the way back in.
      const source = new FileStateStore(path.join(directory, 'source'));
      const { market } = await resumeMarket({
        asset,
        keyring,
        environment: 'test',
        clock: new SteppableClock(GENESIS),
        store: source,
        genesisInstant: GENESIS,
      });
      market.advanceTo(epochMillis(GENESIS + 10_000));
      const base = checkpointMarket(market, 'eurusd', GENESIS);
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await Promise.all([
          store.save({ ...base, savedAt: epochMillis(GENESIS + attempt) }),
          store.save({ ...base, savedAt: epochMillis(GENESIS + 1_000 + attempt) }),
        ]);
      }
      expect(await store.load('eurusd')).not.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

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
    // An *older* record version: the shape this code knows how to seam past.
    // A newer one is refused outright — see below.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    first.market.advance();
    const record = checkpointMarket(first.market, asset.definition.id, clock.now());
    await store.save({ ...record, version: STATE_RECORD_VERSION - 1 });

    const second = await resumeMarket(base(store, new SteppableClock(clock.now())));
    expect(second.outcome.kind).toBe('seam');
    if (second.outcome.kind === 'seam') {
      expect(second.outcome.reason).toMatch(/version/);
    }
  });

  it('refuses to start on a record newer than this code understands (a5-11)', async () => {
    // A downgrade or a mixed-version rollout. The record was written by code
    // that knows more than this does, so nothing it says about leases or
    // cursors can be read with confidence — which is `CorruptRecordError`'s
    // definition, not a seam's. Seaming here discontinued every market's
    // latent state silently-but-logged on every rollback.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    first.market.advance();
    const record = checkpointMarket(first.market, asset.definition.id, clock.now());
    await store.save({ ...record, version: STATE_RECORD_VERSION + 1 });

    await expect(resumeMarket(base(store, new SteppableClock(clock.now())))).rejects.toThrow(
      CorruptRecordError,
    );
    await expect(resumeMarket(base(store, new SteppableClock(clock.now())))).rejects.toThrow(
      new RegExp(`version ${STATE_RECORD_VERSION + 1}.*${STATE_RECORD_VERSION}`),
    );
  });

  it('never spends a keystream position twice across a seam', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    first.market.advance();
    const record = checkpointMarket(first.market, asset.definition.id, clock.now());
    await store.save({ ...record, version: STATE_RECORD_VERSION - 1 });

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
    await store.save({ ...record, version: STATE_RECORD_VERSION - 1 });

    const laterClock = new SteppableClock(epochMillis(clock.now() + 60_000));
    const second = await resumeMarket(base(store, laterClock));
    // The seam opens AT the clock, so nothing is due until time moves on. The
    // gap stays a gap, which is honest: the venue really was down.
    laterClock.advance(durationMillis(60_000));
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

describe('records that parse but are not records', () => {
  // Found by Cycle Audit 2. Every other malformed shape threw; only the JSON
  // literal `null` parsed cleanly and read as "nothing ever ran", restarting the
  // market at genesis and re-consuming keystream from block zero — the exact
  // failure PH-5.2 says has no safe automatic recovery.
  it.each([
    ['null', 'null'],
    ['a bare number', '42'],
    ['a string', '"eurusd"'],
    ['an array', '[]'],
  ])('refuses to start on %s', async (_label, payload) => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    first.market.advance();
    await store.save(checkpointMarket(first.market, asset.definition.id, clock.now()));
    store.replaceRaw(asset.definition.id, payload);

    await expect(resumeMarket(base(store, new SteppableClock(clock.now())))).rejects.toThrow(
      CorruptRecordError,
    );
  });
});

describe('the seam never starts inside spent keystream', () => {
  async function seedRecord(store: MemoryStateStore, clock: SteppableClock) {
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(600_000));
    first.market.advance();
    return checkpointMarket(first.market, asset.definition.id, clock.now());
  }

  it('floors each cursor at the record own snapshot, not only at its leases', async () => {
    // A damaged lease entry silently became startAt = 0, restarting the sign
    // stream — the one line in the engine that touches direction — at cursor 0:0
    // against positions already spent.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const record = await seedRecord(store, clock);
    const damaged = {
      ...record,
      version: STATE_RECORD_VERSION - 1,
      leasedBlocks: { ...record.leasedBlocks },
    };
    delete (damaged.leasedBlocks as Record<string, string>).sign;
    await store.save(damaged);

    const resumed = await resumeMarket(base(store, new SteppableClock(clock.now())));
    expect(resumed.outcome.kind).toBe('seam');
    const after = resumed.market.snapshotEngine();
    for (const [purpose, cursor] of Object.entries(record.snapshot.cursors)) {
      const consumed = BigInt(cursor.split(':')[0]!);
      const startsAt = BigInt(after.cursors[purpose]!.split(':')[0]!);
      expect(startsAt, `${purpose} restarted inside spent keystream`).toBeGreaterThan(consumed);
    }
  });

  it('treats a record belonging to another asset as corrupt, not as a seam', async () => {
    // Seaming on a foreign record re-issued 5,377 already-consumed blocks and
    // adopted the other asset's last price. A foreign record says nothing about
    // THIS asset's leases, which is the definition of refusing to start.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const record = await seedRecord(store, clock);
    await store.save({ ...record, assetId: asset.definition.id });
    store.replaceRaw(
      asset.definition.id,
      JSON.stringify({ ...record, assetId: 'some-other-asset' }),
    );

    await expect(resumeMarket(base(store, new SteppableClock(clock.now())))).rejects.toThrow(
      CorruptRecordError,
    );
  });

  it('refuses a record with no evidence at all for a stream', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const record = await seedRecord(store, clock);
    const stripped = {
      ...record,
      version: STATE_RECORD_VERSION - 1,
      leasedBlocks: { sign: record.leasedBlocks.sign! },
      snapshot: { ...record.snapshot, cursors: { sign: record.snapshot.cursors.sign! } },
    };
    await store.save(stripped);
    await expect(resumeMarket(base(store, new SteppableClock(clock.now())))).rejects.toThrow(
      UnusableRecordError,
    );
  });
});

describe('a checkpoint never erases published history', () => {
  it('records the inherited position when a resumed market has not published yet', async () => {
    // checkpointMarket used the process-local getter, so a resumed market
    // checkpointing before its first tick wrote lastPublished: null. Measured
    // consequences: a disabled catch-up bound, and a 1,347-step price reset on a
    // later seam.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    const published = first.market.advance();
    const lastSeen = published[published.length - 1]!;
    await store.save(checkpointMarket(first.market, asset.definition.id, clock.now()));

    // Second boot: resume and checkpoint immediately, publishing nothing.
    const secondClock = new SteppableClock(clock.now());
    const second = await resumeMarket(base(store, secondClock));
    expect(second.market.lastPublished).toBeNull();
    const rewritten = checkpointMarket(second.market, asset.definition.id, secondClock.now());

    expect(rewritten.lastPublished, 'history erased by an idle checkpoint').not.toBeNull();
    expect(rewritten.lastPublished!.sequence).toBe(lastSeen.sequence);
    expect(rewritten.lastPublished!.price).toBe(lastSeen.price);
  });
});

describe('a seam moves forward, never back', () => {
  async function seamed() {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(base(store, clock));
    clock.advance(durationMillis(120_000));
    first.market.advance();
    const record = checkpointMarket(first.market, asset.definition.id, clock.now());

    // Observers keep seeing ticks after the checkpoint — this is the window the
    // old seam rewound into and republished with different prices.
    clock.advance(durationMillis(300_000));
    const observed = first.market.advance();
    const lastObserved = observed[observed.length - 1]!;

    await store.save({ ...record, version: STATE_RECORD_VERSION - 1 });
    const resumeClock = new SteppableClock(clock.now());
    const second = await resumeMarket(base(store, resumeClock));
    return { second, resumeClock, lastObserved, record };
  }

  it('never republishes an instant an observer has already seen', async () => {
    // The defect: the seam restarted from the record's stale lastPublished and
    // regenerated 146 ticks inside the observed window, one instant carrying two
    // prices 935 lattice steps apart.
    const { second, resumeClock, lastObserved } = await seamed();
    expect(second.outcome.kind).toBe('seam');
    resumeClock.advance(durationMillis(120_000));
    for (const tick of second.market.advance()) {
      expect(tick.instant, 'republished an already-observed instant').toBeGreaterThan(
        lastObserved.instant,
      );
    }
  });

  it('never reuses a sequence number under one asset id', async () => {
    // It restarted numbering at 1, so a single asset published two different
    // ticks under the same sequence — irreconcilable for any observer, and
    // forbidden by PH-5.3 acceptance criterion 2.
    const { second, resumeClock, lastObserved } = await seamed();
    resumeClock.advance(durationMillis(120_000));
    const after = second.market.advance();
    expect(after.length).toBeGreaterThan(0);
    expect(after[0]!.sequence, 'sequence went backwards across the seam').toBeGreaterThan(
      lastObserved.sequence,
    );
  });

  it('still carries the price across, so the market does not jump', async () => {
    const { second, resumeClock, record } = await seamed();
    resumeClock.advance(durationMillis(120_000));
    const after = second.market.advance();
    expect(Math.abs(after[0]!.price - record.lastPublished!.price)).toBeLessThan(20_000);
  });
});
