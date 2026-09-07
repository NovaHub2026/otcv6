// Invariant evidence: INV-009 (reproducible settlement).
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, SteppableClock, type Tick } from '@otc/core';
import { FileStateStore, RECORD_DB, SqliteTickRecord, STATE_RECORD_VERSION } from '@otc/runtime';
import { parseStateToolArgs, runStateTool } from './stateTool.js';

const GENESIS = 1_776_000_000_000;
const directories: string[] = [];
function scratch(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'otc-state-tool-'));
  directories.push(d);
  return d;
}
afterAll(() => {
  for (const d of directories) rmSync(d, { recursive: true, force: true });
});

async function stateDir(published: number, recorded: number): Promise<string> {
  const directory = scratch();
  const tick = (s: number): Tick => ({
    sequence: s,
    instant: epochMillis(GENESIS + s * 500),
    price: logPrice(1_000 + s),
  });
  await new FileStateStore(directory).save({
    version: STATE_RECORD_VERSION,
    assetId: 'eurusd',
    savedAt: epochMillis(GENESIS),
    snapshot: {} as never,
    pending: null,
    lastPublished: {
      sequence: published,
      instant: tick(published).instant,
      price: tick(published).price,
    },
    leasedBlocks: { sign: '1:0' },
    leasedSequence: 1,
  });
  const record = new SqliteTickRecord(path.join(directory, RECORD_DB));
  await record.append([
    { assetId: 'eurusd', ticks: Array.from({ length: recorded }, (_, i) => tick(i + 1)) },
  ]);
  record.close();
  return directory;
}

describe('the operator’s state tool', () => {
  it('parses its two commands and refuses anything else', () => {
    expect(parseStateToolArgs(['verify', '--dir', 'x'])).toEqual({ command: 'verify', dir: 'x' });
    expect(parseStateToolArgs(['backup', '--dir', 'x', '--out', 'y'])).toEqual({
      command: 'backup',
      dir: 'x',
      out: 'y',
    });
    expect(() => parseStateToolArgs(['restore', '--dir', 'x'])).toThrow(/Usage/);
    expect(() => parseStateToolArgs(['verify'])).toThrow(/--dir is required/);
    expect(() => parseStateToolArgs(['backup', '--dir', 'x'])).toThrow(/needs --out/);
    expect(() => parseStateToolArgs(['verify', '--dir'])).toThrow(/needs a value/);
  });

  it('verify exits 0 on a consistent directory and 1 with the problem named', async () => {
    const good = await stateDir(100, 120);
    const ok = await runStateTool(['verify', '--dir', good]);
    expect(ok.code).toBe(0);
    expect(ok.output).toMatch(/eurusd: checkpoint through 100, record through 120/);
    expect(ok.output).toMatch(/Consistent/);
    const bad = await stateDir(100, 80);
    const refused = await runStateTool(['verify', '--dir', bad]);
    expect(refused.code).toBe(1);
    expect(refused.output).toMatch(/Refusing to start[\s\S]*record\.db \(eurusd\)/);
    expect((await runStateTool(['nonsense'])).code).toBe(2);
  });

  /**
   * **Cycle Audit 10 (a8-05).** `verify` on a path that does not exist printed
   * `Assets: none (nothing to resume)` / `Consistent: every file agrees.` and
   * exited **0** — a mistyped `--dir`, an unmounted volume or a restore that
   * never landed, all reading as a healthy state directory, and PH-28 cites
   * `state:verify — exit 0` as evidence of consistency. `backup` refused the
   * same input. The two commands now agree, and an empty directory that does
   * exist is still the legal first-boot state it always was.
   */
  it('verify refuses a directory that is not there, exactly as backup does', async () => {
    const missing = path.join(scratch(), 'never-mounted');
    const verified = await runStateTool(['verify', '--dir', missing]);
    expect(verified.code).toBe(1);
    expect(verified.output).toBe(`No state directory at ${missing}.`);
    const backed = await runStateTool([
      'backup',
      '--dir',
      missing,
      '--out',
      path.join(scratch(), 'out'),
    ]);
    expect(backed.code).toBe(1);
    expect(backed.output).toBe(verified.output);
    // And the other half: nothing to resume is not the same as nowhere to look.
    const empty = await runStateTool(['verify', '--dir', scratch()]);
    expect(empty.code).toBe(0);
    expect(empty.output).toMatch(/Assets: none \(nothing to resume\)[\s\S]*Consistent/);
  });

  /**
   * **Cycle Audit 10 (a6-13).** This is the command the restore runbook names
   * as its acceptance check, and on a state directory with 8 KB of garbage in
   * the middle of `record.db` it printed every asset's heads and `Consistent:
   * every file agrees.`, exit 0. The venue then booted, resumed and seamed the
   * whole catalogue, and died in `#primeFromRecord` with a raw
   * `ERR_SQLITE_ERROR` — every two seconds, under `Restart=always`.
   */
  it('does not call a damaged record.db consistent', async () => {
    const directory = await stateDir(100, 4_000);
    const file = path.join(directory, RECORD_DB);
    const handle = openSync(file, 'r+');
    try {
      writeSync(handle, Buffer.alloc(8_192, 0x5a), 0, 8_192, Math.floor(statSync(file).size / 2));
    } finally {
      closeSync(handle);
    }
    const verified = await runStateTool(['verify', '--dir', directory]);
    expect(verified.output).not.toMatch(/Consistent/);
    expect(verified.output).toMatch(/record\.db: is damaged/);
    expect(verified.code).toBe(1);
  });

  it('backup writes a verified copy with its manifest, at the clock it is given', async () => {
    const source = await stateDir(100, 120);
    const out = path.join(scratch(), 'backup');
    const clock = new SteppableClock(epochMillis(GENESIS + 99));
    const result = await runStateTool(['backup', '--dir', source, '--out', out], clock);
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/Backup written to .*taken at 1776000000099/);
    const manifest = JSON.parse(readFileSync(path.join(out, 'backup.json'), 'utf8')) as {
      heads: unknown;
    };
    expect(manifest.heads).toEqual({ eurusd: { checkpoint: 100, record: 120, history: null } });
    // A second backup into the same place is refused, not merged.
    writeFileSync(path.join(out, 'keep'), '');
    expect((await runStateTool(['backup', '--dir', source, '--out', out], clock)).code).toBe(1);
  });

  /**
   * **Cycle Audit 10 (a7-01).** The documented restore is a directory swap
   * with the service stopped, and the boot check is what decides. So the check
   * this test makes is the operator's: `verify` on the directory `backup` just
   * wrote, unmodified, manifest and all. It refused — `backup.json (backup):
   * record belongs to asset undefined` — because the manifest the tool writes
   * into its own copy was read back as a checkpoint. The tool exited 0 while
   * producing a directory that would not boot, because it verified the copy
   * *before* writing the manifest into it.
   */
  it('writes a copy that its own verify — and therefore the boot check — accepts', async () => {
    const source = await stateDir(100, 120);
    const out = path.join(scratch(), 'restore');
    const clock = new SteppableClock(epochMillis(GENESIS + 99));
    const written = await runStateTool(['backup', '--dir', source, '--out', out], clock);
    expect(written.code).toBe(0);
    const restored = await runStateTool(['verify', '--dir', out]);
    expect(restored.output).toMatch(/Consistent: every file agrees/);
    expect(restored.code).toBe(0);
    expect(restored.output).toMatch(/Assets: 1 — eurusd/);
    // And a backup of a restored directory does not carry the old manifest in.
    const second = path.join(scratch(), 'restore-2');
    expect((await runStateTool(['backup', '--dir', out, '--out', second], clock)).code).toBe(0);
    expect((await runStateTool(['verify', '--dir', second])).code).toBe(0);
  });
});
