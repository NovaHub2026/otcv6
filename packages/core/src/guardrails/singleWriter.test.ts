import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './repository.js';
import { moduleSpecifiers, stripCommentsKeepingStrings } from './sourceScan.js';

/**
 * Generation is single-writer, and a follower must be *unable* to generate.
 *
 * [ADR-0012](../../../../docs/decisions/ADR-0012-single-writer-generation.md)
 * makes leadership the sole authority to produce ticks. The lease enforces that
 * for anything that writes through the store, but it says nothing about a node
 * that simply builds an engine of its own and serves the result. That node
 * would fork the record invisibly: every observer reaching it would see a
 * different market and none of them could tell, which is INV-002 broken in the
 * one place nobody looks.
 *
 * A comment saying the follower does not do this is worth nothing against a
 * future edit that adds an engine "just to fill the gap during failover" — the
 * single most plausible wrong instinct in this phase. So the rule is structural:
 * the follower module, and everything it transitively imports inside the
 * runtime, may not reach the engine or any key material.
 *
 * It settles INV-010 for followers at the same time. A module that never
 * receives key material cannot leak it.
 */

const runtimeSrc = path.join(repoRoot, 'packages/runtime/src');

function isFile(candidate: string): boolean {
  return existsSync(candidate) && statSync(candidate).isFile();
}

/** The follower entry point, and everything it can reach without leaving the package. */
const FOLLOWER_ENTRY = 'follower.ts';

/**
 * Specifiers a follower may not import, at any depth.
 *
 * Type-only imports are refused too. A `import type { MasterKeyring }` does
 * nothing at runtime, which is exactly why it would be waved through — and it
 * turns "add an engine here" from a design change into a one-word edit.
 *
 * **a2-06, W-06 and W-07.** `node:vm` and `node:worker_threads` evaluate
 * source a follower could assemble; `node:child_process` runs anything at all;
 * `node:module` hands out `createRequire`. None has a use in a module whose
 * whole job is to replay a record it was handed.
 */
const FORBIDDEN_MODULES = [
  /^@otc\/engine/,
  /^@otc\/fixtures/,
  /^@otc\/lab/,
  /^(?:node:)?(?:vm|worker_threads|child_process|module)$/,
];

/**
 * Identifiers that mean the module has touched generation or key material.
 *
 * Named rather than inferred, because the import check alone would miss a
 * follower that received a keyring as a *parameter* from somewhere else in the
 * runtime.
 */
const FORBIDDEN_IDENTIFIERS = [
  'MasterKeyring',
  'createMarketEngine',
  'EngineSnapshot',
  'ASSET_CATALOGUE',
  'RegisteredAsset',
  'configFor',
  // **Cycle Audit 5, CA5-05.** `@otc/core` is a permitted dependency and it
  // exports the entropy surface, so naming only `MasterKeyring` left a follower
  // free to import the primitives key material is made of. PH-14 §12 cites this
  // guard as the evidence for INV-010.
  'RandomStream',
  'expandKey',
  'expandNonce',
  'chacha20Block',
  'CursorLease',
  'deriveKey',
];

/**
 * Escape hatches, banned by construction rather than by what they name.
 *
 * **Cycle Audit 5, CA5-05.** Three of the four evasions an auditor found were
 * not about *which* module was reached — they were about reaching it in a form
 * no name-based scan can see: `await import(\`./resume.js\`)` with a template
 * literal, `await import(['.', 'resume.js'].join('/'))`, and `createRequire`
 * with an assembled specifier. Adding each name to a list would have caught none
 * of them.
 *
 * So the rule is about the construct. A module that must be *provably* unable
 * to reach the engine may not contain a dynamic escape hatch at all — there is no
 * legitimate reason for one in a module whose entire job is to replay a record
 * it was handed.
 *
 * **a2-05 / a2-06.** Widened to the forms the out-of-band audit planted:
 * Node's `global` (W-08), the `Function` constructor reached through
 * `.constructor` (W-09), indirect `eval` as a value (W-10), `Reflect`, and
 * `process.getBuiltinModule` (W-13).
 */
const FORBIDDEN_CONSTRUCTS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bimport\s*\(/, why: 'a dynamic import can name anything at run time' },
  { pattern: /\brequire\s*\(/, why: 'so can require' },
  { pattern: /\bcreateRequire\b/, why: 'and so can a require built from createRequire' },
  { pattern: /(?<![\w$.])Function\b/, why: 'the Function constructor evaluates arbitrary source' },
  { pattern: /\.constructor\b/, why: 'and so does the constructor of any function' },
  {
    pattern: /(?<![\w$.])eval\b/,
    why: 'eval evaluates arbitrary source, called directly or indirectly',
  },
  { pattern: /\bglobalThis\b|\bglobal\b/, why: 'a global is a channel no import graph shows' },
  { pattern: /\bReflect\b/, why: 'Reflect reaches any property by a name assembled at run time' },
  {
    pattern: /\bgetBuiltinModule\b/,
    why: 'process.getBuiltinModule loads any built-in without an import',
  },
];

/**
 * **Cycle Audit 5, CA5-05.** This was a pair of regexes, and it was not aware of
 * string literals: `const OPEN = '/*'` before an import and `const CLOSE` after
 * it made a plain static engine import read as the inside of a comment. The
 * guard stayed green while an auditor gave a follower a real engine and measured
 * INV-002 broken at 120 of 120 sampled instants.
 *
 * **a2-01, W-17 and W-19.** The character scanner that replaced it read a regex
 * after `return` as a division, and the same import vanished again behind
 * `return /[/*]/`. Specifiers are read by the shared lexer now, and the lexer's
 * corpus (`sourceScan.test.ts`) holds every construct that has hidden one.
 */
const stripComments = stripCommentsKeepingStrings;

/**
 * Every runtime module reachable from the follower, including itself.
 *
 * Transitive, because a follower that imports a helper that imports the engine
 * has imported the engine. The first draft of this guard checked `follower.ts`
 * alone, which would have passed a one-line indirection.
 */
function reachableFromFollower(): Map<string, string> {
  const reached = new Map<string, string>();
  const queue = [FOLLOWER_ENTRY];
  while (queue.length > 0) {
    const relative = queue.pop()!;
    if (reached.has(relative)) continue;
    const absolute = path.join(runtimeSrc, relative);
    if (!isFile(absolute)) {
      throw new Error(`Follower reachability walked to a file that does not exist: ${relative}`);
    }
    const source = readFileSync(absolute, 'utf8');
    reached.set(relative, source);
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      // Emitted specifiers end in `.js`; the sources are `.ts`. A directory
      // import names its index.
      const target = path.resolve(path.dirname(absolute), specifier);
      const candidates = [target.replace(/\.js$/, '.ts'), path.join(target, 'index.ts')];
      // A file, not a directory: `./fill` names `fill/index.ts`, and a walk that
      // reads the directory crashes the guard instead of failing it (W-16).
      const found = candidates.find(isFile) ?? candidates[0]!;
      queue.push(path.relative(runtimeSrc, found));
    }
  }
  return reached;
}

const reachable = reachableFromFollower();

describe('a follower cannot generate', () => {
  it('reaches a plausible set of modules, so the walk is doing something', () => {
    expect(reachable.has(FOLLOWER_ENTRY)).toBe(true);
    expect(reachable.size).toBeGreaterThanOrEqual(2);
  });

  it('imports no engine, fixture corpus, laboratory or evaluator, at any depth', () => {
    const offenders: string[] = [];
    for (const [file, source] of reachable) {
      for (const specifier of moduleSpecifiers(source)) {
        if (FORBIDDEN_MODULES.some((pattern) => pattern.test(specifier))) {
          offenders.push(`${file} imports ${specifier}`);
        }
      }
    }
    expect(
      offenders,
      'a follower that can construct an engine can fork the record invisibly',
    ).toEqual([]);
  });

  it('names no generation or key-material identifier, at any depth', () => {
    const offenders: string[] = [];
    for (const [file, source] of reachable) {
      const stripped = stripComments(source);
      for (const identifier of FORBIDDEN_IDENTIFIERS) {
        if (new RegExp(`\\b${identifier}\\b`).test(stripped)) {
          offenders.push(`${file} names ${identifier}`);
        }
      }
    }
    expect(offenders, 'a follower holds no key material and derives no price').toEqual([]);
  });

  it('contains no dynamic escape hatch, at any depth', () => {
    // The rule that closes the class rather than the instance. Three of the four
    // evasions found by Cycle Audit 5 were dynamic forms, and no list of module
    // names or identifiers can see a specifier that is assembled at run time.
    const offenders: string[] = [];
    for (const [file, source] of reachable) {
      const stripped = stripComments(source);
      for (const { pattern, why } of FORBIDDEN_CONSTRUCTS) {
        if (pattern.test(stripped)) offenders.push(`${file}: ${pattern.source} — ${why}`);
      }
    }
    expect(
      offenders,
      'a follower that can construct a specifier at run time cannot be shown to reach nothing',
    ).toEqual([]);
  });

  it('sees an import hidden behind string literals or a regex that look like comment markers', () => {
    // The exact evasions, as unit tests on the reader rather than plants.
    const behindStrings = [
      "const OPEN = '/*';",
      "import * as engineModule from '@otc/engine';",
      "const CLOSE = '*' + '/';",
    ].join('\n');
    expect(moduleSpecifiers(behindStrings)).toContain('@otc/engine');
    expect(stripComments(behindStrings)).toContain('@otc/engine');
    const behindKeywordRegex = [
      'export function sep17(s: string): boolean {',
      '  return /[/*]/.test(s);',
      '}',
      "import * as gen17 from '@otc/engine';",
      "export const close17 = '*/';",
    ].join('\n');
    expect(moduleSpecifiers(behindKeywordRegex)).toContain('@otc/engine');
    expect(stripComments(behindKeywordRegex)).toContain('gen17');
    // And a genuine comment is still removed.
    expect(stripComments('/* import x from "@otc/engine" */ const a = 1;')).not.toContain(
      '@otc/engine',
    );
    expect(moduleSpecifiers('/* import x from "@otc/engine" */ const a = 1;')).toEqual([]);
  });

  it('the rule would notice: the leader path it is contrasted with does import an engine', () => {
    // A negative control. If `resume.ts` also came back clean, the check would
    // be measuring nothing — the runtime would simply have no engine anywhere.
    const leaderSource = readFileSync(path.join(runtimeSrc, 'resume.ts'), 'utf8');
    const leaderImports = moduleSpecifiers(leaderSource);
    expect(leaderImports.some((s) => FORBIDDEN_MODULES.some((p) => p.test(s)))).toBe(true);
    expect(reachable.has('resume.ts')).toBe(false);
  });
});
