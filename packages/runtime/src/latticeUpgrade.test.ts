// Invariant evidence: INV-002 (shared market), INV-009 (reproducible settlement).
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { RECORD_SCHEMA_VERSION, SqliteTickRecord } from './tickRecord.js';

/**
 * A record written by the previous release, opened by this one.
 *
 * **Cycle Audit 12's headline, and the reason this file is shaped the way it
 * is.** A release passed its full gate, passed hosted CI on both jobs, and was
 * broken in production anyway, in the one path no test walks. The auditor who
 * named the general shape put it better than a summary can:
 *
 * > The defect was not a missing test but a missing **test input**. Every test
 * > in the repository constructs its artefacts with the code under test. An
 * > upgrade feeds the _previous release's_ artefact to the _current_ reader,
 * > and nothing in the gate can produce one.
 *
 * So this test does not synthesise a version-2 file by hand-writing the DDL the
 * current code believes the old code used — that is a test of this release's
 * memory, not of the old release. It materialises `v2.4.0`, builds it, and
 * writes the record with **that** build. `v2.4.0` is the right tag because it
 * is the release that moved all thirty lattices, so it is the artefact every
 * real deployment is upgrading from.
 *
 * The `node_modules/@otc` exclusion is load-bearing and was measured in both
 * directions by the audit's refuter: without it the materialised tree imports
 * today's `@otc/core` and the comparison goes falsely green.
 */
const PREVIOUS_TAG = 'v2.4.0';
const REPO = path.resolve(import.meta.dirname, '../../..');

const directories: string[] = [];
async function scratch(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-upgrade-'));
  directories.push(directory);
  return directory;
}
afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function tagIsAvailable(): boolean {
  try {
    execFileSync('git', ['-C', REPO, 'rev-parse', `${PREVIOUS_TAG}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function materialise(tag: string): string {
  const to = path.join(tmpdir(), `otc-previous-record-${tag}`);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  execFileSync('bash', ['-c', `git -C '${REPO}' archive ${tag} | tar -x -C '${to}'`]);
  const shared = path.join(REPO, 'node_modules');
  mkdirSync(path.join(to, 'node_modules', '@otc'), { recursive: true });
  for (const entry of readdirSync(shared)) {
    if (entry === '@otc') continue;
    symlinkSync(path.join(shared, entry), path.join(to, 'node_modules', entry));
  }
  for (const pkg of readdirSync(path.join(to, 'packages'))) {
    symlinkSync(path.join(to, 'packages', pkg), path.join(to, 'node_modules', '@otc', pkg));
  }
  return to;
}

/** Write a record with the previous release's own code, and say what it wrote. */
function recordWrittenBy(tree: string, file: string): readonly Tick[] {
  execFileSync(path.join(tree, 'node_modules/.bin/tsc'), ['-b', 'packages/runtime'], { cwd: tree });
  const probe = path.join(tree, 'record-probe.mjs');
  writeFileSync(
    probe,
    `import { SqliteTickRecord } from '@otc/runtime';\n` +
      `const record = new SqliteTickRecord(process.argv[2]);\n` +
      `const ticks = [];\n` +
      `for (let s = 1; s <= 200; s += 1) ticks.push({ sequence: s, instant: ${String(GENESIS)} + s * 250, price: 1000 + s });\n` +
      // The previous release's AssetBatch has no frame. That is the point: this
      // is what a deployment's file actually contains.
      `await record.append([{ assetId: 'eurusd-otc', ticks }]);\n` +
      `record.close();\n` +
      `console.log(JSON.stringify(ticks));\n`,
  );
  const printed = execFileSync('node', [probe, file], { cwd: tree, encoding: 'utf8' });
  return (JSON.parse(printed) as { sequence: number; instant: number; price: number }[]).map(
    (row) => ({
      sequence: row.sequence,
      instant: epochMillis(row.instant),
      price: logPrice(row.price),
    }),
  );
}

const GENESIS = 1_776_000_000_000;

describe('a record written by the previous release, read by this one (PH-38.1)', () => {
  it(`opens ${PREVIOUS_TAG}'s record, keeps every tick, and reports its past as undeclared`, async () => {
    if (!existsSync(path.join(REPO, 'packages')) || !tagIsAvailable()) {
      // An integration package has no git history. This must be a loud skip
      // rather than a silent early return: a guard that passes because it did
      // nothing is exactly what Cycle Audit 12 found at `9e44ffb`.
      console.info(`[lattice-upgrade] SKIPPED: ${PREVIOUS_TAG} is not reachable from this tree`);
      return;
    }
    const file = path.join(await scratch(), 'record.db');
    const written = recordWrittenBy(materialise(PREVIOUS_TAG), file);
    expect(written).toHaveLength(200);

    // What the old release stamped, before this one touches it.
    const before = new DatabaseSync(file);
    const stampedBefore = Number(before.prepare('PRAGMA user_version').get()!['user_version']);
    before.close();
    expect(stampedBefore, 'the previous release wrote a version-2 record').toBe(2);

    const record = new SqliteTickRecord(file);
    try {
      // Every tick survives the upgrade, byte for byte. The record is never
      // rewritten: a client holds these integers and `settle()` compares
      // them, so re-expressing them would change settled outcomes (INV-009).
      expect(await record.since('eurusd-otc', 1, 500)).toEqual(written);
      // And the file is now a version-3 file.
      const after = new DatabaseSync(file);
      expect(Number(after.prepare('PRAGMA user_version').get()!['user_version'])).toBe(
        RECORD_SCHEMA_VERSION,
      );
      after.close();
      // The point of the whole phase: the upgraded file says it does **not
      // know** what these integers counted in, rather than answering with
      // today's frame. Nothing in this repository can soundly date them.
      expect(await record.frames('eurusd-otc')).toEqual([]);
      expect(await record.frameAt('eurusd-otc', 1)).toBeNull();
      expect(await record.frameAt('eurusd-otc', 200)).toBeNull();
    } finally {
      record.close();
    }
  }, 180_000);
});

describe('a frame is recorded with the ticks it explains (PH-38.1)', () => {
  const OLD = { logQuantum: 3.131447750503912e-7, referencePrice: 1.1, displayPrecision: 5 };
  const NOW = { logQuantum: 4.044597092506429e-6, referencePrice: 1.1, displayPrecision: 5 };
  const run = (from: number, to: number): Tick[] => {
    const ticks: Tick[] = [];
    for (let s = from; s <= to; s += 1) {
      ticks.push({
        sequence: s,
        instant: epochMillis(GENESIS + s * 250),
        price: logPrice(1000 + s),
      });
    }
    return ticks;
  };

  it('writes one epoch per change, at the sequence the change took effect', async () => {
    const file = path.join(await scratch(), 'record.db');
    const first = new SqliteTickRecord(file);
    await first.append([{ assetId: 'a', ticks: run(1, 2000), frame: OLD }]);
    first.close();

    // Reopened, so the epoch is read back from disk rather than remembered.
    const second = new SqliteTickRecord(file);
    try {
      await second.append([{ assetId: 'a', ticks: run(2001, 4000), frame: NOW }]);
      const epochs = await second.frames('a');
      expect(epochs.map((e) => e.fromSequence)).toEqual([1, 2001]);
      expect(epochs[0]).toMatchObject({ ...OLD, fromSequence: 1 });
      expect(epochs[1]).toMatchObject({ ...NOW, fromSequence: 2001 });
      // Half-open: each epoch covers up to the next one's start.
      expect(await second.frameAt('a', 1)).toMatchObject(OLD);
      expect(await second.frameAt('a', 2000)).toMatchObject(OLD);
      expect(await second.frameAt('a', 2001)).toMatchObject(NOW);
      expect(await second.frameAt('a', 4000)).toMatchObject(NOW);
    } finally {
      second.close();
    }
  });

  it('writes no second epoch while the frame does not move', async () => {
    const record = new SqliteTickRecord(path.join(await scratch(), 'record.db'));
    try {
      await record.append([{ assetId: 'a', ticks: run(1, 100), frame: OLD }]);
      await record.append([{ assetId: 'a', ticks: run(101, 200), frame: { ...OLD } }]);
      expect(await record.frames('a')).toHaveLength(1);
    } finally {
      record.close();
    }
  });

  it('refuses a malformed frame and writes nothing, the way a malformed tick is refused', async () => {
    const record = new SqliteTickRecord(path.join(await scratch(), 'record.db'));
    try {
      await expect(
        record.append([{ assetId: 'a', ticks: run(1, 5), frame: { ...OLD, logQuantum: 0 } }]),
      ).rejects.toThrow(/log quantum that is not finite and positive/);
      expect(await record.head('a'), 'nothing was written').toBeNull();
      expect(await record.frames('a')).toEqual([]);
    } finally {
      record.close();
    }
  });

  it('the memory record answers exactly as the file one does', async () => {
    const { MemoryTickRecord } = await import('./tickRecord.js');
    const memory = new MemoryTickRecord();
    const file = new SqliteTickRecord(path.join(await scratch(), 'record.db'));
    try {
      for (const record of [memory, file]) {
        await record.append([{ assetId: 'a', ticks: run(1, 50), frame: OLD }]);
        await record.append([{ assetId: 'a', ticks: run(51, 100), frame: NOW }]);
      }
      expect(await memory.frames('a')).toEqual(await file.frames('a'));
      expect(await memory.frameAt('a', 50)).toEqual(await file.frameAt('a', 50));
      expect(await memory.frameAt('a', 51)).toEqual(await file.frameAt('a', 51));
    } finally {
      file.close();
    }
  });

  it('fails closed on a record newer than this reader understands', async () => {
    const file = path.join(await scratch(), 'record.db');
    const record = new SqliteTickRecord(file);
    await record.append([{ assetId: 'a', ticks: run(1, 5), frame: NOW }]);
    record.close();
    // A file written by a release that knows a version this one does not. A
    // reader that read on would render prices on a frame it cannot see, which
    // is the defect version 3 exists to prevent.
    const ahead = new DatabaseSync(file);
    ahead.exec(`PRAGMA user_version = ${RECORD_SCHEMA_VERSION + 1}`);
    ahead.close();
    expect(() => new SqliteTickRecord(file)).toThrow();
  });
});
