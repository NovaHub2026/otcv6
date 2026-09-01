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
          // The unit project runs first and alone. See the statistical
          // project's note below.
          sequence: { groupOrder: 0 },
          /**
           * Half the cores, because the box has sixteen of them and 7 GB.
           *
           * Vitest defaults to one worker per core, which on this machine is
           * about 440 MB each — and several unit tests build multi-million
           * element typed arrays. The measured consequence was not a
           * heap-out-of-memory but something quieter: `npm run test` exited 1
           * with every test passing, on `Timeout calling "onTaskUpdate"`, twice
           * in the PH-18 phase gate. The statistical project alone was clean;
           * the two together were not.
           *
           * Fewer workers is slower on paper and was not, measurably: the unit
           * suite runs in about the same wall time because it was never
           * CPU-bound at that width, and the run stops being a coin toss.
           */
          maxWorkers: 8,
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
          // Statistical suites are CPU-bound simulations; running them in
          // parallel oversubscribes the box and makes timings meaningless.
          fileParallelism: false,
          /**
           * And not in parallel with the *unit* project either.
           *
           * `fileParallelism: false` only serialises files inside this project.
           * The unit project ran alongside it on every core the box has, which
           * is the same oversubscription one level up — and it produced the
           * failure mode this repository knows best: every test passing and the
           * run exiting 1 on `Timeout calling "onTaskUpdate"`, because a worker
           * starved of CPU cannot answer its own progress channel.
           *
           * The PH-18 phase gate hit it twice with 2,014 tests green. Nothing
           * was wrong with the tests; the runner could not report them.
           * `groupOrder` makes the two projects run one after the other, which
           * also makes every wall-clock assertion in here a measurement of the
           * code rather than of what else was running.
           */
          sequence: { groupOrder: 1 },
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
      include: ['packages/*/src/**/*.ts', 'tools/*/src/**/*.ts'],
      // `**/*.test.ts` also matches `*.stat.test.ts`.
      exclude: ['**/*.test.ts', '**/index.ts', '**/*.d.ts'],
    },
  },
});
