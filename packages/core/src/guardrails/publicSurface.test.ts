import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every module a package builds is reachable from its public surface.
 *
 * PH-15 found `failover.ts` — `LeaderSession`, the whole PH-14.3 leader loop —
 * missing from `@otc/runtime`'s index, and found it only because the integrated
 * test in `tools/sim` happened to import it. Nothing else would have: tests
 * inside a package import their neighbours by relative path, so a module can be
 * complete, tested, approved and unreachable from outside all at once.
 *
 * The cause is the project's most-repeated one. An edit added the export block
 * and its anchor no longer matched, because Prettier had reformatted the
 * surrounding lines — the same re-padding that silently defeated six edits to
 * `CURRENT_STATE.md` between PH-4 and PH-6. The edit reported success and did
 * nothing.
 *
 * So the surface is checked rather than trusted. A module that is genuinely
 * internal says so by name, which is a decision someone has to write down.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/**
 * Modules that are deliberately not part of a package's surface.
 *
 * Each entry is a decision, not an exemption to be widened when this test is
 * inconvenient: adding one says "nothing outside this package may use it", and
 * that is a real architectural claim.
 */
const INTERNAL: Record<string, readonly string[]> = {
  // A second surface, not a missing export: `@otc/core/browser` is the subpath
  // PH-8 added so a browser bundle could take the domain primitives without the
  // entropy subsystem. Re-exporting it from the main index would defeat that.
  '@otc/core': ['browser.ts'],
  // The unseeded scaffolding every planted-edge fixture is built on. It is not
  // a fixture and produces no market; exporting it would invite something
  // outside the corpus to build on it.
  '@otc/fixtures': ['base.ts'],
  // A binary entry point and the evidence generators it drives. `@otc/sim` is a
  // tool: nothing imports it, and its surface is the `otc-sim` command plus the
  // statistical tests in the same package. `catalogueScale.ts` and
  // `venueScale.ts` are PH-21's deliberate-act runners, each minutes long and
  // each recorded in `docs/evidence/`; the gate guards the same properties
  // through `catalogueScale.stat.test.ts` at a scale it can afford.
  '@otc/sim': [
    'catalogueScale.ts',
    'cli.ts',
    'dispersionEvidence.ts',
    'horizonCoverage.ts',
    'horizonEvidence.ts',
    'venueScale.ts',
  ],
};

interface Package {
  readonly name: string;
  readonly dir: string;
}

function packages(): Package[] {
  const found: Package[] = [];
  for (const group of ['packages', 'tools']) {
    const base = path.join(repoRoot, group);
    for (const entry of readdirSync(base)) {
      const dir = path.join(base, entry);
      const manifest = path.join(dir, 'package.json');
      const index = path.join(dir, 'src/index.ts');
      if (!existsSync(manifest) || !existsSync(index)) continue;
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string };
      found.push({ name: parsed.name, dir });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Top-level modules under `src/`, excluding tests and the index itself. */
function topLevelModules(dir: string): string[] {
  const src = path.join(dir, 'src');
  return readdirSync(src)
    .filter(
      (entry) =>
        entry.endsWith('.ts') &&
        !entry.endsWith('.test.ts') &&
        !entry.endsWith('.d.ts') &&
        entry !== 'index.ts',
    )
    .sort();
}

/** Modules the index re-exports, by file name. */
function reExported(dir: string): Set<string> {
  const source = readFileSync(path.join(dir, 'src/index.ts'), 'utf8');
  const found = new Set<string>();
  for (const match of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
    found.add(match[1]!.replace(/\.js$/, '.ts'));
  }
  return found;
}

const all = packages();

describe('a package exports what it builds', () => {
  it('finds packages with a public surface', () => {
    expect(all.length).toBeGreaterThanOrEqual(6);
  });

  it.each(all.map((p) => [p.name, p] as const))('%s re-exports every module', (name, pkg) => {
    const internal = new Set(INTERNAL[name] ?? []);
    const exported = reExported(pkg.dir);
    const missing = topLevelModules(pkg.dir).filter(
      (module) => !exported.has(module) && !internal.has(module),
    );
    expect(
      missing,
      `${name} builds these and does not export them; either add them to src/index.ts or ` +
        `declare them internal in this file's INTERNAL map`,
    ).toEqual([]);
  });

  it('declares nothing internal that does not exist', () => {
    // An entry naming a deleted file is a claim about nothing, and it would go
    // on silently excusing whatever later took that name.
    const stale: string[] = [];
    for (const [name, modules] of Object.entries(INTERNAL)) {
      const pkg = all.find((p) => p.name === name);
      if (pkg === undefined) {
        stale.push(`${name} (no such package)`);
        continue;
      }
      const present = new Set(topLevelModules(pkg.dir));
      for (const module of modules) {
        if (!present.has(module)) stale.push(`${name}/${module}`);
      }
    }
    expect(stale).toEqual([]);
  });
});
