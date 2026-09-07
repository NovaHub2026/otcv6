import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeStaleBuild,
  isFreshBuild,
  projectsSpawnedBy,
  readBuildVerdict,
} from './buildFreshness.js';
import { listSourceFiles, readRepositoryFile, repoRoot } from './repository.js';
import { stripCommentsKeepingStrings } from './sourceScan.js';

/**
 * The gate's own configuration, guarded.
 *
 * This project's single most expensive class of defect is an instrument that
 * silently stops measuring. Cycle Audit 6's headline was two Vitest options
 * living where Vitest 3 drops them without a word, so the statistical suite had
 * never run serially despite a comment saying it did. The out-of-band audit
 * found the browser suite reporting six tests as *passed* while launching no
 * browser. Cycle Audit 7 found two more, and neither needed a subtle mistake —
 * deleting one line from a glob list, and a default that differs between a
 * laptop and CI.
 *
 * So the configuration is read and asserted, like any other code.
 */
const config = readFileSync(path.join(repoRoot, 'vitest.config.ts'), 'utf8');
/** The steps themselves are configuration too, and are read the same way. */
const scripts = (
  JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    readonly scripts: Record<string, string>;
  }
).scripts;

/** Where this repository keeps code. Anything else is not the gate's business. */
const WORKSPACE_ROOTS = ['packages', 'tools', 'apps'];

describe('the gate runs the tests that exist', () => {
  it('has a glob for every root that holds statistical tests (CA7-16)', () => {
    // **Cycle Audit 7.** An auditor deleted `'apps/*/src/**/*.stat.test.ts'`
    // from the statistical include: six files vanished, among them the entire
    // eight-test browser suite — the only browser coverage in the repository —
    // and every step of the gate still passed with counts identical to the
    // recorded baseline. Nothing in either layer noticed.
    //
    // The check is against what is on disk, not against a remembered list, so
    // a new root with statistical tests joins it by existing.
    const roots = WORKSPACE_ROOTS.filter((root) =>
      listSourceFiles(root, { includeTests: true }).some((file) => file.endsWith('.stat.test.ts')),
    );
    expect(roots.length, 'no statistical tests were found at all').toBeGreaterThan(1);
    const unmatched = roots.filter((root) => !config.includes(`'${root}/*/src/**/*.stat.test.ts'`));
    expect(unmatched, 'these roots hold statistical tests the gate would not run').toEqual([]);
  });

  it('has a glob for every root that holds unit tests', () => {
    const roots = WORKSPACE_ROOTS.filter((root) =>
      listSourceFiles(root, { includeTests: true }).some(
        (file) => file.endsWith('.test.ts') && !file.endsWith('.stat.test.ts'),
      ),
    );
    expect(roots.length).toBeGreaterThan(1);
    const unmatched = roots.filter((root) => !config.includes(`'${root}/*/src/**/*.test.ts'`));
    expect(unmatched, 'these roots hold unit tests the gate would not run').toEqual([]);
  });

  it('refuses a stray .only rather than letting it silence a sibling (CA7-17)', () => {
    // Vitest defaults `allowOnly` to `!process.env.CI`, so a file carrying
    // `it.only` silenced its failing siblings locally — exit 0, "2204 passed |
    // 1 skipped" — and turned red only on a push to `main`. The local gate is
    // what an approval is recorded from, so the layer that could be fooled was
    // the authoritative one.
    const occurrences = config.match(/allowOnly:\s*false/g) ?? [];
    expect(occurrences.length, 'both projects must pin allowOnly').toBe(2);
  });

  it('excludes nothing from either project but the directories that hold no tests (a2)', () => {
    // **Cycle Audit 8.** The two checks above guard the *include* lists. An
    // `exclude` is the same defect from the other side and CA7-16's guard does
    // not see it: an auditor added `'**/apps/web/src/*.stat.test.ts'` to the
    // statistical project's exclude, the whole browser layer stopped being
    // collected, and every step of the gate stayed green — a smaller suite
    // reported as a pass, with nothing comparing against a baseline.
    //
    // Pinned by value rather than by shape, because the point is that the two
    // lists are exactly what they are: the shared non-source directories, plus
    // the one glob that separates the projects.
    const excludes = [...config.matchAll(/^ {10}exclude: (.+),$/gm)].map((match) => match[1]);
    expect(excludes, "the projects' exclude lists").toEqual([
      "[...commonExclude, '**/*.stat.test.ts']",
      'commonExclude',
    ]);
    // And `commonExclude` itself holds directories, never test files.
    const common = /const commonExclude = \[([\s\S]*?)\];/.exec(config)?.[1] ?? '';
    expect(common, 'commonExclude is not declared as a list').not.toBe('');
    expect(common, 'commonExclude names a test file').not.toMatch(/\.test\.ts/);
  });
});

/**
 * What the gate is allowed to claim when it exits 0.
 *
 * The guards above are about the tests the gate *collects*. These are about the
 * distance between what a run did and what the record says it did — the same
 * defect one layer up, and the one that produced the sentence
 * `GATE COMPLETE: unit and statistical suites both ran` on a machine where the
 * only browser coverage in the repository had launched nothing.
 */
describe('the gate reports what it ran', () => {
  it('requires a real browser of its statistical leg rather than accepting a skip (a2)', () => {
    // **Cycle Audit 8.** The gate script set neither `OTC_REQUIRE_BROWSER=1`
    // nor anything else Chromium needs, while `ci.yml` sets it and installs the
    // libraries with `playwright install --with-deps`. So `npm run gate` on a
    // developer machine printed `GATE COMPLETE` with `lab.stat.test.ts` and
    // `panel.stat.test.ts` — seventeen flows, the only executed coverage of the
    // panel and the Lab — having done nothing, and Vitest prints the same
    // totals either way: the number recorded as evidence could not tell the two
    // runs apart.
    //
    // The variable belongs to the gate and not to `test:stat`, because a
    // developer without the system libraries must still be able to run the
    // statistical suite. What they may not do is record an approval from it.
    expect(scripts['gate'], 'the gate must fail where the browser cannot launch').toMatch(
      /OTC_REQUIRE_BROWSER=1 npm run test:stat/,
    );

    // And every suite that launches a browser must still fail on the variable:
    // a gate that sets it against a suite that ignores it is the same silent
    // skip with more ceremony. What is asserted is that the suite *reads* the
    // variable and *throws* where it is set — a mention is not enough, because
    // the first version of this check passed a suite whose condition had been
    // replaced by `false`, on the name surviving in the message that tells the
    // reader to set it.
    const suites = WORKSPACE_ROOTS.flatMap((root) => listSourceFiles(root))
      .filter((file) => file.endsWith('.stat.test.ts'))
      .map((file) => ({ file, code: stripCommentsKeepingStrings(readRepositoryFile(file)) }))
      .filter(({ code }) => code.includes('chromium.launch('));
    expect(suites.length, 'no browser suite was found at all').toBeGreaterThan(0);
    const deaf = suites
      .filter(({ code }) => {
        const read = /process\.env\W{0,3}OTC_REQUIRE_BROWSER/.exec(code);
        return read === null || !/\bthrow\b/.test(code.slice(read.index, read.index + 200));
      })
      .map(({ file }) => file);
    expect(deaf, 'these suites would skip a missing browser even under the gate').toEqual([]);
  });

  it("records the unit run's own exit code, which its JSON report does not (a2)", () => {
    // **Cycle Audit 8.** `artifacts/unit-results.json` exists to name the
    // failures of the next bad run, and it reports `success: true` for a run
    // that exited 1: an unhandled rejection fails the run without failing any
    // test, and the report then states the opposite of what happened
    // (reproduced on Vitest 3.2.7 with one passing test and one stray
    // `Promise.reject` — exit 1, `"success": true`, `"numFailedTests": 0`). It
    // is a trap laid exactly where someone looks after a confusing failure.
    //
    // So the shell that saw the verdict writes it down beside the report. The
    // fragment is *executed* here rather than matched, because the property
    // that matters is behavioural: the code is recorded **and** re-raised. A
    // recording that swallowed the failure would be worse than the report it
    // corrects.
    //
    // The recording is a shell tail, so `npm run test:unit` now takes no extra
    // arguments — npm appends them past the `exit`. A subset is
    // `npx vitest run --project unit <paths>`, which is what `CLAUDE.md` §5
    // gives as the targeted command anyway.
    const script = scripts['test:unit'] ?? '';
    expect(script, 'the unit run still writes its JSON report').toContain(
      '--outputFile=artifacts/unit-results.json',
    );
    const at = script.indexOf('; code=$?;');
    expect(at, 'the unit script no longer captures its exit code').toBeGreaterThan(0);

    const directory = mkdtempSync(path.join(tmpdir(), 'otc-gate-'));
    try {
      // 7 rather than 1: a tail that hard-codes a verdict fails here too.
      const run = spawnSync('sh', ['-c', `(exit 7)${script.slice(at)}`], { cwd: directory });
      expect(run.status, "the run's own exit code must survive the recording").toBe(7);
      const recorded = readFileSync(path.join(directory, 'artifacts/unit-exit-code'), 'utf8');
      expect(recorded.trim(), 'the recorded verdict is not the exit code').toBe('7');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('holds a coverage floor for every workspace that has source (a2)', () => {
    // **Cycle Audit 8.** Coverage was measured accurately and enforced nothing:
    // no `thresholds` key, and no step of the gate that ran the measurement. A
    // directory could arrive at zero — `apps/web/src` did, and three defects
    // reached the Human Owner through that hole in one day (CA6-10) — with
    // every step of the gate returning the same verdict.
    //
    // A floor list is only as good as its completeness, which is the CA7-16
    // shape again: a workspace with no floor is a workspace whose coverage
    // nothing reads. So the list is checked against what is on disk, in both
    // directions — a new package cannot arrive unmeasured, and a floor cannot
    // outlive the package it names.
    const floors = new Set(
      [...config.matchAll(/'([^']+)\/src\/\*\*':\s*\{[^}]*\blines:\s*\d+/g)].map(
        (match) => match[1]!,
      ),
    );
    // The same files the coverage `include`/`exclude` pair measures.
    const workspaces = new Set(
      WORKSPACE_ROOTS.flatMap((root) => listSourceFiles(root, { includeTests: false }))
        .filter(
          (file) =>
            file.includes('/src/') && !file.endsWith('/index.ts') && !file.endsWith('.d.ts'),
        )
        .map((file) => file.split('/').slice(0, 2).join('/')),
    );
    expect(workspaces.size, 'no workspace source was found at all').toBeGreaterThan(1);
    expect(
      [...workspaces].filter((workspace) => !floors.has(workspace)),
      'these workspaces hold source that no coverage floor protects',
    ).toEqual([]);
    expect(
      [...floors].filter((floor) => !workspaces.has(floor)),
      'these coverage floors name a workspace that no longer holds source',
    ).toEqual([]);
  });

  it('runs the coverage check that gives those floors teeth (a2)', () => {
    // A threshold nothing executes is the finding it was written to close. The
    // gate runs the **unit project alone** under instrumentation — about 100 s,
    // where `test:cov` over both projects was abandoned after 85 minutes during
    // Cycle Audit 8 — which is why the floors are set against that measurement.
    // The plain unit run stays in the gate beside it: instrumentation makes the
    // timeout and the throughput floors meaningless, so each of the two runs
    // measures the one thing the other cannot.
    expect(scripts['gate'], 'the gate does not enforce the coverage floors').toContain(
      'npm run test:cov:unit',
    );
    const coverage = scripts['test:cov:unit'] ?? '';
    expect(coverage, 'the coverage step must run the unit project with coverage on').toMatch(
      /--project unit .*--coverage|--coverage .*--project unit/,
    );
  });
});

/**
 * Which build a suite that spawns one is talking to.
 *
 * **Cycle Audit 10, a2-05 and a2-06.** Vitest resolves workspace imports to
 * TypeScript sources, so a run's only dependency on `dist/` is the handful of
 * suites that spawn a built entry as a child process — and a stale `dist/`
 * there is silent. Two plants in `apps/api/src`, in two different routes, were
 * reported as passes by the statistical suite written to catch them. The one
 * check that existed, in `tools/sim`, read two of `tsc -b --dry`'s three
 * verdicts and so was red on a clean tree after any `git checkout`.
 *
 * The rule lives in `buildFreshness.ts` and runs as a setup file for both
 * projects; these are its unit tests and the assertion that it is still wired
 * in. The fixtures are assembled at run time rather than written as literals,
 * so that this file does not itself read as one that spawns a build — the
 * payload trick `guardrailMetaAudit.stat.test.ts` uses for the same reason.
 */
describe('a suite that spawns a build runs against this source', () => {
  const distPath = (workspace: string, entry: string): string =>
    [workspace, 'dist', entry].join('/');
  const tsconfigOf = (project: string): string => `/tmp/checkout/${project}/tsconfig.json`;
  const upToDate = (project: string): string =>
    `12:00:00 PM - Project '${tsconfigOf(project)}' is up to date\n`;
  const stampsOnly = (project: string): string =>
    `12:00:00 PM - A non-dry build would update timestamps for output of project ` +
    `'${tsconfigOf(project)}'\n`;
  const wouldBuild = (project: string): string =>
    `12:00:00 PM - A non-dry build would build project '${tsconfigOf(project)}'\n`;

  it('is wired into both projects (a2-06)', () => {
    const occurrences = config.match(/vitest\.setup\.buildFreshness\.ts/g) ?? [];
    expect(occurrences.length, 'both projects must run the build-freshness setup').toBe(2);
  });

  it('reads both spellings of a workspace build path', () => {
    const named = `const entry = path.join(repoRoot, '${distPath('apps/api', 'main.js')}');`;
    expect(projectsSpawnedBy('apps/api/src/x.stat.test.ts', named)).toEqual(['apps/api']);
    const relative = `const entry = path.resolve(here, '${['..', 'dist', 'main.js'].join('/')}');`;
    expect(projectsSpawnedBy('apps/api/src/x.stat.test.ts', relative)).toEqual(['apps/api']);
    // A path that is not a workspace build: the mutation payload two test files
    // carry, and a relative `dist` that would resolve inside `src/`.
    const payload = `'${['..', '..', 'trading', 'dist', 'index.js'].join('/')}'`;
    expect(projectsSpawnedBy('tools/sim/src/x.test.ts', payload)).toEqual([]);
    expect(projectsSpawnedBy('apps/api/src/lab/x.test.ts', relative)).toEqual([]);
  });

  it('accepts a build whose inputs are merely newer (a2-05)', () => {
    // The third verdict, and the one the PH-28.1 fix did not read: content
    // identical, stamps behind. A `touch`, a branch switch or the
    // `git checkout -- .` that reverts a plant produces exactly this, and the
    // guard was red on a clean tree with a complete build because of it.
    const report = stampsOnly('packages/core') + stampsOnly('tools/sim');
    expect(isFreshBuild(readBuildVerdict('tools/sim', report))).toBe(true);
    expect(isFreshBuild(readBuildVerdict('tools/sim', upToDate('tools/sim')))).toBe(true);
  });

  it('rejects a build the compiler would rebuild anywhere in the graph (a2-06)', () => {
    // The spawned project's own line says only that its stamps are behind; the
    // stale project is upstream, and the process it spawns loads that one's
    // `dist/`. Reading the spawned project's line alone — the literal fix a2-05
    // proposed — passes this tree.
    const report = wouldBuild('packages/core') + stampsOnly('tools/sim');
    const verdict = readBuildVerdict('tools/sim', report);
    expect(isFreshBuild(verdict)).toBe(false);
    expect(verdict.wouldBuild).toEqual(['packages/core']);
    expect(describeStaleBuild(verdict, report)).toContain('npx tsc -b tools/sim');
  });

  it('refuses a report that says nothing about the project', () => {
    // A `tsc` that failed to run, or a project name that no longer exists,
    // must not read as a clean build: silence is the failure mode every guard
    // in this file exists for.
    expect(isFreshBuild(readBuildVerdict('apps/api', ''))).toBe(false);
    expect(isFreshBuild(readBuildVerdict('apps/api', upToDate('tools/sim')))).toBe(false);
  });

  it('finds every suite that spawns a build', () => {
    const spawning = new Map<string, string[]>();
    for (const root of WORKSPACE_ROOTS) {
      for (const file of listSourceFiles(root, { includeTests: true })) {
        if (!file.endsWith('.test.ts')) continue;
        const projects = projectsSpawnedBy(file, readRepositoryFile(file));
        if (projects.length > 0) spawning.set(file, projects);
      }
    }
    // The seven `apps/api` statistical suites a2-06 named, the `tools/sim` job
    // test that carried the only check, and the two outside them that spawn a
    // build for the same reason. Named rather than counted: a detector that
    // stopped reading one spelling would still find "some".
    for (const file of [
      'apps/api/src/clientReconstruction.stat.test.ts',
      'apps/api/src/conformance.stat.test.ts',
      'apps/api/src/panelSurface.stat.test.ts',
      'apps/api/src/registration.stat.test.ts',
      'apps/api/src/restart.stat.test.ts',
      'apps/api/src/servedRecord.stat.test.ts',
      'apps/api/src/stream.stat.test.ts',
      'packages/runtime/src/sqliteConcurrency.test.ts',
      'tools/sim/src/servedAssuranceJob.test.ts',
    ]) {
      expect(spawning.has(file), `${file} spawns a build and the detector missed it`).toBe(true);
    }
  });
});
