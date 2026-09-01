// Invariant evidence: INV-009 (reproducible settlement), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { commit } from './commitment.js';
import {
  authorisedKeys,
  RotationError,
  signRotation,
  verifyRotation,
  type SignedRotation,
} from './rotation.js';
import {
  publicKeyHex,
  publishingKeyFromSeed,
  signCommitment,
  verifySignedChain,
  type SignedCommitment,
} from './signing.js';

const KEY_0 = publishingKeyFromSeed('11'.repeat(32));
const KEY_1 = publishingKeyFromSeed('22'.repeat(32));
const KEY_2 = publishingKeyFromSeed('33'.repeat(32));
const KEY_X = publishingKeyFromSeed('ee'.repeat(32));

const HEX_0 = publicKeyHex(KEY_0);
const HEX_1 = publicKeyHex(KEY_1);
const HEX_2 = publicKeyHex(KEY_2);
const HEX_X = publicKeyHex(KEY_X);

function ticks(from: number, count: number): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: from + i,
    instant: epochMillis(1_776_000_000_000 + (from + i) * 250),
    price: logPrice((from + i) * 3 - 7),
  }));
}

/** A chain of `keys.length` windows, each signed by the key at its position. */
function chainSignedBy(keys: readonly (typeof KEY_0)[]): SignedCommitment[] {
  const chain: SignedCommitment[] = [];
  let previousRoot = '';
  for (const [index, key] of keys.entries()) {
    const commitment = commit('eurusd', ticks(index * 8 + 1, 8), previousRoot);
    previousRoot = commitment.root;
    chain.push(signCommitment(commitment, key));
  }
  return chain;
}

const ROTATE_1: SignedRotation = signRotation(
  { toPublicKey: HEX_1, epoch: 1, reason: 'scheduled' },
  KEY_0,
);
const ROTATE_2: SignedRotation = signRotation(
  { toPublicKey: HEX_2, epoch: 2, reason: 'scheduled' },
  KEY_1,
);

describe('a rotation is signed by the key it retires', () => {
  it('verifies against the outgoing key', () => {
    expect(verifyRotation(ROTATE_1)).toBe(true);
    expect(ROTATE_1.rotation.fromPublicKey).toBe(HEX_0);
    expect(ROTATE_1.rotation.toPublicKey).toBe(HEX_1);
  });

  it('does not verify once any field is changed', () => {
    const fields: SignedRotation[] = [
      { ...ROTATE_1, rotation: { ...ROTATE_1.rotation, epoch: 2 } },
      { ...ROTATE_1, rotation: { ...ROTATE_1.rotation, toPublicKey: HEX_X } },
      { ...ROTATE_1, rotation: { ...ROTATE_1.rotation, reason: 'compromise' } },
      { ...ROTATE_1, rotation: { ...ROTATE_1.rotation, fromPublicKey: HEX_1 } },
    ];
    for (const forged of fields) expect(verifyRotation(forged)).toBe(false);
  });

  it('refuses to sign a rotation to the same key', () => {
    // It would advance the epoch while leaving the retired key able to sign,
    // which is the one thing rotation exists to stop.
    expect(() => signRotation({ toPublicKey: HEX_0, epoch: 1, reason: 'no-op' }, KEY_0)).toThrow(
      RotationError,
    );
  });

  it.each([0, -1, 1.5])('refuses epoch %s', (epoch) => {
    expect(() => signRotation({ toPublicKey: HEX_1, epoch, reason: 'x' }, KEY_0)).toThrow(
      RotationError,
    );
  });
});

describe('the authorised key list is built from the genesis key alone', () => {
  it('is just the genesis key when nothing has rotated', () => {
    expect(authorisedKeys(HEX_0, [])).toEqual({ keys: [HEX_0] });
  });

  it('follows a chain of rotations', () => {
    expect(authorisedKeys(HEX_0, [ROTATE_1, ROTATE_2])).toEqual({ keys: [HEX_0, HEX_1, HEX_2] });
  });

  it('refuses a rotation not signed by the key it names', () => {
    const forged: SignedRotation = { ...ROTATE_1, signature: ROTATE_2.signature };
    const result = authorisedKeys(HEX_0, [forged]);
    expect(result).toHaveProperty('error');
  });

  it('refuses a rotation whose outgoing key is not the current one', () => {
    // Correctly signed and correctly numbered, and still refused: KEY_1 is not
    // in force, so it has no standing to name a successor. Only the holder of
    // the key actually in force may hand it over.
    const wrongHolder = signRotation({ toPublicKey: HEX_2, epoch: 1, reason: 'x' }, KEY_1);
    expect(verifyRotation(wrongHolder)).toBe(true);
    const result = authorisedKeys(HEX_0, [wrongHolder]);
    expect('error' in result && result.error).toMatch(/not the current one/);
  });

  it('refuses a gap in the epoch sequence', () => {
    const skipped = signRotation({ toPublicKey: HEX_1, epoch: 2, reason: 'x' }, KEY_0);
    // A gap would let a rotation be dropped from the log without trace.
    const result = authorisedKeys(HEX_0, [skipped]);
    expect('error' in result && result.error).toMatch(/expected 1/);
  });

  it('refuses rotating back to a retired key', () => {
    const back = signRotation({ toPublicKey: HEX_0, epoch: 2, reason: 'undo' }, KEY_1);
    // Reinstating a retired key restores exactly the ability retiring it removed.
    const result = authorisedKeys(HEX_0, [ROTATE_1, back]);
    expect('error' in result && result.error).toMatch(/reinstates/);
  });
});

describe('a chain spanning a rotation verifies from the genesis key', () => {
  it('accepts a chain that rotates once', () => {
    const chain = chainSignedBy([KEY_0, KEY_0, KEY_1, KEY_1]);
    expect(verifySignedChain(chain, HEX_0, [ROTATE_1])).toBeNull();
  });

  it('accepts a chain that rotates twice', () => {
    const chain = chainSignedBy([KEY_0, KEY_1, KEY_2]);
    expect(verifySignedChain(chain, HEX_0, [ROTATE_1, ROTATE_2])).toBeNull();
  });

  it('still verifies an unrotated chain exactly as before', () => {
    const chain = chainSignedBy([KEY_0, KEY_0, KEY_0]);
    expect(verifySignedChain(chain, HEX_0)).toBeNull();
    expect(verifySignedChain(chain, HEX_1)).not.toBeNull();
  });

  it('refuses a rotated chain when the rotation log is withheld', () => {
    // Without the log the successor key is unattested, and refusing is right:
    // an operator who could rotate silently could hand over to anyone.
    const chain = chainSignedBy([KEY_0, KEY_1]);
    expect(verifySignedChain(chain, HEX_0)).not.toBeNull();
  });

  it('refuses a key that was never authorised', () => {
    const chain = chainSignedBy([KEY_0, KEY_X]);
    expect(verifySignedChain(chain, HEX_0, [ROTATE_1])).toMatch(/never authorised/);
  });
});

describe('a retired key cannot sign history that follows its rotation', () => {
  it('refuses an epoch that goes backwards', () => {
    // The attacker holds KEY_0, retired at epoch 1, and appends a link with it
    // after the chain has moved on. Without this rule, compromising any key the
    // venue ever held would still let them sign new history, and rotation would
    // buy nothing.
    const chain = chainSignedBy([KEY_0, KEY_1, KEY_0]);
    expect(verifySignedChain(chain, HEX_0, [ROTATE_1])).toMatch(/retired key/);
  });

  it('refuses a retired key even two epochs later', () => {
    const chain = chainSignedBy([KEY_0, KEY_1, KEY_2, KEY_1]);
    expect(verifySignedChain(chain, HEX_0, [ROTATE_1, ROTATE_2])).toMatch(/retired key/);
  });

  it('allows a key to sign several consecutive windows', () => {
    const chain = chainSignedBy([KEY_0, KEY_0, KEY_1, KEY_1, KEY_2, KEY_2]);
    expect(verifySignedChain(chain, HEX_0, [ROTATE_1, ROTATE_2])).toBeNull();
  });

  it('allows an epoch to be skipped entirely, if nothing was published under it', () => {
    // A key rotated in and out without ever signing a window is legitimate —
    // rotating twice in a quiet period, say — and the chain still moves forward.
    const chain = chainSignedBy([KEY_0, KEY_2]);
    expect(verifySignedChain(chain, HEX_0, [ROTATE_1, ROTATE_2])).toBeNull();
  });
});

describe('what rotation does not change', () => {
  it('a forged signature is still refused, under any epoch', () => {
    const chain = chainSignedBy([KEY_0, KEY_1]);
    const tampered: SignedCommitment[] = [
      chain[0]!,
      { ...chain[1]!, signature: chain[0]!.signature },
    ];
    expect(verifySignedChain(tampered, HEX_0, [ROTATE_1])).toMatch(
      /not signed by the key it names/,
    );
  });

  it('a broken structural link is still refused before any key is considered', () => {
    const chain = chainSignedBy([KEY_0, KEY_1]);
    const broken: SignedCommitment[] = [
      chain[0]!,
      {
        ...chain[1]!,
        commitment: { ...chain[1]!.commitment, previousRoot: '00'.repeat(32) },
      },
    ];
    expect(verifySignedChain(broken, HEX_0, [ROTATE_1])).not.toBeNull();
  });

  it('an empty chain is still refused', () => {
    expect(verifySignedChain([], HEX_0, [ROTATE_1])).toBe('The chain is empty.');
  });
});
