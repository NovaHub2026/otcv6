import { afterEach, beforeEach } from 'vitest';

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

/**
 * How long one test may block this worker's event loop before the file is failed
 * by name.
 *
 * **Cycle Audit 13 (wave 3).** The `afterEach` above is the *mitigation* for the
 * rpc failure; it is not a detector, and on 2026-09-26 the difference cost a red
 * hosted CI on a commit whose local gate was green: all 3,618 tests passed and the
 * run exited 1 on `Timeout calling "onTaskUpdate"` with **nothing naming a file**.
 * The statistical project has had a probe that names the offender since B-021; the
 * unit project had only the fix. So the run that failed could not say what failed,
 * and the slow files (`registration.test.ts` at 496 s under coverage on a
 * four-core runner, with single tests at 61.6 s) had to be inferred from
 * durations.
 *
 * A loop turn between tests cannot help a test that blocks for longer than the
 * sixty seconds Vitest waits for its task update to be *read*: the reply is a
 * macrotask, so it needs a turn **inside** the test. Twenty seconds is the
 * threshold because no unit test has any business blocking for that long — the
 * whole plain suite is 93 s — and because it leaves room under the sixty the
 * worker actually has.
 *
 * Coverage instrumentation multiplies every synchronous stretch, so the threshold
 * stands down under `OTC_COVERAGE=1` rather than failing a run for being
 * measured — but it still reports, because that is the run CI fails in.
 */
const BLOCK_LIMIT_MS = process.env.OTC_COVERAGE === '1' ? 55_000 : 20_000;
const SAMPLE_MS = 250;

let worst = 0;
let last = Date.now();
const heartbeat = setInterval(() => {
  const now = Date.now();
  const gap = now - last - SAMPLE_MS;
  if (gap > worst) worst = gap;
  last = now;
}, SAMPLE_MS);
// Never hold the process open: this is a measurement, not work.
heartbeat.unref();

beforeEach(() => {
  worst = 0;
  last = Date.now();
});

afterEach(() => {
  if (worst <= BLOCK_LIMIT_MS) return;
  const seconds = (worst / 1000).toFixed(1);
  throw new Error(
    `this test blocked its worker's event loop for ${seconds}s, and Vitest gives the reply to a ` +
      `task update sixty seconds to be read — so a file like this one fails the whole run with ` +
      `"Timeout calling onTaskUpdate" and every test green (CLAUDE.md §5). Make the body async ` +
      `and await yieldToLoop() between units of work, or use the *Async variant of whatever it ` +
      `calls: calibrateAssetAsync, runBatteryAsync and buildObserverDataset all yield.`,
  );
});
