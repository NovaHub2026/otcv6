// Invariant evidence: INV-002 (shared market), INV-008 (continuous market state), INV-009 (reproducible settlement).
import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
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
  type StateDirectoryReport,
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

/**
 * A second process appending ticks and closing bars into a live state
 * directory, for the backup-while-running case (a3-05).
 *
 * Raw `INSERT`s rather than `SqliteTickRecord`/`SqliteCandleHistory`: a child
 * process cannot use Vitest's module resolution, and what this test needs from
 * the writer is only that the two databases advance together, under the
 * invariant a venue keeps — the ticks are committed *before* the bar folded
 * from them, so the record is never behind the history in the source. Driving
 * `dist/` instead would tie a test about copy ordering to a build.
 */
const WRITER = `
import { DatabaseSync } from 'node:sqlite';

const [, , recordFile, historyFile, assetId, fromRaw, minuteRaw, genesisRaw] = process.argv;
let sequence = Number(fromRaw);
let minute = Number(minuteRaw);
const genesis = Number(genesisRaw);

const record = new DatabaseSync(recordFile);
record.exec('PRAGMA busy_timeout = 5000');
const insertTick = record.prepare(
  'INSERT INTO tick (asset_id, sequence, instant, price) VALUES (?, ?, ?, ?)',
);
const history = new DatabaseSync(historyFile);
history.exec('PRAGMA busy_timeout = 5000');
const insertBar = history.prepare(
  'INSERT INTO candle (asset_id, timeframe, open_instant, open, high, low, close, ' +
    'tick_count, first_sequence, last_sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);

function step() {
  const first = sequence;
  record.exec('BEGIN IMMEDIATE');
  for (let i = 0; i < 40; i += 1) {
    insertTick.run(assetId, sequence, genesis + sequence * 500, 1000 + sequence);
    sequence += 1;
  }
  record.exec('COMMIT');
  // Only now: a bar is never visible before the ticks it was folded from.
  insertBar.run(assetId, '1m', genesis + minute * 60000, 1000, 1000, 1000, 1000, 40, first, sequence - 1);
  minute += 1;
}

step();
process.stdout.write('ready\\n');
setInterval(step, 1);
`;

/** Start the writer above against `directory`, and resolve once it has written. */
async function advancing(directory: string, from: number): Promise<ChildProcess> {
  // Not inside the state directory: nothing but the venue's own files belongs
  // in one, and the backup is about to read it.
  const script = path.join(scratch(), 'writer.mjs');
  writeFileSync(script, WRITER, 'utf8');
  const child = spawn(
    process.execPath,
    [
      script,
      path.join(directory, RECORD_DB),
      path.join(directory, HISTORY_DB),
      'eurusd',
      String(from + 1),
      '2',
      String(GENESIS),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => (stderr += chunk));
  child.on('error', (error) => (stderr += String(error.message)));
  await new Promise<void>((resolve, reject) => {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (chunk.includes('ready')) resolve();
    });
    child.once('exit', (code) => {
      reject(
        new Error(`the writer exited with ${String(code)} before writing anything: ${stderr}`),
      );
    });
  });
  return child;
}

/** Stop it, and wait: a child still writing outlives the test that started it. */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
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
    // A record file exists for another asset, so the store is there and this
    // asset has no rows. That other asset is `usdjpy`, which has a checkpoint
    // here: an asset the record holds and no checkpoint names is its own
    // warning now (Cycle Audit 10, a6-06), and this case is about a checkpoint
    // with no record.
    const store = new FileStateStore(directory);
    await store.save({ ...stubRecord('usdjpy', epochMillis(GENESIS)), leasedBlocks: {} });
    const record = new SqliteTickRecord(path.join(directory, RECORD_DB));
    await record.append([{ assetId: 'usdjpy', ticks: [tick(1)] }]);
    record.close();
    const report = await verifyStateDirectory(directory);
    expect(report.problems).toEqual([]);
    expect(report.warnings.map((w) => [w.file, w.assetId])).toEqual([
      ['usdjpy.json', 'usdjpy'],
      [RECORD_DB, 'eurusd'],
    ]);
    expect(report.warnings[0]!.detail).toMatch(/will be seamed past: no leased cursors/);
    expect(report.heads['eurusd']).toEqual({ checkpoint: 100, record: null, history: 90 });
  });

  /**
   * **Cycle Audit 10 (a3-03).** This function's own docstring promised a
   * warning for "an asset with a checkpoint and no record at all", and the
   * guard was `published !== null && recordHead === null && record !== null`:
   * the trailing clause made it fire only when `record.db` **exists** and
   * happens to hold nothing for that asset, which is the one case the sentence
   * does not describe. Delete `record.db` between a kill and a restart — the
   * way an operator produces exactly this — and verification said nothing at
   * all: no problem, no warning, `Consistent: every file agrees.`, exit 0,
   * while the boot that follows primes no feed window, restarts the commitment
   * chain at a second genesis link and refuses every client's resume below the
   * new head.
   *
   * The two cases are both warnings and are worded differently, because an
   * operator fixes them differently: a file that is not there is a restore that
   * lost it; a file that is there and empty is an asset the record never held.
   */
  it('warns when record.db is absent, in different words from a record that holds nothing', async () => {
    const gone = await directoryWith({ published: 100, recorded: null, stored: 90 });
    expect(existsSync(path.join(gone, RECORD_DB)), 'the case needs no record.db').toBe(false);
    const report = await verifyStateDirectory(gone);
    expect(report.problems).toEqual([]);
    expect(report.warnings.map((w) => [w.file, w.assetId])).toEqual([[RECORD_DB, 'eurusd']]);
    expect(report.warnings[0]!.detail).toMatch(
      /is not in the state directory, and this asset's checkpoint has published through 100/,
    );
    expect(report.heads['eurusd']).toEqual({ checkpoint: 100, record: null, history: 90 });

    // The same asset, with record.db present and holding another asset's ticks:
    // a warning too, and not the same sentence.
    const empty = await directoryWith({ published: 100, recorded: null, stored: 90 });
    const other = new SqliteTickRecord(path.join(empty, RECORD_DB));
    await other.append([{ assetId: 'gbpusd', ticks: [tick(1)] }]);
    other.close();
    const second = await verifyStateDirectory(empty);
    expect(second.problems).toEqual([]);
    expect(second.warnings[0]!.detail).toMatch(/holds no tick for an asset/);
    expect(second.warnings[0]!.detail).not.toMatch(/is not in the state directory/);
  });

  /**
   * **Cycle Audit 10 (a6-13).** Verification opened each database and asked it
   * for a head per asset — a handful of pages — so damage anywhere else in the
   * file was invisible: 8 KB of garbage over the middle of a real `record.db`
   * and the tool printed every asset's heads, `Consistent: every file agrees.`,
   * exit 0. That is the acceptance check the restore runbook names. The venue
   * then booted, resumed and **seamed** all thirty assets, hosted them, and
   * died in `#primeFromRecord` with a raw `ERR_SQLITE_ERROR`; the shipped unit
   * is `Restart=always` / `RestartSec=2`, so it did that every two seconds. At
   * other corruption offsets this function itself died the same way, so the
   * head reads are wrapped too — a damaged file is a named refusal from either
   * direction, never a Node stack out of the operator's own tool.
   */
  describe('a damaged database is refused by name, not discovered at boot (a6-13)', () => {
    /** Overwrite `bytes` in the middle of a file — a torn page, as a disk gives it. */
    const damage = (file: string, bytes: number): void => {
      const handle = openSync(file, 'r+');
      try {
        writeSync(handle, Buffer.alloc(bytes, 0x5a), 0, bytes, Math.floor(statSync(file).size / 2));
      } finally {
        closeSync(handle);
      }
    };

    it('refuses a record.db whose pages do not hold together', async () => {
      const directory = await directoryWith({ published: 100, recorded: 4_000, stored: 90 });
      damage(path.join(directory, RECORD_DB), 8_192);
      const report = await verifyStateDirectory(directory);
      expect(report.problems.map((p) => p.file)).toContain(RECORD_DB);
      expect(report.problems.find((p) => p.file === RECORD_DB)!.detail).toMatch(/is damaged/);
      expect(stateRefusal(report)).toMatch(/Refusing to start[\s\S]*record\.db/);
    });

    it('refuses a history.db whose pages do not hold together', async () => {
      const directory = await directoryWith({ published: 100, recorded: 100, stored: 4_000 });
      damage(path.join(directory, HISTORY_DB), 8_192);
      const report = await verifyStateDirectory(directory);
      expect(report.problems.map((p) => p.file)).toContain(HISTORY_DB);
      // `is damaged` is the integrity check's own word: the same file reached
      // by a head read alone says `cannot be read`, one asset at a time, after
      // the boot has already decided the directory was fine.
      expect(report.problems.find((p) => p.file === HISTORY_DB)!.detail).toMatch(/is damaged/);
      expect(stateRefusal(report)).toMatch(/Refusing to start[\s\S]*history\.db/);
    });

    it('says it once for a directory of assets, not once per asset', async () => {
      const directory = await directoryWith({ published: 100, recorded: 4_000, stored: 90 });
      const store = new FileStateStore(directory);
      for (const id of ['gbpusd', 'usdjpy', 'audusd']) {
        await store.save({
          ...stubRecord(id, epochMillis(GENESIS)),
          lastPublished: { sequence: 100, instant: tick(100).instant, price: tick(100).price },
        });
      }
      damage(path.join(directory, RECORD_DB), 8_192);
      const report = await verifyStateDirectory(directory);
      expect(report.problems.filter((p) => p.file === RECORD_DB)).toHaveLength(1);
      // And no priming warning beside it: nothing read the file, so "holds no
      // tick" would be a claim about a file this report refuses to speak for.
      expect(report.warnings).toEqual([]);
    });

    it('refuses a record.db that is not a database at all', async () => {
      const directory = await directoryWith({ published: 100, recorded: null, stored: 90 });
      writeFileSync(path.join(directory, RECORD_DB), 'half a download\n');
      const report = await verifyStateDirectory(directory);
      expect(report.problems.map((p) => p.file)).toContain(RECORD_DB);
      expect(report.problems.find((p) => p.file === RECORD_DB)!.detail).toMatch(
        /is damaged: file is not a database/,
      );
    });

    /**
     * The other half of a6-13: damage `quick_check` cannot see. A database
     * salvaged with `sqlite3 .recover` is structurally perfect and holds
     * whatever survived — here a bar whose `open` came back as text. The heads
     * read below then throw from inside the reader, and until this was wrapped
     * that was a raw `ERR_SQLITE_ERROR`-shaped stack out of the operator's own
     * tool, naming no file and refusing nothing.
     */
    it('refuses a structurally sound database whose contents the reader cannot use', async () => {
      const directory = await directoryWith({ published: 100, recorded: 100, stored: 90 });
      const db = new DatabaseSync(path.join(directory, HISTORY_DB));
      db.exec("UPDATE candle SET open = 'x'");
      expect(
        db.prepare('PRAGMA quick_check').all(),
        'the point of the case is that quick_check sees nothing wrong',
      ).toEqual([{ quick_check: 'ok' }]);
      db.close();
      const report = await verifyStateDirectory(directory);
      expect(report.problems.map((p) => p.file)).toEqual([HISTORY_DB]);
      expect(report.problems[0]!.detail).toMatch(/cannot be read: Expected a number/);
      expect(stateRefusal(report)).toMatch(/Refusing to start[\s\S]*history\.db/);
    });

    it('leaves a healthy directory exactly as consistent as it was', async () => {
      const directory = await directoryWith({ published: 100, recorded: 4_000, stored: 90 });
      const report = await verifyStateDirectory(directory);
      expect(report.problems).toEqual([]);
      expect(report.heads['eurusd']).toEqual({ checkpoint: 100, record: 4_000, history: 90 });
    });
  });

  /**
   * **Cycle Audit 10 (a2-09).** The registry check could be deleted outright —
   * `void FileAssetRegistry;` in its place — and every test in this file and in
   * `venueRecord.test.ts` still passed. A registry that cannot be read is a
   * catalogue the venue cannot host, and it is the fourth file in the state
   * directory: it is checked, so it is guarded.
   */
  it('refuses a registry it cannot read, by file', async () => {
    const directory = await directoryWith({ published: 100, recorded: 100, stored: 90 });
    mkdirSync(path.join(directory, 'assets'), { recursive: true });
    writeFileSync(path.join(directory, 'assets', 'eurusd.json'), '{ this is not json');
    const report = await verifyStateDirectory(directory);
    expect(report.problems.map((p) => p.file)).toEqual(['assets']);
    expect(stateRefusal(report)).toMatch(/Refusing to start[\s\S]*assets/);
  });

  /**
   * **Cycle Audit 10, a6-06.** The loop that checks the heads iterated the
   * *checkpoints*, so an asset the record held and no checkpoint named was
   * examined by nothing: `state:verify` answered `Assets: none (nothing to
   * resume)` and `Consistent: every file agrees.`, exit 0, on a directory
   * holding ticks for 29 of 30 assets after a SIGKILL inside the first
   * checkpoint interval. Re-executed by the refuter on the audited commit.
   *
   * A warning rather than a problem, because `resumeMarket` now reopens such a
   * market past the record instead of forking it at sequence 1 (see
   * `seamPastRecord`): refusing the boot would refuse a directory the venue
   * recovers correctly. What the operator needs is to be told, by name.
   */
  it('warns about a record holding ticks for an asset no checkpoint names (a6-06)', async () => {
    const directory = await directoryWith({ published: 100, recorded: 100, stored: null });
    const record = new SqliteTickRecord(path.join(directory, RECORD_DB));
    await record.append([{ assetId: 'gbpusd', ticks: [tick(1), tick(2), tick(3)] }]);
    record.close();
    const report = await verifyStateDirectory(directory);
    expect(report.problems).toEqual([]);
    expect(report.warnings.map((w) => [w.file, w.assetId])).toEqual([[RECORD_DB, 'gbpusd']]);
    expect(report.warnings[0]!.detail).toMatch(/ticks 1–3 .*no checkpoint names it/);
    expect(report.warnings[0]!.detail).toMatch(/seam/);
    // Named in the heads as well, so the tool prints what it holds rather than
    // "Assets: none".
    expect(report.heads['gbpusd']).toEqual({ checkpoint: null, record: 3, history: null });
    expect(stateRefusal(report), 'the venue reopens past it; this is not a refusal').toBeNull();
  });

  /**
   * **Cycle Audit 10, a6-07.** The documented restore is a directory swap with
   * the service stopped, and after one nothing in the directory says a restore
   * happened: the venue seams from the backup's checkpoint, every tick served
   * after the backup is gone from the record (404 by sequence), and
   * `GET /markets/:id/price?at=` answers instants observers already held with
   * the backup-era price. Measured on a 3.5-minute run against a 30-second-old
   * backup: `/ticks/310` 404 where an observer held sequence 310, and
   * `/price?at=` answering -73 where observers saw -374.
   *
   * The rollback cannot be undone by a boot. What a boot can do is *say* so,
   * and the manifest the backup tool leaves in the copy is enough to know: a
   * directory whose heads are still exactly what the manifest recorded is a
   * backup copy nothing has run in yet.
   */
  it('recognises an untouched backup copy, and stops once the venue has run in it (a6-07)', async () => {
    const directory = await directoryWith({ published: 100, recorded: 130, stored: 120 });
    const target = path.join(scratch(), 'backup');
    await backupStateDirectory(directory, target, GENESIS + 5);

    const asRestored = await verifyStateDirectory(target);
    expect(asRestored.backup).toEqual({ takenAt: GENESIS + 5, untouched: true });
    expect(asRestored.problems, 'saying so is not refusing').toEqual([]);
    expect(stateRefusal(asRestored)).toBeNull();

    // One tick served in the restored directory and it is no longer a copy of
    // anything: the heads have moved past what the manifest recorded.
    const record = new SqliteTickRecord(path.join(target, RECORD_DB));
    await record.append([{ assetId: 'eurusd', ticks: [tick(131)] }]);
    record.close();
    expect((await verifyStateDirectory(target)).backup).toEqual({
      takenAt: GENESIS + 5,
      untouched: false,
    });

    // And a directory that is not a copy of anything says nothing.
    expect((await verifyStateDirectory(directory)).backup).toBeNull();
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
    // **Cycle Audit 10 (a2-09).** `verifyStateDirectory(to)` could be changed to
    // `(from)` — the report in the manifest describing the *source* rather than
    // the copy — with this file and `venueRecord.test.ts` all green, because
    // every head compared here is equal either way. A backup whose `VACUUM INTO`
    // had silently produced a bad file would still have been reported verified.
    expect(report.directory, 'the report describes the source, not the copy').toBe(target);
    expect(manifest).toMatchObject({
      kind: 'otc-state-backup',
      version: 1,
      takenAt: GENESIS + 5,
      assets: ['eurusd'],
      heads: { eurusd: { checkpoint: 100, record: 130, history: 120 } },
    });
    const again = await verifyStateDirectory(target);
    expect(again.heads).toEqual(manifest.heads);
    // What the operator's `state:verify` would say about the copy, and what the
    // boot check would do with it — not only its heads (Cycle Audit 10, a7-01).
    expect(again.problems).toEqual([]);
    expect(again.assets).toEqual(manifest.assets);
    expect(stateRefusal(again)).toBeNull();
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

  /**
   * **Cycle Audit 10 (a7-01), the other half.** `backup` is a legal asset id
   * and the manifest is written under that name, so a copy that carried the
   * checkpoint across would have the manifest written over it — one market's
   * lease marks lost, silently. Refusing costs an operator a rename.
   */
  it('refuses a source whose checkpoint would be written over by the manifest', async () => {
    const directory = await directoryWith({ published: 10, recorded: 10, stored: null });
    writeFileSync(
      path.join(directory, BACKUP_MANIFEST),
      JSON.stringify(stubRecord('backup', epochMillis(GENESIS))),
    );
    await expect(
      backupStateDirectory(directory, path.join(scratch(), 'copy'), GENESIS),
    ).rejects.toThrow(/holds a checkpoint at backup\.json/);
  });

  /**
   * **Cycle Audit 10 (a3-05).** A backup is taken *while the venue runs* — that
   * is what the tool is for — and each `VACUUM INTO` snapshots at its own
   * instant, so the copy holds three files caught at three different moments.
   * The order was checkpoints, record, history, which makes the history the
   * newest file in the copy: a bar folded while the record's VACUUM ran lands
   * in a copy whose record does not hold the ticks it came from, which is
   * exactly the condition `verifyStateDirectory` refuses. The backup then
   * failed its own verification, the tool exited 1, and the unbootable
   * directory stayed on disk — on a perfectly healthy venue.
   *
   * So this runs the case the tool exists for: a real second process appending
   * ticks and closing bars throughout the copy. The writer keeps the invariant
   * a venue keeps — ticks first, then the bar folded from them — so with the
   * copy ordered checkpoints, history, record the result is clean *whatever*
   * the timing, and this test cannot flake green-side. Taken the other way it
   * fails within milliseconds; that is the plant this guard was watched
   * failing on.
   */
  it('verifies clean when taken against a directory a second process is advancing', async () => {
    const recorded = 30_000;
    const directory = await directoryWith({ published: 100, recorded, stored: 120 });
    const hot = path.join(scratch(), 'hot');
    const writer = await advancing(directory, recorded);
    let report: StateDirectoryReport;
    try {
      report = (await backupStateDirectory(directory, hot, GENESIS + 5)).report;
    } finally {
      await stop(writer);
    }
    expect(stateRefusal(report)).toBeNull();
    expect(report.problems).toEqual([]);
    const heads = report.heads['eurusd'];
    expect(heads, 'the copy holds no head for the asset it was taken from').toBeDefined();
    expect(
      heads!.history,
      'the copy holds a bar folded from ticks it does not hold',
    ).toBeLessThanOrEqual(heads!.record!);
    // And the writer really was inside the window: the copy is ahead of where
    // the record stood when it started, so the source moved while it was read.
    expect(
      heads!.record,
      'nothing was written during the backup; the test proved nothing',
    ).toBeGreaterThan(recorded);
    // The heads are the *copy's* (a2-09). This is the case where verifying the
    // source instead is observable: the source was still advancing while the
    // copy was verified, so the two numbers are different numbers.
    const copy = new SqliteTickRecord(path.join(hot, RECORD_DB));
    const copyHead = await copy.head('eurusd');
    copy.close();
    expect(heads!.record, 'the report describes the source, not the copy').toBe(copyHead);
  }, 30_000);

  /**
   * **Cycle Audit 10 (a6-13), the cost of the check.** `quick_check` reads the
   * whole file, and the file it reads may be one a venue is writing. SQLite
   * gives the reader a consistent snapshot, so a healthy live database must
   * come back clean — a check that called a running venue's record damaged
   * would be worse than the hole it closes, because it would refuse the boot
   * that follows a kill.
   */
  it('calls a database a second process is writing healthy, not damaged', async () => {
    const recorded = 30_000;
    const directory = await directoryWith({ published: 100, recorded, stored: 120 });
    const writer = await advancing(directory, recorded);
    let live: StateDirectoryReport;
    try {
      live = await verifyStateDirectory(directory);
    } finally {
      await stop(writer);
    }
    expect(live.problems, 'a live state directory was called damaged').toEqual([]);
    expect(live.heads['eurusd']!.record).toBeGreaterThan(recorded);
  }, 30_000);

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
