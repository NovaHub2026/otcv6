import { hkdfSync } from 'node:crypto';
import { CHACHA20_KEY_BYTES } from './chacha20.js';
import { ProductionStreamFromTestKeyringError } from './errors.js';
import { canonicalLabel, type StreamLabel } from './label.js';
import { RandomStream, type StreamCursor } from './stream.js';

/**
 * Domain-separation salt for stream-key derivation.
 *
 * Part of the durable derivation contract. Changing it re-keys every stream that
 * has ever existed and invalidates replay of all recorded history.
 */
const HKDF_SALT = new TextEncoder().encode('otc-engine/entropy/v1');

const MIN_SECRET_BYTES = 32;

/**
 * Holder of the master secret and the only way to obtain a random stream.
 *
 * The master secret never leaves this object: it is not serialised into
 * snapshots, not exposed on the public surface, and not written to logs. A
 * snapshot references a `keyId`, and reconstructing history requires possession
 * of the corresponding secret. That is precisely the property INV-010 asks for —
 * public history plus recorded cursors are useless without the sealed key.
 */
export class MasterKeyring {
  // ECMAScript private fields, not TypeScript `private`. TypeScript's modifier
  // is erased at compile time, which leaves the secret enumerable and therefore
  // reachable by `JSON.stringify`, structured clone, a logger that serialises
  // its arguments, or an error reporter. Any of those would put the master
  // secret somewhere it must never be, and possession of it makes the entire
  // future of every stream reconstructable (INV-010).
  readonly #secret: Uint8Array;
  readonly #productionAllowed: boolean;

  private constructor(
    readonly keyId: string,
    secret: Uint8Array,
    productionAllowed: boolean,
  ) {
    this.#secret = secret;
    this.#productionAllowed = productionAllowed;
  }

  /** Redacted representation. Guarantees the secret cannot leak via serialisation. */
  toJSON(): { keyId: string; secret: string } {
    return { keyId: this.keyId, secret: '[redacted]' };
  }

  toString(): string {
    return `MasterKeyring(${this.keyId})`;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }

  /**
   * Build a keyring from a real secret.
   *
   * @param keyId  identifier recorded in snapshots so history can be matched to
   *               the secret that produced it
   * @param secret at least 32 bytes of high-entropy material
   */
  static fromSecret(keyId: string, secret: Uint8Array): MasterKeyring {
    if (secret.length < MIN_SECRET_BYTES) {
      throw new TypeError(
        `Master secret must be at least ${MIN_SECRET_BYTES} bytes, received ${secret.length}.`,
      );
    }
    return new MasterKeyring(keyId, Uint8Array.from(secret), true);
  }

  /**
   * Build a deterministic keyring for tests and simulations.
   *
   * The secret is derived from a public constant, so any stream it produces is
   * fully predictable to anyone reading this file. It therefore refuses to
   * derive a `production` stream — a structural guarantee that a test fixture
   * can never become the live market's entropy source.
   */
  static forTesting(tag: string): MasterKeyring {
    const secret = hkdfSync(
      'sha256',
      new TextEncoder().encode(`otc-engine/test-keyring/${tag}`),
      HKDF_SALT,
      new TextEncoder().encode('test-master-secret'),
      MIN_SECRET_BYTES,
    );
    return new MasterKeyring(`test:${tag}`, new Uint8Array(secret), false);
  }

  /** Derive the 32-byte stream key for a label. Exposed for verification. */
  deriveKey(label: StreamLabel): Uint8Array {
    if (label.env === 'production' && !this.#productionAllowed) {
      throw new ProductionStreamFromTestKeyringError(
        `Keyring ${this.keyId} is a test keyring and cannot derive production streams.`,
      );
    }
    const info = new TextEncoder().encode(canonicalLabel(label));
    const key = hkdfSync('sha256', this.#secret, HKDF_SALT, info, CHACHA20_KEY_BYTES);
    return new Uint8Array(key);
  }

  /** Derive a stream, optionally positioned at a recorded cursor. */
  derive(label: StreamLabel, start?: StreamCursor): RandomStream {
    return new RandomStream(this.deriveKey(label), canonicalLabel(label), start);
  }
}
