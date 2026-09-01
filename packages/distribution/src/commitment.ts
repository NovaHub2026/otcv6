import { createHash } from 'node:crypto';
import type { Tick } from '@otc/core';

/**
 * A cryptographic commitment over a contiguous range of the published record.
 *
 * ## What this is for
 *
 * PH-9.3 gave a counterparty everything needed to **recompute** a verdict from a
 * published journal, and said plainly what it had not given them: the journal's
 * fingerprint proves agreement, not authenticity. Nothing stopped an operator
 * publishing a different journal, and nothing let a trader show that the record
 * used to settle their contract was the record that existed when they opened it.
 *
 * A commitment closes that. One 32-byte root per window, published as the market
 * runs; a trader disputing a single contract needs an inclusion proof for two
 * ticks and `O(log n)` hashes, and the operator proves the specific claim without
 * publishing the whole history.
 *
 * ## What it does not do
 *
 * **It says nothing about whether the market was generated fairly.** It proves
 * the record is the record. Fairness rests on ADR-0003's theorem, the mirror
 * test and the attack battery — all of which the counterparty runs themselves.
 *
 * These are separate guarantees and the distinction matters, because a
 * cryptographic result reads as stronger than it is. A commitment over a rigged
 * market is a perfectly valid commitment.
 *
 * ## Construction
 *
 * ```
 * leaf = SHA256( 0x00 || sequence || instant || price )
 * node = SHA256( 0x01 || left || right )
 * root = SHA256( 0x02 || assetId || from || to || count || previousRoot || merkle )
 * ```
 *
 * Every part of that closes a specific attack; see the notes on
 * {@link LEAF_TAG}, {@link foldLevel} and {@link commit}.
 */

/** Domain separation tags. See {@link LEAF_TAG}. */
/**
 * Leaves and internal nodes are hashed under different tags.
 *
 * Without this an attacker can present an **internal node** where a leaf is
 * expected: the verifier hashes it, obtains a value that genuinely appears in the
 * tree, and the proof verifies for data that was never published. It is the
 * standard second-preimage attack on Merkle trees, and domain separation is the
 * whole defence — a leaf hash and a node hash cannot collide by construction.
 */
const LEAF_TAG = 0x00;
const NODE_TAG = 0x01;
const ROOT_TAG = 0x02;

export interface Commitment {
  readonly assetId: string;
  /** First sequence covered, inclusive. */
  readonly fromSequence: number;
  /** Last sequence covered, inclusive. */
  readonly toSequence: number;
  /** Leaves committed. Bound into the root; see {@link foldLevel}. */
  readonly count: number;
  /** Root of the preceding window, or the empty string for the first. */
  readonly previousRoot: string;
  /** Hex SHA-256. */
  readonly root: string;
}

export interface InclusionProof {
  readonly sequence: number;
  readonly instant: number;
  readonly price: number;
  /** Position of this tick among the committed leaves. */
  readonly index: number;
  /** Sibling hashes, bottom-up. Shorter than `log2(count)` where levels promote. */
  readonly path: readonly string[];
}

export class CommitmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommitmentError';
  }
}

function sha256(parts: readonly Buffer[]): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/** Big-endian, fixed width, so no two field values can be confused by framing. */
function u64(value: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(value));
  return out;
}

/** Prices are signed lattice indices, so they need a signed encoding. */
function i64(value: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigInt64BE(BigInt(value));
  return out;
}

function leafHash(tick: Tick): Buffer {
  return sha256([Buffer.of(LEAF_TAG), u64(tick.sequence), u64(tick.instant), i64(tick.price)]);
}

function nodeHash(left: Buffer, right: Buffer): Buffer {
  return sha256([Buffer.of(NODE_TAG), left, right]);
}

/**
 * One level of the tree.
 *
 * An odd final node is **promoted unchanged**, never duplicated. Duplicating it
 * is what Bitcoin does and it is CVE-2012-2459: two different leaf sets collapse
 * to the same root, so a commitment stops uniquely identifying a record.
 *
 * Promotion alone is not sufficient either — a tree of `n` leaves and one of
 * `n + 1` can still align — which is why {@link commit} binds the leaf `count`
 * into the root and {@link verifyInclusion} replays the promotion from it.
 */
function foldLevel(level: readonly Buffer[]): Buffer[] {
  const next: Buffer[] = [];
  for (let i = 0; i < level.length; i += 2) {
    if (i + 1 < level.length) next.push(nodeHash(level[i]!, level[i + 1]!));
    else next.push(level[i]!);
  }
  return next;
}

function merkleRoot(leaves: readonly Buffer[]): Buffer {
  let level = [...leaves];
  while (level.length > 1) level = foldLevel(level);
  return level[0]!;
}

function assertRange(ticks: readonly Tick[]): void {
  if (ticks.length === 0) {
    throw new CommitmentError('A commitment needs at least one tick.');
  }
  for (let i = 1; i < ticks.length; i += 1) {
    if (ticks[i]!.sequence !== ticks[i - 1]!.sequence + 1) {
      throw new CommitmentError(
        `A commitment covers a contiguous sequence range: ${ticks[i - 1]!.sequence} is followed ` +
          `by ${ticks[i]!.sequence}. A gap would let an operator omit a tick and still commit.`,
      );
    }
  }
}

/**
 * Commit to a contiguous run of published ticks.
 *
 * The root binds far more than the leaves, and each addition closes something:
 *
 * - **assetId** — a proof for one market must not verify against another's root.
 * - **range and count** — the root states exactly what it covers, so ranges can
 *   be checked to tile without gaps, and a differently-sized tree cannot match.
 * - **previousRoot** — the chain is append-only. Rewriting any earlier window
 *   invalidates every root after it, so history cannot be quietly restated.
 */
export function commit(assetId: string, ticks: readonly Tick[], previousRoot = ''): Commitment {
  if (assetId.length === 0) throw new CommitmentError('A commitment needs an asset id.');
  assertRange(ticks);
  const leaves = ticks.map(leafHash);
  const merkle = merkleRoot(leaves);
  const root = sha256([
    Buffer.of(ROOT_TAG),
    Buffer.from(assetId, 'utf8'),
    Buffer.of(0),
    u64(ticks[0]!.sequence),
    u64(ticks[ticks.length - 1]!.sequence),
    u64(ticks.length),
    Buffer.from(previousRoot, 'hex'),
    merkle,
  ]);
  return {
    assetId,
    fromSequence: ticks[0]!.sequence,
    toSequence: ticks[ticks.length - 1]!.sequence,
    count: ticks.length,
    previousRoot,
    root: root.toString('hex'),
  };
}

/** An inclusion proof for one tick in a committed range. */
export function proveInclusion(ticks: readonly Tick[], sequence: number): InclusionProof {
  assertRange(ticks);
  const index = sequence - ticks[0]!.sequence;
  if (index < 0 || index >= ticks.length) {
    throw new CommitmentError(
      `Sequence ${sequence} is outside the committed range ` +
        `[${ticks[0]!.sequence}, ${ticks[ticks.length - 1]!.sequence}].`,
    );
  }

  let level = ticks.map(leafHash);
  let cursor = index;
  const path: string[] = [];
  while (level.length > 1) {
    const promoted = cursor === level.length - 1 && level.length % 2 === 1;
    if (!promoted) {
      const sibling = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
      path.push(level[sibling]!.toString('hex'));
    }
    level = foldLevel(level);
    cursor >>= 1;
  }

  const tick = ticks[index]!;
  return { sequence, instant: tick.instant, price: tick.price, index, path };
}

/**
 * Verify a tick was in a committed range, using the commitment and nothing else.
 *
 * The promotion structure is replayed from `commitment.count` rather than taken
 * from the proof, so a forged proof cannot choose a tree shape that suits it.
 *
 * ## What a proof does not bind
 *
 * A proof is a leaf and a path. It carries no asset and no chain position, so it
 * verifies against **any** commitment that genuinely covers those ticks at that
 * index — including the same record committed under a different asset id, or
 * re-anchored behind a different previous root.
 *
 * That is correct rather than a gap, because the two properties live in
 * different layers:
 *
 * - the **root** binds asset, range, count and predecessor, so two different
 *   records can never share one;
 * - the **chain** binds position — {@link verifyChain} requires each
 *   `previousRoot` to equal its actual predecessor and the ranges to tile.
 *
 * Expecting this function to catch re-anchoring would put the check in the one
 * layer that cannot see the neighbouring windows. PH-12.1's first draft of the
 * tests asserted exactly that, and was wrong.
 */
export function verifyInclusion(commitment: Commitment, proof: InclusionProof): boolean {
  if (proof.index < 0 || proof.index >= commitment.count) return false;
  if (proof.sequence !== commitment.fromSequence + proof.index) return false;

  let hash = leafHash({
    sequence: proof.sequence,
    instant: proof.instant as Tick['instant'],
    price: proof.price as Tick['price'],
  });
  let cursor = proof.index;
  let width = commitment.count;
  let consumed = 0;

  while (width > 1) {
    const promoted = cursor === width - 1 && width % 2 === 1;
    if (!promoted) {
      const sibling = proof.path[consumed];
      if (sibling === undefined) return false;
      consumed += 1;
      const siblingHash = Buffer.from(sibling, 'hex');
      if (siblingHash.length !== 32) return false;
      hash = cursor % 2 === 0 ? nodeHash(hash, siblingHash) : nodeHash(siblingHash, hash);
    }
    width = Math.ceil(width / 2);
    cursor >>= 1;
  }

  // A proof carrying more siblings than the tree needs is malformed, not merely
  // redundant: accepting it would let a forger append junk that never gets read.
  if (consumed !== proof.path.length) return false;

  const expected = sha256([
    Buffer.of(ROOT_TAG),
    Buffer.from(commitment.assetId, 'utf8'),
    Buffer.of(0),
    u64(commitment.fromSequence),
    u64(commitment.toSequence),
    u64(commitment.count),
    Buffer.from(commitment.previousRoot, 'hex'),
    hash,
  ]);
  return expected.toString('hex') === commitment.root;
}

/**
 * Check that a chain of commitments is append-only and tiles the record.
 *
 * Returns the first problem found, or `null`. Reported rather than thrown so a
 * verifier can show a counterparty exactly where a published history stops
 * being consistent.
 */
export function verifyChain(commitments: readonly Commitment[]): string | null {
  if (commitments.length === 0) return 'The chain is empty.';
  for (let i = 0; i < commitments.length; i += 1) {
    const link = commitments[i]!;
    if (link.toSequence - link.fromSequence + 1 !== link.count) {
      return `Commitment ${i} covers ${link.fromSequence}..${link.toSequence} but claims ${link.count} leaves.`;
    }
    if (i === 0) continue;
    const previous = commitments[i - 1]!;
    if (link.assetId !== previous.assetId) {
      return `Commitment ${i} is for ${link.assetId}, following ${previous.assetId}.`;
    }
    if (link.previousRoot !== previous.root) {
      return `Commitment ${i} does not follow commitment ${i - 1}: the chain is broken there.`;
    }
    if (link.fromSequence !== previous.toSequence + 1) {
      return (
        `Commitment ${i} starts at ${link.fromSequence}, but ${i - 1} ended at ` +
        `${previous.toSequence}. Windows must tile without gaps or overlap.`
      );
    }
  }
  return null;
}
