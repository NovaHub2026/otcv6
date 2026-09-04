import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
