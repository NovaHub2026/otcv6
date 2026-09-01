// Invariant evidence: INV-009 (reproducible settlement), INV-010 (private generator state).
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { commit, type Commitment } from './commitment.js';
import {
  publicKeyHex,
  publishingKeyFromEnvironment,
  publishingKeyFromSeed,
  PublishingKeyError,
  signCommitment,
  verifyCommitment,
  verifySignedChain,
} from './signing.js';

const SEED_A = '11'.repeat(32);
const SEED_B = '22'.repeat(32);

function ticks(from: number, count: number, priceAt = (i: number) => i * 3 - 7): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: from + i,
    instant: epochMillis(1_776_000_000_000 + i * 250),
    price: logPrice(priceAt(i)),
  }));
}

describe('a signature attributes a commitment', () => {
  const key = publishingKeyFromSeed(SEED_A);
  const commitment = commit('eurusd', ticks(1, 32));

  it('verifies under the key that produced it', () => {
    expect(verifyCommitment(signCommitment(commitment, key), publicKeyHex(key))).toBe(true);
  });

  it('is deterministic, so two publishers of the same record agree', () => {
    expect(signCommitment(commitment, key).signature).toBe(
      signCommitment(commitment, key).signature,
    );
  });

  it('does not verify under any other key', () => {
    const other = publishingKeyFromSeed(SEED_B);
    expect(verifyCommitment(signCommitment(commitment, key), publicKeyHex(other))).toBe(false);
  });

  it('does not verify against a key the caller did not name', () => {
    // A signature that only verifies against the key shipped alongside it proves
    // nothing, because a forger supplies both. The caller must state the identity
    // they trust, and a swapped-in public key must fail even when the signature
    // is internally consistent with it.
    const signed = signCommitment(commitment, key);
    const forged = { ...signed, publicKey: publicKeyHex(publishingKeyFromSeed(SEED_B)) };
    expect(verifyCommitment(forged, publicKeyHex(key))).toBe(false);
    expect(verifyCommitment(forged, forged.publicKey)).toBe(false);
  });
});

describe('every field of a commitment is attested, not just the root', () => {
  // A signature over the root alone would leave asset, range, count and
  // predecessor unattested — and those are the fields that say what the root
  // *means*. An operator could then re-label a signed root as covering a
  // different range and the signature would still check out.
  const key = publishingKeyFromSeed(SEED_A);
  const base = commit('eurusd', ticks(1, 32), 'ab'.repeat(32));
  const signed = signCommitment(base, key);
  const identity = publicKeyHex(key);

  const mutations: [string, Commitment][] = [
    ['assetId', { ...base, assetId: 'btcusd' }],
    ['fromSequence', { ...base, fromSequence: base.fromSequence + 1 }],
    ['toSequence', { ...base, toSequence: base.toSequence + 1 }],
    ['count', { ...base, count: base.count + 1 }],
    ['previousRoot', { ...base, previousRoot: 'cd'.repeat(32) }],
    ['root', { ...base, root: 'ef'.repeat(32) }],
  ];

  it.each(mutations)('rejects a commitment with %s altered', (_field, mutated) => {
    expect(verifyCommitment({ ...signed, commitment: mutated }, identity)).toBe(false);
  });

  it('rejects a mutated signature', () => {
    expect(verifyCommitment({ ...signed, signature: 'ff'.repeat(64) }, identity)).toBe(false);
  });

  it('rejects malformed input rather than throwing', () => {
    // A verifier is fed hostile input by definition. It must answer "no", not
    // crash the process that asked.
    expect(verifyCommitment({ ...signed, signature: 'nothex' }, identity)).toBe(false);
    expect(verifyCommitment(signed, 'nothex')).toBe(false);
    expect(verifyCommitment({ ...signed, signature: '' }, identity)).toBe(false);
  });
});

describe('loading the publishing key refuses every shape of mistake', () => {
  it('refuses a missing key rather than inventing one', () => {
    expect(() => publishingKeyFromEnvironment({})).toThrow(/will not invent a publishing key/);
    expect(() => publishingKeyFromEnvironment({ OTC_PUBLISHING_KEY: '' })).toThrow(
      PublishingKeyError,
    );
  });

  it('refuses a malformed key', () => {
    expect(() => publishingKeyFromEnvironment({ OTC_PUBLISHING_KEY: 'abc' })).toThrow(
      /64 hex characters/,
    );
    expect(() => publishingKeyFromSeed('zz'.repeat(32))).toThrow(/64 hex characters/);
  });

  it('refuses a publishing key equal to the generation secret', () => {
    // The mistake an operator makes when wiring a second secret in a hurry, and
    // the one that costs INV-010. It must be loud at startup, not discovered
    // later.
    expect(() =>
      publishingKeyFromEnvironment({ OTC_PUBLISHING_KEY: SEED_A, OTC_MASTER_SECRET: SEED_A }),
    ).toThrow(/equal to OTC_MASTER_SECRET/);
    expect(() =>
      publishingKeyFromEnvironment({
        OTC_PUBLISHING_KEY: SEED_A.toLowerCase(),
        OTC_MASTER_SECRET: SEED_A.toUpperCase(),
      }),
    ).toThrow(/equal to OTC_MASTER_SECRET/);
  });

  it('accepts an independent key alongside a generation secret', () => {
    const key = publishingKeyFromEnvironment({
      OTC_PUBLISHING_KEY: SEED_A,
      OTC_MASTER_SECRET: SEED_B,
    });
    expect(publicKeyHex(key)).toMatch(/^[0-9a-f]+$/);
  });

  it('produces a different identity for every seed', () => {
    const identities = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      identities.add(publicKeyHex(publishingKeyFromSeed(randomBytes(32).toString('hex'))));
    }
    expect(identities.size).toBe(25);
  });
});

describe('a signed chain verifies end to end', () => {
  const key = publishingKeyFromSeed(SEED_A);
  const identity = publicKeyHex(key);

  function signedChain(windows: number, size: number) {
    const out = [];
    let previous = '';
    for (let w = 0; w < windows; w += 1) {
      const link = commit('eurusd', ticks(1 + w * size, size), previous);
      out.push(signCommitment(link, key));
      previous = link.root;
    }
    return out;
  }

  it('accepts a well-formed signed chain', () => {
    expect(verifySignedChain(signedChain(5, 20), identity)).toBeNull();
  });

  it('reports a structurally broken chain before checking signatures', () => {
    // Order matters: a chain that does not tile is broken whoever signed it, and
    // reporting "bad signature" for a missing window would send an investigator
    // the wrong way.
    //
    // A dropped window breaks two things at once — the `previousRoot` link and
    // the sequence tiling — and `verifyChain` reports the link, which is the
    // more precise of the two. Every window here is correctly signed, so the
    // assertion is that the answer is *structural* rather than about signatures.
    const chain = signedChain(3, 20);
    const gapped = [chain[0]!, chain[2]!];
    const problem = verifySignedChain(gapped, identity);
    expect(problem).toMatch(/does not follow commitment 0/);
    expect(problem).not.toMatch(/not signed/);
  });

  it('reports the link signed by the wrong key', () => {
    const chain = signedChain(4, 20);
    const impostor = publishingKeyFromSeed(SEED_B);
    chain[2] = signCommitment(chain[2]!.commitment, impostor);
    expect(verifySignedChain(chain, identity)).toMatch(/Commitment 2 is not signed/);
  });

  it('reports an empty chain rather than passing it', () => {
    expect(verifySignedChain([], identity)).toBe('The chain is empty.');
  });
});

// ---------------------------------------------------------------------------
// Cycle Audit 4 regression: F-2
// ---------------------------------------------------------------------------

/**
 * One signature must attest exactly one commitment.
 *
 * The shipped encoding joined the six fields with a newline. An independent
 * auditor showed that **one Ed25519 signature verified against two different
 * commitments** — a published `eurusd` window over 100..109, and a never-signed
 * reframing of the same bytes as a different asset over 900..909. Both returned
 * true from `verifyCommitment`, and `verifySignedChain` accepted both.
 *
 * That defeats the guarantee PH-12.2 rests on: "an operator cannot present a
 * different history without producing a second signature over a conflicting
 * root, which is itself the evidence." With an ambiguous encoding there is no
 * second signature — the operator plants the ambiguity once and afterwards says
 * the signature was over the other reading.
 *
 * The existing mutation tests all changed **one** field, and any single-field
 * change alters the joined string. The attack is a coordinated multi-field
 * change that preserves it.
 */
describe('a signature attests exactly one commitment (F-2)', () => {
  const key = publishingKeyFromSeed(SEED_A);
  const identity = publicKeyHex(key);

  it('cannot be transferred by re-partitioning the encoded fields', () => {
    const published = commit('eurusd', ticks(100, 10));
    const signed = signCommitment(published, key);

    // The auditor's reframing: fold the range and predecessor into the asset id
    // and re-cut the boundaries. Under a newline join these encode identically.
    const reframed = {
      ...published,
      assetId: `eurusd\n${published.fromSequence}\n${published.toSequence}\n${published.count}\n${published.previousRoot}`,
      fromSequence: 900,
      toSequence: 909,
    };
    expect(verifyCommitment({ ...signed, commitment: reframed }, identity)).toBe(false);
  });

  it('gives a different encoding to every framing of the same characters', () => {
    // The structural half. Length prefixes make the partition unique, so these
    // must all produce distinct signatures.
    const base = commit('eurusd', ticks(1, 8));
    const signatures = new Set<string>();
    for (const assetId of ['a', 'ab', 'abc']) {
      for (const from of [1, 12, 123]) {
        signatures.add(signCommitment({ ...base, assetId, fromSequence: from }, key).signature);
      }
    }
    expect(signatures.size).toBe(9);
  });

  it('refuses to build a commitment carrying the ambiguity in the first place', () => {
    // Defence in depth: the framing makes the attack unconstructable, and asset
    // id validation makes it unplantable.
    expect(() => commit('eurusd\n900\n909', ticks(1, 8))).toThrow(/not permitted/);
  });
});
