// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream), INV-009 (reproducible settlement).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, SteppableClock, type Tick } from '@otc/core';
import { StaleFenceError } from './fence.js';
import { DEFAULT_LEASE_TERM_MS } from './lease.js';
import { describeCoordinatedStore, stubRecord } from './leaseConformance.test.js';
import { RecordForkError, SeamError, type SeamMarker } from './replication.js';
import { SqliteCoordinatedStore } from './sqliteStore.js';

const GENESIS = epochMillis(1_776_000_000_000);
const ASSET = 'eurusd';

const directories: string[] = [];
async function scratch(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-sqlite-'));
  directories.push(directory);
  return directory;
}

afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/**
 * The contract, invoked unmodified.
 *
 * PH-14.1 §5 made it executable precisely so this substitution would be checked
 * against properties rather than prose. Relaxing one to fit the backend would
 * convert the battery from a specification into a description, and a
 * description of a broken store still passes.
 *
 * Importing the module also re-runs the battery against the in-memory
 * reference, because that invocation is top-level there. That is a control
 * rather than an accident: if the reference battery failed in this file, the
 * battery would be broken rather than the backend.
 */
describeCoordinatedStore('SqliteCoordinatedStore', () => {
  const clock = new SteppableClock(GENESIS);
  return {
    store: new SqliteCoordinatedStore(':memory:', clock),
    advance: (byMs: number) => {
      clock.set(epochMillis(clock.now() + byMs));
    },
    termMs: DEFAULT_LEASE_TERM_MS,
  };
});

function tick(sequence: number, price = 100_000 + sequence): Tick {
  return {
    sequence,
    instant: epochMillis(GENESIS + sequence * 1_000),
    price: logPrice(price),
  };
}

function seam(lastSequence: number | null, resumesAtSequence: number): SeamMarker {
  return {
    assetId: ASSET,
    lastSequence,
    lastInstant: lastSequence === null ? null : tick(lastSequence).instant,
    resumesAtSequence,
    resumesAtInstant: tick(resumesAtSequence).instant,
    reason: 'snapshot rejected',
  };
}

function openStore(file: string, clock: SteppableClock): SqliteCoordinatedStore {
  return new SqliteCoordinatedStore(file, clock);
}

async function lead(store: SqliteCoordinatedStore, holder = 'api-1#aa'): Promise<number> {
  const outcome = await store.acquire(ASSET, holder);
  if (outcome.kind !== 'granted') throw new Error('expected a grant');
  return outcome.grant.token;
}

describe('state survives the process that wrote it', () => {
  it('keeps the record across a close and reopen', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const clock = new SteppableClock(GENESIS);

    const first = openStore(file, clock);
    const token = await lead(first);
    await first.appendTicks(ASSET, token, [tick(1), tick(2), tick(3)]);
    await first.saveFenced(stubRecord(ASSET, epochMillis(42)), token);
    first.close();

    const second = openStore(file, clock);
    expect(await second.recordHead(ASSET)).toBe(3);
    expect(await second.readRecord(ASSET, 1, 10)).toEqual([
      { kind: 'tick', tick: tick(1) },
      { kind: 'tick', tick: tick(2) },
      { kind: 'tick', tick: tick(3) },
    ]);
    expect((await second.load(ASSET))?.savedAt).toBe(42);
    expect(await second.list()).toEqual([ASSET]);
    second.close();
  });

  it('keeps the lease, and its expiry, across a reopen', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const clock = new SteppableClock(GENESIS);

    const first = openStore(file, clock);
    const token = await lead(first, 'api-1#aa');
    first.close();

    const second = openStore(file, clock);
    // Still held: the lease is durable, so a restarted process does not silently
    // become the leader by forgetting that something else is.
    expect(await second.acquire(ASSET, 'api-2#bb')).toMatchObject({ kind: 'held' });
    expect((await second.inspect(ASSET))?.token).toBe(token);

    clock.set(epochMillis(clock.now() + DEFAULT_LEASE_TERM_MS));
    expect(await second.acquire(ASSET, 'api-2#bb')).toMatchObject({ kind: 'granted' });
    second.close();
  });

  it('keeps the high-water mark across a reopen, so a token is never recycled', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const clock = new SteppableClock(GENESIS);

    const first = openStore(file, clock);
    const before = await lead(first, 'api-1#aa');
    first.close();

    clock.set(epochMillis(clock.now() + DEFAULT_LEASE_TERM_MS));
    const second = openStore(file, clock);
    const after = await lead(second, 'api-2#bb');
    // A restart that forgot the mark would reissue `before`, and a write from a
    // process stranded since then would match the new grant exactly.
    expect(after).toBeGreaterThan(before);
    second.close();
  });

  it('keeps a seam across a reopen, and it still blocks a contiguous append', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const clock = new SteppableClock(GENESIS);

    const first = openStore(file, clock);
    const token = await lead(first);
    await first.appendTicks(ASSET, token, [tick(1), tick(2)]);
    await first.recordSeam(ASSET, token, seam(2, 500));
    first.close();

    const second = openStore(file, clock);
    expect(await second.seams(ASSET)).toEqual([seam(2, 500)]);
    // The record's head is 2 and the next tick must land at 500. A store that
    // rebuilt `expectNext` as `head + 1` would silently close the gap.
    await expect(second.appendTicks(ASSET, token, [tick(3)])).rejects.toBeInstanceOf(RangeError);
    await second.appendTicks(ASSET, token, [tick(500)]);
    expect(await second.recordHead(ASSET)).toBe(500);
    second.close();
  });
});

describe('two connections to one database see one lease', () => {
  it('admits exactly one leader across connections', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const clock = new SteppableClock(GENESIS);
    const a = openStore(file, clock);
    const b = openStore(file, clock);

    const first = await a.acquire(ASSET, 'api-1#aa');
    const second = await b.acquire(ASSET, 'api-2#bb');
    expect(first.kind).toBe('granted');
    expect(second.kind).toBe('held');
    if (second.kind !== 'held') throw new Error('unreachable');
    expect(second.by.holder).toBe('api-1#aa');

    a.close();
    b.close();
  });

  it('fences a write made through another connection', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const clock = new SteppableClock(GENESIS);
    const a = openStore(file, clock);
    const b = openStore(file, clock);

    const stranded = await lead(a, 'api-1#aa');
    await a.appendTicks(ASSET, stranded, [tick(1)]);

    clock.set(epochMillis(clock.now() + DEFAULT_LEASE_TERM_MS));
    const successor = await lead(b, 'api-2#bb');
    await b.appendTicks(ASSET, successor, [tick(2)]);

    // The first connection has not noticed. It is still generating and still
    // writing, and it is refused by the store it is writing to.
    await expect(a.appendTicks(ASSET, stranded, [tick(3)])).rejects.toBeInstanceOf(StaleFenceError);
    await expect(a.saveFenced(stubRecord(ASSET, epochMillis(9)), stranded)).rejects.toBeInstanceOf(
      StaleFenceError,
    );
    expect(await b.recordHead(ASSET)).toBe(2);

    a.close();
    b.close();
  });

  it('shows one connection what the other appended', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const clock = new SteppableClock(GENESIS);
    const writer = openStore(file, clock);
    const reader = openStore(file, clock);

    const token = await lead(writer);
    await writer.appendTicks(ASSET, token, [tick(1), tick(2)]);
    expect(await reader.recordHead(ASSET)).toBe(2);
    await writer.appendTicks(ASSET, token, [tick(3)]);
    expect((await reader.readRecord(ASSET, 1, 10)).length).toBe(3);

    writer.close();
    reader.close();
  });
});

describe('a rejected write leaves the database untouched', () => {
  it('rolls back the good prefix of a bad batch', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const clock = new SteppableClock(GENESIS);
    const store = openStore(file, clock);
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1)]);

    await expect(
      store.appendTicks(ASSET, token, [tick(2), tick(3), tick(9)]),
    ).rejects.toBeInstanceOf(RangeError);

    // A store that wrote ticks 2 and 3 before reaching the bad one would leave
    // a record no single writer could have produced.
    expect(await store.recordHead(ASSET)).toBe(1);
    expect((await store.readRecord(ASSET, 1, 10)).length).toBe(1);
    store.close();
  });

  it('rolls back a fork, and survives a reopen unchanged', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const clock = new SteppableClock(GENESIS);
    const store = openStore(file, clock);
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1), tick(2)]);

    await expect(
      store.appendTicks(ASSET, token, [tick(2, 999_999), tick(3)]),
    ).rejects.toBeInstanceOf(RecordForkError);
    store.close();

    const reopened = openStore(file, clock);
    expect(await reopened.readRecord(ASSET, 1, 10)).toEqual([
      { kind: 'tick', tick: tick(1) },
      { kind: 'tick', tick: tick(2) },
    ]);
    reopened.close();
  });

  it('rolls back a refused seam', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const clock = new SteppableClock(GENESIS);
    const store = openStore(file, clock);
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1), tick(2), tick(3)]);

    await expect(store.recordSeam(ASSET, token, seam(2, 500))).rejects.toBeInstanceOf(SeamError);
    expect(await store.seams(ASSET)).toEqual([]);
    // And the record still continues contiguously, so the refused seam moved
    // nothing.
    await store.appendTicks(ASSET, token, [tick(4)]);
    expect(await store.recordHead(ASSET)).toBe(4);
    store.close();
  });
});

describe('the store refuses what it cannot store', () => {
  it.each([0, -1, Number.NaN])('refuses a lease term of %s', (termMs) => {
    expect(
      () => new SqliteCoordinatedStore(':memory:', new SteppableClock(GENESIS), termMs),
    ).toThrow(RangeError);
  });
});

describe('entries come back in the order they were written', () => {
  it('puts a seam before the tick that follows it, even when they tie on sequence', async () => {
    // A seam sits at `lastSequence + 1`, and a seam that resumes at exactly
    // `lastSequence + 1` therefore ties with the tick that follows it. Ordering
    // by sequence would leave which comes first to the database; ordering by
    // insertion position cannot, and the client must see the discontinuity
    // before the tick on the far side of it.
    //
    // **This test does not discriminate the two.** Swapping `ORDER BY position`
    // for `ORDER BY sequence` leaves it green, because SQLite breaks the tie in
    // rowid order, which here *is* insertion order. The column is chosen
    // because it does not depend on that — an undocumented tie-break is not
    // something a published record should rest on — and no test can show the
    // difference while the two agree. Recorded rather than claimed.
    const file = path.join(await scratch(), 'venue.db');
    const store = openStore(file, new SteppableClock(GENESIS));
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1), tick(2)]);
    await store.recordSeam(ASSET, token, seam(2, 3));
    await store.appendTicks(ASSET, token, [tick(3)]);

    const entries = await store.readRecord(ASSET, 1, 10);
    expect(entries.map((e) => e.kind)).toEqual(['tick', 'tick', 'seam', 'tick']);
    store.close();
  });

  it('hands a client resuming inside a gap the seam first', async () => {
    const file = path.join(await scratch(), 'venue.db');
    const store = openStore(file, new SteppableClock(GENESIS));
    const token = await lead(store);
    await store.appendTicks(ASSET, token, [tick(1), tick(2)]);
    await store.recordSeam(ASSET, token, seam(2, 500));
    await store.appendTicks(ASSET, token, [tick(500), tick(501)]);

    expect((await store.readRecord(ASSET, 3, 10)).map((e) => e.kind)).toEqual([
      'seam',
      'tick',
      'tick',
    ]);
    expect((await store.readRecord(ASSET, 501, 10)).map((e) => e.kind)).toEqual(['tick']);
    store.close();
  });
});

describe('a file-backed database is configured for concurrent readers', () => {
  it('is in WAL mode', async () => {
    // A configuration assertion, and deliberately so. WAL is what stops a
    // reader observing a half-written transaction, and nothing else in this
    // suite depends on it: removing it entirely leaves even the multi-process
    // race green, because mutual exclusion comes from `BEGIN IMMEDIATE`
    // instead. The property is real and only the setting is observable, so the
    // setting is what is asserted.
    const file = path.join(await scratch(), 'venue.db');
    const store = openStore(file, new SteppableClock(GENESIS));
    store.close();

    const inspector = new DatabaseSync(file);
    const row = inspector.prepare('PRAGMA journal_mode').get();
    inspector.close();
    expect(String(row?.['journal_mode']).toLowerCase()).toBe('wal');
  });

  it('does not demand WAL of an in-memory database, which cannot enter it', () => {
    // SQLite keeps `:memory:` in `memory` mode however often it is asked.
    // Requiring WAL unconditionally broke the entire conformance battery, which
    // runs in memory.
    expect(() => openStore(':memory:', new SteppableClock(GENESIS)).close()).not.toThrow();
  });
});
