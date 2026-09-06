import { verifyChain } from './commitment.js';
import { verifySignedChain, type SignedCommitment } from './signing.js';
import type { SignedRotation } from './rotation.js';

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

/**
 * An interval inside an anchored range that the chain commits nothing in.
 *
 * The same fact `ChainBreak` reports about a file, carried into the anchor
 * because without it the entry's `fromSequence..toSequence` would read as a
 * range the chain covers, and after one deploy it is not (Cycle Audit 10,
 * a6-12). A reader pinning this anchor pins the holes too, so an operator
 * cannot widen one later and call it the same record.
 */
export interface AnchorBreak {
  /** The last sequence committed before the interval. */
  readonly afterSequence: number;
  /** The sequence the record resumes at. */
  readonly fromSequence: number;
  /** Whether the resuming link binds the head before the interval. */
  readonly bound: boolean;
}

/** One asset's chain, summarised at a point in time. */
export interface AnchorEntry {
  readonly assetId: string;
  /** First sequence the chain covers. */
  readonly fromSequence: number;
  /** Last sequence the chain covers. */
  readonly toSequence: number;
  /** Number of commitments summarised. */
  readonly commitments: number;
  /**
   * Intervals inside that range the chain commits nothing in, in order.
   *
   * Empty for a market that has never seamed. One entry per deploy-length
   * restart after that.
   */
  readonly breaks: readonly AnchorBreak[];
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

/**
 * Summarise one asset's published chain, however many pieces it is in.
 *
 * The chain is checked structurally first. **Cycle Audit 5, F-7:** this read
 * `assetId` and `fromSequence` from the first link and `toSequence` from the
 * last and validated nothing in between, so it happily summarised an array that
 * was not a chain at all — links for different assets, links that did not
 * follow one another — and published a range that no single record covered.
 *
 * ## A file is not always one chain, and refusing it anchors nothing
 *
 * **Cycle Audit 10, a6-12.** PH-30.4 made a seam start a new chain at an empty
 * root, and a seam is what every deploy is: thirty of thirty files in the
 * release run held two chains. `verifyChain` requires every link after the
 * first to carry a digest, so this threw `AnchorError` on all thirty — and the
 * anchor is the artefact that makes the chain evidence against the operator
 * rather than a number the operator serves. No anchor could be built for any
 * market that had ever been deployed twice.
 *
 * The unit is therefore the asset, not the unbroken chain: the array is split
 * where a genesis link appears mid-file, each piece is verified, and what the
 * entry publishes is the head root of the whole plus **where the coverage
 * stops and resumes**. The workaround an operator would otherwise reach for —
 * anchoring only the newest chain — is exactly the blindness a6-04 measured,
 * because that summary is byte-identical whether or not the earlier chain
 * still has its tail.
 */
export function summarise(chain: readonly SignedCommitment[]): AnchorEntry {
  if (chain.length === 0) {
    throw new AnchorError('An empty chain cannot be anchored: there is nothing to attest.');
  }
  const first = chain[0]!.commitment;
  const breaks: AnchorBreak[] = [];
  let segmentStart = 0;
  for (let i = 0; i <= chain.length; i += 1) {
    const link = i < chain.length ? chain[i]!.commitment : null;
    // A resume link binds its predecessor, so it stays inside its segment and
    // `verifyChain` checks the declaration against it. An unbound genesis link
    // mid-array ends the segment: nothing binds it to what came before, which
    // is precisely what the break records.
    if (link !== null) {
      if (link.resumesAfter !== undefined && i > segmentStart) {
        breaks.push({
          afterSequence: link.resumesAfter,
          fromSequence: link.fromSequence,
          bound: true,
        });
      }
      if (i === 0 || link.previousRoot !== '') continue;
    }
    const structural = verifyChain(chain.slice(segmentStart, i).map((l) => l.commitment));
    if (structural !== null) {
      throw new AnchorError(
        `That is not a chain, so it cannot be summarised: ${renumber(structural, segmentStart)}`,
      );
    }
    const previous = chain[i - 1]!.commitment;
    if (link === null) break;
    if (link.assetId !== first.assetId) {
      throw new AnchorError(
        `That is not one asset's record, so it cannot be summarised: commitment ${i} is for ` +
          `${link.assetId}, following ${first.assetId}.`,
      );
    }
    if (link.fromSequence <= previous.toSequence) {
      throw new AnchorError(
        `That is not one record, so it cannot be summarised: commitment ${i} starts at ` +
          `${link.fromSequence}, which commitment ${i - 1} already covers.`,
      );
    }
    breaks.push({
      afterSequence: previous.toSequence,
      fromSequence: link.fromSequence,
      bound: false,
    });
    segmentStart = i;
  }
  const last = chain[chain.length - 1]!;
  return {
    assetId: first.assetId,
    fromSequence: first.fromSequence,
    toSequence: last.commitment.toSequence,
    commitments: chain.length,
    breaks,
    headRoot: last.commitment.root,
    publicKey: last.publicKey,
  };
}

/** A segment's verdict numbers its own links; the caller numbers the array's. */
function renumber(detail: string, offset: number): string {
  if (offset === 0) return detail;
  return detail.replace(
    /\b([Cc]ommitment) (\d+)\b/g,
    (_, word: string, index: string) => `${word} ${Number(index) + offset}`,
  );
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
export interface AnchorCheck {
  /**
   * The genesis publishing key, and the rotation log.
   *
   * **Cycle Audit 5, F-7.** Without these, nothing in this module consults a
   * key at all: an anchor over a chain signed entirely by a stranger verified
   * clean, because `verifyAnchor` only compared the anchor's `publicKey` field
   * against the chain's — both supplied by the same party. Passing the genesis
   * key makes the anchor's identity claim attested rather than asserted.
   */
  readonly genesisPublicKey?: string;
  readonly rotations?: readonly SignedRotation[];
  /**
   * An anchor the reader kept earlier.
   *
   * Supplying it turns the append-only claim into a check against the record —
   * see {@link extendsAnchor} for why the anchors alone cannot bear it.
   */
  readonly previous?: Anchor;
}

export function verifyAnchor(
  anchor: Anchor,
  chains: readonly (readonly SignedCommitment[])[],
  check: AnchorCheck = {},
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
    // `?? []` because a verifier reads someone else's file: an anchor written
    // before entries carried their breaks parses into an entry without them,
    // and the honest verdict is that it claims none, not a crash.
    const disagreement = breaksDiffer(claimed.breaks ?? [], actual.breaks);
    if (disagreement !== null) {
      return `${actual.assetId}: the anchor and the chain disagree about ${disagreement}`;
    }
    if (claimed.publicKey !== actual.publicKey) {
      return `${actual.assetId}: the anchor names a different signing key than the chain's head.`;
    }
  }
  if (byAsset.size > 0) {
    return `The anchor mentions ${[...byAsset.keys()].join(', ')}, for which no chain was given.`;
  }

  if (check.genesisPublicKey !== undefined) {
    for (const chain of chains) {
      const signatures = verifySignedChain(chain, check.genesisPublicKey, check.rotations ?? []);
      if (signatures !== null) {
        return `${chain[0]!.commitment.assetId}: ${signatures}`;
      }
    }
  }
  if (check.previous !== undefined) {
    return extendsAnchor(check.previous, anchor, chains);
  }
  return null;
}

/**
 * Where two break lists disagree, in words, or null when they agree.
 *
 * A range with a hole in it is not the range without it, so an entry that
 * understated its holes would let an operator publish a summary claiming
 * coverage the chain does not have.
 */
function breaksDiffer(
  claimed: readonly AnchorBreak[],
  actual: readonly AnchorBreak[],
): string | null {
  if (claimed.length !== actual.length) {
    return (
      `how many intervals the record is missing: ${claimed.length} claimed, ` +
      `${actual.length} in the chain.`
    );
  }
  for (const [index, entry] of actual.entries()) {
    const said = claimed[index]!;
    if (
      said.afterSequence !== entry.afterSequence ||
      said.fromSequence !== entry.fromSequence ||
      said.bound !== entry.bound
    ) {
      return (
        `the interval after sequence ${entry.afterSequence}: the chain resumes at ` +
        `${entry.fromSequence} ${entry.bound ? 'bound to' : 'unbound from'} what precedes it.`
      );
    }
  }
  return null;
}

/**
 * Whether `later` is a legitimate continuation of `earlier`.
 *
 * The property an append-only anchor has to have, and the one a counterparty
 * actually uses: they keep the anchor they saw last quarter and check that
 * today's extends it.
 *
 * **Cycle Audit 5, F-1. This needs the chain, and the first version did not
 * take it.** The head-root comparison was reachable only when the record had
 * *not* grown — which is the one case where two anchors would not differ in the
 * first place. Whenever a window had been added, nothing looked at any root, and
 * an operator who rewrote history from window three onward, re-derived every
 * root after it and appended five more windows was accepted as having extended
 * the record. So was a total rewrite, and so was re-windowing the same range.
 *
 * Comparing the head roots of two chains of different lengths yields nothing,
 * and neither would the `rootsDigest` that PH-15.2 removed: what an append-only
 * claim needs is a relation *between* the artefacts. The chain is hash-linked,
 * so the relation is available — the window the earlier anchor summarised must
 * still be in the later chain, with the same root. That is exactly a consistency
 * proof, made cheap by the fact that the caller already holds the chain in order
 * to verify anything at all.
 */
export function extendsAnchor(
  earlier: Anchor,
  later: Anchor,
  laterChains: readonly (readonly SignedCommitment[])[],
): string | null {
  if (earlier.version !== 1) return `Unknown earlier anchor version ${String(earlier.version)}.`;
  // Checked on both, because a future format whose fields mean something else
  // would otherwise be compared field-by-field against a v1 anchor.
  if (later.version !== 1) return `Unknown later anchor version ${String(later.version)}.`;
  if (later.at < earlier.at) return 'The later anchor is dated before the earlier one.';

  const now = new Map(later.entries.map((entry) => [entry.assetId, entry]));
  const chainOf = new Map<string, readonly SignedCommitment[]>();
  for (const chain of laterChains) {
    if (chain.length > 0) chainOf.set(chain[0]!.commitment.assetId, chain);
  }

  for (const before of earlier.entries) {
    const after = now.get(before.assetId);
    if (after === undefined) return `${before.assetId} has disappeared from the anchor.`;
    if (after.fromSequence !== before.fromSequence) {
      return `${before.assetId}: the chain no longer starts where it did.`;
    }
    if (after.toSequence < before.toSequence) {
      return `${before.assetId}: the chain has gone backwards.`;
    }
    // An interval the reader was shown cannot close, move or lose its binding.
    // The head-root match below certifies the prefix only where the prefix is
    // hash-linked, and across an *unbound* break it is not — which is the one
    // place an operator could restate history without breaking a signature.
    // Every interval the reader was shown must still be there, unchanged and in
    // the same order: a later record may have seamed again, and may not have
    // un-seamed.
    const wasMissing = before.breaks ?? [];
    const nowMissing = after.breaks ?? [];
    if (
      wasMissing.length > nowMissing.length ||
      breaksDiffer(wasMissing, nowMissing.slice(0, wasMissing.length)) !== null
    ) {
      return (
        `${before.assetId}: the intervals the record is missing are no longer the ones the ` +
        `earlier anchor recorded.`
      );
    }
    if (after.commitments < before.commitments) {
      // Not implied by the sequence checks above. Re-windowing the same range
      // into fewer, larger commitments leaves `toSequence` untouched and is a
      // rewritten chain: the roots a counterparty was shown no longer exist.
      return `${before.assetId}: commitments have been removed.`;
    }

    const chain = chainOf.get(before.assetId);
    if (chain === undefined) {
      return (
        `${before.assetId}: no chain was given, so whether the record was rewritten cannot be ` +
        `established. The anchors alone cannot answer it.`
      );
    }
    // The window the earlier anchor summarised must still be there, unchanged.
    // Because every root binds its predecessor, that one match certifies the
    // whole prefix.
    const at = chain.find((link) => link.commitment.toSequence === before.toSequence);
    if (at === undefined) {
      return (
        `${before.assetId}: the record no longer contains a commitment ending at sequence ` +
        `${before.toSequence}, which the earlier anchor summarised.`
      );
    }
    if (at.commitment.root !== before.headRoot) {
      return (
        `${before.assetId}: the commitment ending at sequence ${before.toSequence} now has a ` +
        `different root — the record was rewritten.`
      );
    }
  }
  return null;
}
