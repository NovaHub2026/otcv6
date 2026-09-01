import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const runtimeSrc = path.join(repoRoot, 'packages/runtime/src');

/** The follower entry point, and everything it can reach without leaving the package. */
const FOLLOWER_ENTRY = 'follower.ts';

/**
 * Specifiers a follower may not import, at any depth.
 *
 * Type-only imports are refused too. A `import type { MasterKeyring }` does
 * nothing at runtime, which is exactly why it would be waved through — and it
 * turns "add an engine here" from a design change into a one-word edit.
 */
const FORBIDDEN_MODULES = [/^@otc\/engine/, /^@otc\/fixtures/, /^@otc\/lab/];

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
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of stripComments(source).matchAll(
    /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g,
  )) {
    found.push(match[1]!);
  }
  return found;
}

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
    if (!existsSync(absolute)) {
      throw new Error(`Follower reachability walked to a file that does not exist: ${relative}`);
    }
    const source = readFileSync(absolute, 'utf8');
    reached.set(relative, source);
    for (const specifier of specifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      // Emitted specifiers end in `.js`; the sources are `.ts`.
      const resolved = path
        .relative(runtimeSrc, path.resolve(path.dirname(absolute), specifier))
        .replace(/\.js$/, '.ts');
      queue.push(resolved);
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

  it('imports no engine, fixture corpus or laboratory, at any depth', () => {
    const offenders: string[] = [];
    for (const [file, source] of reachable) {
      for (const specifier of specifiers(source)) {
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

  it('the rule would notice: the leader path it is contrasted with does import an engine', () => {
    // A negative control. If `resume.ts` also came back clean, the check would
    // be measuring nothing — the runtime would simply have no engine anywhere.
    const leaderPath = path.join(runtimeSrc, 'resume.ts');
    const leaderSource = readFileSync(leaderPath, 'utf8');
    const leaderImports = specifiers(leaderSource);
    expect(leaderImports.some((s) => FORBIDDEN_MODULES.some((p) => p.test(s)))).toBe(true);
    expect(reachable.has('resume.ts')).toBe(false);
  });
});
