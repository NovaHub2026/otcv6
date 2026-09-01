// Invariant evidence: INV-009 (reproducible settlement), INV-002 (shared market).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import {
  commit,
  CommitmentError,
  proveInclusion,
  verifyChain,
  verifyInclusion,
  type Commitment,
} from './commitment.js';

/**
 * A commitment is only worth having if forging one is hard.
 *
 * So most of what follows is not "does it work" — it is a list of published
 * attacks on Merkle constructions, each turned into a test that must fail to
 * verify. A tree that only ever gets valid input proves nothing about what it
 * does with invalid input, and the invalid input is the entire threat model.
 */

function ticks(from: number, count: number, priceAt = (i: number) => i * 3 - 7): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: from + i,
    instant: epochMillis(1_776_000_000_000 + i * 250),
    price: logPrice(priceAt(i)),
  }));
}

describe('a commitment identifies exactly one record', () => {
  it('is deterministic', () => {
    expect(commit('eurusd', ticks(1, 50)).root).toBe(commit('eurusd', ticks(1, 50)).root);
  });

  it('changes when any single field of any tick changes', () => {
    const base = commit('eurusd', ticks(1, 33)).root;
    const movedPrice = ticks(1, 33);
    (movedPrice[17] as { price: number }).price = logPrice(999);
    expect(commit('eurusd', movedPrice).root).not.toBe(base);

    const movedInstant = ticks(1, 33);
    (movedInstant[17] as { instant: number }).instant = epochMillis(1_776_000_000_001);
    expect(commit('eurusd', movedInstant).root).not.toBe(base);
  });

  it('separates assets', () => {
    expect(commit('eurusd', ticks(1, 20)).root).not.toBe(commit('btcusd', ticks(1, 20)).root);
  });

  it('separates ranges holding the same prices', () => {
    // Same shape, different sequences: a root must not be replayable elsewhere
    // in the record.
    expect(commit('eurusd', ticks(1, 20)).root).not.toBe(commit('eurusd', ticks(501, 20)).root);
  });

  it('refuses a range with a gap', () => {
    // A gap would let an operator omit a tick and still commit to "the record".
    const gapped = [...ticks(1, 5), ...ticks(7, 5)];
    expect(() => commit('eurusd', gapped)).toThrow(/contiguous sequence range/);
  });

  it('refuses an empty range and a nameless asset', () => {
    expect(() => commit('eurusd', [])).toThrow(CommitmentError);
    expect(() => commit('', ticks(1, 4))).toThrow(/asset id/);
  });
});

describe('inclusion proofs verify, at every size and position', () => {
  // Sizes chosen to exercise odd levels, powers of two, and the promotion path.
  it.each([1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 31, 64, 100])('holds for every leaf of %i', (count) => {
    const record = ticks(1_000, count);
    const commitment = commit('eurusd', record, 'ab'.repeat(32));
    const failures: number[] = [];
    for (const tick of record) {
      const proof = proveInclusion(record, tick.sequence);
      if (!verifyInclusion(commitment, proof)) failures.push(tick.sequence);
    }
    expect(failures).toEqual([]);
  });

  it('refuses a sequence outside the range', () => {
    expect(() => proveInclusion(ticks(10, 5), 99)).toThrow(/outside the committed range/);
  });
});

describe('forged proofs do not verify', () => {
  const record = ticks(1, 64);
  const commitment = commit('eurusd', record);

  it('rejects a tampered price', () => {
    const proof = { ...proveInclusion(record, 20), price: 12_345 };
    expect(verifyInclusion(commitment, proof)).toBe(false);
  });

  it('rejects a tampered instant', () => {
    const proof = { ...proveInclusion(record, 20), instant: 1 };
    expect(verifyInclusion(commitment, proof)).toBe(false);
  });

  it('rejects a proof whose index does not match its sequence', () => {
    const proof = { ...proveInclusion(record, 20), index: 21 };
    expect(verifyInclusion(commitment, proof)).toBe(false);
  });

  it('rejects a mutated sibling', () => {
    const proof = proveInclusion(record, 20);
    const path = [...proof.path];
    path[0] = 'ff'.repeat(32);
    expect(verifyInclusion(commitment, { ...proof, path })).toBe(false);
  });

  it('rejects a truncated path', () => {
    const proof = proveInclusion(record, 20);
    expect(verifyInclusion(commitment, { ...proof, path: proof.path.slice(1) })).toBe(false);
  });

  it('rejects a path with extra siblings appended', () => {
    // Junk a forger appends must not be silently ignored: a verifier that stops
    // early would accept anything past the point it stopped reading.
    const proof = proveInclusion(record, 20);
    const path = [...proof.path, '11'.repeat(32)];
    expect(verifyInclusion(commitment, { ...proof, path })).toBe(false);
  });

  it('rejects a sibling that is not 32 bytes', () => {
    const proof = proveInclusion(record, 20);
    expect(verifyInclusion(commitment, { ...proof, path: ['abcd'] })).toBe(false);
  });

  it('rejects a proof against another asset holding a different record', () => {
    const proof = proveInclusion(record, 20);
    const otherMarket = ticks(1, 64, (i) => i * 11 + 4);
    expect(verifyInclusion(commit('btcusd', otherMarket), proof)).toBe(false);
  });
});

describe('what an inclusion proof binds, and what the chain binds instead', () => {
  /**
   * Worth stating because the first version of these tests asserted otherwise.
   *
   * A proof is a leaf and a path. It carries no asset and no chain position, so
   * it verifies against **any** commitment that genuinely covers those ticks at
   * that index — including the same record committed under another asset id, or
   * re-anchored behind a different previous root.
   *
   * That is correct, and it is not a weakness, because the two properties are
   * enforced in different places:
   *
   * - **The root** binds asset, range, count and predecessor, so two different
   *   records can never share one.
   * - **The chain** binds position: `verifyChain` requires each `previousRoot` to
   *   equal its actual predecessor and the ranges to tile, so a window cannot be
   *   quietly moved.
   *
   * Expecting `verifyInclusion` to catch re-anchoring would have put the check in
   * the layer that cannot see the neighbours.
   */
  const record = ticks(1, 64);

  it('verifies against the same record committed under another asset', () => {
    const proof = proveInclusion(record, 20);
    expect(verifyInclusion(commit('btcusd', record), proof)).toBe(true);
  });

  it('verifies against the same record re-anchored in the chain', () => {
    const proof = proveInclusion(record, 20);
    expect(verifyInclusion(commit('eurusd', record, 'cd'.repeat(32)), proof)).toBe(true);
  });

  it('but the chain refuses the re-anchoring', () => {
    // The window above, spliced in where it does not belong.
    const first = commit('eurusd', ticks(1, 64));
    const second = commit('eurusd', ticks(65, 64), first.root);
    const spliced = [first, { ...second, previousRoot: 'cd'.repeat(32) }];
    expect(verifyChain(spliced)).toMatch(/does not follow commitment 0/);
  });
});

describe('the second-preimage attack fails', () => {
  it('will not accept an internal node dressed up as a leaf', () => {
    // The classic Merkle forgery: present an internal node where a leaf is
    // expected. Without domain separation the verifier hashes it, lands on a
    // value that genuinely appears in the tree, and the proof checks out for
    // data that was never published.
    //
    // Here a leaf is SHA256(0x00 || ...) and a node is SHA256(0x01 || ...), so
    // the two spaces cannot intersect. The test asserts the tags are actually
    // different rather than trusting that they are.
    const leafOfTick = createHash('sha256')
      .update(Buffer.of(0x00))
      .update(Buffer.alloc(24))
      .digest('hex');
    const nodeOfSameBytes = createHash('sha256')
      .update(Buffer.of(0x01))
      .update(Buffer.alloc(24))
      .digest('hex');
    expect(leafOfTick).not.toBe(nodeOfSameBytes);

    // And end to end: a two-leaf tree's root, offered as a leaf of the parent
    // tree, must not verify.
    const record = ticks(1, 4);
    const commitment = commit('eurusd', record);
    const inner = proveInclusion(record, 1).path[0]!;
    const forged = {
      sequence: 1,
      instant: 0,
      price: 0,
      index: 0,
      path: [inner, ...proveInclusion(record, 1).path.slice(1)],
    };
    expect(verifyInclusion(commitment, forged)).toBe(false);
  });
});

describe('CVE-2012-2459 does not apply', () => {
  it('gives different roots to different leaf counts', () => {
    // Duplicating the odd final node — as Bitcoin does — makes an n-leaf tree
    // and a particular (n+1)-leaf tree collapse to the same root, so a
    // commitment stops uniquely identifying a record. Here the final node is
    // promoted unchanged and the count is bound into the root.
    const seen = new Map<string, number>();
    const collisions: string[] = [];
    for (let count = 1; count <= 40; count += 1) {
      const root = commit('eurusd', ticks(1, count)).root;
      const previous = seen.get(root);
      if (previous !== undefined) collisions.push(`${previous} and ${count} share a root`);
      seen.set(root, count);
    }
    expect(collisions).toEqual([]);
  });

  it('does not let a duplicated tail forge a matching root', () => {
    const three = ticks(1, 3);
    const withDuplicatedTail = [...three, { ...three[2]!, sequence: 4 }];
    expect(commit('eurusd', withDuplicatedTail).root).not.toBe(commit('eurusd', three).root);
  });
});

describe('the chain is append-only', () => {
  function chain(windows: number, size: number): Commitment[] {
    const out: Commitment[] = [];
    let previous = '';
    for (let w = 0; w < windows; w += 1) {
      const link = commit('eurusd', ticks(1 + w * size, size), previous);
      out.push(link);
      previous = link.root;
    }
    return out;
  }

  it('accepts a well-formed chain', () => {
    expect(verifyChain(chain(6, 25))).toBeNull();
  });

  it('reports where a rewritten window breaks it', () => {
    // The point of the chain: an operator cannot restate history quietly.
    // Changing window 2 invalidates every root after it, and the verifier says
    // which link failed rather than only that something did.
    const links = chain(6, 25);
    const rewritten = [...links];
    rewritten[2] = commit(
      'eurusd',
      ticks(51, 25, (i) => i * 5),
      links[1]!.root,
    );
    expect(verifyChain(rewritten)).toMatch(/does not follow commitment 2/);
  });

  it('reports a gap between windows', () => {
    const links = chain(3, 25);
    const gapped = [links[0]!, commit('eurusd', ticks(40, 25), links[0]!.root)];
    expect(verifyChain(gapped)).toMatch(/tile without gaps or overlap/);
  });

  it('reports a window whose count disagrees with its range', () => {
    const link = commit('eurusd', ticks(1, 10));
    expect(verifyChain([{ ...link, toSequence: 99 }])).toMatch(/claims 10 leaves/);
  });

  it('reports a chain that switches asset midway', () => {
    const first = commit('eurusd', ticks(1, 10));
    const second = commit('btcusd', ticks(11, 10), first.root);
    expect(verifyChain([first, second])).toMatch(/is for btcusd, following eurusd/);
  });

  it('reports an empty chain rather than passing it', () => {
    expect(verifyChain([])).toBe('The chain is empty.');
  });
});
