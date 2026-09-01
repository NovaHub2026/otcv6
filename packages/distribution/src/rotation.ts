import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { publicKeyHex } from './signing.js';

/**
 * Rotating a publishing key without a verifier seeing a forgery.
 *
 * `verifySignedChain` took one public key and checked every link against it, so
 * a rotated key produced a chain that failed verification — and failed it the
 * same way a forgery does. A verifier could not tell "the operator changed keys"
 * from "someone else signed this". That leaves two options, and both are worse
 * than no rotation: never rotate, or train verifiers to accept an unexplained
 * key change.
 *
 * So **the outgoing key names its successor**. A rotation is a record signed by
 * the key being retired, saying which key replaces it. A verifier holding only
 * the genesis key walks forward: each rotation is authorised by the key it
 * retires, so the chain of keys is as attested as the chain of roots.
 *
 * ## Nothing new is signed into a commitment
 *
 * A `SignedCommitment` already records which key signed it, so its epoch is the
 * position of that key in the authorised list. The canonical encoding does not
 * change — and it must not, because changing what a signature covers would
 * invalidate every root already published.
 *
 * It also means the epoch cannot be lied about. It is not a claim in the
 * payload: a link naming a key it was not signed by fails the signature check,
 * and a link naming an unauthorised key fails the key check.
 */

export class RotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RotationError';
  }
}

/**
 * Refuse a public key that is not in its one canonical spelling.
 *
 * **Cycle Audit 5, F-2.** `Buffer.from(hex, 'hex')` truncates at the first
 * non-hex character and is case-insensitive, so `deadbeefzz` and `DEADBEEF`
 * both decode to `deadbeef`. Every identity check here compared JS *strings* —
 * `keys.includes(rotation.toPublicKey)`, and the epoch lookup in
 * `verifySignedChain` — so one key had unboundedly many spellings and all but
 * one slipped past them.
 *
 * An auditor used that to rotate "back" to the retired genesis key under the
 * alias `HEX_0 + 'zz'`, walking through the reinstatement guard, and then had
 * the retired key sign a link at the newest epoch. The forged chain verified
 * from the genesis key. That is the exact attack the non-decreasing epoch rule
 * exists to stop, defeated by a string comparison.
 *
 * Refusing rather than normalising: a published artefact whose key is written
 * non-canonically is malformed, and silently accepting it would leave two
 * artefacts that look different and mean the same thing.
 */
export function assertCanonicalPublicKey(hex: string, what: string): void {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new RotationError(
      `${what} is not canonical lower-case hex: ${JSON.stringify(hex.slice(0, 24))}. One key ` +
        `must have exactly one spelling, or an identity check is a string comparison ` +
        `between aliases.`,
    );
  }
  let roundTripped: string;
  try {
    roundTripped = createPublicKey({ key: Buffer.from(hex, 'hex'), format: 'der', type: 'spki' })
      .export({ format: 'der', type: 'spki' })
      .toString('hex');
  } catch {
    throw new RotationError(`${what} is not a readable SPKI public key.`);
  }
  if (roundTripped !== hex) {
    throw new RotationError(
      `${what} is not the canonical encoding of the key it decodes to. Trailing or altered ` +
        `bytes would give one key a second identity.`,
    );
  }
}

/**
 * Whether every surrogate in a string is paired.
 *
 * Written out rather than using `String.prototype.isWellFormed`, which needs a
 * newer `lib` than this repository targets. Raising the target for one predicate
 * would change what every other module may reach for.
 */
function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Refuse a string that does not survive a round trip through UTF-8.
 *
 * **Cycle Audit 5, F-9.** An unpaired surrogate encodes to the same three bytes
 * as a literal U+FFFD, so two distinct `reason` values produce one signature —
 * and `reason` is documented as attested. Narrow, but it is the same class as
 * the framing defect and the fix belongs at the same boundary.
 */
export function assertWellFormed(value: string, what: string): void {
  if (!wellFormed(value)) {
    throw new RotationError(
      `${what} contains an unpaired surrogate. It would sign the same bytes as a different ` +
        `string, so the signature would attest both.`,
    );
  }
}

/**
 * Where a rotation sits in the record, for one asset.
 *
 * **Cycle Audit 5, F-3.** Without this, "follows its rotation" meant only
 * "appears later in the array the verifier was handed" — and the attacker
 * chooses that array. An auditor holding only the retired genesis key produced a
 * chain signed entirely at epoch 0, and a partially genuine one whose real
 * epoch-0 prefix was continued with forged epoch-0 windows. Both verified.
 *
 * The head root is what binds the rotation to the record: the chain is
 * hash-linked, so naming the root in force at rotation time names a position no
 * one can move.
 */
export interface RotationHead {
  readonly assetId: string;
  /** Root of the newest commitment for this asset when the rotation was signed. */
  readonly root: string;
}

/** A key handing over to its successor. */
export interface KeyRotation {
  /** The epoch this creates. Genesis is 0, so the first rotation is 1. */
  readonly epoch: number;
  /** Hex SPKI of the key being retired. */
  readonly fromPublicKey: string;
  /** Hex SPKI of the key taking over. */
  readonly toPublicKey: string;
  /**
   * The chain head per asset at the moment of rotation, sorted by asset.
   *
   * Every commitment after an asset's named head must be signed at this epoch or
   * later. An asset with no entry had no commitments yet, so *all* of its
   * commitments come after the rotation.
   */
  readonly heads: readonly RotationHead[];
  /** Why, for an operator reading the log later. Attested, so it cannot be edited. */
  readonly reason: string;
}

/** A rotation with the outgoing key's signature over it. */
export interface SignedRotation {
  readonly rotation: KeyRotation;
  /** Hex Ed25519 signature by the **outgoing** key. */
  readonly signature: string;
}

/**
 * Exactly what a rotation signature covers, framed so it reads only one way.
 *
 * Length-prefixed for the reason PH-12.2 records: `reason` is a free string, and
 * a separator delimits a field only if the field cannot contain it. An ambiguous
 * encoding here would let one signature attest two different successors, which
 * is the whole authority this record carries.
 */
function canonicalRotation(rotation: KeyRotation): Buffer {
  const framed = (value: string): Buffer => {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  const epoch = Buffer.alloc(8);
  epoch.writeBigUInt64BE(BigInt(rotation.epoch));
  const count = Buffer.alloc(8);
  count.writeBigUInt64BE(BigInt(rotation.heads.length));
  return Buffer.concat([
    framed('otc-key-rotation-v2'),
    epoch,
    framed(rotation.fromPublicKey),
    framed(rotation.toPublicKey),
    // The head list is length-prefixed as a whole and field-by-field within, so
    // no rearrangement of assets or roots produces the same bytes.
    count,
    ...rotation.heads.flatMap((head) => [framed(head.assetId), framed(head.root)]),
    framed(rotation.reason),
  ]);
}

/**
 * Sign a rotation with the key it retires.
 *
 * The outgoing key, not the incoming one, and that is the whole design: only
 * the holder of the current key may name the next. A rotation signed by the new
 * key would prove nothing — a forger holds their own key by definition.
 */
export function signRotation(
  next: {
    readonly toPublicKey: string;
    readonly epoch: number;
    readonly reason: string;
    /** The chain head per asset at this moment. Omit only when nothing is published. */
    readonly heads?: readonly RotationHead[];
  },
  outgoing: KeyObject,
): SignedRotation {
  if (!Number.isInteger(next.epoch) || next.epoch < 1) {
    throw new RotationError(`A rotation's epoch must be a positive integer, got ${next.epoch}.`);
  }
  assertCanonicalPublicKey(next.toPublicKey, 'The incoming key');
  assertWellFormed(next.reason, 'A rotation reason');
  const heads = [...(next.heads ?? [])].sort((a, b) => a.assetId.localeCompare(b.assetId));
  for (const head of heads) {
    assertWellFormed(head.assetId, 'A rotation head asset id');
    if (!/^[0-9a-f]{64}$/.test(head.root)) {
      throw new RotationError(
        `A rotation head root must be 64 lower-case hex characters, got ` +
          `${JSON.stringify(head.root.slice(0, 24))}.`,
      );
    }
  }
  if (new Set(heads.map((head) => head.assetId)).size !== heads.length) {
    throw new RotationError(
      'A rotation names one asset twice. Two heads for one chain would let a verifier pick ' +
        'whichever admits the signature it is checking.',
    );
  }
  const rotation: KeyRotation = {
    epoch: next.epoch,
    fromPublicKey: publicKeyHex(outgoing),
    toPublicKey: next.toPublicKey,
    heads,
    reason: next.reason,
  };
  if (rotation.fromPublicKey === rotation.toPublicKey) {
    throw new RotationError(
      'A rotation to the same key is not a rotation. It would advance the epoch while leaving ' +
        'the retired key able to sign, which is the one thing rotation exists to stop.',
    );
  }
  return { rotation, signature: sign(null, canonicalRotation(rotation), outgoing).toString('hex') };
}

/** Verify one rotation against the key it claims to retire. Never throws. */
export function verifyRotation(signed: SignedRotation): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(signed.rotation.fromPublicKey, 'hex'),
      format: 'der',
      type: 'spki',
    });
    return verify(
      null,
      canonicalRotation(signed.rotation),
      key,
      Buffer.from(signed.signature, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Every key authorised to sign, in epoch order, starting from a trusted key.
 *
 * Returns the list, or a reason it could not be built. The genesis key is the
 * only thing a verifier has to be told out of band; everything after it is
 * attested by the key it replaces.
 */
export function authorisedKeys(
  genesisPublicKey: string,
  rotations: readonly SignedRotation[],
): { readonly keys: readonly string[] } | { readonly error: string } {
  try {
    assertCanonicalPublicKey(genesisPublicKey, 'The genesis key');
  } catch (error) {
    return { error: (error as Error).message };
  }
  const keys = [genesisPublicKey];
  for (const [index, signed] of rotations.entries()) {
    const { rotation } = signed;
    try {
      assertCanonicalPublicKey(rotation.fromPublicKey, `Rotation ${index}'s outgoing key`);
      assertCanonicalPublicKey(rotation.toPublicKey, `Rotation ${index}'s incoming key`);
    } catch (error) {
      return { error: (error as Error).message };
    }
    const expectedEpoch = index + 1;
    if (rotation.epoch !== expectedEpoch) {
      return {
        error:
          `Rotation ${index} declares epoch ${rotation.epoch}, expected ${expectedEpoch}. ` +
          `A gap or a repeat would let a rotation be dropped from the log without trace.`,
      };
    }
    const current = keys[keys.length - 1]!;
    if (rotation.fromPublicKey !== current) {
      return {
        error:
          `Rotation ${index} retires a key that is not the current one. Only the holder of the ` +
          `key in force may name its successor.`,
      };
    }
    if (keys.includes(rotation.toPublicKey)) {
      // Rotating back to a retired key would restore its ability to sign, which
      // is exactly what retiring it was for.
      return { error: `Rotation ${index} reinstates a key that has already been retired.` };
    }
    if (!verifyRotation(signed)) {
      return { error: `Rotation ${index} is not signed by the key it claims to retire.` };
    }
    keys.push(rotation.toPublicKey);
  }
  return { keys };
}
