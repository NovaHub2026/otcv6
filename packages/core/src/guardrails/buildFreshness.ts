import path from 'node:path';

/**
 * Whether a suite that spawns a built entry point is running against this
 * source or against the last build.
 *
 * ## The defect
 *
 * Seven `apps/api` statistical suites, one `packages/runtime` unit test and the
 * two browser suites spawn a `dist/` entry as a child process. Vitest resolves
 * workspace imports to TypeScript **sources**, so nothing else in a run depends
 * on `dist/` — which is exactly why a stale one is invisible. Cycle Audit 10
 * (a2-06) planted a 503 into `market.controller.ts`'s readiness route, left
 * `dist/` unbuilt, and `conformance.stat.test.ts` reported
 * `| ready | pass | GET /health/ready answered 200 |`; a second plant in the
 * history route passed the same way. The suite written to catch a regression
 * reported on the build before it, and said nothing about doing so. The full
 * gate builds first, so this bites precisely the targeted runs `GOVERNANCE.md`
 * §21 allows during subphase work — what an implementer and an auditor do all
 * day.
 *
 * ## Why `tsc -b --dry`, and why the whole graph
 *
 * Comparing mtimes is what PH-28.1 replaced: a `git checkout` that rewrites an
 * unchanged file bumps the source's mtime while the incremental build, seeing
 * the same content hash, rightly emits nothing. `tsc -b --dry` answers from its
 * own bookkeeping in about a third of a second.
 *
 * It has **three** verdicts, not two, and Cycle Audit 10 (a2-05) found the
 * replacement reading only the first:
 *
 * - `Project '…' is up to date` — nothing to do.
 * - `A non-dry build would update timestamps for output of project '…'` —
 *   inputs are newer, content is identical. The build is current; only the
 *   stamps are behind. The guard read this as stale, so a `touch`, a branch
 *   switch or the `git checkout -- .` that reverts a plant turned it red on a
 *   clean tree with a complete build.
 * - `A non-dry build would build project '…'` — the emitted output does not
 *   match the source. This, and only this, is a stale build.
 *
 * The verdict is taken over the **whole build graph** rather than over the
 * spawned project alone, because that is where the false green lives. A content
 * edit in `packages/core` left unbuilt makes `tools/sim`'s own line read
 * `would update timestamps` — its `dist/` really is current — while the process
 * it spawns loads `packages/core/dist`, which is not. Measured on 2026-09-06:
 * one line said `would build` (core) and nine said `would update timestamps`.
 * A rule that accepted both wordings *for the spawned project only* — the
 * literal fix a2-05 proposed — would have passed that tree.
 */

/** Directory groups a workspace can live in. */
const WORKSPACE_GROUPS = ['packages', 'apps', 'tools'];

/**
 * A `dist/` under a named workspace: `apps/api/dist/main.js`,
 * `packages/runtime/dist/sqliteStore.js`.
 *
 * The leading character class keeps `../../trading/dist/index.js` — a mutation
 * payload in two test files, not a path this repository spawns — from reading
 * as `packages/trading`.
 */
const NAMED_DIST = /(?:^|[^A-Za-z0-9_.\-/])(packages|apps|tools)\/([A-Za-z0-9][\w.-]*)\/dist\//g;

/** A `dist/` reached from the test file's own directory: `path.resolve(here, '../dist/main.js')`. */
const RELATIVE_DIST = /(?:^|[^A-Za-z0-9_.\-/])((?:\.\.\/)+)dist\//g;

/** POSIX form, so a Windows separator cannot make a path stop matching. */
function toPosix(file: string): string {
  return file.split(path.sep).join('/');
}

/** `apps/api` for a path inside it, or `null` when the path is not a workspace root. */
function asWorkspace(candidate: string): string | null {
  const segments = candidate.split('/').filter((segment) => segment !== '');
  if (segments.length !== 2) return null;
  const [group, name] = segments;
  if (group === undefined || name === undefined) return null;
  return WORKSPACE_GROUPS.includes(group) ? `${group}/${name}` : null;
}

/**
 * The workspaces whose build a test file depends on, from the paths it names.
 *
 * A `dist/` path in a comment counts, deliberately: a file that talks about a
 * built entry is a file that depends on one, and the cost of being wrong is one
 * extra third of a second.
 */
export function projectsSpawnedBy(testFile: string, source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(NAMED_DIST)) found.add(`${match[1]!}/${match[2]!}`);
  const directory = path.posix.dirname(toPosix(testFile));
  for (const match of source.matchAll(RELATIVE_DIST)) {
    const workspace = asWorkspace(path.posix.normalize(path.posix.join(directory, match[1]!)));
    if (workspace !== null) found.add(workspace);
  }
  return [...found].sort();
}

/** What a `tsc -b <project> --dry` report says about a build. */
export interface BuildVerdict {
  /** The workspace asked about, e.g. `apps/api`. */
  readonly project: string;
  /** Whether the report mentions that project at all. A silent report is not a pass. */
  readonly reported: boolean;
  /** Projects in the graph whose emitted output does not match their source. */
  readonly wouldBuild: readonly string[];
}

const WOULD_BUILD = /would build project '([^']+)'/g;
/**
 * Any project the report speaks about. Case-insensitive: `tsc` writes
 * `Project '…' is up to date` with a capital and `would build project '…'`
 * without one, and reading only the lower-case spelling made a clean
 * up-to-date report look like a report that never mentioned the project.
 */
const ANY_PROJECT = /project '([^']+)'/gi;

/** `packages/core` from `/home/…/packages/core/tsconfig.json`. */
function shortProject(tsconfig: string): string {
  const parts = toPosix(tsconfig)
    .split('/')
    .filter((segment) => segment !== '');
  return parts.slice(-3, -1).join('/');
}

export function readBuildVerdict(project: string, report: string): BuildVerdict {
  const mentioned = [...report.matchAll(ANY_PROJECT)].map((match) => shortProject(match[1]!));
  return {
    project,
    reported: mentioned.includes(project),
    wouldBuild: [...new Set([...report.matchAll(WOULD_BUILD)].map((m) => shortProject(m[1]!)))],
  };
}

/** A build is current when the report spoke about it and nothing in its graph would be built. */
export function isFreshBuild(verdict: BuildVerdict): boolean {
  return verdict.reported && verdict.wouldBuild.length === 0;
}

/** Why a run must not continue, in the words a reader can act on. */
export function describeStaleBuild(verdict: BuildVerdict, report: string): string {
  const head = verdict.reported
    ? `${verdict.project}/dist is behind its source: a non-dry build would rebuild ` +
      `${verdict.wouldBuild.join(', ')}.`
    : `tsc said nothing about ${verdict.project}, so its build could not be verified.`;
  return (
    `${head} This suite spawns a built entry point, so it would be testing the last ` +
    `build rather than this source (Cycle Audit 10, a2-06). Run ` +
    `\`npx tsc -b ${verdict.project}\` — or \`npm run build\` — and run it again.\n` +
    `tsc -b ${verdict.project} --dry said:\n${report.trim()}`
  );
}
