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
