import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
  '@otc/sim': [
    '@otc/core',
    '@otc/engine',
    '@otc/fixtures',
    '@otc/lab',
    '@otc/runtime',
    '@otc/trading',
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
  readonly dir: string;
  readonly declared: readonly string[];
}

function workspaces(): Workspace[] {
  const found: Workspace[] = [];
  for (const group of ['packages', 'tools']) {
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

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const child = path.join(absolute, entry);
      if (statSync(child).isDirectory()) walk(child);
      else if (entry.endsWith('.ts')) found.push(child);
    }
  };
  const src = path.join(dir, 'src');
  walk(src);
  return found;
}

/** Bare module specifiers imported by a file, excluding relative paths. */
function importedModules(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1]!;
    if (specifier.startsWith('.')) continue;
    specifiers.push(specifier);
  }
  return specifiers;
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
      const internal = workspace.declared.filter((dependency) => dependency.startsWith('@otc/'));
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
          if (!permitted.has(specifier)) {
            offenders.push(`${path.relative(repoRoot, file)} imports ${specifier}`);
          }
        }
      }
      expect(offenders, `${name} has undeclared internal imports`).toEqual([]);
    },
  );

  it.each(all.map((w) => [w.name, w] as const))(
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

  it('has no cycle', () => {
    const edges = new Map(all.map((w) => [w.name, (ALLOWED[w.name] ?? []).slice()]));
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
