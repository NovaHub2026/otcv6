/** Base class for entropy-architecture defects. */
export class EntropyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidStreamLabelError extends EntropyError {}

/**
 * Raised when a keyring created for testing is asked to derive a production
 * stream. Test and production entropy must never intersect: a test keyring's
 * secret is derived from a public constant, so a production stream built from it
 * would be fully predictable.
 */
export class ProductionStreamFromTestKeyringError extends EntropyError {}
