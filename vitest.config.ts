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
     * Vitest intercepts `console.*` in a worker and forwards every call to the
     * main thread as an RPC message, on the same channel as `onTaskUpdate`. The
     * statistical suite prints heavily — it is how its evidence is recorded —
     * and that traffic is what turns a busy box into a
     * `Timeout calling "onTaskUpdate"` with every test passing.
     *
     * Cycle Audit 6 (C-2) recorded this as still open after `maxWorkers`
     * narrowed it: 2,050 tests green and exit 1, on a run sharing the machine
     * with a demo service. Removing the interception removes the traffic rather
     * than the symptom, and the output is unchanged — it is the same text, on
     * the same stream, not relayed.
     */
    disableConsoleIntercept: true,
    /**
     * A quiet reporter, because the default one *is* the RPC traffic.
     *
     * Vitest's default reporter subscribes to per-task updates, and each one is
     * a message from the worker to the main thread. On a suite whose files run
     * for six and seven hundred seconds each, that channel is the only thing
     * that has to stay responsive — and `Timeout calling "onTaskUpdate"` is
     * what happens when it does not.
     *
     * With the console interception gone as well, the channel carries almost
     * nothing. That is the point: a run's exit code should depend on the tests,
     * not on how chatty the runner is while something else uses the machine.
     * Failures and summaries still print, and the statistical suite's evidence
     * goes straight to stdout.
     */
    reporters: ['basic'],
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
          testTimeout: 900_000,
          hookTimeout: 900_000,
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
    },
  },
});
