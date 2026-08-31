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

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly bound: number;
}

/**
 * Assertions inside a large loop.
 *
 * Brace-depth tracking rather than a fixed window, so a single-line loop
 * followed by unrelated assertions is not flagged — that false positive cost a
 * real investigation the first time this was measured by hand.
 */
function offences(file: string): Offence[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const found: Offence[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    // Iterations, not the bound. `interval <= 60_000; interval += 137` runs 438
    // times, and flagging it would be a false positive — one that cost a real
    // investigation when this was first measured by hand.
    const match = /\bfor \(let \w+ = (\d[\d_]*); \w+ <=? ([\d_]+); \w+ \+= ([\d_]+)/.exec(
      lines[i]!,
    );
    if (match === null) continue;
    const from = Number.parseInt(match[1]!.replace(/_/g, ''), 10);
    const to = Number.parseInt(match[2]!.replace(/_/g, ''), 10);
    const step = Number.parseInt(match[3]!.replace(/_/g, ''), 10);
    if (step <= 0) continue;
    const bound = Math.ceil((to - from) / step);
    if (bound < LOOP_BOUND_LIMIT) continue;
    if (!lines[i]!.includes('{')) continue; // single-line body: nothing inside

    let depth = 0;
    for (let j = i; j < lines.length; j += 1) {
      const text = lines[j]!;
      for (const character of text) {
        if (character === '{') depth += 1;
        else if (character === '}') depth -= 1;
      }
      if (j > i && text.includes('expect(') && depth > 0) {
        found.push({ file: path.relative(repoRoot, file), line: j + 1, bound });
      }
      if (depth <= 0 && j > i) break;
    }
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
    const rendered = all.map((o) => `${o.file}:${o.line} (${o.bound} iterations)`);
    expect(
      rendered,
      'count inside the loop and assert once after it — a matcher call is ~25us, ' +
        'and this has already caused two timeouts that looked like unrelated failures',
    ).toEqual([]);
  });
});
