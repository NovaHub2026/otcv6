import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { moduleSpecifiers } from './sourceScan.js';

/**
 * Dependency direction.
 *
 * The economic-blindness scan checks *vocabulary*: it would catch a `payout`
 * field arriving in the magnitude path. It cannot catch the other way this
 * erodes — the engine acquiring a dependency it should not have, on a web
 * framework, on a persistence layer, or on an application.
 *
 * PH-5 makes that risk concrete for the first time, because it introduces a
 * runtime and a NestJS service. The rule that keeps the batteries able to drive
 * the engine directly is that dependencies only ever point *down*: an app may
 * depend on the runtime, the runtime on the engine, the engine on the kernel,
 * and never the reverse.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/** What each workspace package is permitted to depend on. */
const ALLOWED: Record<string, readonly string[]> = {
  '@otc/core': [],
  '@otc/engine': ['@otc/core'],
  '@otc/fixtures': ['@otc/core'],
  '@otc/lab': ['@otc/core', '@otc/fixtures'],
  '@otc/runtime': ['@otc/core', '@otc/engine'],
  '@otc/trading': ['@otc/core'],
  '@otc/distribution': ['@otc/core'],
  '@otc/chart': ['@otc/core'],
  '@otc/api': ['@otc/core', '@otc/engine', '@otc/runtime', '@otc/distribution', '@otc/chart'],
  // The browser bundle. `@otc/lab` and `@otc/fixtures` must never appear here:
  // one carries the attack battery, the other the planted-defect corpus.
  '@otc/web': ['@otc/core', '@otc/chart'],
  '@otc/sim': [
    '@otc/core',
    '@otc/engine',
    '@otc/fixtures',
    '@otc/lab',
    '@otc/runtime',
    '@otc/trading',
    '@otc/distribution',
    '@otc/chart',
  ],
};

/**
 * Module specifiers no package under `packages/` may import.
 *
 * Frameworks and servers belong above the runtime, in `apps/`. A package that
 * imports one cannot be driven by a battery in a plain Node process any more.
 */
const FORBIDDEN_BELOW_APPS =
  /^(@nestjs\/|next(\/|$)|react(\/|$)|react-dom|express(\/|$)|fastify(\/|$)|socket\.io)/;

interface Workspace {
  readonly name: string;
  /** `packages`, `tools` or `apps`. Frameworks are permitted only in `apps`. */
  readonly group: string;
  readonly dir: string;
  readonly declared: readonly string[];
}

/**
 * Every workspace, **including `apps/`**.
 *
 * Cycle Audit 4 found this enumerating `packages` and `tools` only, which made
 * the `'@otc/api'` entry in {@link ALLOWED} unenforced configuration that reads
 * as policy, and left `'@otc/web'` with no entry at all. An auditor planted
 * `@otc/lab` into `apps/api/package.json` — a dependency that would drag the
 * planted-defect fixture corpus into the running venue — and the guard stayed
 * silent through 38 passing tests. The control plant into `packages/trading`
 * fired correctly, so the rule worked; it simply never looked at `apps/`.
 *
 * That is the project's most repeated defect once more: a guard that exists, is
 * documented as sufficient, and has a blind spot exactly one directory wide.
 */
function workspaces(): Workspace[] {
  const found: Workspace[] = [];
  for (const group of ['packages', 'tools', 'apps']) {
    const base = path.join(repoRoot, group);
    for (const entry of readdirSync(base)) {
      const dir = path.join(base, entry);
      const manifest = path.join(dir, 'package.json');
      if (!statSync(dir).isDirectory()) continue;
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      found.push({
        name: parsed.name,
        group,
        dir,
        declared: [
          ...Object.keys(parsed.dependencies ?? {}),
          ...Object.keys(parsed.devDependencies ?? {}),
        ],
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What counts as a source file here.
 *
 * **Cycle Audit 6, CA6-12.** This read only `.ts`, so seven of `apps/web`'s nine
 * files — every React component, including the whole browser bundle — were never
 * opened. An auditor imported `@otc/fixtures`, the planted-defect corpus, into
 * the shipped panel and every check in the repository stayed green; the same
 * import into a `.ts` file two directories away was caught by name.
 *
 * `.mts`/`.cts` are included for the same reason `.tsx` now is: the guard should
 * fail because a rule was broken, never because of how a file was spelled.
 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const child = path.join(absolute, entry);
      if (statSync(child).isDirectory()) walk(child);
      else if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(child);
    }
  };
  const src = path.join(dir, 'src');
  walk(src);
  return found;
}

function allSpecifiers(file: string): string[] {
  return moduleSpecifiers(readFileSync(file, 'utf8'));
}

/** Bare specifiers only: package names, not relative paths. */
function importedModules(file: string): string[] {
  return allSpecifiers(file).filter((specifier) => !specifier.startsWith('.'));
}

/**
 * The package a specifier belongs to.
 *
 * `@otc/core/browser` is a dependency on `@otc/core`. PH-8 introduced that
 * subpath so a browser bundle could take the domain primitives without the
 * entropy subsystem, and the allowlist compares package names rather than
 * import paths.
 */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/**
 * Relative specifiers that leave their own package.
 *
 * `../../trading/dist/index.js` is a dependency by any honest reading, and it
 * bypassed the allowlist, the TypeScript project graph and lint simultaneously
 * because none of them treat a relative path as a dependency edge.
 */
function escapingRelativeImports(file: string, packageDir: string): string[] {
  const offenders: string[] = [];
  for (const specifier of allSpecifiers(file)) {
    if (!specifier.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(file), specifier);
    if (!resolved.startsWith(packageDir + path.sep)) {
      offenders.push(`${path.relative(repoRoot, file)} imports ${specifier}`);
    }
  }
  return offenders;
}

const all = workspaces();

describe('dependencies only point down', () => {
  it('finds every workspace', () => {
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const workspace of all) {
      expect(Object.keys(ALLOWED), `${workspace.name} has no declared policy`).toContain(
        workspace.name,
      );
    }
  });

  it.each(all.map((w) => [w.name, w] as const))(
    '%s declares only what it may',
    (name, workspace) => {
      const internal = workspace.declared
        .filter((dependency) => dependency.startsWith('@otc/'))
        .map(packageOf);
      const permitted = ALLOWED[name] ?? [];
      for (const dependency of internal) {
        expect(permitted, `${name} may not depend on ${dependency}`).toContain(dependency);
      }
    },
  );

  it.each(all.map((w) => [w.name, w] as const))(
    '%s imports nothing it has not declared',
    (name, workspace) => {
      // Workspace hoisting makes an undeclared dependency work anyway, right up
      // until the package is built or published on its own.
      const permitted = new Set(workspace.declared);
      const offenders: string[] = [];
      for (const file of sourceFiles(workspace.dir)) {
        for (const specifier of importedModules(file)) {
          if (!specifier.startsWith('@otc/')) continue;
          if (!permitted.has(packageOf(specifier))) {
            offenders.push(`${path.relative(repoRoot, file)} imports ${specifier}`);
          }
        }
      }
      expect(offenders, `${name} has undeclared internal imports`).toEqual([]);
    },
  );

  // Frameworks are permitted in `apps/` and nowhere else — that is the rule's
  // whole content. Before Cycle Audit 4 it read as "every workspace", which was
  // accidentally correct only because `apps/` was never enumerated.
  it.each(all.filter((w) => w.group !== 'apps').map((w) => [w.name, w] as const))(
    '%s imports no framework or server',
    (name, workspace) => {
      const offenders: string[] = [];
      for (const file of sourceFiles(workspace.dir)) {
        for (const specifier of importedModules(file)) {
          if (FORBIDDEN_BELOW_APPS.test(specifier)) {
            offenders.push(`${path.relative(repoRoot, file)} imports ${specifier}`);
          }
        }
      }
      expect(
        offenders,
        `${name} is below apps/ and must stay drivable from a plain Node process`,
      ).toEqual([]);
    },
  );

  it.each(all.map((w) => [w.name, w] as const))(
    '%s never reaches into another package by relative path',
    (name, workspace) => {
      const offenders = sourceFiles(workspace.dir).flatMap((file) =>
        escapingRelativeImports(file, workspace.dir),
      );
      expect(
        offenders,
        `${name} reaches outside itself without declaring a dependency — a relative path into ` +
          `another package's dist/ satisfies none of the allowlist, the build graph or lint`,
      ).toEqual([]);
    },
  );

  it('has no cycle', () => {
    // **Cycle Audit 4, m-7.** This walked `ALLOWED` — a constant in this file —
    // so it only ever tested whether someone had written a cycle into the
    // policy. An auditor declared a real `core <-> engine` cycle in both
    // `package.json` manifests and this test stayed green; a sibling test caught
    // it, but this one, whose entire subject is cycles, did not.
    //
    // The graph now comes from the manifests, which is where a cycle would
    // actually be introduced. `ALLOWED` is still the policy; the *edges* are
    // what the repository declares.
    const internal = (workspace: Workspace): string[] =>
      workspace.declared.filter((d) => d.startsWith('@otc/'));
    const edges = new Map(all.map((w) => [w.name, internal(w)]));
    const state = new Map<string, 'open' | 'done'>();
    const visit = (node: string, trail: string[]): void => {
      if (state.get(node) === 'done') return;
      if (state.get(node) === 'open') {
        expect.unreachable(`dependency cycle: ${[...trail, node].join(' -> ')}`);
      }
      state.set(node, 'open');
      for (const next of edges.get(node) ?? []) visit(next, [...trail, node]);
      state.set(node, 'done');
    };
    for (const workspace of all) visit(workspace.name, []);
    expect([...state.values()].every((v) => v === 'done')).toBe(true);
  });
});
