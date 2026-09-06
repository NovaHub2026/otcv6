// Invariant evidence: INV-009 (reproducible settlement), INV-010 (private generator state).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { CommitmentError, verifyInclusion } from './commitment.js';
import { JournalFileError, proveFromPublication, readJournalFile } from './journalFile.js';
import { PublicationWriter } from './publicationWriter.js';
import { publicKeyHex, publishingKeyFromSeed, verifyCommitment } from './signing.js';

const KEY = publishingKeyFromSeed('55'.repeat(32));
const HEX = publicKeyHex(KEY);
const SPEC = { assetId: 'eurusd', instrumentId: 'EURUSD', logQuantum: 1e-5 };
const directories: string[] = [];
async function scratch(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'otc-journal-'));
  directories.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(directories.map((d) => rm(d, { recursive: true, force: true })));
});
function ticks(from: number, count: number): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: from + i,
    instant: epochMillis(1_776_000_000_000 + (from + i) * 250),
    price: logPrice((from + i) * 3 - 7),
  }));
}

describe('a journal file is read back as the lab reads it', () => {
  it('yields the window the writer archived, and refuses what is not a journal', async () => {
    const directory = await scratch();
    const writer = new PublicationWriter({
      directory,
      windowTicks: 10,
      privateKey: KEY,
      assets: [SPEC],
    });
    writer.observe('eurusd', ticks(1, 10));
    const file = path.join(directory, 'eurusd', '1-10.journal');
    const journal = readJournalFile(file);
    expect(journal).toEqual({ instrumentId: 'EURUSD', logQuantum: 1e-5, ticks: ticks(1, 10) });
    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    const bad = path.join(directory, 'bad.journal');
    await writeFile(bad, '');
    expect(() => readJournalFile(bad)).toThrow(JournalFileError);
    await writeFile(bad, `${lines[0]}\n${lines[1]}\n${lines[3]}\n`);
    expect(() => readJournalFile(bad)).toThrow(/a gap/);
    await writeFile(bad, `${lines[0]}\n${lines[1]}\n`);
    expect(() => readJournalFile(bad)).toThrow(/header claims 10 ticks, found 1/);
    await writeFile(bad, `{"kind":"something-else"}\n`);
    expect(() => readJournalFile(bad)).toThrow(/not a tick journal/);
    await writeFile(bad, `${lines[0]}\n[1, 2]\n`);
    expect(() => readJournalFile(bad)).toThrow(/not \[sequence, instant, price\]/);
  });
});

describe('a proof comes from the archive (PH-29.1)', () => {
  it('proves a committed sequence, says "not yet" for the open window and "never" for an unpublished asset', async () => {
    const directory = await scratch();
    const writer = new PublicationWriter({
      directory,
      windowTicks: 10,
      privateKey: KEY,
      assets: [SPEC],
    });
    writer.observe('eurusd', ticks(1, 25)); // windows 1-10 and 11-20 committed; 21-25 open
    const proved = await proveFromPublication(directory, 'eurusd', 17);
    expect(proved.kind).toBe('proved');
    if (proved.kind !== 'proved') return;
    expect(proved.linksRead).toBe(2);
    expect(proved.proof).toMatchObject({
      sequence: 17,
      index: 6,
      instant: ticks(17, 1)[0]!.instant,
      price: ticks(17, 1)[0]!.price,
    });
    expect(verifyInclusion(proved.signed.commitment, proved.proof)).toBe(true);
    expect(verifyCommitment(proved.signed, HEX)).toBe(true);
    expect(
      verifyInclusion(proved.signed.commitment, { ...proved.proof, price: proved.proof.price + 1 }),
    ).toBe(false);
    expect(await proveFromPublication(directory, 'eurusd', 23)).toEqual({
      kind: 'uncommitted',
      committedThrough: 20,
    });
    expect(await proveFromPublication(directory, 'eurusd', 900)).toEqual({
      kind: 'uncommitted',
      committedThrough: 20,
    });
    expect(await proveFromPublication(directory, 'gbpusd', 1)).toEqual({ kind: 'not-published' });
    // Registered, nothing committed yet: "not yet", not "no".
    new PublicationWriter({
      directory,
      windowTicks: 10,
      privateKey: KEY,
      assets: [{ ...SPEC, assetId: 'gbpusd', instrumentId: 'GBPUSD' }],
    });
    expect(await proveFromPublication(directory, 'gbpusd', 1)).toEqual({
      kind: 'uncommitted',
      committedThrough: null,
    });
    await expect(proveFromPublication(directory, 'eurusd', 0)).rejects.toThrow(/positive integer/);
  });

  it('refuses a journal that does not match its commitment, and a sequence before a restarted chain', async () => {
    const directory = await scratch();
    const writer = new PublicationWriter({
      directory,
      windowTicks: 10,
      privateKey: KEY,
      assets: [SPEC],
    });
    writer.observe('eurusd', ticks(1, 20));
    const file = path.join(directory, 'eurusd', '11-20.journal');
    const lines = (await readFile(file, 'utf8')).split('\n');
    await writeFile(
      file,
      [lines[0]!.replace('"ticks":10', '"ticks":9'), ...lines.slice(1, 10)].join('\n'),
    );
    await expect(proveFromPublication(directory, 'eurusd', 15)).rejects.toThrow(CommitmentError);
    // A chain restarted at 31: sequences 21-30 were never committed.
    writer.restartChain('eurusd');
    writer.observe('eurusd', ticks(31, 10));
    expect(await proveFromPublication(directory, 'eurusd', 25)).toEqual({
      kind: 'uncommitted',
      committedThrough: null,
    });
    expect((await proveFromPublication(directory, 'eurusd', 35)).kind).toBe('proved');
  });
});
