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

/**
 * Thrown when a commitments file cannot be read as a chain **at all**.
 *
 * Not a verdict about the chain — that is `CommitmentsFileVerdict`, and a
 * chain that verifies badly is still a chain. This is the file underneath it:
 * a line that is not JSON, or a last line that was never finished.
 *
 * **Cycle Audit 10 (a2-04, a3-08, a8-06).** The chain is the one durable file
 * in the deployment that is never fsynced — checkpoints go through
 * `atomicFile.ts` and the databases are WAL, while a window is one
 * `appendFileSync` — so it is the file most likely to end in a torn line after
 * ENOSPC, a power loss or an interrupted copy, and it was the only one with no
 * parse guard at all. Every path through it called `JSON.parse` bare:
 * `chainTipOf` runs at boot for every asset, so one torn line in one market's
 * file aborted the boot of all thirty with `SyntaxError: Unterminated string
 * in JSON at position 200` and named no file, no asset and no repair; and
 * `verifyCommitmentsFile` — whose whole verdict type carries `error: {line,
 * detail}` so that a reader learns *where* a file went bad — threw the same
 * exception instead of answering, in exactly the case where naming the line
 * matters most.
 */
export class CommitmentsFileError extends Error {
  constructor(
    readonly filePath: string,
    readonly line: number | null,
    readonly detail: string,
  ) {
    super(`${filePath}${line === null ? '' : `, line ${line}`}: ${detail}`);
    this.name = 'CommitmentsFileError';
  }
}

/** One line of the file, or a refusal that names where it stopped being one. */
export function parseLink(filePath: string, line: number | null, text: string): SignedCommitment {
  try {
    return JSON.parse(text) as SignedCommitment;
  } catch (error) {
    throw new CommitmentsFileError(
      filePath,
      line,
      `this line is not JSON (${(error as Error).message}). A commitments file holds one ` +
        `signed commitment per line; a line that is not one is a file cut mid-append or ` +
        `partly copied, and no chain can be read across it.`,
    );
  }
}

/**
 * One signed commitment per line, in file order; a blank line is skipped.
 *
 * A line of spaces is blank too: `trim` rather than `length`, because a bare
 * length test sent whitespace into `JSON.parse` and threw where the file was
 * merely padded (Cycle Audit 10, a3-08).
 */
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
    if (text.trim().length === 0) continue;
    yield { line, signed: parseLink(filePath, line, text) };
  }
}

/**
 * The last complete line of the file, parsed, or null for an empty file.
 *
 * Reads the tail of the file, not the file: a writer resuming a chain at boot
 * needs the tip and nothing before it.
 *
 * ## A file that does not end in a newline was cut mid-append
 *
 * Every window is appended as one `${json}\n` in a single call, and the only
 * prefix of that payload ending in a newline is the whole of it. So bytes
 * after the file's last newline are a line that was never finished, and this
 * refuses by name (Cycle Audit 10, a2-04, a3-08, a8-06). It does **not**
 * bridge: reading the tip from the last whole line and appending after it
 * would write the next window onto the end of the fragment's own line, which
 * destroys a second window to hide the first. It does not truncate either —
 * an evidence file is not repaired by the process that found it damaged — so
 * the refusal names the byte to truncate to and the operator decides.
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
      const text = buffer.toString('utf8');
      const whole = span === size;
      const end = text.lastIndexOf('\n');
      const fragment = text.slice(end + 1);
      if (fragment.trim().length > 0 && (end >= 0 || whole)) {
        const bytes = Buffer.byteLength(fragment, 'utf8');
        throw new CommitmentsFileError(
          filePath,
          null,
          `the file ends in an unfinished line of ${bytes} byte(s). Every window is appended ` +
            `as one line ending in a newline, so a file that does not end in one was cut ` +
            `mid-append — ENOSPC, a power loss, or an interrupted copy. The chain is not ` +
            `continued across it and nothing is repaired here: truncate the file to ` +
            `${size - bytes} bytes, its last newline, and start again. Nothing published is ` +
            `necessarily lost by that: the next process resumes from the last whole window and ` +
            `re-commits from the tick record what the unfinished one covered, and where the ` +
            `record cannot reach it the chain states the interval instead.`,
        );
      }
      // Trailing blank lines are not the tip; step back over them.
      const complete = text.slice(0, end + 1);
      const done = complete.split('\n');
      for (let i = done.length - 1; i >= 0; i -= 1) {
        const line = done[i]!;
        if (line.trim().length === 0) continue;
        if (i === 0 && !whole) break;
        return parseLink(filePath, null, line);
      }
      if (whole) return null;
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
 * An interval of the record that no window in this file commits to.
 *
 * PH-28.3 stops bridging the chain when the record cannot reach the tip;
 * PH-30.4 does the same at a seam — a market resumed past its catch-up bound,
 * whose sequences jump by the lease. Both leave an interval nobody published,
 * and the file states it in one of two shapes:
 *
 * - **bound** — a resume link (`resumesAfter`), which binds the head the
 *   earlier run ended at and declares the sequence it ended at. The hash chain
 *   is unbroken across it, so a window cut from before the break is refused
 *   where the cut is rather than read as a wider gap.
 * - **unbound** — a second genesis link, the shape PH-30.4 wrote and Cycle
 *   Audit 10 found blind (a6-04): the two chains are bound to each other by
 *   nothing, so `afterSequence` is only the tail this file happens to hold,
 *   and an operator deleting the last windows of the earlier chain widens the
 *   interval without breaking a signature. Files written before Cycle 10 hold
 *   these, so they are read and reported rather than refused — and reported as
 *   what they are.
 */
export interface ChainBreak {
  /** Index of the link that resumes the record after the interval. */
  readonly link: number;
  /** The last sequence committed before the interval. */
  readonly afterSequence: number;
  /** Root of the window that ended at {@link afterSequence}. */
  readonly afterRoot: string;
  /** The sequence the record resumes at. */
  readonly fromSequence: number;
  /**
   * Whether the resuming link binds the head before the interval.
   *
   * `false` says the interval's near edge is unattested: what a reader can
   * conclude is that this file commits nothing between the two sequences, not
   * that nothing was published there.
   */
  readonly bound: boolean;
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
    // A genesis link after the first is an unbound restart (PH-28.3, PH-30.4,
    // and the shape Cycle Audit 10 found blind): checked as a genesis, for the
    // same asset, and reported as a break once the rest of the link — its key,
    // its epoch, its signature — has been accepted. A **resume** link is not
    // this: it binds its predecessor, so it goes through the pairwise check
    // like any other link and is reported as a bound break.
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
    if (this.#previous !== null && (restart || link.resumesAfter !== undefined)) {
      this.#breaks.push({
        link: i,
        afterSequence: this.#previous.toSequence,
        afterRoot: this.#previous.root,
        fromSequence: link.fromSequence,
        bound: !restart,
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
   * Intervals of the record this file commits nothing in, in file order. Empty
   * for a record covered end to end; a verifier that needs continuity checks
   * this, because `ok` says every link verifies and the chain is sound, not
   * that the coverage has no holes.
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
  try {
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
  } catch (error) {
    // A file that is not readable as lines is still a verdict, and the line it
    // stopped on is the whole point of the verdict carrying one (Cycle Audit
    // 10, a2-04): a broker verifying a partly downloaded chain could not
    // otherwise tell a damaged file from a broken verifier. Only this one
    // error is a verdict — anything else (EACCES, EISDIR) is the caller's
    // problem with the path they passed, not the file's contents.
    if (!(error instanceof CommitmentsFileError)) throw error;
    return {
      ok: false,
      count: verifier.count,
      tip: verifier.tip,
      breaks: verifier.breaks,
      error: { line: error.line, detail: error.detail },
    };
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
