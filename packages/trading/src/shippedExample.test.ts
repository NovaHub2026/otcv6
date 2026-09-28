import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **The settlement example a broker receives is executed here, and its own
 * documented output is compared with what it prints** (the readiness audit of
 * 2026-09-28, finding 1).
 *
 * `docs/integration/examples/settle-example.ts` ships inside the integration
 * package, at `examples/`, and it is the only runnable demonstration of the one
 * function a broker integrates. Nothing compiled it and nothing ran it, so it
 * drifted until every run ended in its own `catch`: `TickRecord.seams` became
 * required in Cycle Audit 12 — silence and "no discontinuities" had been the same
 * input — and the example never passed it, so `settle()` refused with
 * `NotSettleableError` every time. Its commented output said `returned: 185` and
 * `net: 85` for a 10,000 stake at 0.85, which is a hundredth of the real 18,500
 * and 8,500.
 *
 * Both were invisible because `docs/` is in no tsconfig and no test. This runs the
 * file as a broker would and holds its comment to its behaviour.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXAMPLE = path.join(repoRoot, 'docs/integration/examples/settle-example.ts');

/** The `key: value` pairs of a `console.log`ged object, from text. */
function fields(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, key, rest] of text.matchAll(/^\s*(?:\/\/\s*)?([a-zA-Z]+):\s*(.+)$/gm)) {
    // The inline comment goes first, then the trailing comma it was hiding: doing
    // it the other way round left `'win',` where the program prints `'win'`.
    const value = rest!
      .replace(/\s*\/\/.*$/, '')
      .trim()
      .replace(/,$/, '')
      .trim();
    if (!out.has(key!)) out.set(key!, value);
  }
  return out;
}

describe('the settlement example that ships to a broker', () => {
  const run = (): { status: number | null; stdout: string; stderr: string } => {
    // Node 24 runs TypeScript directly, so this is what the file does on a
    // broker's machine — not a rewritten copy of it that could agree with a bug.
    const result = spawnSync(process.execPath, ['--experimental-strip-types', EXAMPLE], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };

  it('runs, and settles instead of being refused', () => {
    const { status, stdout, stderr } = run();
    expect(status, `the example exited ${String(status)}: ${stderr}`).toBe(0);
    expect(
      stdout + stderr,
      'the example was refused by settle() — the record it builds is incomplete',
    ).not.toContain('no liquidable');
    expect(stdout).toContain("outcome: 'win'");
  });

  it('prints what its own comment says it prints', () => {
    const { stdout } = run();
    const printed = fields(stdout.slice(0, stdout.indexOf('}')));
    const source = readFileSync(EXAMPLE, 'utf8');
    const block = /\/\/ \{\n([\s\S]*?)\/\/ \}/.exec(source)?.[1];
    expect(block, 'the example no longer documents its output').toBeDefined();
    const documented = fields(block!);
    expect(documented.size).toBeGreaterThan(6);
    for (const [key, value] of documented) {
      expect(printed.has(key), `the comment documents \`${key}\`, which it does not print`).toBe(
        true,
      );
      expect(
        printed.get(key),
        `the comment says ${key} is ${value} and the example prints ${String(printed.get(key))}`,
      ).toBe(value);
    }
  });

  it('states its discontinuities, because settle() refuses a record that does not', () => {
    const source = readFileSync(EXAMPLE, 'utf8');
    expect(source, 'the example builds a TickRecord without `seams`').toMatch(/\bseams\b/);
    // And the guide's own example, which is what most readers copy.
    const guide = readFileSync(path.join(repoRoot, 'docs/integration/INTEGRATION.md'), 'utf8');
    for (const [, body] of guide.matchAll(/const record: TickRecord = \{([\s\S]*?)\};/g)) {
      expect(body, 'a TickRecord in the guide omits `seams`').toMatch(/seams/);
    }
  });
});
