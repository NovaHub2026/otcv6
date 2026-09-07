/**
 * A suite that spawns `dist/` refuses to run against a stale one.
 *
 * Cycle Audit 10 (a2-06) planted a regression in `apps/api/src`, left `dist/`
 * unbuilt, and watched the statistical suite written to catch it report a pass
 * — twice, in two different routes. Nothing in the run said which build it was
 * talking to. `tools/sim`'s served-assurance job carried the only such check in
 * the repository, and a2-05 found that one red on a clean tree after any
 * `git checkout`, because it read two of `tsc -b --dry`'s three verdicts.
 *
 * The rule and the reasoning live in
 * `packages/core/src/guardrails/buildFreshness.ts`, where they are unit-tested.
 * This file is the wiring: before each test file, read the paths that file
 * names, and for every workspace `dist/` among them ask `tsc` whether a non-dry
 * build would build anything in that project's graph. It costs a third of a
 * second, only for the ten or so files that spawn a build, and nothing at all
 * for the rest.
 *
 * It is a setup file rather than a helper each suite imports because a helper
 * can be forgotten: seven suites shared the same defect and none of them had
 * one. `gate.test.ts` asserts this file is wired into both projects, and the
 * suites that spawn a build assert that it ran for them.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect } from 'vitest';
import {
  describeStaleBuild,
  isFreshBuild,
  projectsSpawnedBy,
  readBuildVerdict,
} from './packages/core/src/guardrails/buildFreshness.js';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const tsc = path.join(repoRoot, 'node_modules/typescript/bin/tsc');

/** One report per project per worker: eleven files asking costs one answer. */
const reports = new Map<string, string>();

function dryRun(project: string): string {
  const cached = reports.get(project);
  if (cached !== undefined) return cached;
  const result = spawnSync(process.execPath, [tsc, '-b', path.join(repoRoot, project), '--dry'], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  const report = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  reports.set(project, report);
  return report;
}

/** The file being run, from Vitest's state, with the worker's own record as a fallback. */
function currentTestFile(): string | undefined {
  const fromState = expect.getState().testPath;
  if (typeof fromState === 'string' && fromState !== '') return fromState;
  const worker = (globalThis as { __vitest_worker__?: { filepath?: string } }).__vitest_worker__;
  return worker?.filepath;
}

beforeAll(() => {
  const state = globalThis as { __otcFreshBuilds__?: string[] | undefined };
  // Left undefined when the file cannot be identified, so the assertion each
  // spawning suite carries fails loudly rather than reading a stale array.
  state.__otcFreshBuilds__ = undefined;
  const file = currentTestFile();
  if (file === undefined) return;
  const relative = path.relative(repoRoot, file).split(path.sep).join('/');
  const verified: string[] = [];
  for (const project of projectsSpawnedBy(relative, readFileSync(file, 'utf8'))) {
    const report = dryRun(project);
    const verdict = readBuildVerdict(project, report);
    if (!isFreshBuild(verdict)) throw new Error(describeStaleBuild(verdict, report));
    verified.push(project);
  }
  state.__otcFreshBuilds__ = verified;
});
