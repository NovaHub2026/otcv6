// Invariant evidence: INV-002 (shared market), INV-008 (continuous market state), INV-009 (reproducible settlement), INV-010 (private generator state).
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { RecordForkError } from './replication.js';
import {
  MEASURED_RECORD_BYTES_PER_TICK,
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

  /**
   * **Cycle Audit 10, a4-01 and a1-01.** The test above accepts the gap; until
   * PH-31 nothing wrote it down, so a seam from an earlier boot survived only
   * as a jump in sequence — and `settle()`'s seam refusal, which takes
   * instants, could not be reached through the API at all.
   */
  it('writes down the seam an accepted gap leaves, in sequences and in instants (PH-31)', async () => {
    const record = await open();
    expect(await record.seams('a'), 'nothing recorded, no seams').toEqual([]);
    await record.append([{ assetId: 'a', ticks: run(1, 5) }]);
    expect(await record.seams('a'), 'a contiguous record has no seams').toEqual([]);
    await record.append([{ assetId: 'a', ticks: run(100_006, 100_009) }]);
    const expected = {
      assetId: 'a',
      lastSequence: 5,
      lastInstant: tick(5).instant,
      resumesAtSequence: 100_006,
      resumesAtInstant: tick(100_006).instant,
    };
    expect(await record.seams('a')).toEqual([expected]);
    // Appending on past the seam adds no second one.
    await record.append([{ assetId: 'a', ticks: run(100_010, 100_012) }]);
    expect(await record.seams('a')).toEqual([expected]);
    // A second seam is a second row, oldest first.
    await record.append([{ assetId: 'a', ticks: run(200_000, 200_001) }]);
    expect((await record.seams('a')).map((seam) => seam.resumesAtSequence)).toEqual([
      100_006, 200_000,
    ]);
    expect(await record.seams('b'), 'per asset').toEqual([]);
    // The interval is open at both ends: the boundary instants are on ticks
    // that were published, and are answerable prices.
    expect(await record.seamAt('a', tick(5).instant), 'on the last tick before it').toBeNull();
    expect(await record.seamAt('a', tick(100_006).instant), 'on the first tick after').toBeNull();
    expect(await record.seamAt('a', tick(5).instant + 1), 'one millisecond in').toEqual(expected);
    expect(
      await record.seamAt('a', tick(100_006).instant - 1),
      'one millisecond before the resume',
    ).toEqual(expected);
    expect(
      await record.seamAt('a', Math.floor((tick(5).instant + tick(100_006).instant) / 2)),
      'the middle of the gap',
    ).toEqual(expected);
    expect(await record.seamAt('a', tick(3).instant), 'inside the contiguous run').toBeNull();
    await expect(record.seamAt('a', 1.5)).rejects.toThrow(/safe integer/);
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

  it('answers the last tick at or before an instant — the settlement rule (PH-29.1)', async () => {
    const record = await open();
    // Two ticks in one millisecond: the later sequence is the one in force.
    const twin: Tick = { ...tick(4), sequence: 5 };
    await record.append([
      { assetId: 'a', ticks: [tick(1), tick(2), tick(3), tick(4), twin, tick(6)] },
    ]);
    expect(await record.atOrBefore('a', tick(1).instant - 1), 'before the record').toBeNull();
    expect(await record.atOrBefore('a', tick(1).instant), 'exactly on the first').toEqual(tick(1));
    expect(await record.atOrBefore('a', tick(2).instant + 1), 'between ticks').toEqual(tick(2));
    expect(await record.atOrBefore('a', tick(4).instant), 'two at one instant').toEqual(twin);
    expect(await record.atOrBefore('a', tick(6).instant + 1_000_000), 'after the newest').toEqual(
      tick(6),
    );
    expect(await record.atOrBefore('b', tick(6).instant), 'an asset with nothing').toBeNull();
    await expect(record.atOrBefore('a', 1.5)).rejects.toThrow(/safe integer/);
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
    const seamColumns = db
      .prepare('PRAGMA table_info(seam)')
      .all()
      .map((row) => String(row['name']));
    expect(seamColumns.sort()).toEqual([
      'asset_id',
      'last_instant',
      'last_sequence',
      'resumes_at_instant',
      'resumes_at_sequence',
    ]);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row['name']));
    // The record's two tables and no third: what was published, and where it
    // stopped and started again (PH-31). Both are sequences, instants and
    // prices — nothing an observer could not have read for themselves.
    expect(tables.sort()).toEqual(['seam', 'tick']);
    expect(Number(db.prepare('PRAGMA user_version').get()!['user_version'])).toBe(
      RECORD_SCHEMA_VERSION,
    );
    db.close();
    reader.close();
  });

  it('reads the seams a file written before the seam table already holds (PH-31)', async () => {
    const file = path.join(await scratch(), 'record.db');
    // A version-1 record: the tick table alone, with a deploy-length seam in
    // it — what every deployment upgrading to this code has on disk.
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE tick (
        asset_id TEXT NOT NULL, sequence INTEGER NOT NULL,
        instant INTEGER NOT NULL, price INTEGER NOT NULL,
        PRIMARY KEY (asset_id, sequence)
      ) WITHOUT ROWID
    `);
    for (const t of [...run(1, 5), ...run(100_006, 100_008)]) {
      old.prepare('INSERT INTO tick VALUES (?, ?, ?, ?)').run('a', t.sequence, t.instant, t.price);
    }
    for (const t of run(1, 3)) {
      old.prepare('INSERT INTO tick VALUES (?, ?, ?, ?)').run('b', t.sequence, t.instant, t.price);
    }
    old.exec('PRAGMA user_version = 1');
    old.close();

    const record = new SqliteTickRecord(file);
    expect(await record.seams('a')).toEqual([
      {
        assetId: 'a',
        lastSequence: 5,
        lastInstant: tick(5).instant,
        resumesAtSequence: 100_006,
        resumesAtInstant: tick(100_006).instant,
      },
    ]);
    expect(await record.seams('b'), 'a contiguous asset gains none').toEqual([]);
    expect(await record.seamAt('a', tick(5).instant + 1)).not.toBeNull();
    record.close();
    // Stamped forward, and the second open does not double the row.
    const again = new SqliteTickRecord(file);
    expect(await again.seams('a')).toHaveLength(1);
    again.close();
    const db = new DatabaseSync(file);
    expect(Number(db.prepare('PRAGMA user_version').get()!['user_version'])).toBe(
      RECORD_SCHEMA_VERSION,
    );
    db.close();
  });

  it('refuses a file written by newer code', async () => {
    const file = path.join(await scratch(), 'record.db');
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA user_version = ${RECORD_SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => new SqliteTickRecord(file)).toThrow(/newer than/);
  });

  /**
   * **Cycle Audit 10 (a7-03).** This asserted a bound and printed a figure for
   * a docstring nothing related it to. PH-29.1 added the `tick_by_instant`
   * index, the cost went from 32.6 to 61.2 bytes a tick — a factor of 1.9 —
   * the bound of 80 held, the suite stayed green, and the docstring that sizes
   * `DEFAULT_RECORD_TICKS`, plus the PH-28 records, went on telling an
   * operator to size disk at eight megabytes an asset for two phases.
   *
   * So the number in the prose is now read out of the prose and held to the
   * measurement. Twenty per cent of slack: a page-size or SQLite change may
   * move it a little without failing the suite, but nothing may add a second
   * index and leave the sizing where it was.
   */
  it('costs the number of bytes per tick its own docstring says it does', async () => {
    const file = path.join(await scratch(), 'record.db');
    const record = new SqliteTickRecord(file);
    const n = 20_000;
    await record.append([{ assetId: 'eurusd-otc', ticks: run(1, n) }]);
    record.close();
    const bytes = (await stat(file)).size;
    const perTick = bytes / n;
    // WITHOUT ROWID with a (text, integer) primary key and two integers, plus
    // the PH-29.1 index over (asset_id, instant, sequence): tens of bytes, not
    // hundreds.
    console.info(`[tickRecord] ${perTick.toFixed(1)} bytes per tick on disk over ${n} ticks`);
    expect(perTick).toBeLessThan(80);

    expect(
      Math.abs(perTick - MEASURED_RECORD_BYTES_PER_TICK) / MEASURED_RECORD_BYTES_PER_TICK,
      `the record costs ${perTick.toFixed(1)} bytes a tick, not ` +
        `${String(MEASURED_RECORD_BYTES_PER_TICK)} — re-measure and update the sizing on ` +
        `DEFAULT_RECORD_TICKS in tickRecord.ts, and the PH-28 and PH-28.1 records that ` +
        `restate it; that is what an operator sizes disk from`,
    ).toBeLessThan(0.2);
  });
});
