import type { SignedCommitment } from './signing.js';

/**
 * An external anchor for the commitment chain.
 *
 * A root served only by the venue's own API proves nothing the venue could not
 * also rewrite. The chain is tamper-*evident* to anyone holding an earlier copy
 * of it, and holds nothing against a counterparty who has only ever seen the
 * operator's current answer.
 *
 * So the chain is summarised into an append-only anchor and placed somewhere
 * the operator does not control. The repository is public and independently
 * hosted, which makes it one at no cost: third-party timestamping and a
 * tamper-evident history, for the price of committing a file.
 *
 * What is built here is the artefact and its verifier. Pushing it anywhere needs
 * a credential and a schedule, which are operational acts with no code in this
 * repository.
 */

/** One asset's chain, summarised at a point in time. */
export interface AnchorEntry {
  readonly assetId: string;
  /** First sequence the chain covers. */
  readonly fromSequence: number;
  /** Last sequence the chain covers. */
  readonly toSequence: number;
  /** Number of commitments summarised. */
  readonly commitments: number;
  /** Root of the newest commitment. */
  readonly headRoot: string;
  /**
   * No digest over the roots, and that is deliberate.
   *
   * The first version carried one, documented as committing "to the whole
   * prefix, not just its end". It does not add that, because `headRoot` already
   * has it: `commit()` folds `previousRoot` into every root, so the head is a
   * hash-chain over the entire history. Any change anywhere in the chain
   * changes the head.
   *
   * It was removed when a planted defect disabled the digest check and the
   * whole battery stayed green — there is no chain this system can produce
   * where the digest disagrees and the head does not. A field in a published
   * artefact that reads as a guarantee and cannot fail is the "recorded number
   * that nothing reads" this project has already found once, and shipping it
   * would have invited a verifier to rely on it.
   */
  /** Hex SPKI of the key that signed the newest commitment. */
  readonly publicKey: string;
}

export interface Anchor {
  readonly version: 1;
  /** When the anchor was built, by the caller's clock. */
  readonly at: number;
  readonly entries: readonly AnchorEntry[];
}

export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnchorError';
  }
}

/** Summarise one asset's chain. The chain must be non-empty and in order. */
export function summarise(chain: readonly SignedCommitment[]): AnchorEntry {
  if (chain.length === 0) {
    throw new AnchorError('An empty chain cannot be anchored: there is nothing to attest.');
  }
  const first = chain[0]!.commitment;
  const last = chain[chain.length - 1]!;
  return {
    assetId: first.assetId,
    fromSequence: first.fromSequence,
    toSequence: last.commitment.toSequence,
    commitments: chain.length,
    headRoot: last.commitment.root,
    publicKey: last.publicKey,
  };
}

/** Build an anchor over several assets' chains. */
export function buildAnchor(chains: readonly (readonly SignedCommitment[])[], at: number): Anchor {
  const entries = chains.map(summarise);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.assetId)) {
      throw new AnchorError(
        `Asset ${entry.assetId} appears twice in one anchor. Two summaries of one chain would ` +
          `let a reader pick whichever agrees with them.`,
      );
    }
    seen.add(entry.assetId);
  }
  return {
    version: 1,
    at,
    entries: [...entries].sort((a, b) => a.assetId.localeCompare(b.assetId)),
  };
}

/**
 * Check an anchor against the chains it claims to summarise.
 *
 * Returns null when it agrees, or the first disagreement. Never throws: a
 * verifier is often reading someone else's file and a malformed one is a
 * finding, not a crash.
 */
export function verifyAnchor(
  anchor: Anchor,
  chains: readonly (readonly SignedCommitment[])[],
): string | null {
  if (anchor.version !== 1) return `Unknown anchor version ${String(anchor.version)}.`;
  const byAsset = new Map<string, AnchorEntry>();
  for (const entry of anchor.entries) byAsset.set(entry.assetId, entry);
  if (byAsset.size !== anchor.entries.length) {
    return 'The anchor summarises one asset more than once.';
  }

  for (const chain of chains) {
    let actual: AnchorEntry;
    try {
      actual = summarise(chain);
    } catch (error) {
      return (error as Error).message;
    }
    const claimed = byAsset.get(actual.assetId);
    if (claimed === undefined) return `The anchor does not mention ${actual.assetId}.`;
    byAsset.delete(actual.assetId);

    if (claimed.headRoot !== actual.headRoot) {
      return `${actual.assetId}: the anchor's head root does not match the chain's.`;
    }
    if (claimed.commitments !== actual.commitments) {
      return `${actual.assetId}: the anchor claims ${claimed.commitments} commitments, the chain has ${actual.commitments}.`;
    }
    if (claimed.fromSequence !== actual.fromSequence || claimed.toSequence !== actual.toSequence) {
      return `${actual.assetId}: the anchor claims a different sequence range than the chain.`;
    }
    if (claimed.publicKey !== actual.publicKey) {
      return `${actual.assetId}: the anchor names a different signing key than the chain's head.`;
    }
  }
  if (byAsset.size > 0) {
    return `The anchor mentions ${[...byAsset.keys()].join(', ')}, for which no chain was given.`;
  }
  return null;
}

/**
 * Whether `later` is a legitimate continuation of `earlier`.
 *
 * The property an append-only anchor has to have, and the one a counterparty
 * actually uses: they keep the anchor they saw last quarter and check that
 * today's extends it. An entry that shrank, or whose earlier roots changed, is
 * a rewritten record however well-formed the new file is.
 */
export function extendsAnchor(earlier: Anchor, later: Anchor): string | null {
  if (later.at < earlier.at) return 'The later anchor is dated before the earlier one.';
  const now = new Map(later.entries.map((entry) => [entry.assetId, entry]));
  for (const before of earlier.entries) {
    const after = now.get(before.assetId);
    if (after === undefined) return `${before.assetId} has disappeared from the anchor.`;
    if (after.fromSequence !== before.fromSequence) {
      return `${before.assetId}: the chain no longer starts where it did.`;
    }
    if (after.toSequence < before.toSequence) {
      return `${before.assetId}: the chain has gone backwards.`;
    }
    if (after.commitments < before.commitments) {
      // Not implied by the sequence checks above. Re-windowing the same range
      // into fewer, larger commitments leaves `toSequence` untouched and is a
      // rewritten chain: the roots a counterparty was shown no longer exist.
      return `${before.assetId}: commitments have been removed.`;
    }
    if (
      after.toSequence === before.toSequence &&
      after.commitments === before.commitments &&
      after.headRoot !== before.headRoot
    ) {
      return `${before.assetId}: the same range and window count now hash differently — the record was rewritten.`;
    }
  }
  return null;
}
