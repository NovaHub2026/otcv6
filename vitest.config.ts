import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Workspace packages are resolved directly to their TypeScript sources so that
 * tests never depend on a prior build step. `tsc -b` remains the authority for
 * emitted output; Vitest is the authority for behaviour.
 */
const alias = {
  '@otc/core/browser': path.resolve(root, 'packages/core/src/browser.ts'),
  '@otc/core': path.resolve(root, 'packages/core/src/index.ts'),
  '@otc/engine': path.resolve(root, 'packages/engine/src/index.ts'),
  '@otc/fixtures': path.resolve(root, 'packages/fixtures/src/index.ts'),
  '@otc/lab': path.resolve(root, 'packages/lab/src/index.ts'),
  '@otc/runtime': path.resolve(root, 'packages/runtime/src/index.ts'),
  '@otc/trading': path.resolve(root, 'packages/trading/src/index.ts'),
  '@otc/distribution': path.resolve(root, 'packages/distribution/src/index.ts'),
  '@otc/chart': path.resolve(root, 'packages/chart/src/index.ts'),
};

const commonExclude = ['**/node_modules/**', '**/dist/**', '**/artifacts/**'];

/**
 * Coverage instrumentation rewrites every function to record which lines ran.
 * That is what makes it useful, and it is also what makes a wall-clock timeout
 * measure the instrumentation rather than the code: a test that takes one second
 * normally can exceed a five-second limit under it.
 *
 * PH-11.3 found `npm run test:cov` failing on exactly that, which meant coverage
 * was still effectively unmeasured (B-003) even after `tools/` was added to it.
 *
 * The signal is an explicit variable set by the `test:cov` script, not a guess at
 * Vitest's internals, so it cannot silently stop working when Vitest changes.
 */
const measuringCoverage = process.env.OTC_COVERAGE === '1';
/**
 * The unit project's per-test timeout.
 *
 * **Raised from 5s to 20s by Cycle Audit 5, finding 1.** The gate failed
 * roughly one run in five on an idle box, and the cause was not a defect: ten
 * unit tests are deliberate deterministic computations sitting between 2.5s and
 * 4.2s — co-varied kurtosis solves, closed-form-versus-simulation checks, the
 * full-stack mirror test — and any of them crosses 5s when something else wants
 * the CPU. `GOVERNANCE.md` §40.1 calls the gate "deterministic and
 * reproducible"; it was not, and it is the authority for every approval in this
 * repository.
 *
 * The timeout was doing two jobs. Catching *accidental* cost — an assertion
 * inside a large loop — is `testCost.test.ts`'s job and it does it directly, by
 * reading the code rather than by timing it. Bounding *deliberate* cost is this
 * value's job, and 5s left no headroom at all. 20s is roughly five times the
 * slowest test, which is headroom rather than a licence: a unit test that needs
 * more than that is a statistical test in the wrong project.
 */
const unitTimeoutMs = measuringCoverage ? 60_000 : 20_000;

export default defineConfig({
  resolve: { alias },
  test: {
    /**
     * Concurrency is set here, at the root, because Vitest ignores it anywhere
     * else — and that is not a style note.
     *
     * **Cycle Audit 6, C-1.** `fileParallelism: false` and `maxWorkers: 8` were
     * written inside the project blocks below, where Vitest 3 types them as
     * `NonProjectOptions` and silently drops them. So the statistical suite had
     * *never* run serially, despite a comment saying it did and a phase document
     * claiming the setting as a determinism fix. The measured tell was in the
     * summary all along: `detectionPower` alone reporting 707 s of test time
     * inside a 749 s run that also ran everything else.
     *
     * Two consequences, both of which had been read as something else. The
     * statistical files oversubscribed the box against each other, which is the
     * real source of `Timeout calling "onTaskUpdate"`; and every wall-clock
     * assertion in that suite was measuring whatever else happened to be
     * running.
     *
     * The gate now runs the two projects as **separate invocations**
     * (`package.json`), because that is the only place per-project concurrency
     * can actually be expressed — and it is what CI has always done.
     *
     * This file is also now typechecked (`npm run typecheck:config`). It was in
     * no TypeScript program at all, which is why an option that does not exist
     * sat here unnoticed: the file that configures every test in the repository
     * was the one file nothing read.
     */
    maxWorkers: 8,
    /**
     * Worker output goes straight to stdout instead of over the RPC channel.
     *
     * **This option is repeated inside each project block below, and that is
     * where it takes effect.** The out-of-band audit of 2026-09-02 (a1-03)
     * resolved the configuration through `createVitest` and found
     * `disableConsoleIntercept: false` in both projects: an inline project
     * inherits nothing from the root unless it says `extends: true`, so the
     * option written here for Cycle Audit 6 (C-2) had never applied — the CI
     * logs carry the `stdout |` interception headers on every run. The same
     * shape as CA6-01, in the other direction.
     *
     * It was also never the cause of `Timeout calling "onTaskUpdate"`: a console
     * log is an RPC *event*, sent without a timer, and cannot time out. The
     * cause is in `vitest.setup.statistical.ts` and B-021. The interception is
     * still turned off, because relaying evidence text through the main thread
     * buys nothing.
     */
    disableConsoleIntercept: true,
    /**
     * `basic` was the reporter here until 2026-09-02; it is deprecated and
     * prints a banner on every run. `default` without the summary is the same
     * output. The second reporter is the main-thread probe: a lag timer in the
     * process that answers every worker request, so a slow reply can be told
     * from a blocked worker (a1-01 established it is the worker).
     */
    reporters: [['default', { summary: false }], './vitest.reporter.probe.ts'],
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          root,
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'tools/*/src/**/*.test.ts',
            'apps/*/src/**/*.test.ts',
          ],
          exclude: [...commonExclude, '**/*.stat.test.ts'],
          // Inline projects do not inherit root options (a1-03).
          disableConsoleIntercept: true,
          // See the statistical project below: a stray `.only` fails the run
          // rather than silencing its siblings (CA7-17).
          allowOnly: false,
          /**
           * One event-loop turn between tests, so a worker running a file of
           * back-to-back synchronous tests still reads the main thread's reply
           * inside the sixty seconds it is given. Hosted CI failed on
           * 2026-09-04 with every test green and exit 1; the setup file carries
           * the reproduction.
           */
          setupFiles: [path.resolve(root, 'vitest.setup.unit.ts')],
          testTimeout: unitTimeoutMs,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'statistical',
          root,
          environment: 'node',
          include: [
            'packages/*/src/**/*.stat.test.ts',
            'tools/*/src/**/*.stat.test.ts',
            'apps/*/src/**/*.stat.test.ts',
          ],
          exclude: commonExclude,
          // Inline projects do not inherit root options (a1-03).
          disableConsoleIntercept: true,
          /**
           * A stray `.only` is a failure, not a filter.
           *
           * **Cycle Audit 7, CA7-17.** Vitest defaults `allowOnly` to
           * `!process.env.CI`, so a file carrying `it.only` silenced its
           * failing siblings locally — exit 0, "2204 passed | 1 skipped" — and
           * only turned red on a push to `main`. The local gate is what an
           * approval is recorded from (`GOVERNANCE.md` §40.1), so the layer
           * that can be fooled was the authoritative one.
           */
          allowOnly: false,
          /**
           * The round-trip guard and the lag watchdog. The first fails a file
           * that keeps a main-thread request unanswered for thirty seconds —
           * the quantity that fails the whole run at sixty, with every test
           * passing; the second reports the worst synchronous block per file.
           */
          setupFiles: [path.resolve(root, 'vitest.setup.statistical.ts')],
          /**
           * Fifteen minutes until Cycle Audit 8, when two files crossed it on a
           * hosted runner and the whole gate came back red on a green tree.
           *
           * PH-24.17 recalibrated the engine to print three to four times as
           * many ticks per candle, and the suites that were redefined to sample
           * **in time** rather than in ticks — deliberately, so a recalibration
           * could not shrink the evidence — got proportionally more expensive.
           * A hosted runner is about half again slower than the machine these
           * numbers were set on. The work is intentional; the ceiling has to
           * follow it, and the job's own ceiling (`ci.yml`, 180 minutes) has the
           * room.
           */
          testTimeout: 1_800_000,
          hookTimeout: 1_800_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      // `tools/*` was excluded until PH-11.3 (B-003). It carries the simulation
      // runner, the evidence generators and the phase acceptance suites — the
      // code that produces the numbers every claim in this project cites — and
      // its coverage was simply unmeasured. Excluding the code that generates
      // your evidence from the measurement of your evidence is the wrong way
      // round.
      //
      // Entry points are deliberately *not* excluded. A CLI that no test drives
      // should read as uncovered, because it is.
      // **Cycle Audit 6, CA6-10.** `apps/*` was excluded, which was defensible
      // while the apps were thin wiring and stopped being so in PH-18: 840
      // lines of `apps/api/src` — the history service, the controller, the
      // venue — are directly unit-tested and were simply not measured, and not
      // one line of `apps/web/src` is referenced by any test at all. A coverage
      // figure that excludes the code you are least sure about is the wrong way
      // round.
      include: ['packages/*/src/**/*.ts', 'tools/*/src/**/*.ts', 'apps/*/src/**/*.ts?(x)'],
      // `**/*.test.ts` also matches `*.stat.test.ts`.
      exclude: ['**/*.test.ts', '**/index.ts', '**/*.d.ts'],
      /**
       * A floor per workspace, and what it is for.
       *
       * **Cycle Audit 8 (a2).** Coverage was measured accurately and enforced
       * nothing: no threshold here, and no step of `npm run gate` that ran the
       * measurement. A file could go from fully covered to zero — or arrive at
       * zero, as every line of `apps/web/src` did — and every step of the gate
       * returned the same verdict. An instrument that reports and holds nothing
       * shut is the same class of defect as CA6-01, one layer up.
       *
       * These are a ratchet, not a target. Each floor sits about two points
       * under what `npm run test:cov:unit` measured on 2026-09-04 — or fifteen
       * lines, in the small packages where two points is a handful of lines —
       * which is one refactor's worth of slack and far less than a file falling
       * out of the suite. The measurement each floor was set under is recorded
       * beside it, so a reader can see how much slack is left without running
       * anything. Raise a floor when the measurement rises; lowering one is a
       * decision, and belongs in the commit message that does it.
       *
       * **Per workspace, because an aggregate has no resolution.** Three hundred
       * uncovered lines is a rounding error across the eleven thousand in
       * `packages/` and the whole of `packages/chart` on its own. `gate.test.ts`
       * asserts every workspace holding source has a floor here, so a new
       * package cannot arrive unmeasured — which is exactly how `apps/web`'s
       * zero arrived.
       *
       * **Measured under the unit project alone**, because that is the run the
       * gate can afford (about 100 s). A file covered only by statistical tests
       * reads as uncovered there, which is why `tools/sim` and `apps/web` sit
       * where they do; `npm run test:cov` runs both projects and can only
       * measure higher, so it passes these floors too.
       */
      thresholds: {
        'packages/chart/src/**': { lines: 94 }, // measured 99.3
        'packages/core/src/**': { lines: 96 }, // measured 99.0
        'packages/distribution/src/**': { lines: 88 }, // measured 90.5
        'packages/engine/src/**': { lines: 95 }, // measured 97.1
        'packages/fixtures/src/**': { lines: 95 }, // measured 100.0
        'packages/lab/src/**': { lines: 88 }, // measured 90.3
        'packages/runtime/src/**': { lines: 91 }, // measured 94.0
        'packages/trading/src/**': { lines: 88 }, // measured 93.5
        'apps/api/src/**': { lines: 75 }, // measured 77.7
        'apps/web/src/**': { lines: 5 }, // measured 7.7
        'tools/sim/src/**': { lines: 33 }, // measured 35.7
      },
    },
  },
});
