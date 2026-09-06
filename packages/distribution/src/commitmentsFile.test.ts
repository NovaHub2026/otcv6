// Invariant evidence: INV-009 (reproducible settlement), INV-010 (private generator state).
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { commit } from './commitment.js';
import {
  chainTipOf,
  CommitmentsFileError,
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
  it('verifies both chains, names the break as unbound, and shows a window cut from the earlier tail as a wider gap', async () => {
    const directory = await scratch();
    const file = path.join(directory, 'commitments.ndjson');
    // Six windows to sequence 60, then a seam: the chain restarts at 100_061.
    const links = [...chain(6), ...chain(3, KEY_0, 100_061)];
    await writeFile(file, `${links.map((l) => JSON.stringify(l)).join('\n')}\n`);
    const verdict = await verifyCommitmentsFile(file, HEX_0);
    expect(verdict.ok).toBe(true);
    expect(verdict.count).toBe(9);
    expect(verdict.tip).toEqual(links[8]!.commitment);
    expect(verdict.breaks).toEqual([
      {
        link: 6,
        afterSequence: 60,
        afterRoot: links[5]!.commitment.root,
        fromSequence: 100_061,
        // Unbound: nothing in the second chain refers to the first, which is
        // exactly why the cut below is invisible here (Cycle Audit 10, a6-04).
        bound: false,
      },
    ]);
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
    expect(wider.breaks).toEqual([
      {
        link: 5,
        afterSequence: 50,
        afterRoot: links[4]!.commitment.root,
        fromSequence: 100_061,
        bound: false,
      },
    ]);
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

/**
 * Cycle Audit 10, a6-03 and a6-04.
 *
 * PH-30.4's restart at an empty root left two things behind. The ticks in the
 * open window went with the process, so a deploy abandoned them for ever; and
 * a window deleted from the tail of the earlier chain was indistinguishable
 * from that honest loss, to this verifier, to the proof route, to a rotation
 * and to the anchor. A resume link closes both: the chain is sealed where it
 * stops, and the link that resumes it binds the sealed head and states the
 * sequence it ended at.
 */
describe('a chain sealed at a seam and resumed after it (Cycle Audit 10)', () => {
  function seamed(directory: string): string {
    const writer = new PublicationWriter({
      directory,
      windowTicks: 10,
      privateKey: KEY_0,
      assets: [SPEC],
    });
    writer.observe('eurusd', ticks(1, 25));
    // A deploy: what was open is sealed, and the record resumes a lease later.
    writer.seamChain('eurusd');
    writer.observe('eurusd', ticks(100_061, 20));
    return path.join(directory, 'eurusd', 'commitments.ndjson');
  }

  it('commits the tail that was open, and names the interval as bound', async () => {
    const file = seamed(await scratch());
    const links = readCommitments(await readFile(file, 'utf8')).map((l) => l.commitment);
    // The seal: a short window over exactly the ticks that had been served and
    // not committed. Before this they were in no window at all, for ever.
    expect(links[2]!.fromSequence).toBe(21);
    expect(links[2]!.toSequence).toBe(25);
    expect(links[2]!.count).toBe(5);
    // Nothing served is outside the chain: the links tile 1..25 and then
    // 100_061..100_080, with the interval between declared.
    const verdict = await verifyCommitmentsFile(file, HEX_0);
    expect(verdict.ok, JSON.stringify(verdict.error)).toBe(true);
    expect(verdict.breaks).toEqual([
      {
        link: 3,
        afterSequence: 25,
        afterRoot: links[2]!.root,
        fromSequence: 100_061,
        bound: true,
      },
    ]);
    expect(links[3]!.resumesAfter).toBe(25);
    expect(links[3]!.previousRoot).toBe(links[2]!.root);
  });

  it('refuses a window cut from before the interval, where the cut is', async () => {
    // The a6-04 attack, executed. An operator holding the publishing key drops
    // the last window before the seam. Every remaining signature is genuine and
    // every link still verifies on its own — and the record no longer ends
    // where the link that resumes it says it ended.
    const file = seamed(await scratch());
    const links = readCommitments(await readFile(file, 'utf8'));
    const cut = [...links.slice(0, 2), ...links.slice(3)];
    await writeFile(file, `${cut.map((l) => JSON.stringify(l)).join('\n')}\n`);
    const verdict = await verifyCommitmentsFile(file, HEX_0);
    expect(verdict.ok).toBe(false);
    expect(verdict.error?.line).toBe(3);
    expect(verdict.error?.detail).toBe(
      'Commitment 2 does not follow commitment 1: the chain is broken there.',
    );
  });

  it('refuses a resume whose declaration disagrees with the head it binds', async () => {
    // The same cut, re-signed to bind the new tail. The operator has the key,
    // so the signature is genuine; what they cannot do is keep the root, and
    // the declaration is bound into it.
    const file = seamed(await scratch());
    const links = readCommitments(await readFile(file, 'utf8'));
    const resume = links[3]!.commitment;
    const forged = signCommitment({ ...resume, previousRoot: links[1]!.commitment.root }, KEY_0);
    const cut = [...links.slice(0, 2), forged, ...links.slice(4)];
    await writeFile(file, `${cut.map((l) => JSON.stringify(l)).join('\n')}\n`);
    const verdict = await verifyCommitmentsFile(file, HEX_0);
    expect(verdict.ok).toBe(false);
    expect(verdict.error?.detail).toBe(
      'Commitment 2 resumes after sequence 25, but commitment 1 ends at 20. The record ' +
        'between them is not the one this link was signed over.',
    );
  });

  it('refuses a resume link that declares an interval it does not have', () => {
    // A link dressed as a resume to excuse a gap it invented, and one that
    // declares a resume while continuing its predecessor exactly.
    const honest = chain(2);
    const invented = signCommitment(
      { ...commit('eurusd', ticks(21, 10), honest[1]!.commitment.root), resumesAfter: 25 },
      KEY_0,
    );
    expect(incremental([...honest, invented])).toBe(
      'Commitment 2 resumes after sequence 25, but commitment 1 ends at 20. The record ' +
        'between them is not the one this link was signed over.',
    );
    const contiguous = signCommitment(
      { ...commit('eurusd', ticks(21, 10), honest[1]!.commitment.root), resumesAfter: 20 },
      KEY_0,
    );
    expect(incremental([...honest, contiguous])).toBe(
      'Commitment 2 declares a resume but starts at 21, which follows 20 with nothing ' +
        'between. A window that continues its predecessor is an ordinary link.',
    );
  });
});

/**
 * Cycle Audit 10, a2-04, a3-08 and a8-06 — independently confirmed, and the
 * boot half executed by two refuters.
 *
 * The chain is the one durable file in the deployment that is never fsynced,
 * and it was the only one whose every reader called `JSON.parse` bare. A last
 * line cut mid-append — ENOSPC, a power loss, an interrupted copy — made
 * `chainTipOf` throw `SyntaxError: Unterminated string in JSON at position
 * 200` out of the `PublicationService` constructor, which took the boot of all
 * thirty markets down naming no file, no asset and no repair; and it made
 * `verifyCommitmentsFile` throw the same exception rather than return the
 * `{ok:false, error:{line, detail}}` its own verdict type promises, in exactly
 * the case where naming the line is the whole value of the verdict.
 */
describe('a commitments file that was cut mid-append is refused by name (Cycle Audit 10)', () => {
  /** Three whole windows, and then a line that stops in the middle. */
  async function torn(cut = 200): Promise<{ file: string; links: SignedCommitment[] }> {
    const directory = await scratch();
    const file = path.join(directory, 'commitments.ndjson');
    const links = chain(3);
    const whole = links.slice(0, 2).map((l) => `${JSON.stringify(l)}\n`);
    await writeFile(file, `${whole.join('')}${JSON.stringify(links[2]).slice(0, cut)}`);
    return { file, links };
  }

  it('gives a verdict naming the line instead of throwing', async () => {
    const { file, links } = await torn();
    const verdict = await verifyCommitmentsFile(file, HEX_0);
    expect(verdict.ok).toBe(false);
    expect(verdict.count).toBe(2);
    expect(verdict.tip).toEqual(links[1]!.commitment);
    expect(verdict.error?.line).toBe(3);
    expect(verdict.error?.detail).toMatch(/^this line is not JSON \(/);
    expect(verdict.error?.detail).toMatch(/cut mid-append or partly copied/);
  });

  it('refuses the tip of a torn file, naming the file, the bytes lost and the repair', async () => {
    const { file } = await torn();
    const size = (await stat(file)).size;
    let refusal: CommitmentsFileError | null = null;
    try {
      chainTipOf(file);
    } catch (error) {
      refusal = error as CommitmentsFileError;
    }
    expect(refusal).toBeInstanceOf(CommitmentsFileError);
    expect(refusal!.filePath).toBe(file);
    expect(refusal!.message).toContain(file);
    expect(refusal!.message).toContain('ends in an unfinished line of 200 byte(s)');
    expect(refusal!.message).toContain(`truncate the file to ${size - 200} bytes`);
    // And it is a refusal, not a bridge: reading the tip from the last whole
    // line would append the next window onto the fragment's own line.
    expect(refusal!.message).not.toMatch(/SyntaxError/);
  });

  it('refuses the boot of the asset whose file is torn, by asset id', async () => {
    const directory = await scratch();
    const writer = new PublicationWriter({
      directory,
      windowTicks: 10,
      privateKey: KEY_0,
      assets: [SPEC],
    });
    writer.observe('eurusd', ticks(1, 30));
    const file = path.join(directory, 'eurusd', 'commitments.ndjson');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.slice(0, text.length - 120));
    expect(
      () =>
        new PublicationWriter({ directory, windowTicks: 10, privateKey: KEY_0, assets: [SPEC] }),
    ).toThrow(/eurusd: the file ends in an unfinished line/);
  });

  it('reads a padded file: a line of spaces is blank, not a parse failure', async () => {
    const directory = await scratch();
    const file = path.join(directory, 'commitments.ndjson');
    const links = chain(3);
    await writeFile(file, `${links.map((l) => JSON.stringify(l)).join('\n   \n')}\n  \n`);
    const verdict = await verifyCommitmentsFile(file, HEX_0);
    expect(verdict.ok, JSON.stringify(verdict.error)).toBe(true);
    expect(verdict.count).toBe(3);
    expect(chainTipOf(file)).toEqual(links[2]);
    expect(readCommitments(await readFile(file, 'utf8'))).toEqual(links);
  });

  it('names the line when the whole file is parsed in one string', async () => {
    const { file } = await torn();
    const text = readFileSync(file, 'utf8');
    expect(() => readCommitments(text, file)).toThrow(
      new RegExp(`${file.replaceAll('/', '\\/')}, line 3: this line is not JSON`),
    );
  });
});
