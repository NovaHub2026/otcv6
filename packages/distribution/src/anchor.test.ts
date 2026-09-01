// Invariant evidence: INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { commit } from './commitment.js';
import { AnchorError, buildAnchor, extendsAnchor, summarise, verifyAnchor } from './anchor.js';
import { publishingKeyFromSeed, signCommitment, type SignedCommitment } from './signing.js';

const KEY = publishingKeyFromSeed('11'.repeat(32));
const OTHER = publishingKeyFromSeed('22'.repeat(32));
const AT = 1_800_000_000_000;

function ticks(from: number, count: number, offset = 0): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: from + i,
    instant: epochMillis(1_776_000_000_000 + (from + i) * 250),
    price: logPrice((from + i) * 3 - 7 + offset),
  }));
}

/** A chain of `windows` commitments over 8 ticks each. */
function chain(assetId: string, windows: number, offset = 0, key = KEY): SignedCommitment[] {
  const out: SignedCommitment[] = [];
  let previousRoot = '';
  for (let index = 0; index < windows; index += 1) {
    const commitment = commit(assetId, ticks(index * 8 + 1, 8, offset), previousRoot);
    previousRoot = commitment.root;
    out.push(signCommitment(commitment, key));
  }
  return out;
}

describe('an anchor summarises a chain', () => {
  it('records the range, the count, the head and the key', () => {
    const entry = summarise(chain('eurusd', 4));
    expect(entry.assetId).toBe('eurusd');
    expect(entry.fromSequence).toBe(1);
    expect(entry.toSequence).toBe(32);
    expect(entry.commitments).toBe(4);
    expect(entry.headRoot).toHaveLength(64);
  });

  it('refuses to anchor an empty chain', () => {
    expect(() => summarise([])).toThrow(AnchorError);
  });

  it('orders entries by asset, so two runs over the same chains agree byte for byte', () => {
    const built = buildAnchor([chain('gbpusd', 2), chain('eurusd', 2)], AT);
    expect(built.entries.map((e) => e.assetId)).toEqual(['eurusd', 'gbpusd']);
    expect(JSON.stringify(built)).toBe(
      JSON.stringify(buildAnchor([chain('eurusd', 2), chain('gbpusd', 2)], AT)),
    );
  });

  it('refuses to summarise one asset twice', () => {
    // Two summaries of one chain would let a reader pick whichever agrees with
    // them, which is the opposite of what an anchor is for.
    expect(() => buildAnchor([chain('eurusd', 2), chain('eurusd', 3)], AT)).toThrow(AnchorError);
  });
});

describe('an anchor is checked against the chain it claims to summarise', () => {
  it('agrees with the chain it was built from', () => {
    const chains = [chain('eurusd', 3), chain('gbpusd', 2)];
    expect(verifyAnchor(buildAnchor(chains, AT), chains)).toBeNull();
  });

  it('refuses a chain whose head differs', () => {
    const chains = [chain('eurusd', 3)];
    const anchor = buildAnchor(chains, AT);
    // The same asset, the same window count, different ticks underneath.
    expect(verifyAnchor(anchor, [chain('eurusd', 3, 1)])).toMatch(/head root/);
  });

  it('refuses a truncated chain even though its prefix is genuine', () => {
    // The head root is what refuses this: `commit()` folds `previousRoot` into
    // every root, so a chain of three has a different head from the first three
    // links of a chain of five, and the count and range disagree too.
    const anchor = buildAnchor([chain('eurusd', 5)], AT);
    expect(verifyAnchor(anchor, [chain('eurusd', 3)])).not.toBeNull();
  });

  it('refuses a chain extended past what the anchor claims', () => {
    const anchor = buildAnchor([chain('eurusd', 3)], AT);
    expect(verifyAnchor(anchor, [chain('eurusd', 5)])).not.toBeNull();
  });

  it('refuses an anchor that names a different signing key', () => {
    const anchor = buildAnchor([chain('eurusd', 2)], AT);
    expect(verifyAnchor(anchor, [chain('eurusd', 2, 0, OTHER)])).toMatch(/signing key/);
  });

  it('refuses an anchor mentioning an asset with no chain', () => {
    const anchor = buildAnchor([chain('eurusd', 2), chain('gbpusd', 2)], AT);
    expect(verifyAnchor(anchor, [chain('eurusd', 2)])).toMatch(/gbpusd/);
  });

  it('refuses a chain the anchor does not mention', () => {
    const anchor = buildAnchor([chain('eurusd', 2)], AT);
    expect(verifyAnchor(anchor, [chain('eurusd', 2), chain('gbpusd', 2)])).toMatch(
      /does not mention gbpusd/,
    );
  });

  it('refuses an anchor version it does not know', () => {
    const anchor = { ...buildAnchor([chain('eurusd', 2)], AT), version: 2 as unknown as 1 };
    expect(verifyAnchor(anchor, [chain('eurusd', 2)])).toMatch(/version/);
  });

  it('refuses a hand-edited anchor listing one asset twice', () => {
    const built = buildAnchor([chain('eurusd', 2)], AT);
    const duplicated = { ...built, entries: [built.entries[0]!, built.entries[0]!] };
    expect(verifyAnchor(duplicated, [chain('eurusd', 2)])).toMatch(/more than once/);
  });

  it('never throws on a malformed anchor', () => {
    // A verifier is usually reading someone else's file, and a malformed one is
    // a finding rather than a crash.
    const built = buildAnchor([chain('eurusd', 2)], AT);
    expect(() => verifyAnchor(built, [[]])).not.toThrow();
    expect(verifyAnchor(built, [[]])).not.toBeNull();
  });
});

describe('the property a counterparty actually uses', () => {
  it('accepts an anchor that extends the one they kept', () => {
    const earlier = buildAnchor([chain('eurusd', 2)], AT);
    const later = buildAnchor([chain('eurusd', 5)], AT + 1000);
    expect(extendsAnchor(earlier, later)).toBeNull();
  });

  it('accepts an unchanged anchor', () => {
    const anchor = buildAnchor([chain('eurusd', 3)], AT);
    expect(extendsAnchor(anchor, buildAnchor([chain('eurusd', 3)], AT + 1))).toBeNull();
  });

  it('refuses a record that went backwards', () => {
    const earlier = buildAnchor([chain('eurusd', 5)], AT);
    const later = buildAnchor([chain('eurusd', 3)], AT + 1000);
    expect(extendsAnchor(earlier, later)).not.toBeNull();
  });

  it('refuses a rewritten prefix at the same length', () => {
    const earlier = buildAnchor([chain('eurusd', 3)], AT);
    const later = buildAnchor([chain('eurusd', 3, 1)], AT + 1000);
    expect(extendsAnchor(earlier, later)).toMatch(/rewritten/);
  });

  it('refuses the same range re-windowed into fewer commitments', () => {
    // The case the sequence checks alone cannot see: `toSequence` is unchanged
    // and the range is unchanged, but the roots a counterparty was shown no
    // longer exist. Re-windowing a published record is rewriting it.
    const earlier = buildAnchor([chain('eurusd', 5)], AT);
    const rewindowed: SignedCommitment[] = (() => {
      const out: SignedCommitment[] = [];
      let previousRoot = '';
      for (let index = 0; index < 2; index += 1) {
        const commitment = commit('eurusd', ticks(index * 20 + 1, 20), previousRoot);
        previousRoot = commitment.root;
        out.push(signCommitment(commitment, KEY));
      }
      return out;
    })();
    const later = buildAnchor([rewindowed], AT + 1000);
    expect(later.entries[0]!.toSequence).toBe(earlier.entries[0]!.toSequence);
    expect(extendsAnchor(earlier, later)).toMatch(/commitments have been removed/);
  });

  it('refuses a chain that no longer starts where it did', () => {
    const earlier = buildAnchor([chain('eurusd', 3)], AT);
    const later = {
      ...buildAnchor([chain('eurusd', 3)], AT + 1),
      entries: [{ ...buildAnchor([chain('eurusd', 3)], AT + 1).entries[0]!, fromSequence: 9 }],
    };
    expect(extendsAnchor(earlier, later)).toMatch(/no longer starts/);
  });

  it('refuses an asset that has disappeared', () => {
    const earlier = buildAnchor([chain('eurusd', 2), chain('gbpusd', 2)], AT);
    const later = buildAnchor([chain('eurusd', 3)], AT + 1000);
    expect(extendsAnchor(earlier, later)).toMatch(/disappeared/);
  });

  it('accepts a new asset appearing', () => {
    const earlier = buildAnchor([chain('eurusd', 2)], AT);
    const later = buildAnchor([chain('eurusd', 2), chain('gbpusd', 2)], AT + 1000);
    expect(extendsAnchor(earlier, later)).toBeNull();
  });

  it('refuses an anchor dated before the one it claims to extend', () => {
    const earlier = buildAnchor([chain('eurusd', 2)], AT);
    const later = buildAnchor([chain('eurusd', 3)], AT - 1);
    expect(extendsAnchor(earlier, later)).toMatch(/dated before/);
  });
});
