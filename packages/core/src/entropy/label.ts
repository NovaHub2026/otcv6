import { InvalidStreamLabelError } from './errors.js';

/**
 * Environment component of a stream label.
 *
 * The environment is part of the key-derivation input, so a simulation, a test
 * and production draw from cryptographically unrelated streams even when the
 * asset and purpose are identical. This is what stops a backtest or a staging
 * deployment from ever reproducing — or revealing — the live market.
 */
export const ENVIRONMENTS = ['production', 'staging', 'simulation', 'test'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export interface StreamLabel {
  readonly env: Environment;
  /** Asset identifier, e.g. `eurusd-otc`. */
  readonly asset: string;
  /** What the stream drives, e.g. `magnitude`, `sign`, `arrival`, `regime`. */
  readonly purpose: string;
  /** Key generation. Incremented only for a deliberate re-key of a stream. */
  readonly keyEpoch: number;
}

/**
 * Label components exclude `|` and `=`, which are the separators used by
 * {@link canonicalLabel}. That exclusion is what guarantees two distinct labels
 * can never canonicalise to the same string — and therefore can never
 * accidentally share a key.
 */
const COMPONENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const LABEL_VERSION = 'otc1';

function assertComponent(name: string, value: string): void {
  if (!COMPONENT_PATTERN.test(value)) {
    throw new InvalidStreamLabelError(
      `Stream label component "${name}" is invalid: ${JSON.stringify(value)}. ` +
        `Expected to match ${COMPONENT_PATTERN.source}.`,
    );
  }
}

export function assertValidStreamLabel(label: StreamLabel): void {
  if (!ENVIRONMENTS.includes(label.env)) {
    throw new InvalidStreamLabelError(
      `Unknown environment ${JSON.stringify(label.env)}. Expected one of ${ENVIRONMENTS.join(', ')}.`,
    );
  }
  assertComponent('asset', label.asset);
  assertComponent('purpose', label.purpose);
  if (!Number.isSafeInteger(label.keyEpoch) || label.keyEpoch < 0) {
    throw new InvalidStreamLabelError(
      `Stream label keyEpoch must be a non-negative safe integer, received ${label.keyEpoch}.`,
    );
  }
}

/**
 * The exact byte string fed to key derivation.
 *
 * This format is a durable wire contract: changing it re-keys every stream in
 * existence and breaks replay of all recorded history. A change therefore
 * requires a new `LABEL_VERSION` and a documented migration, never an edit.
 */
export function canonicalLabel(label: StreamLabel): string {
  assertValidStreamLabel(label);
  return `${LABEL_VERSION}|env=${label.env}|asset=${label.asset}|purpose=${label.purpose}|epoch=${label.keyEpoch}`;
}
