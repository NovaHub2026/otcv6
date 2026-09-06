import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { CommitmentError, proveInclusion, type InclusionProof } from './commitment.js';
import { readCommitmentsStream } from './commitmentsFile.js';
import type { SignedCommitment } from './signing.js';

/**
 * The journal a window was archived as, read back (PH-29.1).
 *
 * The format is `@otc/lab`'s (`assurance.ts` reads it there): a header line
 * naming the instrument and the count, then one `[sequence, instant, price]`
 * per line. This reader mirrors that one rather than importing it — `@otc/api`
 * may not depend on the lab — and refuses the same shapes: a gap, a count the
 * header does not agree with, a line that is not a tick.
 */
export class JournalFileError extends Error {
  constructor(detail: string) {
    super(`Journal file: ${detail}`);
    this.name = 'JournalFileError';
  }
}

export interface JournalFile {
  readonly instrumentId: string;
  readonly logQuantum: number;
  readonly ticks: readonly Tick[];
}

export function readJournalFile(filePath: string): JournalFile {
  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  if (lines.length === 0) throw new JournalFileError('empty');
  let header: {
    kind?: string;
    version?: number;
    instrumentId?: string;
    logQuantum?: number;
    ticks?: number;
  };
  try {
    header = JSON.parse(lines[0]!) as typeof header;
  } catch {
    throw new JournalFileError('header is not JSON');
  }
  if (header.kind !== 'otc-tick-journal') throw new JournalFileError('not a tick journal');
  if (header.version !== 1)
    throw new JournalFileError(`unsupported version ${String(header.version)}`);
  if (typeof header.instrumentId !== 'string' || typeof header.logQuantum !== 'number') {
    throw new JournalFileError('header is missing the instrument');
  }
  const ticks: Tick[] = [];
  let previous: number | null = null;
  for (let i = 1; i < lines.length; i += 1) {
    let row: unknown;
    try {
      row = JSON.parse(lines[i]!);
    } catch {
      throw new JournalFileError(`line ${i + 1} is not JSON — the file may be truncated`);
    }
    if (!Array.isArray(row) || row.length !== 3 || !row.every((v) => Number.isSafeInteger(v))) {
      throw new JournalFileError(`line ${i + 1} is not [sequence, instant, price]`);
    }
    const [sequence, instant, price] = row as [number, number, number];
    if (previous !== null && sequence !== previous + 1) {
      throw new JournalFileError(
        `sequence ${sequence} follows ${previous} at line ${i + 1}: a gap`,
      );
    }
    previous = sequence;
    ticks.push({ sequence, instant: epochMillis(instant), price: logPrice(price) });
  }
  if (header.ticks !== undefined && header.ticks !== ticks.length) {
    throw new JournalFileError(`header claims ${header.ticks} ticks, found ${ticks.length}`);
  }
  return { instrumentId: header.instrumentId, logQuantum: header.logQuantum, ticks };
}

/** What asking the publication directory for a proof can come back with. */
export type PublicationProof =
  | {
      readonly kind: 'proved';
      readonly signed: SignedCommitment;
      readonly proof: InclusionProof;
      /** Commitments read before the window was found; a cost the caller may report. */
      readonly linksRead: number;
    }
  | { readonly kind: 'uncommitted'; readonly committedThrough: number | null }
  | { readonly kind: 'not-published' };

/**
 * The inclusion proof for one sequence, from what the venue archived.
 *
 * The window is found by streaming the asset's commitments file until one
 * spans the sequence — linear in the chain, one line in memory at a time
 * (Issue #19) — and the window's ticks come from its journal. `uncommitted`
 * names the newest committed sequence, so a caller can tell "not yet" from
 * "never": a tick in the open window is published and not archived, a real
 * third state (`PUBLICATION.md`).
 */
export async function proveFromPublication(
  directory: string,
  assetId: string,
  sequence: number,
): Promise<PublicationProof> {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError(`A sequence must be a positive integer, received ${sequence}.`);
  }
  const file = path.join(directory, assetId, 'commitments.ndjson');
  if (!existsSync(file)) {
    // The writer makes the asset's directory when it registers the asset and
    // the file when its first window closes: a directory with no file is a
    // market that publishes and has not committed yet — "not yet", not "no"
    // (PH-29.3's run against the shipped service answered 404 here).
    return existsSync(path.join(directory, assetId))
      ? { kind: 'uncommitted', committedThrough: null }
      : { kind: 'not-published' };
  }
  let committedThrough: number | null = null;
  let linksRead = 0;
  for await (const { signed } of readCommitmentsStream(file)) {
    linksRead += 1;
    const { fromSequence, toSequence } = signed.commitment;
    committedThrough = toSequence;
    if (sequence < fromSequence) {
      // Before this window and not in an earlier one: a chain that restarted
      // past it, or a sequence never published. Either way not committed.
      return { kind: 'uncommitted', committedThrough: null };
    }
    if (sequence > toSequence) continue;
    const journal = readJournalFile(
      path.join(directory, assetId, `${String(fromSequence)}-${String(toSequence)}.journal`),
    );
    const first = journal.ticks[0];
    if (
      first === undefined ||
      first.sequence !== fromSequence ||
      journal.ticks.length !== signed.commitment.count
    ) {
      throw new CommitmentError(
        `The journal for ${assetId} ${fromSequence}-${toSequence} does not match its commitment ` +
          `(${journal.ticks.length} ticks, first ${String(first?.sequence)}).`,
      );
    }
    return { kind: 'proved', signed, proof: proveInclusion(journal.ticks, sequence), linksRead };
  }
  return { kind: 'uncommitted', committedThrough };
}
