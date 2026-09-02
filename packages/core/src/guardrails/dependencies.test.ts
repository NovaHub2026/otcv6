import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSourceFiles, repoRoot } from './repository.js';
import {
  importSpecifiers,
  isTestFile,
  scanOptionsFor,
  SHIPPED_EXTENSIONS,
  stripCommentsKeepingStrings,
} from './sourceScan.js';

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

/** Node's own modules, with or without the `node:` prefix. */
const NODE_BUILTINS: ReadonlySet<string> = new Set(
  builtinModules.map((name) => name.replace(/^node:/, '')),
);

interface Alias {
  /** A specifier, or a pattern with one `*`. */
  readonly pattern: string;
  /** What it stands for; a relative target is resolved against `base`. */
  readonly target: string;
  readonly base: string;
  readonly origin: string;
}

interface Workspace {
  readonly name: string;
  /** `packages`, `tools` or `apps`. Frameworks are permitted only in `apps`. */
  readonly group: string;
  readonly dir: string;
  /**
   * Every dependency field.
   *
   * **a2-12.** This read `dependencies` and `devDependencies`, so an edge
   * declared under `peerDependencies` or `optionalDependencies` was neither
   * policed by {@link ALLOWED} nor walked by the cycle check. A peer dependency
   * is still a dependency.
   */
  readonly declared: readonly string[];
  /**
   * Specifier rewrites the toolchain honours before an import resolves:
   * `compilerOptions.paths` in the workspace's tsconfig, and the `imports`
   * field of its manifest (a2-12). A rule applied to the specifier as written
   * and not as resolved is a rule an alias walks past.
   */
  readonly aliases: readonly Alias[];
}

interface Manifest {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly imports?: Record<string, string | Record<string, string>>;
}

interface TsConfig {
  readonly extends?: string;
  readonly compilerOptions?: {
    readonly baseUrl?: string;
    readonly paths?: Record<string, readonly string[]>;
  };
}

/** A tsconfig may carry comments, which the JSON parser may not see. */
function readJsonWithComments<T>(file: string): T {
  return JSON.parse(stripCommentsKeepingStrings(readFileSync(file, 'utf8'))) as T;
}

/** `compilerOptions.paths`, following `extends` until a file defines them. */
function tsconfigPaths(dir: string): Alias[] {
  let file = path.join(dir, 'tsconfig.json');
  for (let hops = 0; hops < 8 && existsSync(file); hops += 1) {
    const config = readJsonWithComments<TsConfig>(file);
    const paths = config.compilerOptions?.paths;
    if (paths !== undefined) {
      const base = path.resolve(path.dirname(file), config.compilerOptions?.baseUrl ?? '.');
      const origin = `${path.relative(repoRoot, file)} paths`;
      return Object.entries(paths).flatMap(([pattern, targets]) =>
        targets.length === 0 ? [] : [{ pattern, target: targets[0]!, base, origin }],
      );
    }
    if (config.extends === undefined) break;
    file = path.resolve(path.dirname(file), config.extends);
  }
  return [];
}

/** The manifest's `imports` field: `#name` subpaths, possibly conditional. */
function manifestImports(dir: string, manifest: Manifest): Alias[] {
  const aliases: Alias[] = [];
  for (const [pattern, value] of Object.entries(manifest.imports ?? {})) {
    const target = typeof value === 'string' ? value : (value.default ?? Object.values(value)[0]);
    if (target === undefined) continue;
    aliases.push({ pattern, target, base: dir, origin: 'package.json imports' });
  }
  return aliases;
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
      if (!statSync(dir).isDirectory()) continue;
      const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest;
      found.push({
        name: manifest.name,
        group,
        dir,
        declared: [
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.devDependencies ?? {}),
          ...Object.keys(manifest.peerDependencies ?? {}),
          ...Object.keys(manifest.optionalDependencies ?? {}),
        ],
        aliases: [...tsconfigPaths(dir), ...manifestImports(dir, manifest)],
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Tooling every workspace may use from the root manifest — `vitest` above all.
 * Hoisted, so a test importing it works; declared at the root, so it is not an
 * undeclared dependency. Only tests may lean on it: shipped code that imports
 * a root dev dependency is shipped code with an undeclared dependency.
 */
function rootTooling(): ReadonlySet<string> {
  const root = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as Manifest;
  return new Set(Object.keys(root.devDependencies ?? {}));
}

/**
 * Every file that ships from `src/`.
 *
 * **Cycle Audit 6, CA6-12.** This read only `.ts`, so seven of `apps/web`'s nine
 * files — every React component, including the whole browser bundle — were never
 * opened. The extensions now come from the one shared list (a2-03), and that
 * list includes `.js`: a checked-in `.js` under `src/` is still code the package
 * publishes, and `import '@otc/lab'` in one was invisible (a2-12, D-14).
 */
function sourceFiles(workspace: Workspace): string[] {
  const src = path.relative(repoRoot, path.join(workspace.dir, 'src'));
  return listSourceFiles(src, { extensions: SHIPPED_EXTENSIONS }).map((file) =>
    path.join(repoRoot, file),
  );
}

/** The alias a specifier matches and what it resolves to, or `null` for none. */
export function resolveAlias(
  specifier: string,
  aliases: readonly Alias[],
): { readonly resolved: string; readonly alias: Alias } | null {
  for (const alias of aliases) {
    const star = alias.pattern.indexOf('*');
    let captured: string | null = null;
    if (star === -1) {
      if (specifier === alias.pattern) captured = '';
    } else {
      const prefix = alias.pattern.slice(0, star);
      const suffix = alias.pattern.slice(star + 1);
      if (
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix) &&
        specifier.length >= prefix.length + suffix.length
      ) {
        captured = specifier.slice(prefix.length, specifier.length - suffix.length);
      }
    }
    if (captured === null) continue;
    const target = alias.target.replace('*', captured);
    const resolved = /^[./]/.test(target) ? path.resolve(alias.base, target) : target;
    return { resolved, alias };
  }
  return null;
}

interface Resolved {
  /** The specifier as the toolchain resolves it: bare, or an absolute path. */
  readonly specifier: string;
  /** How it was written, when an alias rewrote it. */
  readonly via?: string;
}

/** A file's literal specifiers with aliases resolved, and its computed ones. */
function specifiersOf(
  file: string,
  workspace: Workspace,
): { readonly resolved: Resolved[]; readonly computed: readonly string[] } {
  const found = importSpecifiers(readFileSync(file, 'utf8'), scanOptionsFor(file));
  const resolved = found.literal.map((specifier): Resolved => {
    const match = resolveAlias(specifier, workspace.aliases);
    if (match === null) {
      return {
        specifier: specifier.startsWith('.')
          ? path.resolve(path.dirname(file), specifier)
          : specifier,
      };
    }
    return { specifier: match.resolved, via: `${specifier} (${match.alias.origin})` };
  });
  return { resolved, computed: found.computed };
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

function isNodeBuiltin(specifier: string): boolean {
  return NODE_BUILTINS.has(packageOf(specifier.replace(/^node:/, '')));
}

function shown(file: string, entry: Resolved): string {
  const target = path.isAbsolute(entry.specifier)
    ? path.relative(repoRoot, entry.specifier)
    : entry.specifier;
  const via = entry.via === undefined ? '' : ` via ${entry.via}`;
  return `${path.relative(repoRoot, file)} imports ${target}${via}`;
}

const all = workspaces();
const tooling = rootTooling();

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
      //
      // **a2-12.** This checked `@otc/*` only, so `import 'lodash'` in
      // `trading` was nobody's business. Below `apps/` every bare specifier
      // must now be declared — by the workspace, or for a test file by the root
      // manifest's tooling. The applications keep the internal rule only:
      // their frameworks bring transitive packages a manifest never names.
      const permitted = new Set(workspace.declared);
      const offenders: string[] = [];
      for (const file of sourceFiles(workspace)) {
        for (const entry of specifiersOf(file, workspace).resolved) {
          if (path.isAbsolute(entry.specifier)) continue;
          const pkg = packageOf(entry.specifier);
          if (permitted.has(pkg)) continue;
          if (pkg.startsWith('@otc/')) {
            offenders.push(shown(file, entry));
            continue;
          }
          if (workspace.group === 'apps' || isNodeBuiltin(entry.specifier)) continue;
          if (isTestFile(path.basename(file)) && tooling.has(pkg)) continue;
          offenders.push(`${shown(file, entry)} (undeclared)`);
        }
      }
      expect(offenders, `${name} has undeclared imports`).toEqual([]);
    },
  );

  // Frameworks are permitted in `apps/` and nowhere else — that is the rule's
  // whole content. Before Cycle Audit 4 it read as "every workspace", which was
  // accidentally correct only because `apps/` was never enumerated.
  it.each(all.filter((w) => w.group !== 'apps').map((w) => [w.name, w] as const))(
    '%s imports no framework or server',
    (name, workspace) => {
      const offenders: string[] = [];
      for (const file of sourceFiles(workspace)) {
        for (const entry of specifiersOf(file, workspace).resolved) {
          if (!path.isAbsolute(entry.specifier) && FORBIDDEN_BELOW_APPS.test(entry.specifier)) {
            offenders.push(shown(file, entry));
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
      // `../../trading/dist/index.js` is a dependency by any honest reading, and
      // it bypassed the allowlist, the TypeScript project graph and lint
      // simultaneously because none of them treat a relative path as a
      // dependency edge. An alias whose target is a path is the same edge with
      // a shorter name (a2-12).
      const offenders: string[] = [];
      for (const file of sourceFiles(workspace)) {
        for (const entry of specifiersOf(file, workspace).resolved) {
          if (!path.isAbsolute(entry.specifier)) continue;
          if (!entry.specifier.startsWith(workspace.dir + path.sep)) {
            offenders.push(shown(file, entry));
          }
        }
      }
      expect(
        offenders,
        `${name} reaches outside itself without declaring a dependency — a relative path into ` +
          `another package's dist/ satisfies none of the allowlist, the build graph or lint`,
      ).toEqual([]);
    },
  );

  it.each(all.filter((w) => w.group !== 'apps').map((w) => [w.name, w] as const))(
    '%s writes no import specifier that is computed at run time',
    (name, workspace) => {
      // **a2-12, D-06 and D-07.** `import(spec)` and
      // `import(['@otc', 'lab'].join('/'))` name their target only when they
      // run. No scan can say what they reach, so below `apps/` there are none:
      // every specifier is a literal the rules above can read.
      const offenders: string[] = [];
      for (const file of sourceFiles(workspace)) {
        for (const argument of specifiersOf(file, workspace).computed) {
          offenders.push(`${path.relative(repoRoot, file)} imports (${argument})`);
        }
      }
      expect(offenders, `${name} has import specifiers no scan can read`).toEqual([]);
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

describe('an alias is judged by what it resolves to (a2-12: D-09, D-10)', () => {
  const trading = path.join(repoRoot, 'packages/trading');
  const aliases: Alias[] = [
    { pattern: 'otc-lab-alias', target: '../lab/src/index.ts', base: trading, origin: 'paths' },
    { pattern: '#lab', target: '@otc/lab', base: trading, origin: 'imports' },
    { pattern: '@app/*', target: './src/*', base: trading, origin: 'paths' },
    { pattern: '#deep/*', target: '@otc/engine/*', base: trading, origin: 'imports' },
  ];

  it('resolves a path alias to the path, so the escape rule sees it', () => {
    const match = resolveAlias('otc-lab-alias', aliases);
    expect(match?.resolved).toBe(path.join(repoRoot, 'packages/lab/src/index.ts'));
    expect(match!.resolved.startsWith(trading + path.sep)).toBe(false);
  });

  it('resolves a bare alias to the package, so the direction rule sees it', () => {
    expect(resolveAlias('#lab', aliases)?.resolved).toBe('@otc/lab');
    expect(packageOf(resolveAlias('#deep/thing', aliases)!.resolved)).toBe('@otc/engine');
  });

  it('substitutes a wildcard, and a target inside the package stays inside it', () => {
    expect(resolveAlias('@app/settle.js', aliases)?.resolved).toBe(
      path.join(trading, 'src/settle.js'),
    );
  });

  it('leaves an ordinary specifier alone', () => {
    expect(resolveAlias('@otc/core', aliases)).toBeNull();
    expect(resolveAlias('./settle.js', aliases)).toBeNull();
  });

  it('reads the aliases a workspace declares — none, today', () => {
    // Asserted so that the first alias to appear is judged by the rules above
    // from the day it lands, and so that this test is known to have read the
    // manifests and tsconfigs rather than found nothing by accident.
    for (const workspace of all) expect(workspace.aliases, workspace.name).toEqual([]);
    expect(
      tsconfigPaths(path.join(repoRoot, 'packages/trading')),
      'tsconfigPaths must follow extends to the base config and find no paths there',
    ).toEqual([]);
  });
});
