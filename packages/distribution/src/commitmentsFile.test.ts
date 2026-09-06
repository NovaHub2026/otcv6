// Invariant evidence: INV-009 (reproducible settlement), INV-010 (private generator state).
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { commit } from './commitment.js';
import {
  chainTipOf,
  IncrementalChainVerifier,
  readCommitmentsStream,
  verifyCommitmentsFile,
} from './commitmentsFile.js';
import { PublicationWriter, readCommitments } from './publicationWriter.js';
import { signRotation, type SignedRotation } from './rotation.js';
import {
  publicKeyHex,
  publishingKeyFromSeed,
  signCommitment,
  verifySignedChain,
  type SignedCommitment,
} from './signing.js';

const KEY_0 = publishingKeyFromSeed('11'.repeat(32));
const KEY_1 = publishingKeyFromSeed('22'.repeat(32));
const HEX_0 = publicKeyHex(KEY_0);
const HEX_1 = publicKeyHex(KEY_1);
const SPEC = { assetId: 'eurusd', instrumentId: 'EURUSD', logQuantum: 1e-5 };

const directories: string[] = [];
async function scratch(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-commitments-'));
  directories.push(directory);
  return directory;
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

/** A signed chain of `windows` links of ten ticks, under one key. */
function chain(windows: number, key = KEY_0, from = 1, previousRoot = ''): SignedCommitment[] {
  const out: SignedCommitment[] = [];
  let root = previousRoot;
  for (let w = 0; w < windows; w += 1) {
    const commitment = commit('eurusd', ticks(from + w * 10, 10), root);
    out.push(signCommitment(commitment, key));
    root = commitment.root;
  }
  return out;
}

function incremental(
  links: readonly SignedCommitment[],
  genesis = HEX_0,
  rotations: readonly SignedRotation[] = [],
): string | null {
  const verifier = new IncrementalChainVerifier(genesis, rotations);
  for (const link of links) {
    const refusal = verifier.accept(link);
    if (refusal !== null) return refusal;
  }
  return verifier.finish();
}

describe('the commitments file is read as a stream', () => {
  it('yields what readCommitments parses, with the line each came from', async () => {
    const directory = await scratch();
    const writer = new PublicationWriter({
      directory,
      windowTicks: 10,
      privateKey: KEY_0,
      assets: [SPEC],
    });
    writer.observe('eurusd', ticks(1, 35));
    const file = path.join(directory, 'eurusd', 'commitments.ndjson');
    const whole = readCommitments(await readFile(file, 'utf8'));
    expect(whole).toHaveLength(3);
    const streamed: { line: number; signed: SignedCommitment }[] = [];
    for await (const entry of readCommitmentsStream(file)) streamed.push(entry);
    expect(streamed.map((e) => e.signed)).toEqual(whole);
    expect(streamed.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(chainTipOf(file)).toEqual(whole[2]);
  });

  it('reads the tip from the tail of the file, however long the last line is', async () => {
    const directory = await scratch();
    const file = path.join(directory, 'commitments.ndjson');
    expect(chainTipOf(file), 'no file').toBeNull();
    await writeFile(file, '');
    expect(chainTipOf(file), 'empty file').toBeNull();
    const links = chain(3);
    const padded = { ...links[2]!, pad: 'x'.repeat(20_000) };
    await writeFile(
      file,
      `${links.map((l) => JSON.stringify(l)).join('\n')}\n${JSON.stringify(padded)}\n`,
    );
    expect((chainTipOf(file) as unknown as { pad: string }).pad).toHaveLength(20_000);
    await writeFile(file, `${JSON.stringify(links[0])}\n`);
    expect(chainTipOf(file)).toEqual(links[0]);
  });
});

describe('the incremental verifier gives the batch verifier’s verdicts', () => {
  it('accepts a genuine chain and reports its tip', () => {
    const links = chain(5);
    const verifier = new IncrementalChainVerifier(HEX_0);
    for (const link of links) expect(verifier.accept(link)).toBeNull();
    expect(verifier.finish()).toBeNull();
    expect(verifier.count).toBe(5);
    expect(verifier.tip).toEqual(links[4]!.commitment);
    expect(verifySignedChain(links, HEX_0)).toBeNull();
  });

  it.each([
    [
      'a tampered link',
      (l: SignedCommitment[]) =>
        (l[2] = { ...l[2]!, commitment: { ...l[2]!.commitment, count: 9 } }),
    ],
    [
      'a link signed by an unauthorised key',
      (l: SignedCommitment[]) => (l[3] = signCommitment(l[3]!.commitment, KEY_1)),
    ],
    [
      'a broken hash link',
      (l: SignedCommitment[]) =>
        (l[3] = signCommitment({ ...l[3]!.commitment, previousRoot: 'ab'.repeat(32) }, KEY_0)),
    ],
    [
      'a foreign asset',
      (l: SignedCommitment[]) =>
        (l[1] = signCommitment({ ...l[1]!.commitment, assetId: 'gbpusd' }, KEY_0)),
    ],
  ])('refuses %s where the batch verifier does, with the same words', (_what, corrupt) => {
    const links = chain(5);
    corrupt(links);
    const batch = verifySignedChain(links, HEX_0);
    expect(batch).not.toBeNull();
    expect(incremental(links)).toBe(batch);
  });

  it('refuses an empty chain and a genesis key that is not a key', () => {
    expect(incremental([])).toBe(verifySignedChain([], HEX_0));
    const links = chain(2);
    expect(incremental(links, 'not-a-key')).toBe(verifySignedChain(links, 'not-a-key'));
  });

  it('places a rotation by its head root, exactly as the batch verifier does', () => {
    const before = chain(3, KEY_0);
    const head = before[2]!.commitment.root;
    const rotation = signRotation(
      {
        toPublicKey: HEX_1,
        epoch: 1,
        reason: 'scheduled',
        heads: [{ assetId: 'eurusd', root: head }],
      },
      KEY_0,
    );
    const after = chain(2, KEY_1, 31, head);
    const good = [...before, ...after];
    expect(verifySignedChain(good, HEX_0, [rotation])).toBeNull();
    expect(incremental(good, HEX_0, [rotation])).toBeNull();
    // The retired key signing after its rotation.
    const retired = [...before, ...chain(2, KEY_0, 31, head)];
    const batchRetired = verifySignedChain(retired, HEX_0, [rotation]);
    expect(batchRetired).toMatch(/retired key/);
    expect(incremental(retired, HEX_0, [rotation])).toBe(batchRetired);
    // A rotation whose head this chain never reaches.
    const elsewhere = signRotation(
      {
        toPublicKey: HEX_1,
        epoch: 1,
        reason: 'x',
        heads: [{ assetId: 'eurusd', root: 'cd'.repeat(32) }],
      },
      KEY_0,
    );
    const batchMissing = verifySignedChain(before, HEX_0, [elsewhere]);
    expect(batchMissing).toMatch(/does not contain/);
    expect(incremental(before, HEX_0, [elsewhere])).toBe(batchMissing);
    // A chain that continues under the new key with no head named (nothing
    // published at the rotation): epoch 1 required from the first link.
    const headless = signRotation({ toPublicKey: HEX_1, epoch: 1, reason: 'x' }, KEY_0);
    const wrongFromStart = chain(2, KEY_0);
    expect(incremental(wrongFromStart, HEX_0, [headless])).toBe(
      verifySignedChain(wrongFromStart, HEX_0, [headless]),
    );
    expect(incremental(chain(2, KEY_1), HEX_0, [headless])).toBeNull();
  });
});

describe('a commitments file is verified without being held whole (Issue #19)', () => {
  it('verifies a genuine file and names the line of a tampered one', async () => {
    const directory = await scratch();
    const file = path.join(directory, 'commitments.ndjson');
    const links = chain(6);
    await writeFile(file, `${links.map((l) => JSON.stringify(l)).join('\n')}\n`);
    const ok = await verifyCommitmentsFile(file, HEX_0);
    expect(ok).toEqual({ ok: true, count: 6, tip: links[5]!.commitment, breaks: [] });
    const tampered = [...links];
    tampered[3] = { ...links[3]!, signature: links[2]!.signature };
    await writeFile(file, `${tampered.map((l) => JSON.stringify(l)).join('\n')}\n`);
    const bad = await verifyCommitmentsFile(file, HEX_0);
    expect(bad.ok).toBe(false);
    expect(bad.count).toBe(3);
    expect(bad.error).toEqual({
      line: 4,
      detail: 'Commitment 3 is not signed by the key it names.',
    });
    await writeFile(file, '');
    expect((await verifyCommitmentsFile(file, HEX_0)).error?.detail).toBe('The chain is empty.');
  });

  it('holds far less than the file while verifying it', async () => {
    const directory = await scratch();
    const file = path.join(directory, 'commitments.ndjson');
    const links = chain(12_000);
    await writeFile(file, `${links.map((l) => JSON.stringify(l)).join('\n')}\n`);
    const size = (await stat(file)).size;
    expect(size).toBeGreaterThan(5_000_000);
    (globalThis as { gc?: () => void }).gc?.();
    const before = process.memoryUsage().heapUsed;
    const verdict = await verifyCommitmentsFile(file, HEX_0);
    const after = process.memoryUsage().heapUsed;
    expect(verdict.ok).toBe(true);
    expect(verdict.count).toBe(12_000);
    // `readCommitments` would hold the string and the parsed array: more than
    // the file. A stream holds a line. The bound is loose because the heap is
    // measured without a forced collection on most runs.
    console.info(
      `[commitments] ${(size / 1e6).toFixed(1)} MB verified; heap moved ${((after - before) / 1e6).toFixed(1)} MB`,
    );
    expect(after - before).toBeLessThan(size);
  });
});

describe('a chain restarted at an empty root is two chains, and the break is named (PH-30.4)', () => {
  it('verifies both chains, names the break, and shows a window cut from the earlier tail as a wider gap', async () => {
    const directory = await scratch();
    const file = path.join(directory, 'commitments.ndjson');
    // Six windows to sequence 60, then a seam: the chain restarts at 100_061.
    const links = [...chain(6), ...chain(3, KEY_0, 100_061)];
    await writeFile(file, `${links.map((l) => JSON.stringify(l)).join('\n')}\n`);
    const verdict = await verifyCommitmentsFile(file, HEX_0);
    expect(verdict.ok).toBe(true);
    expect(verdict.count).toBe(9);
    expect(verdict.tip).toEqual(links[8]!.commitment);
    expect(verdict.breaks).toEqual([{ link: 6, afterSequence: 60, fromSequence: 100_061 }]);
    // The incremental verifier says the same, one link at a time.
    const verifier = new IncrementalChainVerifier(HEX_0);
    for (const link of links) expect(verifier.accept(link)).toBeNull();
    expect(verifier.finish()).toBeNull();
    expect(verifier.breaks).toEqual(verdict.breaks);
    // A window dropped from the tail of the first chain does not break a
    // signature; it widens the reported gap, which is what a reader can see.
    const cut = [...links.slice(0, 5), ...links.slice(6)];
    await writeFile(file, `${cut.map((l) => JSON.stringify(l)).join('\n')}\n`);
    const wider = await verifyCommitmentsFile(file, HEX_0);
    expect(wider.ok).toBe(true);
    expect(wider.breaks).toEqual([{ link: 5, afterSequence: 50, fromSequence: 100_061 }]);
    // A restart is still a link: one for another asset, or signed by a key
    // that was never authorised, is refused where it stands.
    const other = [...chain(6), ...chain(1, KEY_1, 100_061)];
    await writeFile(file, `${other.map((l) => JSON.stringify(l)).join('\n')}\n`);
    const refused = await verifyCommitmentsFile(file, HEX_0);
    expect(refused.ok).toBe(false);
    expect(refused.breaks).toEqual([]);
    expect(refused.error).toEqual({
      line: 7,
      detail: 'Commitment 6 is signed by a key that was never authorised to publish.',
    });
    const foreign: SignedCommitment = signCommitment(
      commit('gbpusd', ticks(100_061, 10), ''),
      KEY_0,
    );
    expect(incremental([...chain(6), foreign])).toBe(
      'Commitment 6 is for gbpusd, following eurusd.',
    );
  });
});

describe('the chain outlives the process (PH-28.3)', () => {
  it('a writer over an existing directory continues the chain from its tip', async () => {
    const directory = await scratch();
    const first = new PublicationWriter({
      directory,
      windowTicks: 10,
      privateKey: KEY_0,
      assets: [SPEC],
    });
    expect(first.resumption('eurusd')).toEqual({ kind: 'fresh' });
    first.observe('eurusd', ticks(1, 25)); // two windows closed, five ticks pending and lost
    const second = new PublicationWriter({
      directory,
      windowTicks: 10,
      privateKey: KEY_0,
      assets: [SPEC],
    });
    const resumed = second.resumption('eurusd');
    expect(resumed?.kind).toBe('continued');
    expect(second.nextSequence('eurusd')).toBe(21);
    // The gap the previous process left pending is refused, not bridged.
    expect(() => second.observe('eurusd', ticks(26, 10))).toThrow(/expected sequence 21/);
    second.observe('eurusd', ticks(21, 20));
    const file = path.join(directory, 'eurusd', 'commitments.ndjson');
    const verdict = await verifyCommitmentsFile(file, HEX_0);
    expect(verdict.ok).toBe(true);
    expect(verdict.count).toBe(4);
    expect(verdict.tip?.fromSequence).toBe(31);
    // A third writer registers an asset the directory never saw: fresh for that one only.
    const third = new PublicationWriter({
      directory,
      windowTicks: 10,
      privateKey: KEY_0,
      assets: [SPEC, { ...SPEC, assetId: 'gbpusd', instrumentId: 'GBPUSD' }],
    });
    expect(third.resumption('eurusd')?.kind).toBe('continued');
    expect(third.resumption('gbpusd')).toEqual({ kind: 'fresh' });
  });

  it('refuses to continue another identity’s directory, or another window size', async () => {
    const directory = await scratch();
    new PublicationWriter({ directory, windowTicks: 10, privateKey: KEY_0, assets: [SPEC] });
    expect(
      () =>
        new PublicationWriter({ directory, windowTicks: 10, privateKey: KEY_1, assets: [SPEC] }),
    ).toThrow(/key rotation, not a resume/);
    expect(
      () =>
        new PublicationWriter({ directory, windowTicks: 20, privateKey: KEY_0, assets: [SPEC] }),
    ).toThrow(/One chain has one window size/);
  });
});
