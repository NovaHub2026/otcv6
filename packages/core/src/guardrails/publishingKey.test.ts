import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Invariant evidence: INV-010 (private generator state).
 *
 * The publishing key must be structurally incapable of deriving the market.
 *
 * `OTC_MASTER_SECRET` derives every stream through HKDF (ADR-0002). The
 * publishing key is handled by operators, shipped to every process that
 * publishes, and written into deployment configuration. If the signing path
 * could reach the keyring, then one convenient refactor — "derive the publishing
 * key from the master secret so there is only one thing to rotate" — would make
 * a leaked signing key a **forward** leak of future prices rather than a
 * historical one.
 *
 * PH-12.2 states that separation. This is what enforces it, because a stated
 * separation is worth nothing: the failure would be a two-line change that looks
 * like a simplification.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/** Everything on the signing path. */
/**
 * Everything on the signing path.
 *
 * **Cycle Audit 4, m-6.** This was a hardcoded pair and the composition root was
 * not on it. An auditor rewrote `apps/api/src/publication.service.ts` to derive
 * the publishing seed from `OTC_MASTER_SECRET` through `MasterKeyring.deriveKey`
 * — the exact "one secret to rotate instead of two" refactor this guard exists
 * to prevent — and nothing fired. The equality refusal never triggers for a
 * *derived* key, because a derived key is not equal to the master secret.
 */
const SIGNING_MODULES = [
  'packages/distribution/src/signing.ts',
  'packages/distribution/src/commitment.ts',
  'packages/distribution/src/publicationWriter.ts',
  'packages/distribution/src/publisher.ts',
  'apps/api/src/publication.service.ts',
];

/**
 * Identifiers that mean "this code can derive generator state".
 *
 * Substring matching, not word-boundary. Cycle Audit 1 found the economic
 * blindness scan missing `contractPayout` because `\b` does not fire inside
 * camelCase, and the same trap applies here to `deriveKeyFor`.
 */
const GENERATION_SURFACE = [
  'MasterKeyring',
  'deriveKey',
  'hkdf',
  'chacha',
  'ChaCha',
  'keyEpoch',
  'RandomSource',
];

/**
 * `OTC_MASTER_SECRET` is deliberately **not** on that list.
 *
 * The signing module reads that variable, and reading it is the defence rather
 * than the violation: it is how `publishingKeyFromEnvironment` refuses a
 * publishing key equal to the generation secret. Banning the name would have
 * forced the check somewhere it could be skipped, which trades a guaranteed
 * refusal for a tidier scan.
 *
 * What matters is that the module cannot *derive* anything — that is what the
 * list above covers, since keystream is unreachable without one of those — so
 * the exemption is paired with the positive check below. The guard asserts the
 * defence is present, not merely that the attack is absent.
 */
const REQUIRED_REFUSAL = 'equal to OTC_MASTER_SECRET';

describe('the publishing key cannot derive the market', () => {
  it.each(SIGNING_MODULES)('%s does not reach the generation surface', (relative) => {
    const source = readFileSync(path.join(repoRoot, relative), 'utf8');
    // Comments legitimately discuss the separation, so only executable lines are
    // scanned. A guard that could be silenced by phrasing would be no guard.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    const found = GENERATION_SURFACE.filter((identifier) => code.includes(identifier));
    expect(found, `${relative} references the generation surface`).toEqual([]);
  });

  it('keeps the refusal that the exemption exists for', () => {
    // If someone removes the equality check, the scan above goes green and the
    // separation is gone. This is the half that notices.
    //
    // **Cycle Audit 4, m-5.** The first version scanned raw source, so deleting
    // the whole refusal block and leaving a comment — "Operators must ensure
    // OTC_PUBLISHING_KEY is never equal to OTC_MASTER_SECRET" — kept it green.
    // A guard satisfiable by a sentence *about* the defence is not a guard.
    // Comments are stripped here for the same reason the scan above strips them.
    const source = readFileSync(
      path.join(repoRoot, 'packages/distribution/src/signing.ts'),
      'utf8',
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code, 'the publishing key must refuse to equal the generation secret').toContain(
      REQUIRED_REFUSAL,
    );
  });

  it('checks modules that exist', () => {
    for (const relative of SIGNING_MODULES) {
      expect(() => readFileSync(path.join(repoRoot, relative), 'utf8')).not.toThrow();
    }
  });
});

/**
 * The behavioural half lives in `packages/distribution/src/signing.test.ts`, not
 * here.
 *
 * The first draft imported `@otc/distribution` to exercise the refusal directly,
 * and the dependency guardrail failed it immediately: `@otc/core` depends on
 * nothing, and a *test* inside core reaching sideways into distribution is the
 * same violation as production code doing it. The guard was right and the test
 * was wrong.
 *
 * So this file scans source — which needs no import — and the refusal is
 * exercised where the code lives. Two halves in the two places that can hold
 * them, rather than one convenient place that breaks the architecture.
 */
