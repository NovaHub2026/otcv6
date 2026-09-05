// Invariant evidence: INV-002 (shared market), INV-008 (continuous market state), INV-009 (reproducible settlement), INV-010 (private generator state).
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { RecordForkError } from './replication.js';
import {
  MemoryTickRecord,
  RECORD_SCHEMA_VERSION,
  SqliteTickRecord,
  type TickRecord,
} from './tickRecord.js';

const directories: string[] = [];
async function scratch(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-record-'));
  directories.push(directory);
  return directory;
}
afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const GENESIS = 1_776_000_000_000;
function tick(sequence: number, price = 1000 + sequence): Tick {
  return { sequence, instant: epochMillis(GENESIS + sequence * 500), price: logPrice(price) };
}
function run(from: number, to: number): Tick[] {
  const ticks: Tick[] = [];
  for (let s = from; s <= to; s += 1) ticks.push(tick(s));
  return ticks;
}

const implementations: [string, () => Promise<TickRecord>][] = [
  ['MemoryTickRecord', () => Promise.resolve(new MemoryTickRecord())],
  ['SqliteTickRecord', async () => new SqliteTickRecord(path.join(await scratch(), 'record.db'))],
];

describe.each(implementations)('%s', (_name, open) => {
  it('returns as fresh exactly the ticks it did not hold, and holds them after', async () => {
    const record = await open();
    const first = await record.append([{ assetId: 'a', ticks: run(1, 5) }]);
    expect(first.get('a')).toEqual(run(1, 5));
    expect(await record.head('a')).toBe(5);
    expect(await record.oldest('a')).toBe(1);
    // A resumed market republishes 3..5 and goes on to 8: the replay is
    // verified, not returned; only 6..8 are new.
    const second = await record.append([{ assetId: 'a', ticks: run(3, 8) }]);
    expect(second.get('a')).toEqual(run(6, 8));
    expect(await record.since('a', 1, 100)).toEqual(run(1, 8));
  });

  it('refuses a fork by name and writes nothing for any asset in the pass (INV-002)', async () => {
    const record = await open();
    await record.append([
      { assetId: 'a', ticks: run(1, 5) },
      { assetId: 'b', ticks: run(1, 2) },
    ]);
    const forked = [...run(4, 6)];
    forked[0] = { ...forked[0]!, price: logPrice(1) };
    await expect(
      record.append([
        { assetId: 'b', ticks: run(3, 4) },
        { assetId: 'a', ticks: forked },
      ]),
    ).rejects.toBeInstanceOf(RecordForkError);
    expect(await record.head('a'), 'a unchanged').toBe(5);
    expect(await record.head('b'), 'b unchanged: the pass is one transaction').toBe(2);
  });

  it('refuses a sequence at or below the head that it does not hold, rather than guessing', async () => {
    const record = await open();
    await record.append([{ assetId: 'a', ticks: run(1, 10) }]);
    await record.trim('a', 3);
    expect(await record.oldest('a')).toBe(8);
    await expect(record.append([{ assetId: 'a', ticks: run(5, 11) }])).rejects.toThrow(
      /holds no tick there to compare/,
    );
    expect(await record.head('a')).toBe(10);
  });

  it('accepts a gap above the head — a seam — and the tail is the run after it', async () => {
    const record = await open();
    await record.append([{ assetId: 'a', ticks: run(1, 5) }]);
    await record.append([{ assetId: 'a', ticks: run(100_006, 100_009) }]);
    expect(await record.head('a')).toBe(100_009);
    expect(await record.tail('a', 50)).toEqual(run(100_006, 100_009));
    expect(await record.tail('a', 2)).toEqual(run(100_008, 100_009));
    expect(await record.since('a', 3, 3)).toEqual([tick(3), tick(4), tick(5)]);
  });

  it('refuses a batch that repeats or reorders a sequence, whole', async () => {
    const record = await open();
    await expect(
      record.append([{ assetId: 'a', ticks: [tick(1), tick(3), tick(2)] }]),
    ).rejects.toThrow(/not strictly ordered/);
    expect(await record.head('a')).toBeNull();
    expect(await record.assets()).toEqual([]);
  });

  it('trims to the newest `keep` and lists the assets it holds', async () => {
    const record = await open();
    await record.append([
      { assetId: 'b', ticks: run(1, 20) },
      { assetId: 'a', ticks: run(1, 4) },
      { assetId: 'c', ticks: [] },
    ]);
    await record.trim('b', 5);
    expect(await record.oldest('b')).toBe(16);
    expect(await record.head('b')).toBe(20);
    await record.trim('a', 10);
    expect(await record.oldest('a')).toBe(1);
    expect(await record.assets()).toEqual(['a', 'b']);
  });

  it('validates limits and sequences before touching anything', async () => {
    const record = await open();
    await expect(record.tail('a', 0)).rejects.toThrow(/positive integer/);
    await expect(record.since('a', 0, 1)).rejects.toThrow(/positive integer/);
    await expect(record.since('a', 1, 1.5)).rejects.toThrow(/positive integer/);
    await expect(record.trim('a', -1)).rejects.toThrow(/positive integer/);
    expect(await record.tail('a', 5)).toEqual([]);
    expect(await record.since('a', 1, 5)).toEqual([]);
  });
});

describe('the SQLite record, as a file', () => {
  it('survives the process that wrote it: what one handle appended another reads back', async () => {
    const file = path.join(await scratch(), 'record.db');
    const writer = new SqliteTickRecord(file);
    await writer.append([{ assetId: 'eurusd-otc', ticks: run(1, 1_000) }]);
    writer.close();
    const reader = new SqliteTickRecord(file);
    expect(await reader.head('eurusd-otc')).toBe(1_000);
    expect(await reader.tail('eurusd-otc', 3)).toEqual(run(998, 1_000));
    // The record holds what the stream carries and nothing else (INV-010).
    const db = new DatabaseSync(file);
    const columns = db
      .prepare('PRAGMA table_info(tick)')
      .all()
      .map((row) => String(row['name']));
    expect(columns.sort()).toEqual(['asset_id', 'instant', 'price', 'sequence']);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row['name']));
    expect(tables).toEqual(['tick']);
    expect(Number(db.prepare('PRAGMA user_version').get()!['user_version'])).toBe(
      RECORD_SCHEMA_VERSION,
    );
    db.close();
    reader.close();
  });

  it('refuses a file written by newer code', async () => {
    const file = path.join(await scratch(), 'record.db');
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA user_version = ${RECORD_SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => new SqliteTickRecord(file)).toThrow(/newer than/);
  });

  it('costs a bounded number of bytes per tick on disk, so the default bound can be sized', async () => {
    const file = path.join(await scratch(), 'record.db');
    const record = new SqliteTickRecord(file);
    const n = 20_000;
    await record.append([{ assetId: 'eurusd-otc', ticks: run(1, n) }]);
    record.close();
    const bytes = (await stat(file)).size;
    const perTick = bytes / n;
    // WITHOUT ROWID with a (text, integer) primary key and two integers: tens
    // of bytes, not hundreds. The bound is generous so a page-size change does
    // not fail the suite; the figure is printed for the docstring that sizes
    // `DEFAULT_RECORD_TICKS` from it.
    console.info(`[tickRecord] ${perTick.toFixed(1)} bytes per tick on disk over ${n} ticks`);
    expect(perTick).toBeLessThan(80);
  });
});
