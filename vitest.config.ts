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
