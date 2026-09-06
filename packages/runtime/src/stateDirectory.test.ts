// Invariant evidence: INV-002 (shared market), INV-008 (continuous market state), INV-009 (reproducible settlement).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Candle, type Tick } from '@otc/core';
import { FileStateStore } from './fileStore.js';
import { stubRecord } from './leaseConformance.test.js';
import { SqliteCandleHistory } from './sqliteHistory.js';
import {
  backupStateDirectory,
  BACKUP_MANIFEST,
  HISTORY_DB,
  LAB_MARKER,
  RECORD_DB,
  stateRefusal,
  verifyStateDirectory,
} from './stateDirectory.js';
import { SqliteTickRecord } from './tickRecord.js';

const GENESIS = 1_776_000_000_000;
const directories: string[] = [];
function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'otc-state-'));
  directories.push(directory);
  return directory;
}
afterAll(() => {
  for (const d of directories) rmSync(d, { recursive: true, force: true });
});

function tick(sequence: number): Tick {
  return {
    sequence,
    instant: epochMillis(GENESIS + sequence * 500),
    price: logPrice(1_000 + sequence),
  };
}
function bar(minute: number, first: number, last: number): Candle {
  return {
    openInstant: epochMillis(GENESIS + minute * 60_000),
    timeframe: '1m',
    open: logPrice(1_000 + first),
    high: logPrice(1_000 + last),
    low: logPrice(1_000 + first),
    close: logPrice(1_000 + last),
    tickCount: last - first + 1,
    firstSequence: first,
    lastSequence: last,
  };
}

/** A directory whose checkpoint published through `published`, record through `recorded`, history through `stored`. */
async function directoryWith(options: {
  published: number | null;
  recorded: number | null;
  stored: number | null;
  assetId?: string;
}): Promise<string> {
  const directory = scratch();
  const id = options.assetId ?? 'eurusd';
  const store = new FileStateStore(directory);
  await store.save({
    ...stubRecord(id, epochMillis(GENESIS)),
    lastPublished:
      options.published === null
        ? null
        : {
            sequence: options.published,
            instant: tick(options.published).instant,
            price: tick(options.published).price,
          },
  });
  if (options.recorded !== null) {
    const record = new SqliteTickRecord(path.join(directory, RECORD_DB));
    const ticks: Tick[] = [];
    for (let s = 1; s <= options.recorded; s += 1) ticks.push(tick(s));
    await record.append([{ assetId: id, ticks }]);
    record.close();
  }
  if (options.stored !== null) {
    const history = new SqliteCandleHistory(path.join(directory, HISTORY_DB));
    await history.append(id, '1m', [
      bar(0, 1, Math.floor(options.stored / 2)),
      bar(1, Math.floor(options.stored / 2) + 1, options.stored),
    ]);
    history.close();
  }
  return directory;
}

describe('a state directory is verified as one thing (PH-28.3)', () => {
  it('passes a healthy directory and reports every head', async () => {
    const directory = await directoryWith({ published: 100, recorded: 100, stored: 90 });
    const report = await verifyStateDirectory(directory);
    expect(report.problems).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.assets).toEqual(['eurusd']);
    expect(report.heads['eurusd']).toEqual({ checkpoint: 100, record: 100, history: 90 });
    expect(report.labComposed).toBe(false);
    expect(stateRefusal(report)).toBeNull();
  });

  it('a record ahead of the checkpoint is the ordinary case after a kill, and passes', async () => {
    const directory = await directoryWith({ published: 100, recorded: 130, stored: 120 });
    expect((await verifyStateDirectory(directory)).problems).toEqual([]);
  });

  it('refuses a checkpoint that cannot be read, by file and asset', async () => {
    const directory = await directoryWith({ published: 100, recorded: 100, stored: 90 });
    writeFileSync(path.join(directory, 'gbpusd.json'), '{ this is not json');
    const report = await verifyStateDirectory(directory);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatchObject({ file: 'gbpusd.json', assetId: 'gbpusd' });
    expect(stateRefusal(report)).toMatch(/Refusing to start[\s\S]*gbpusd\.json \(gbpusd\)/);
    expect(report.assets, 'the corrupt asset is not counted as resumable').toEqual(['eurusd']);
  });

  it('refuses a record behind the checkpoint: ticks observers saw that the record does not hold', async () => {
    const directory = await directoryWith({ published: 100, recorded: 80, stored: 60 });
    const report = await verifyStateDirectory(directory);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatchObject({ file: RECORD_DB, assetId: 'eurusd' });
    expect(report.problems[0]!.detail).toMatch(
      /ends at sequence 80 and the checkpoint has published through 100/,
    );
  });

  it('refuses a candle history ahead of the record', async () => {
    const directory = await directoryWith({ published: 100, recorded: 100, stored: 120 });
    const report = await verifyStateDirectory(directory);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatchObject({ file: HISTORY_DB, assetId: 'eurusd' });
    expect(report.problems[0]!.detail).toMatch(/reaches sequence 120 and the record ends at 100/);
  });

  it('refuses a database written by newer code', async () => {
    const directory = await directoryWith({ published: 100, recorded: 100, stored: 90 });
    const db = new DatabaseSync(path.join(directory, RECORD_DB));
    db.exec('PRAGMA user_version = 99');
    db.close();
    const report = await verifyStateDirectory(directory);
    expect(report.problems.map((p) => p.file)).toEqual([RECORD_DB]);
    expect(report.problems[0]!.detail).toMatch(/newer than/);
  });

  it('warns, and does not refuse, a checkpoint with no record yet, and a checkpoint that will seam', async () => {
    const directory = await directoryWith({ published: 100, recorded: null, stored: 90 });
    // A record file exists for another asset, so the store is there and this asset has no rows.
    const record = new SqliteTickRecord(path.join(directory, RECORD_DB));
    await record.append([{ assetId: 'gbpusd', ticks: [tick(1)] }]);
    record.close();
    const store = new FileStateStore(directory);
    await store.save({ ...stubRecord('usdjpy', epochMillis(GENESIS)), leasedBlocks: {} });
    const report = await verifyStateDirectory(directory);
    expect(report.problems).toEqual([]);
    expect(report.warnings.map((w) => [w.file, w.assetId])).toEqual([
      ['usdjpy.json', 'usdjpy'],
      [RECORD_DB, 'eurusd'],
    ]);
    expect(report.warnings[0]!.detail).toMatch(/will be seamed past: no leased cursors/);
    expect(report.heads['eurusd']).toEqual({ checkpoint: 100, record: null, history: 90 });
  });

  it('reports a missing directory as nothing to resume, and the Lab marker as what it is', async () => {
    const missing = path.join(scratch(), 'never');
    const empty = await verifyStateDirectory(missing);
    expect(empty).toMatchObject({ assets: [], problems: [], warnings: [], labComposed: false });
    const directory = await directoryWith({ published: 10, recorded: 10, stored: null });
    mkdirSync(path.dirname(path.join(directory, LAB_MARKER)), { recursive: true });
    writeFileSync(path.join(directory, LAB_MARKER), '{"composedBy":"lab"}\n');
    expect((await verifyStateDirectory(directory)).labComposed).toBe(true);
  });
});

describe('a state directory is backed up consistently and verified on the way out (PH-28.3)', () => {
  it('copies every file, verifies the copy, writes the manifest, and the copy is independent', async () => {
    const directory = await directoryWith({ published: 100, recorded: 130, stored: 120 });
    mkdirSync(path.join(directory, 'assets'));
    mkdirSync(path.dirname(path.join(directory, LAB_MARKER)), { recursive: true });
    writeFileSync(path.join(directory, LAB_MARKER), '{"composedBy":"lab"}\n');
    const target = path.join(scratch(), 'backup');
    const { manifest, report } = await backupStateDirectory(directory, target, GENESIS + 5);
    expect(report.problems).toEqual([]);
    expect(manifest).toMatchObject({
      kind: 'otc-state-backup',
      version: 1,
      takenAt: GENESIS + 5,
      assets: ['eurusd'],
      heads: { eurusd: { checkpoint: 100, record: 130, history: 120 } },
    });
    const again = await verifyStateDirectory(target);
    expect(again.heads).toEqual(manifest.heads);
    expect(again.labComposed).toBe(true);
    expect(
      JSON.parse(
        String(
          await import('node:fs').then((fs) =>
            fs.readFileSync(path.join(target, BACKUP_MANIFEST), 'utf8'),
          ),
        ),
      ),
    ).toEqual(manifest);
    // The source moves on; the backup does not.
    const live = new SqliteTickRecord(path.join(directory, RECORD_DB));
    await live.append([{ assetId: 'eurusd', ticks: [tick(131), tick(132)] }]);
    live.close();
    const copy = new SqliteTickRecord(path.join(target, RECORD_DB));
    expect(await copy.head('eurusd')).toBe(130);
    copy.close();
  });

  it('never writes over a non-empty target, and refuses a source that does not exist', async () => {
    const directory = await directoryWith({ published: 10, recorded: 10, stored: null });
    const target = scratch();
    writeFileSync(path.join(target, 'something'), 'x');
    await expect(backupStateDirectory(directory, target, GENESIS)).rejects.toThrow(/not empty/);
    await expect(
      backupStateDirectory(path.join(target, 'nope'), path.join(target, 'out'), GENESIS),
    ).rejects.toThrow(/No state directory/);
  });

  it('a backup taken from a directory that is wrong says so in its report', async () => {
    const directory = await directoryWith({ published: 100, recorded: 80, stored: 60 });
    const target = path.join(scratch(), 'backup');
    const { report } = await backupStateDirectory(directory, target, GENESIS);
    expect(report.problems.map((p) => p.file)).toEqual([RECORD_DB]);
  });
});
