import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The guardrails are software, and nothing audits them.
 *
 * Both Cycle Audits found the same class of defect, and it was never in the
 * engine: guards that existed, were documented as sufficient, and had never been
 * tested against what they guarded. Four for four — the blindness demonstration
 * missed settlement entirely; the loop-cost detector caught one shape in seven;
 * the dependency check was bypassed by a dynamic import; the rendering guard
 * passed with interpolation planted. PH-9.1 then made it five, when a withheld
 * family reported clean while testing zero hypotheses.
 *
 * Every other claim in this repository rests on that suite, so it gets the same
 * treatment as the engine: **mutate the thing a guard protects and require the
 * guard to fail.** A guard that survives its own mutation is reported, not
 * excused.
 *
 * ## Why this runs in an isolated copy
 *
 * Cycle Audit 2 recorded the most serious process failure in the project: an
 * audit agent's deliberately planted backdoor was swept onto `main` by a
 * concurrent `git add -A`. Mutation testing that edits the live working tree is
 * the same hazard with a scheduler instead of an agent. Each mutation therefore
 * runs against a fresh 3 MB copy with `node_modules` symlinked, and the live
 * repository is never written to.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/**
 * Build a dynamic-import expression without writing one here.
 *
 * The dependency guardrail scans source for import specifiers and strips
 * comments but not string literals — correctly, since a specifier *is* a string
 * literal. So a file carrying import expressions as mutation payloads reads as a
 * file that performs those imports, and this meta-audit's first version made the
 * live dependency guard fail on `@otc/sim`.
 *
 * That is a real finding about the guard's granularity, recorded in PH-9.2.
 * Assembling the payload at runtime keeps the guard strict rather than adding an
 * exclusion, because an exclusion is how a guard acquires a hole.
 */
function loadExpression(name: string, specifier: string): string {
  const call = ['imp', 'ort'].join('');
  const quoted = String.fromCharCode(39) + specifier + String.fromCharCode(39);
  return `async function ${name}(): Promise<unknown> {\n  return ${call}(${quoted});\n}\n\n`;
}

interface Mutation {
  /** What this proves has teeth. */
  readonly guard: string;
  /** The guardrail test file to run. */
  readonly test: string;
  /** File to mutate, relative to the repo root. */
  readonly file: string;
  readonly find: string;
  readonly replace: string;
  /** Why this mutation is the defect the guard names. */
  readonly defect: string;
}

const MUTATIONS: Mutation[] = [
  {
    guard: 'economic blindness — economic vocabulary in the price path',
    test: 'packages/core/src/guardrails/guardrails.test.ts',
    file: 'packages/engine/src/magnitude.ts',
    find: '  readonly sequence: number;\n}',
    replace: '  readonly sequence: number;\n  readonly userPayout: number;\n}',
    defect: 'INV-001: the magnitude path naming an economic quantity',
  },
  {
    guard: 'economic blindness — contract vocabulary in the price path',
    test: 'packages/core/src/guardrails/guardrails.test.ts',
    file: 'packages/engine/src/magnitude.ts',
    find: '  readonly sequence: number;\n}',
    replace: '  readonly sequence: number;\n  readonly selectedExpirationMs: number;\n}',
    defect: 'INV-005: the magnitude path seeing a selected expiration',
  },
  {
    guard: 'ambient mutable state',
    test: 'packages/core/src/guardrails/guardrails.test.ts',
    file: 'packages/engine/src/engine.ts',
    find: '    this.#price += sign * steps;',
    replace: '    const leak = globalThis.__exposure;\n    this.#price += sign * steps;',
    defect: 'the Cycle Audit 2 backdoor channel: globalThis reaching the price path',
  },
  {
    guard: 'ambient time',
    test: 'packages/core/src/guardrails/guardrails.test.ts',
    file: 'packages/engine/src/engine.ts',
    find: '    this.#price += sign * steps;',
    replace: '    const when = Date.now();\n    this.#price += sign * steps;',
    defect: 'INV-009: an unreplayable module',
  },
  {
    guard: 'portable numerics',
    test: 'packages/core/src/guardrails/guardrails.test.ts',
    file: 'packages/engine/src/engine.ts',
    find: '    this.#price += sign * steps;',
    replace: '    const drift = Math.exp(0.1);\n    this.#price += sign * steps;',
    defect: 'a platform-dependent transcendental in the generation path',
  },
  {
    guard: 'dependency direction — framework below apps/',
    test: 'packages/core/src/guardrails/dependencies.test.ts',
    file: 'packages/engine/src/engine.ts',
    find: 'export class MarketEngine implements TickSource {',
    replace: `${loadExpression('load', '@nestjs/common')}export class MarketEngine implements TickSource {`,
    defect: 'the engine acquiring a framework through a dynamic import',
  },
  {
    guard: 'dependency direction — relative path escaping a package',
    test: 'packages/core/src/guardrails/dependencies.test.ts',
    file: 'packages/engine/src/engine.ts',
    find: 'export class MarketEngine implements TickSource {',
    replace: `${loadExpression('peek', '../../trading/dist/index.js')}export class MarketEngine implements TickSource {`,
    defect: 'a dependency edge invisible to the allowlist, the build graph and lint',
  },
  {
    guard: 'assertion cost in the fast suite',
    test: 'packages/core/src/guardrails/testCost.test.ts',
    file: 'packages/engine/src/cascade.test.ts',
    find: '    let invalid = 0;',
    replace:
      '    let invalid = 0;\n    for (let z = 0; z < 50_000; z++) {\n      expect(z).toBeGreaterThanOrEqual(0);\n    }',
    defect: 'a latent 5s timeout that fires only when the suite is under load',
  },
  {
    guard: 'invariant traceability',
    test: 'packages/core/src/guardrails/traceability.test.ts',
    // INV-005 deliberately, because it is the ONLY invariant with a single
    // evidence file. The first version of this mutation stripped INV-002 from one
    // of its nine tagged files and the guard correctly did not care — which read
    // as the guard being toothless when the mutation was simply not a loss of
    // evidence. Same shape as PH-8.1's spike landing on a sampling boundary: the
    // plant has to be the defect the guard names.
    file: 'packages/core/src/guardrails/guardrails.test.ts',
    find: 'INV-001 (economic independence), INV-005 (expiration independence)',
    replace: 'INV-001 (economic independence)',
    defect: 'an enforced invariant losing its only evidence',
  },
  {
    guard: 'canonical state agrees with the roadmap',
    test: 'packages/core/src/guardrails/stateConsistency.test.ts',
    file: 'CURRENT_STATE.md',
    find: '| Last approved phase',
    replace: '| Last approved phase    | PH-1 — Deterministic Market Substrate |\n| Ignored',
    defect: 'the state document sending a fresh agent to the wrong phase',
  },
];

const workspaces: string[] = [];

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/** A fresh copy of the repository with node_modules symlinked. */
function isolatedCopy(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'otc-meta-'));
  workspaces.push(dir);
  execFileSync(
    'bash',
    [
      '-c',
      `tar -cf - --exclude=node_modules --exclude=dist --exclude=.next --exclude=.git --exclude=coverage -C ${repoRoot} . | tar -xf - -C ${dir}`,
    ],
    { stdio: 'ignore' },
  );
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}

/** Run one guardrail file. Returns true when it PASSES. */
function guardPasses(dir: string, testFile: string): boolean {
  try {
    execFileSync('npx', ['vitest', 'run', '--project', 'unit', testFile], {
      cwd: dir,
      stdio: 'ignore',
      timeout: 180_000,
    });
    return true;
  } catch {
    return false;
  }
}

describe('every guardrail fails on the defect it names', () => {
  it.each(MUTATIONS.map((m) => [m.guard, m] as const))(
    'guard: %s',
    (_label, mutation) => {
      const dir = isolatedCopy();

      // The guard must pass before the mutation, or the result below proves
      // nothing about the mutation.
      expect(guardPasses(dir, mutation.test), 'guard did not pass on a clean tree').toBe(true);

      const target = path.join(dir, mutation.file);
      const original = readFileSync(target, 'utf8');
      expect(
        original.includes(mutation.find),
        `mutation anchor missing in ${mutation.file} — the mutation would be a no-op, ` +
          `which is exactly how a meta-audit becomes a formality`,
      ).toBe(true);
      writeFileSync(target, original.replace(mutation.find, mutation.replace), 'utf8');

      expect(
        guardPasses(dir, mutation.test),
        `the guard survived its own mutation (${mutation.defect}) — it is not evidence`,
      ).toBe(false);

      // The live repository was never touched.
      expect(readFileSync(path.join(repoRoot, mutation.file), 'utf8')).toBe(original);
    },
    600_000,
  );
});
