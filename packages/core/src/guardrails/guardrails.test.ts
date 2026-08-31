// Invariant evidence: INV-001 (economic independence), INV-005 (expiration independence).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AMBIENT_RULES,
  ECONOMIC_BLINDNESS_RULES,
  PORTABILITY_RULES,
  scanSource,
  stripCommentsAndStrings,
  type Violation,
} from './sourceScan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/** Packages whose code generates or transforms market data. */
const GENERATION_ROOTS = [
  'packages/core/src',
  'packages/engine/src',
  // Fixtures deliberately plant directional defects, but they are still
  // generation code: they must be replayable and portable, or a calibration run
  // would not be reproducible. Their intended violation — reading a sign — is
  // caught by the mirror test in PH-3, not by this scanner.
  'packages/fixtures/src',
];

/**
 * `SystemClock` is the single sanctioned reader of ambient time: something must
 * eventually ask the operating system what time it is, and confining that to one
 * named class is what makes every other module replayable.
 */
const AMBIENT_TIME_ALLOWLIST = ['packages/core/src/time/clock.ts'];

function listSourceFiles(root: string): string[] {
  const absolute = path.join(repoRoot, root);
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // a package that does not exist yet
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        out.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(absolute);
  return out.sort();
}

function isTestFile(file: string): boolean {
  return file.endsWith('.test.ts');
}

function generationSources(): { file: string; source: string }[] {
  return GENERATION_ROOTS.flatMap(listSourceFiles)
    .filter((f) => !isTestFile(f))
    .map((file) => ({ file, source: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

function describeViolations(violations: Violation[]): string {
  return violations
    .map((v) => `${v.file}:${v.line} [${v.rule}] ${v.text}\n    ${v.reason}`)
    .join('\n');
}

describe('guardrail scanner', () => {
  it('finds ambient time', () => {
    const found = scanSource('x.ts', 'const t = Date.now();', AMBIENT_RULES);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe('no-ambient-time');
  });

  it('finds ambient randomness', () => {
    expect(scanSource('x.ts', 'const r = Math.random();', AMBIENT_RULES)).toHaveLength(1);
    expect(scanSource('x.ts', 'const r = randomBytes(32);', AMBIENT_RULES)).toHaveLength(1);
  });

  it('finds non-portable maths', () => {
    expect(scanSource('x.ts', 'const v = Math.exp(x);', PORTABILITY_RULES)).toHaveLength(1);
    expect(scanSource('x.ts', 'const v = Math.log(x);', PORTABILITY_RULES)).toHaveLength(1);
    expect(scanSource('x.ts', 'const v = 2 ** 32;', PORTABILITY_RULES)).toHaveLength(1);
  });

  it('permits the exactly-specified operations', () => {
    const safe = 'const v = Math.sqrt(a) + Math.floor(b) * Math.abs(c) - Math.imul(d, e);';
    expect(scanSource('x.ts', safe, PORTABILITY_RULES)).toHaveLength(0);
  });

  it('finds economic inputs', () => {
    expect(scanSource('x.ts', 'const p = config.payout;', ECONOMIC_BLINDNESS_RULES)).toHaveLength(
      1,
    );
    expect(scanSource('x.ts', 'if (brokerExposure > 0) {}', ECONOMIC_BLINDNESS_RULES)).toHaveLength(
      1,
    );
  });

  it('finds contract and expiration inputs', () => {
    expect(
      scanSource('x.ts', 'const e = ctx.selectedExpirationMs;', ECONOMIC_BLINDNESS_RULES),
    ).toHaveLength(1);
    expect(
      scanSource('x.ts', 'if (tradeDirection === 1) {}', ECONOMIC_BLINDNESS_RULES),
    ).toHaveLength(1);
  });

  it('matches inside camelCase, not only at word boundaries', () => {
    // The Cycle Audit 001 regression: `\bpayout\b` cannot match `userPayout`,
    // and `\bexpiration\b` cannot match `selectedExpirationMs`. A planted
    // `selectedExpirationMs` field passed every guardrail because of it.
    for (const source of [
      'const a = userPayout;',
      'const b = ctx.selectedExpirationMs;',
      'const c = theContractHorizonMs;',
    ]) {
      expect(scanSource('x.ts', source, ECONOMIC_BLINDNESS_RULES), source).toHaveLength(1);
    }
  });

  it('does not flag ordinary words that merely look economic', () => {
    const safe =
      'const p = stream.position(); const state = { open, high, low, close };\n' +
      'const v = volatilityContraction(range); const id = contractionId;';
    expect(scanSource('x.ts', safe, ECONOMIC_BLINDNESS_RULES)).toHaveLength(0);
  });

  it('ignores comments and string literals', () => {
    const source = [
      '// Date.now() is forbidden here',
      '/* Math.random() explained */',
      'const message = "call Date.now() for the wall clock";',
      'const template = `Math.random ${x}`;',
      'const ok = 1;',
    ].join('\n');
    expect(scanSource('x.ts', source, AMBIENT_RULES)).toHaveLength(0);
  });

  it('still sees code on the same line as a trailing comment', () => {
    expect(scanSource('x.ts', 'const t = Date.now(); // needed', AMBIENT_RULES)).toHaveLength(1);
  });

  it('preserves line numbering when stripping', () => {
    const stripped = stripCommentsAndStrings('a\n/* x\ny */\nb');
    expect(stripped.split('\n')).toHaveLength(4);
  });
});

describe('generation code is replayable', () => {
  const sources = generationSources();

  it('scans a non-empty set of files', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it('never reads ambient time outside the sanctioned clock', () => {
    const violations = sources
      .filter(({ file }) => !AMBIENT_TIME_ALLOWLIST.includes(file))
      .flatMap(({ file, source }) =>
        scanSource(file, source, AMBIENT_RULES).filter((v) => v.rule === 'no-ambient-time'),
      );
    expect(describeViolations(violations)).toBe('');
  });

  it('never reads ambient randomness', () => {
    const violations = sources.flatMap(({ file, source }) =>
      scanSource(file, source, AMBIENT_RULES).filter((v) => v.rule === 'no-ambient-randomness'),
    );
    expect(describeViolations(violations)).toBe('');
  });

  it('confines ambient time to exactly one file', () => {
    const readers = sources
      .filter(({ file, source }) =>
        scanSource(file, source, AMBIENT_RULES).some((v) => v.rule === 'no-ambient-time'),
      )
      .map(({ file }) => file);
    expect(readers).toEqual(AMBIENT_TIME_ALLOWLIST);
  });
});

describe('generation code is portable', () => {
  it('uses no implementation-approximated floating-point operation', () => {
    const violations = generationSources().flatMap(({ file, source }) =>
      scanSource(file, source, PORTABILITY_RULES),
    );
    expect(describeViolations(violations)).toBe('');
  });
});

describe('generation code is economically blind', () => {
  it('contains no economic vocabulary', () => {
    const violations = generationSources().flatMap(({ file, source }) =>
      scanSource(file, source, ECONOMIC_BLINDNESS_RULES),
    );
    expect(describeViolations(violations)).toBe('');
  });
});

describe('dependency direction', () => {
  const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

  // Import specifiers live inside string literals, which the comment stripper
  // erases, so specifiers are read from the raw text.
  function workspaceImports(source: string): string[] {
    return [...source.matchAll(IMPORT_PATTERN)]
      .map((m) => m[1]!)
      .filter((s) => s.startsWith('@otc/'));
  }

  it('keeps @otc/core free of workspace dependencies', () => {
    const offenders = listSourceFiles('packages/core/src')
      .map((file) => ({
        file,
        imports: workspaceImports(readFileSync(path.join(repoRoot, file), 'utf8')),
      }))
      .filter(({ imports }) => imports.length > 0);
    expect(offenders).toEqual([]);
  });

  it('limits @otc/lab to depending on @otc/core outside its tests', () => {
    // The battery must be able to attack any tick source without knowing what
    // produced it. A battery that can reach the generator is not an observer.
    // Its tests may import the fixture corpus — that is where calibration
    // happens — but nothing that ships may.
    const offenders = listSourceFiles('packages/lab/src')
      .filter((file) => !isTestFile(file))
      .map((file) => ({
        file,
        imports: workspaceImports(readFileSync(path.join(repoRoot, file), 'utf8')).filter(
          (s) => s !== '@otc/core' && !s.startsWith('@otc/core/'),
        ),
      }))
      .filter(({ imports }) => imports.length > 0);
    expect(offenders).toEqual([]);
  });

  it('limits @otc/engine to depending on @otc/core', () => {
    const offenders = listSourceFiles('packages/engine/src')
      .map((file) => ({
        file,
        imports: workspaceImports(readFileSync(path.join(repoRoot, file), 'utf8')).filter(
          (s) => s !== '@otc/core' && !s.startsWith('@otc/core/'),
        ),
      }))
      .filter(({ imports }) => imports.length > 0);
    expect(offenders).toEqual([]);
  });
});
