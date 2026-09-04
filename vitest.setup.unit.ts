import { afterEach } from 'vitest';

/**
 * One event-loop turn between unit tests.
 *
 * The failure this prevents is the one `CLAUDE.md` §5 describes for the
 * statistical project, and on 2026-09-04 it reached the **unit** project on
 * hosted CI: `Test Files 126 passed`, `Tests 2555 passed`, `Errors 1 error`,
 * exit 1, with `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` above a
 * green summary.
 *
 * The mechanism, reproduced locally with `taskset -c 0,1` and the main-thread
 * probe attached — which reported **no** main-thread lag, so the worker is what
 * cannot answer:
 *
 * - Vitest's worker sends a task update at each test boundary and waits sixty
 *   seconds for the reply to be *read*.
 * - `packages/engine/src/registration.test.ts` is 56 tests of synchronous
 *   simulation — personality solves, lattice calibrations, dispersion fits —
 *   back to back. On sixteen cores the file takes 17 s; on two it takes **65**,
 *   with single tests above 10 s. Between two synchronous tests only the
 *   microtask queue drains, and an RPC reply is a macrotask.
 * - So the reply to the update sent early in the file is not read until the file
 *   ends, and 65 > 60.
 *
 * A hosted runner has four cores, the suite runs four files at once, and the
 * heaviest file sat just the wrong side of the limit. Nothing was wrong with the
 * tests; the run was reported as broken anyway, which is the worst kind of
 * failure this project has met — a green suite with a red exit code.
 *
 * Two chained `setImmediate`s, because one is not a full loop turn: a
 * continuation scheduled from inside a `setImmediate` callback runs in the same
 * turn, and the a1-01 reproduction showed a single one leaving the failure in
 * place. Cost: about a quarter of a millisecond per test, 2,555 times.
 */
afterEach(async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
});
