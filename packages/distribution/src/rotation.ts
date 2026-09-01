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

/** A key handing over to its successor. */
export interface KeyRotation {
  /** The epoch this creates. Genesis is 0, so the first rotation is 1. */
  readonly epoch: number;
  /** Hex SPKI of the key being retired. */
  readonly fromPublicKey: string;
  /** Hex SPKI of the key taking over. */
  readonly toPublicKey: string;
  /** Why, for an operator reading the log later. Attested, so it cannot be edited. */
  readonly reason: string;
}

/** A rotation with the outgoing key's signature over it. */
export interface SignedRotation {
  readonly rotation: KeyRotation;
  /** Hex Ed25519 signature by the **outgoing** key. */
  readonly signature: string;
}

export class RotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RotationError';
  }
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
  return Buffer.concat([
    framed('otc-key-rotation-v1'),
    epoch,
    framed(rotation.fromPublicKey),
    framed(rotation.toPublicKey),
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
  next: { readonly toPublicKey: string; readonly epoch: number; readonly reason: string },
  outgoing: KeyObject,
): SignedRotation {
  if (!Number.isInteger(next.epoch) || next.epoch < 1) {
    throw new RotationError(`A rotation's epoch must be a positive integer, got ${next.epoch}.`);
  }
  const rotation: KeyRotation = {
    epoch: next.epoch,
    fromPublicKey: publicKeyHex(outgoing),
    toPublicKey: next.toPublicKey,
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
  const keys = [genesisPublicKey];
  for (const [index, signed] of rotations.entries()) {
    const { rotation } = signed;
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
