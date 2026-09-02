import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepositoryFile, repoRoot } from './repository.js';
import {
  moduleSpecifiers,
  scanOptionsFor,
  stripCommentsAndStrings,
  stripCommentsKeepingStrings,
} from './sourceScan.js';

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

/**
 * Everything on the signing path.
 *
 * **Cycle Audit 4, m-6.** This was a hardcoded pair and the composition root was
 * not on it. An auditor rewrote `apps/api/src/publication.service.ts` to derive
 * the publishing seed from `OTC_MASTER_SECRET` through `MasterKeyring.deriveKey`
 * — the exact "one secret to rotate instead of two" refactor this guard exists
 * to prevent — and nothing fired. The equality refusal never triggers for a
 * *derived* key, because a derived key is not equal to the master secret.
 *
 * **a2-06, K-07.** These are entry points, not the whole path: everything they
 * import by relative path inside their package is on the signing path too, and
 * a one-file indirection (`signing.ts` → `./internal/keys.ts` → `MasterKeyring`)
 * walked past a scan that read five files. The walk is transitive now.
 */
const SIGNING_ENTRY_POINTS = [
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
 *
 * **a2-06, K-08.** The list named the keyring and the derivation and not the
 * primitives they are made of — `RandomStream`, `expandKey`, `expandNonce`,
 * `chacha20Block`, `CursorLease` — which `@otc/core` exports and which the
 * follower guard had already learned to name after CA5-05. Signing code could
 * import the keystream directly. The two lists agree now; a signing module can
 * no more construct an engine than a follower can.
 */
const GENERATION_SURFACE = [
  'MasterKeyring',
  'deriveKey',
  'hkdf',
  'chacha',
  'ChaCha',
  'keyEpoch',
  'RandomSource',
  'RandomStream',
  'expandKey',
  'expandNonce',
  'CursorLease',
  'createMarketEngine',
  'EngineSnapshot',
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
const REFUSAL_MODULE = 'packages/distribution/src/signing.ts';
const REFUSAL_TEST = 'packages/distribution/src/signing.test.ts';

function isFile(candidate: string): boolean {
  return existsSync(candidate) && statSync(candidate).isFile();
}

/** Only code is scanned: comments legitimately discuss the separation. */
function codeOf(relative: string): string {
  return stripCommentsKeepingStrings(readRepositoryFile(relative), scanOptionsFor(relative));
}

/**
 * The signing path: the entry points and everything they reach by relative
 * import without leaving their package.
 */
function signingPath(): string[] {
  const reached = new Set<string>();
  const queue = [...SIGNING_ENTRY_POINTS];
  while (queue.length > 0) {
    const relative = queue.pop()!;
    if (reached.has(relative)) continue;
    const absolute = path.join(repoRoot, relative);
    if (!isFile(absolute)) {
      throw new Error(`The signing path walked to a file that does not exist: ${relative}`);
    }
    reached.add(relative);
    const source = readRepositoryFile(relative);
    for (const specifier of moduleSpecifiers(source, scanOptionsFor(relative))) {
      if (!specifier.startsWith('.')) continue;
      const target = path.resolve(path.dirname(absolute), specifier);
      const candidates = [
        target.replace(/\.js$/, '.ts'),
        target + '.ts',
        path.join(target, 'index.ts'),
      ];
      const found = candidates.find((candidate) => isFile(candidate)) ?? candidates[0]!;
      queue.push(path.relative(repoRoot, found));
    }
  }
  return [...reached].sort();
}

/** The text between the parenthesis at `open` and the one that balances it. */
function balanced(text: string, open: number, pair: readonly [string, string]): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === pair[0]) depth += 1;
    else if (c === pair[1]) {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** Every `if (condition) { body }` in a stripped source. */
function conditionals(code: string): { readonly condition: string; readonly body: string }[] {
  const found: { condition: string; body: string }[] = [];
  const pattern = /\bif\s*\(/g;
  for (const match of code.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    const condition = balanced(code, open, ['(', ')']);
    if (condition === null) continue;
    const bodyOpen = code.indexOf('{', open + condition.length + 2);
    const body = bodyOpen === -1 ? null : balanced(code, bodyOpen, ['{', '}']);
    found.push({ condition, body: body ?? '' });
  }
  return found;
}

describe('the publishing key cannot derive the market', () => {
  const modules = signingPath();

  it('walks the whole signing path, not only its entry points', () => {
    expect(modules).toEqual(expect.arrayContaining(SIGNING_ENTRY_POINTS));
    // The walk is doing something: `signing.ts` imports `./rotation.js`, which
    // no entry point names.
    expect(modules).toContain('packages/distribution/src/rotation.ts');
  });

  it.each(modules)('%s does not reach the generation surface', (relative) => {
    const code = codeOf(relative);
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
    //
    // **a2-06, K-06 and K-09.** The second version stripped comments and looked
    // for the refusal's message as a substring. A dead string literal in code —
    // `const note = 'equal to OTC_MASTER_SECRET'` — satisfied it with the block
    // deleted, and so did replacing the condition with `false` and leaving the
    // `throw` in place. A guard satisfied by the *words* of a defence is not a
    // guard. This one reads the structure: the generation secret is read from
    // the environment into a binding, a conditional compares that binding with
    // the publishing seed, and the conditional's body throws.
    const code = stripCommentsAndStrings(readRepositoryFile(REFUSAL_MODULE));
    const master = /\bconst\s+(\w+)\s*=\s*env\s*\.\s*OTC_MASTER_SECRET\b/.exec(code)?.[1];
    const seed = /\bconst\s+(\w+)\s*=\s*env\s*\.\s*OTC_PUBLISHING_KEY\b/.exec(code)?.[1];
    expect(master, 'signing.ts no longer reads OTC_MASTER_SECRET into a binding').toBeDefined();
    expect(seed, 'signing.ts no longer reads OTC_PUBLISHING_KEY into a binding').toBeDefined();

    const refusal = conditionals(code).find(
      ({ condition }) =>
        new RegExp(`\\b${master!}\\b`).test(condition) &&
        new RegExp(`\\b${seed!}\\b`).test(condition) &&
        /===/.test(condition),
    );
    expect(
      refusal,
      'no conditional in signing.ts compares the publishing key with the generation secret',
    ).toBeDefined();
    expect(refusal!.body, 'the comparison no longer throws').toMatch(
      /\bthrow\s+new\s+PublishingKeyError\s*\(/,
    );
  });

  it('is exercised behaviourally where the code lives', () => {
    // The structural check above says the refusal exists; `signing.test.ts`
    // says it fires. This guard cannot call it — `@otc/core` depends on
    // nothing, and a test inside core reaching into distribution is the same
    // violation as production code doing it — so it asserts the test that can.
    const code = codeOf(REFUSAL_TEST);
    const exercised = [...code.matchAll(/\bexpect\s*\(/g)].some((match) => {
      const open = match.index + match[0].length - 1;
      const argument = balanced(code, open, ['(', ')']);
      if (argument === null) return false;
      const after = code.slice(open + argument.length + 2, open + argument.length + 40);
      return (
        argument.includes('publishingKeyFromEnvironment') &&
        argument.includes('OTC_MASTER_SECRET') &&
        argument.includes('OTC_PUBLISHING_KEY') &&
        /^\s*\)?\s*\.toThrow\s*\(/.test(after)
      );
    });
    expect(
      exercised,
      'signing.test.ts no longer calls publishingKeyFromEnvironment with equal secrets and expects a throw',
    ).toBe(true);
  });

  it('checks modules that exist', () => {
    for (const relative of [...SIGNING_ENTRY_POINTS, REFUSAL_MODULE, REFUSAL_TEST]) {
      expect(existsSync(path.join(repoRoot, relative)), relative).toBe(true);
    }
  });
});
