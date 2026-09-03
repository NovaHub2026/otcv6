import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSourceFiles, repoRoot } from './repository.js';
import { moduleSpecifiers, scanOptionsFor, SOURCE_EXTENSIONS } from './sourceScan.js';

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
 *
 * ## Nested modules
 *
 * **Out-of-band audit 7, a2-10.** This read one directory level and one file
 * extension, so `packages/lab/src/attacks/` — a populated directory of real
 * modules — was never checked, and a `.tsx` at the top level was not either.
 * The rule is now the one PH-15 meant: a module is on the surface when a chain
 * of barrels reaches it from `src/index.ts` — the root index re-exports a
 * directory's `index.ts`, which re-exports the module. A module no barrel
 * reaches is either declared internal here or missing. A non-barrel module's
 * own imports export nothing: only barrels export.
 */

/**
 * Modules that are deliberately not part of a package's surface, by path
 * relative to `src/`.
 *
 * Each entry is a decision, not an exemption to be widened when this test is
 * inconvenient: adding one says "nothing outside this package may use it", and
 * that is a real architectural claim.
 */
const INTERNAL: Record<string, readonly string[]> = {
  '@otc/core': [
    // A second surface, not a missing export: `@otc/core/browser` is the subpath
    // PH-8 added so a browser bundle could take the domain primitives without the
    // entropy subsystem. Re-exporting it from the main index would defeat that.
    'browser.ts',
    // The guardrails are the repository's own tests. Their lexer and walker are
    // compiled with the kernel because they live under `src/`, and nothing
    // outside this directory is meant to build on them.
    'guardrails/lifecycle.ts',
    'guardrails/repository.ts',
    'guardrails/sourceScan.ts',
    // Streams for the kernel's own tests. Found by a2-10's recursive walk:
    // nothing outside `packages/core` builds on a test fixture.
    'market/testStreams.ts',
  ],
  // The atomic-write primitive the registry and the state store share — an
  // implementation detail of persistence that both exported modules use and
  // neither exposes. Found by a2-10's walk the day it landed (f41ed6b).
  '@otc/runtime': ['atomicFile.ts'],
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
    // PH-22.1's observer load harness: a deliberate act like the two scale
    // runners beside it. Its contract is guarded by `observerLoad.test.ts`,
    // which drives it against five deliberately broken servers.
    'observerLoad.ts',
    'venueScale.ts',
  ],
};

/**
 * Workspaces with no `src/index.ts`, and therefore no barrel to check.
 *
 * An application's surface is its process — the Nest module `main.ts` boots,
 * the routes Next discovers under `app/` — not a re-export list. They are
 * enumerated so that one which grows an index joins the check, and so that a
 * package which loses its index is noticed rather than silently skipped (a2-10).
 */
const WITHOUT_INDEX = ['@otc/api', '@otc/web'];

interface Package {
  readonly name: string;
  readonly dir: string;
}

function enumerate(): { readonly withIndex: Package[]; readonly withoutIndex: string[] } {
  const withIndex: Package[] = [];
  const withoutIndex: string[] = [];
  for (const group of ['packages', 'tools', 'apps']) {
    const base = path.join(repoRoot, group);
    for (const entry of readdirSync(base)) {
      const dir = path.join(base, entry);
      const manifest = path.join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string };
      if (existsSync(path.join(dir, 'src/index.ts'))) withIndex.push({ name: parsed.name, dir });
      else withoutIndex.push(parsed.name);
    }
  }
  return {
    withIndex: withIndex.sort((a, b) => a.name.localeCompare(b.name)),
    withoutIndex: withoutIndex.sort(),
  };
}

function isBarrel(relative: string): boolean {
  return /(?:^|\/)index\.(?:ts|tsx|mts|cts)$/.test(relative);
}

/** Every non-test, non-barrel module under `src/`, at any depth, relative to `src/`. */
function modules(pkg: Package): string[] {
  const src = path.relative(repoRoot, path.join(pkg.dir, 'src'));
  return listSourceFiles(src, { includeTests: false })
    .map((file) => path.relative(src, file).split(path.sep).join('/'))
    .filter((relative) => !isBarrel(relative))
    .sort();
}

/** The file a relative specifier in `from` names, relative to `src/`, or `null`. */
function resolveModule(src: string, from: string, specifier: string): string | null {
  const target = path.resolve(src, path.dirname(from), specifier);
  const candidates = [
    ...SOURCE_EXTENSIONS.map((extension) => target.replace(/\.js$/, extension)),
    ...SOURCE_EXTENSIONS.map((extension) => target + extension),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(target, `index${extension}`)),
  ];
  const found = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  return found === undefined ? null : path.relative(src, found).split(path.sep).join('/');
}

/**
 * Modules reachable from `src/index.ts` through barrels only.
 *
 * A barrel's every relative specifier counts, `import … from` as well as
 * `export … from`: an index that imports a module to re-export its names
 * exports it. A non-barrel module is a leaf — reaching it exports it, and its
 * own imports export nothing.
 */
function reachable(pkg: Package): Set<string> {
  const src = path.join(pkg.dir, 'src');
  const seen = new Set<string>();
  const queue = ['index.ts'];
  while (queue.length > 0) {
    const barrel = queue.pop()!;
    if (seen.has(barrel)) continue;
    seen.add(barrel);
    const file = path.join(src, barrel);
    for (const specifier of moduleSpecifiers(readFileSync(file, 'utf8'), scanOptionsFor(file))) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveModule(src, barrel, specifier);
      if (resolved === null) continue;
      if (isBarrel(resolved)) queue.push(resolved);
      else seen.add(resolved);
    }
  }
  return seen;
}

const { withIndex, withoutIndex } = enumerate();

describe('a package exports what it builds', () => {
  it('finds packages with a public surface', () => {
    expect(withIndex.length).toBeGreaterThanOrEqual(6);
  });

  it('knows which workspaces have no surface to check, and they are the applications', () => {
    expect(withoutIndex).toEqual([...WITHOUT_INDEX].sort());
  });

  it.each(withIndex.map((p) => [p.name, p] as const))('%s re-exports every module', (name, pkg) => {
    const internal = new Set(INTERNAL[name] ?? []);
    const exported = reachable(pkg);
    const missing = modules(pkg).filter((module) => !exported.has(module) && !internal.has(module));
    expect(
      missing,
      `${name} builds these and no barrel reaches them; either re-export them from an index ` +
        `that src/index.ts reaches, or declare them internal in this file's INTERNAL map`,
    ).toEqual([]);
  });

  it('declares nothing internal that does not exist', () => {
    // An entry naming a deleted file is a claim about nothing, and it would go
    // on silently excusing whatever later took that name.
    const stale: string[] = [];
    for (const [name, entries] of Object.entries(INTERNAL)) {
      const pkg = withIndex.find((p) => p.name === name);
      if (pkg === undefined) {
        stale.push(`${name} (no such package)`);
        continue;
      }
      const present = new Set(modules(pkg));
      for (const module of entries) {
        if (!present.has(module)) stale.push(`${name}/${module}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('declares nothing internal that a barrel exports anyway', () => {
    // "Nothing outside may use it" and "the index exports it" cannot both be
    // true; one of them is stale.
    const contradicted: string[] = [];
    for (const [name, entries] of Object.entries(INTERNAL)) {
      const pkg = withIndex.find((p) => p.name === name);
      if (pkg === undefined) continue;
      const exported = reachable(pkg);
      for (const module of entries) {
        if (exported.has(module)) contradicted.push(`${name}/${module}`);
      }
    }
    expect(contradicted).toEqual([]);
  });
});
