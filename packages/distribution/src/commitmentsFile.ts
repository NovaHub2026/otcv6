import { closeSync, createReadStream, openSync, readSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { verifyChain, type Commitment } from './commitment.js';
import { authorisedKeys, type SignedRotation } from './rotation.js';
import { verifyCommitment, type SignedCommitment } from './signing.js';

/**
 * The commitments file, read as a stream and verified one link at a time
 * (PH-28.3, Issue #19).
 *
 * `readCommitments(text)` takes the whole file as one string, and a commitment
 * chain is never pruned — each root binds its predecessor, so the file grows
 * for the life of the market, at about 92 MB a year for the fastest asset.
 * Node's string ceiling is 536,870,888 bytes: somewhere around six years the
 * chain is intact on disk and the verifier can no longer load it, which is
 * the worst shape for this failure. Everything here holds one line at a time.
 */

/** One signed commitment per line, in file order; a blank line is skipped. */
export async function* readCommitmentsStream(
  filePath: string,
): AsyncGenerator<{ line: number; signed: SignedCommitment }> {
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let line = 0;
  for await (const text of lines) {
    line += 1;
    if (text.length === 0) continue;
    yield { line, signed: JSON.parse(text) as SignedCommitment };
  }
}

/**
 * The last complete line of the file, parsed, or null for an empty file.
 *
 * Reads the tail of the file, not the file: a writer resuming a chain at boot
 * needs the tip and nothing before it.
 */
export function chainTipOf(filePath: string): SignedCommitment | null {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (size === 0) return null;
  const fd = openSync(filePath, 'r');
  try {
    // A signed commitment is about 500 bytes; the window grows until it holds
    // a whole line, so a longer line is read rather than truncated.
    let span = Math.min(size, 4_096);
    for (;;) {
      const buffer = Buffer.alloc(span);
      readSync(fd, buffer, 0, span, size - span);
      const text = buffer.toString('utf8').replace(/\n+$/, '');
      const cut = text.lastIndexOf('\n');
      if (cut >= 0 || span === size) {
        const last = cut >= 0 ? text.slice(cut + 1) : text;
        if (last.length === 0) return null;
        return JSON.parse(last) as SignedCommitment;
      }
      span = Math.min(size, span * 4);
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * `verifySignedChain`, one link at a time and with the same verdicts.
 *
 * The batch verifier indexes every root of the chain to place each rotation's
 * head; this one remembers the heads it is still waiting for and activates a
 * rotation's epoch floor the moment its head root passes through. A head never
 * seen by `finish()` is the same refusal the batch form makes up front.
 */
/**
 * Where a commitments file's chain was restarted at an empty root.
 *
 * PH-28.3 restarts the chain rather than bridge it when the record cannot
 * reach the tip; PH-30.4 restarts it at a seam — a market resumed past its
 * catch-up bound, whose sequences jump by the lease. Either way the file
 * holds two chains and the genesis link of the second is signed by an
 * authorised key, so the verifier accepts it and **names the break** rather
 * than refuse the file: each chain still verifies link by link, and what the
 * break cannot prove is continuity. `afterSequence` and `fromSequence` say
 * how wide the uncommitted interval between the chains is; a window deleted
 * from the tail of the earlier chain widens it, which is the most a file
 * verifier can see and the reader is told so.
 */
export interface ChainBreak {
  /** Index of the genesis link that begins the new chain. */
  readonly link: number;
  /** The last sequence the earlier chain committed to. */
  readonly afterSequence: number;
  /** The sequence the new chain begins at. */
  readonly fromSequence: number;
}

export class IncrementalChainVerifier {
  readonly #epochOf: Map<string, number> | null;
  readonly #error: string | null;
  readonly #breaks: ChainBreak[] = [];
  /** Rotations whose head root this chain has not reached yet: root → epoch. */
  readonly #pendingHeads = new Map<string, number>();
  readonly #rotations: readonly SignedRotation[];
  #requiredEpoch = 0;
  #epoch = 0;
  #previous: Commitment | null = null;
  #count = 0;
  #assetId: string | null = null;

  constructor(genesisPublicKeyHex: string, rotations: readonly SignedRotation[] = []) {
    this.#rotations = rotations;
    const authorised = authorisedKeys(genesisPublicKeyHex, rotations);
    if ('error' in authorised) {
      this.#error = authorised.error;
      this.#epochOf = null;
      return;
    }
    this.#error = null;
    this.#epochOf = new Map(authorised.keys.map((key, epoch) => [key, epoch]));
  }

  get count(): number {
    return this.#count;
  }

  /** The newest accepted commitment, or null before any. */
  get tip(): Commitment | null {
    return this.#previous;
  }

  /** Every chain restart accepted so far, in file order. */
  get breaks(): readonly ChainBreak[] {
    return this.#breaks;
  }

  /** Accept the next link, or return why it is refused. */
  accept(signed: SignedCommitment): string | null {
    if (this.#error !== null || this.#epochOf === null) return this.#error;
    const i = this.#count;
    const link = signed.commitment;
    // A genesis link after the first is a restart (PH-28.3, PH-30.4): checked
    // as a genesis, for the same asset, and reported as a break once the rest
    // of the link — its key, its epoch, its signature — has been accepted.
    const restart = this.#previous !== null && link.previousRoot === '';
    const structural =
      this.#previous === null || restart
        ? verifyChain([link])
        : verifyChain([this.#previous, link]);
    if (structural === null && restart && link.assetId !== this.#assetId) {
      return `Commitment ${i} is for ${link.assetId}, following ${String(this.#assetId)}.`;
    }
    if (structural !== null) {
      // The pairwise check numbers the offered link 1 (or 0 at genesis); the
      // verdict names its place in the file.
      return structural
        .replace(/^Commitment [01]\b/, `Commitment ${i}`)
        .replace(/\bcommitment 0\b/, `commitment ${i - 1}`);
    }
    if (this.#assetId === null) {
      this.#assetId = link.assetId;
      for (const [index, rotation] of this.#rotations.entries()) {
        const head = rotation.rotation.heads.find((entry) => entry.assetId === link.assetId);
        if (head === undefined) this.#requiredEpoch = Math.max(this.#requiredEpoch, index + 1);
        else this.#pendingHeads.set(head.root, index + 1);
      }
    }
    const linkEpoch = this.#epochOf.get(signed.publicKey);
    if (linkEpoch === undefined) {
      return `Commitment ${i} is signed by a key that was never authorised to publish.`;
    }
    if (linkEpoch < this.#epoch) {
      return (
        `Commitment ${i} is signed by key epoch ${linkEpoch}, after the chain had reached ` +
        `epoch ${this.#epoch}. A retired key cannot sign history that follows its rotation.`
      );
    }
    if (linkEpoch < this.#requiredEpoch) {
      return (
        `Commitment ${i} is signed by key epoch ${linkEpoch}, but it follows the head named ` +
        `by rotation ${this.#requiredEpoch - 1}, so it must be signed at epoch ` +
        `${this.#requiredEpoch} or later. A retired key cannot sign history that follows its ` +
        `rotation.`
      );
    }
    if (!verifyCommitment(signed, signed.publicKey)) {
      return `Commitment ${i} is not signed by the key it names.`;
    }
    if (restart && this.#previous !== null) {
      this.#breaks.push({
        link: i,
        afterSequence: this.#previous.toSequence,
        fromSequence: link.fromSequence,
      });
    }
    this.#epoch = linkEpoch;
    this.#previous = link;
    this.#count += 1;
    const activated = this.#pendingHeads.get(link.root);
    if (activated !== undefined) {
      this.#pendingHeads.delete(link.root);
      this.#requiredEpoch = Math.max(this.#requiredEpoch, activated);
    }
    return null;
  }

  /** The verdict over everything accepted: null when the chain verifies. */
  finish(): string | null {
    if (this.#error !== null) return this.#error;
    if (this.#count === 0) return 'The chain is empty.';
    const [unseen] = this.#pendingHeads;
    if (unseen !== undefined) {
      return (
        `Rotation ${unseen[1] - 1} names a head root for ${String(this.#assetId)} that this ` +
        `chain does not contain, so the chain is not the record the rotation was signed over.`
      );
    }
    return null;
  }
}

export interface CommitmentsFileVerdict {
  readonly ok: boolean;
  /** Links accepted before the verdict. */
  readonly count: number;
  readonly tip: Commitment | null;
  /**
   * Where the chain was restarted at an empty root, in file order. Empty for
   * one unbroken chain; a verifier that needs continuity checks this, because
   * `ok` says every link verifies and every chain is whole, not that there is
   * one chain.
   */
  readonly breaks: readonly ChainBreak[];
  /** The refusal, with the file line it happened on; absent when ok. */
  readonly error?: { readonly line: number | null; readonly detail: string };
}

/** Verify a commitments file from its genesis key, holding one line at a time. */
export async function verifyCommitmentsFile(
  filePath: string,
  genesisPublicKeyHex: string,
  rotations: readonly SignedRotation[] = [],
): Promise<CommitmentsFileVerdict> {
  const verifier = new IncrementalChainVerifier(genesisPublicKeyHex, rotations);
  for await (const { line, signed } of readCommitmentsStream(filePath)) {
    const refusal = verifier.accept(signed);
    if (refusal !== null) {
      return {
        ok: false,
        count: verifier.count,
        tip: verifier.tip,
        breaks: verifier.breaks,
        error: { line, detail: refusal },
      };
    }
  }
  const final = verifier.finish();
  if (final !== null) {
    return {
      ok: false,
      count: verifier.count,
      tip: verifier.tip,
      breaks: verifier.breaks,
      error: { line: null, detail: final },
    };
  }
  return { ok: true, count: verifier.count, tip: verifier.tip, breaks: verifier.breaks };
}
