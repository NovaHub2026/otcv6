import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import type { Commitment } from './commitment.js';
import { verifyChain } from './commitment.js';
import { authorisedKeys, type SignedRotation } from './rotation.js';

/**
 * Signing a commitment, with a key that cannot generate a market.
 *
 * ## Why this key is not the master secret
 *
 * `OTC_MASTER_SECRET` derives every stream in the market through HKDF
 * (ADR-0002). Signing with it would be one secret to deploy instead of two, and
 * it would break **INV-010**.
 *
 * A signing key lives in every process that publishes, is handled by operators,
 * and appears in deployment configuration. If it were also the generation
 * secret, anyone obtaining it would obtain the keystream — and a keystream
 * snapshot is not a historical leak but a **forward** one, worth hours of future
 * prices to whoever holds it.
 *
 * So the publishing key is generated independently, shares no derivation tree
 * with the master secret, and is a different algorithm with a different shape.
 * **A process that can sign must not be able to generate.**
 *
 * That is enforced rather than stated: this module imports nothing from core's
 * entropy surface, `guardrails/publishingKey.test.ts` fails if it ever does, and
 * {@link publishingKeyFromEnvironment} refuses a key equal to the generation
 * secret — the exact mistake an operator makes when wiring a second secret in a
 * hurry.
 *
 * ## What a signature adds over a commitment
 *
 * PH-12.1 made a root identify a record. A signature makes it identify **who
 * committed to it**. An operator cannot later disown a published root, and
 * cannot present a different history without producing a second signature over a
 * conflicting root for the same range — which is itself the evidence.
 */

export class PublishingKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishingKeyError';
  }
}

/** A commitment with the signature that attributes it. */
export interface SignedCommitment {
  readonly commitment: Commitment;
  /** Hex Ed25519 signature over the canonical encoding. */
  readonly signature: string;
  /** Hex SPKI public key, so a chain records which key signed each root. */
  readonly publicKey: string;
}

/**
 * Exactly what is signed, framed so it can be read only one way.
 *
 * Every field of the commitment, in fixed order. A signature over the root alone
 * would leave the surrounding claims — asset, range, count, predecessor —
 * unattested, and those are the fields that say what the root *means*.
 *
 * ## Why length prefixes rather than a separator
 *
 * **Cycle Audit 4, F-2.** The first version joined the fields with `\n`. Two of
 * them are free strings, so a newline inside one made the partition ambiguous
 * and **one signature attested two different commitments** — a published
 * `EURUSD` window over range 100..109, and a never-signed reframing of the same
 * bytes as a different asset over range 900..909. Both verified.
 *
 * The existing tests mutated one field at a time, and a single-field change
 * always changes the joined string. The attack is a *coordinated* multi-field
 * change that preserves it.
 *
 * That defeats the guarantee PH-12.2 rests on — "an operator cannot present a
 * different history without producing a second signature over a conflicting
 * root, which is itself the evidence." With an ambiguous encoding there is no
 * second signature: the operator plants the ambiguity once and can afterwards
 * say the signature was over the other reading.
 *
 * A separator delimits a field only if the field cannot contain the separator.
 * A length prefix delimits it unconditionally.
 */
function canonicalEncoding(commitment: Commitment): Buffer {
  const framed = (value: string): Buffer => {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  const u64 = (value: number): Buffer => {
    const out = Buffer.alloc(8);
    out.writeBigUInt64BE(BigInt(value));
    return out;
  };
  return Buffer.concat([
    framed('otc-commitment-v2'),
    framed(commitment.assetId),
    u64(commitment.fromSequence),
    u64(commitment.toSequence),
    u64(commitment.count),
    framed(commitment.previousRoot),
    framed(commitment.root),
  ]);
}

/** Ed25519 private key from a 32-byte hex seed. */
export function publishingKeyFromSeed(seedHex: string): KeyObject {
  if (!/^[0-9a-f]{64}$/i.test(seedHex)) {
    throw new PublishingKeyError('A publishing key seed must be 64 hex characters (32 bytes).');
  }
  // PKCS#8 wrapper for a raw Ed25519 seed. Node has no raw-seed importer.
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return createPrivateKey({
    key: Buffer.concat([prefix, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
}

export function publicKeyHex(privateKey: KeyObject): string {
  return createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('hex');
}

/**
 * Load the publishing key from the environment, refusing every shape of mistake.
 *
 * The refusals matter more than the happy path. A service that quietly invents a
 * key produces signatures nobody can verify against a published identity, and a
 * service that signs with the generation secret has already lost INV-010 by the
 * time anyone notices.
 */
export function publishingKeyFromEnvironment(env: NodeJS.ProcessEnv = process.env): KeyObject {
  const seed = env.OTC_PUBLISHING_KEY;
  if (seed === undefined || seed.length === 0) {
    throw new PublishingKeyError(
      'OTC_PUBLISHING_KEY is not set. The service will not invent a publishing key: ' +
        'signatures under an ephemeral identity are unverifiable against any published one.',
    );
  }
  const master = env.OTC_MASTER_SECRET;
  if (master !== undefined && master.length > 0 && master.toLowerCase() === seed.toLowerCase()) {
    throw new PublishingKeyError(
      'OTC_PUBLISHING_KEY is equal to OTC_MASTER_SECRET. The publishing key is handled by ' +
        'operators and shipped to every publishing process; if it also derives the market, ' +
        'anyone who obtains it obtains the keystream — which is a forward leak of future ' +
        'prices, not a historical one (INV-010). Generate an independent key.',
    );
  }
  return publishingKeyFromSeed(seed);
}

export function signCommitment(commitment: Commitment, privateKey: KeyObject): SignedCommitment {
  return {
    commitment,
    signature: sign(null, canonicalEncoding(commitment), privateKey).toString('hex'),
    publicKey: publicKeyHex(privateKey),
  };
}

/** Verify a signature against a stated public key. Never throws. */
export function verifyCommitment(signed: SignedCommitment, publicKeyHexValue?: string): boolean {
  const expected = publicKeyHexValue ?? signed.publicKey;
  // A signature that only verifies against the key shipped alongside it proves
  // nothing: a forger supplies both. The caller passes the identity they trust.
  if (expected !== signed.publicKey) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(expected, 'hex'),
      format: 'der',
      type: 'spki',
    });
    return verify(
      null,
      canonicalEncoding(signed.commitment),
      key,
      Buffer.from(signed.signature, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Verify a signed chain end to end: structure first, then attribution.
 *
 * Returns the first problem, or `null`. Reported rather than thrown so a verifier
 * can show a counterparty exactly where a published history stops being
 * consistent, which is the question they actually have.
 *
 * ## What the chain attests, and what it does not (a5-12)
 *
 * The chain attests **content**: every root, every range, and that each link
 * was signed by a key the venue had authorised at a point no later than the
 * link. The epoch rule is non-decreasing *forwards* — a retired key cannot sign
 * history that follows its rotation — and nothing forbids the reverse. A
 * successor key can re-sign windows that precede its own rotation, and the
 * chain verifies: the content is unchanged and the key was authorised, so
 * nothing the chain promises is broken. What is not promised is **attribution
 * of a window to the particular key that first signed it.** A verifier that
 * needs to know which key signed a pre-rotation window must keep the signed
 * commitments as originally published, not merely a chain that verifies.
 */
export function verifySignedChain(
  chain: readonly SignedCommitment[],
  publicKeyHexValue: string,
  rotations: readonly SignedRotation[] = [],
): string | null {
  if (chain.length === 0) return 'The chain is empty.';
  const structural = verifyChain(chain.map((link) => link.commitment));
  if (structural !== null) return structural;

  // `publicKeyHexValue` is the *genesis* key — the only thing a verifier has to
  // be told out of band. Every key after it is attested by the key it retires,
  // so a chain spanning a rotation verifies from the same starting point as one
  // that never rotated.
  const authorised = authorisedKeys(publicKeyHexValue, rotations);
  if ('error' in authorised) return authorised.error;
  const epochOf = new Map(authorised.keys.map((key, epoch) => [key, epoch]));

  // Where each rotation sits in *this* chain.
  //
  // **Cycle Audit 5, F-3.** Without this, "follows its rotation" meant only
  // "appears later in the array the verifier was handed" — and the attacker
  // chooses that array. An auditor holding only the retired genesis key
  // produced a chain signed entirely at epoch 0, and a partially genuine one
  // whose real epoch-0 prefix was continued with forged epoch-0 windows. Both
  // verified. The rotation now names the head root in force when it was signed,
  // which the hash-linking makes a position nobody can move.
  const assetId = chain[0]!.commitment.assetId;
  const rootIndex = new Map(chain.map((link, index) => [link.commitment.root, index]));
  const requiredFrom = new Map<number, number>();
  for (const [index, signed] of rotations.entries()) {
    const targetEpoch = index + 1;
    const head = signed.rotation.heads.find((entry) => entry.assetId === assetId);
    if (head === undefined) {
      // No head for this asset means it had published nothing when the rotation
      // was signed, so every one of its commitments comes after it.
      requiredFrom.set(targetEpoch, 0);
      continue;
    }
    const at = rootIndex.get(head.root);
    if (at === undefined) {
      return (
        `Rotation ${index} names a head root for ${assetId} that this chain does not contain, ` +
        `so the chain is not the record the rotation was signed over.`
      );
    }
    requiredFrom.set(targetEpoch, at + 1);
  }

  let epoch = 0;
  for (let i = 0; i < chain.length; i += 1) {
    const link = chain[i]!;
    const linkEpoch = epochOf.get(link.publicKey);
    if (linkEpoch === undefined) {
      return `Commitment ${i} is signed by a key that was never authorised to publish.`;
    }
    // Non-decreasing, and this is the property that makes rotation worth doing.
    // Without it, compromising any key the venue has ever held still lets an
    // attacker sign new history, and retiring a key buys nothing.
    if (linkEpoch < epoch) {
      return (
        `Commitment ${i} is signed by key epoch ${linkEpoch}, after the chain had reached ` +
        `epoch ${epoch}. A retired key cannot sign history that follows its rotation.`
      );
    }
    // And the epoch the *record* requires here, which the presented order
    // cannot alter.
    for (const [targetEpoch, from] of requiredFrom) {
      if (i >= from && linkEpoch < targetEpoch) {
        return (
          `Commitment ${i} is signed by key epoch ${linkEpoch}, but it follows the head named ` +
          `by rotation ${targetEpoch - 1}, so it must be signed at epoch ${targetEpoch} or ` +
          `later. A retired key cannot sign history that follows its rotation.`
        );
      }
    }
    epoch = linkEpoch;
    if (!verifyCommitment(link, link.publicKey)) {
      return `Commitment ${i} is not signed by the key it names.`;
    }
  }
  return null;
}
