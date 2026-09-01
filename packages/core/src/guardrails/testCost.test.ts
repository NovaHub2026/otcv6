import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Assertion cost in the fast unit suite.
 *
 * A matcher call costs roughly 25 microseconds. That is irrelevant once and
 * ruinous a hundred thousand times: an assertion inside a large loop turns a
 * millisecond of real work into five seconds of matcher overhead, which is
 * exactly the unit project's timeout.
 *
 * This has now bitten twice. `regime.test.ts` made 200,000 `expect()` calls and
 * sat at 5.08s, failing only when something else competed for CPU. Then
 * `cascade.test.ts` failed the PH-5 phase gate the same way. Both were latent
 * for as long as nothing ran beside them, which is the worst kind of failure:
 * it appears when the suite gets busier, and it looks like the new work broke
 * something.
 *
 * The fix in both cases was the same — count inside the loop, assert once after
 * it — and it reads better too, because a failure reports "3 invalid values"
 * rather than stopping at the first.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/** Loop bound above which a per-iteration assertion is a problem. */
const LOOP_BOUND_LIMIT = 20_000;

/** Every `*.stat.test.ts` in the workspace. */
function statisticalTestFiles(): string[] {
  const found: string[] = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const child = path.join(absolute, entry);
      if (statSync(child).isDirectory()) walk(child);
      else if (entry.endsWith('.stat.test.ts')) found.push(child);
    }
  };
  for (const group of ['packages', 'tools', 'apps']) {
    try {
      walk(path.join(repoRoot, group));
    } catch {
      // A group that does not exist yet is not a failure.
    }
  }
  return found.sort();
}

function unitTestFiles(): string[] {
  const found: string[] = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const child = path.join(absolute, entry);
      if (statSync(child).isDirectory()) walk(child);
      else if (entry.endsWith('.test.ts') && !entry.endsWith('.stat.test.ts')) found.push(child);
    }
  };
  for (const group of ['packages', 'tools', 'apps']) {
    const base = path.join(repoRoot, group);
    try {
      walk(base);
    } catch {
      // A group that does not exist yet is not a failure.
    }
  }
  return found.sort();
}

/**
 * Iterations a loop header performs, or `null` when the line opens no loop.
 *
 * Cycle Audit 2 measured the original detector against seven loop shapes and it
 * caught one. The six it missed included `i++` — which the audit then showed
 * costs 4,214ms against vitest's 5s default, the identical failure that broke two
 * phase gates — and a `const SAMPLES = 100_000` bound, and a nested 300 x 300
 * pair whose 90,000 assertions hid behind two bounds each under the limit.
 *
 * A guardrail that catches a seventh of its subject is worse than none, because
 * the record then claims the class is closed.
 */
function loopIterations(line: string, constants: ReadonlyMap<string, number>): number | null {
  const counted =
    /\bfor \(\s*(?:let|var)\s+\w+\s*=\s*(\d[\d_]*)\s*;\s*\w+\s*(<=?)\s*([\w_]+)\s*;\s*\w+\s*(?:(\+\+)|\+=\s*([\d_]+))/.exec(
      line,
    );
  if (counted === null) return null;
  const from = Number.parseInt(counted[1]!.replace(/_/g, ''), 10);
  const rawTo = counted[3]!.replace(/_/g, '');
  const to = /^\d+$/.test(rawTo) ? Number.parseInt(rawTo, 10) : constants.get(counted[3]!);
  // A bound this file does not define as a literal is unknown, and unknown is
  // treated as suspect: that shape is one of the six the audit planted.
  if (to === undefined) return Number.POSITIVE_INFINITY;
  const step = counted[5] === undefined ? 1 : Number.parseInt(counted[5].replace(/_/g, ''), 10);
  if (step <= 0) return null;
  const span = counted[2] === '<=' ? to - from + 1 : to - from;
  return Math.max(0, Math.ceil(span / step));
}

/** `const NAME = <literal>` declarations, so a named bound can be resolved. */
function literalConstants(source: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(\d[\d_]*)\s*;/g)) {
    found.set(match[1]!, Number.parseInt(match[2]!.replace(/_/g, ''), 10));
  }
  return found;
}

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly bound: number;
}

/**
 * Assertions executed inside large loops.
 *
 * Walks the file keeping a stack of open counting loops and multiplies their
 * counts, so nested loops are measured by the assertions they actually perform
 * rather than by either bound alone.
 */
function offences(file: string): Offence[] {
  const source = readFileSync(file, 'utf8');
  const constants = literalConstants(source);
  const lines = source.split('\n');
  const found: Offence[] = [];
  const stack: { iterations: number; depth: number }[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]!;
    const iterations = loopIterations(text, constants);
    const opensBlock = text.includes('{');

    let product = 1;
    for (const frame of stack) product *= frame.iterations;
    if (product >= LOOP_BOUND_LIMIT && text.includes('expect(')) {
      found.push({ file: path.relative(repoRoot, file), line: i + 1, bound: product });
    }

    for (const character of text) {
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        while (stack.length > 0 && stack[stack.length - 1]!.depth > depth) stack.pop();
      }
    }
    if (iterations !== null && opensBlock) stack.push({ iterations, depth });
  }
  return found;
}

describe('the fast suite stays fast', () => {
  const files = unitTestFiles();

  it('has unit tests to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never asserts inside a large loop', () => {
    const all = files.flatMap(offences);
    const rendered = all.map(
      (o) =>
        `${o.file}:${o.line} (${Number.isFinite(o.bound) ? `${String(o.bound)} iterations` : 'unbounded or non-literal loop'})`,
    );
    expect(
      rendered,
      'count inside the loop and assert once after it — a matcher call is ~25us, ' +
        'and this has already caused two timeouts that looked like unrelated failures',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PH-11.3: the synchronous-driver rule
// ---------------------------------------------------------------------------

/**
 * A statistical test must not drive the engine through a synchronous entry point
 * when a yielding one exists.
 *
 * ## Why this guard exists, and why it did not before
 *
 * This defect has now recurred three times:
 *
 * - **B-005** (PH-4) — calibration loops that never returned to the event loop.
 *   Cost a phase gate.
 * - **B-010** (PH-10.3) — `latticeTies.stat.test.ts` drove btcusd for 25 seconds
 *   synchronously.
 * - **PH-11.3** — `withheld.stat.test.ts` used `runBattery` instead of
 *   `runBatteryAsync`; under coverage instrumentation that was **627 seconds**
 *   of uninterrupted CPU.
 *
 * Each time the symptom is the most confusing failure this project produces: the
 * worker's own RPC channel starves, and the run fails with
 * `Timeout calling "onTaskUpdate"` **while reporting every test as passed**.
 *
 * B-010 concluded that no static guard could see it, because the offending loop
 * is bounded at a small number and the per-iteration cost is unbounded — the
 * source looks identical to the many short driver loops that are fine.
 *
 * That conclusion was right about *loops* and wrong about *entry points*. Every
 * recurrence went through a function whose yielding twin already existed and was
 * two characters away in the import list. That is statically visible, and it is
 * the whole of what this checks.
 *
 * ## The escape hatch, and why it is spelled the way it is
 *
 * `catalogue.stat.test.ts` legitimately imports the synchronous variant, to
 * assert that it rejects bad input. Renaming it on import —
 * `calibrateAsset as calibrateAssetSync` — is how a test says the synchronous
 * behaviour is the subject rather than the vehicle. An alias whose name contains
 * `Sync` is therefore allowed, and it makes the intent visible at the call site
 * instead of in a config file nobody reads.
 */
describe('statistical tests use the yielding driver', () => {
  /** Entry points that walk a whole dataset and have an `...Async` twin. */
  const SYNCHRONOUS_DRIVERS = [
    'runBattery',
    'runSimulation',
    'calibrateAsset',
    'estimateDirectionalEdge',
  ] as const;

  const statisticalTests = statisticalTestFiles();

  it('finds statistical tests to check', () => {
    expect(statisticalTests.length).toBeGreaterThan(5);
  });

  it.each(SYNCHRONOUS_DRIVERS)('no statistical test imports %s without saying so', (driver) => {
    const offenders: string[] = [];
    for (const file of statisticalTests) {
      const source = readFileSync(file, 'utf8');
      for (const block of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
        for (const specifier of block[1]!.split(',')) {
          const [imported, alias] = specifier.split(/\s+as\s+/).map((part) => part.trim());
          if (imported !== driver) continue;
          // The async twin is a different identifier and never matches here.
          if (alias !== undefined && /sync/i.test(alias)) continue;
          offenders.push(`${path.relative(repoRoot, file)} imports ${driver}`);
        }
      }
      // **Cycle Audit 4, m-8.** The named-import check above was the whole rule,
      // and an auditor walked past it two ways:
      //   import * as lab from '@otc/lab';  lab.runBattery(x)
      //   const { runBattery } = await import('@otc/lab');
      // Both reach the same synchronous driver without ever writing
      // `import { runBattery } from`. The docstring claimed static visibility
      // "is the whole of what this checks" — it was, and the check was too
      // narrow. A call is what matters, so calls are what get counted.
      const called = new RegExp(`(?<![A-Za-z0-9_$.])${driver}\\s*\\(`, 'g');
      const namespaced = new RegExp(`\\.\\s*${driver}\\s*\\(`, 'g');
      const destructured = new RegExp(
        `\\{[^}]*\\b${driver}\\b[^}]*\\}\\s*=\\s*await\\s+import`,
        'g',
      );
      for (const [pattern, how] of [
        [called, 'calls'],
        [namespaced, 'calls through a namespace'],
        [destructured, 'destructures from a dynamic import'],
      ] as const) {
        if (pattern.test(source)) {
          offenders.push(`${path.relative(repoRoot, file)} ${how} ${driver}`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
