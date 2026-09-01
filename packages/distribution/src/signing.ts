import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import type { Commitment } from './commitment.js';
import { verifyChain } from './commitment.js';

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
 * Exactly what is signed.
 *
 * Every field of the commitment, newline-separated and in fixed order. A
 * signature over the root alone would leave the surrounding claims — asset,
 * range, count, predecessor — unattested, and those are the fields that say what
 * the root *means*.
 */
function canonicalEncoding(commitment: Commitment): Buffer {
  return Buffer.from(
    [
      'otc-commitment-v1',
      commitment.assetId,
      String(commitment.fromSequence),
      String(commitment.toSequence),
      String(commitment.count),
      commitment.previousRoot,
      commitment.root,
    ].join('\n'),
    'utf8',
  );
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
 */
export function verifySignedChain(
  chain: readonly SignedCommitment[],
  publicKeyHexValue: string,
): string | null {
  if (chain.length === 0) return 'The chain is empty.';
  const structural = verifyChain(chain.map((link) => link.commitment));
  if (structural !== null) return structural;
  for (let i = 0; i < chain.length; i += 1) {
    if (!verifyCommitment(chain[i]!, publicKeyHexValue)) {
      return `Commitment ${i} is not signed by the expected publishing key.`;
    }
  }
  return null;
}
