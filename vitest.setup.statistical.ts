/**
 * An event-loop watchdog for the statistical suite.
 *
 * ## The failure it exists to locate
 *
 * `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` — every test passing,
 * the run exiting 1. It has cost this project a phase gate (B-005), recurred in
 * PH-10.3, and as of PH-21 it is **reproducible on hosted CI**: two consecutive
 * runs, 238 tests passed, 36 files passed, one unhandled error, exit 1.
 *
 * The cause is always the same shape and never the same place: a test body that
 * runs synchronously for long enough that its worker cannot answer the runner.
 * `CLAUDE.md` §5 records the convention that prevents it — make the callback
 * `async` and `await new Promise((r) => setImmediate(r))` every few hundred
 * thousand ticks — and the hazard is standing, because it returns with every new
 * long test.
 *
 * Remembering a convention is not a guard. This measures the thing directly: a
 * timer that should fire every 250ms, and the gap between when it should have
 * fired and when it did. That gap **is** the block, whatever caused it.
 *
 * ## Why it reports rather than fails
 *
 * A CI runner is several times slower than a developer machine and shares a
 * host, so any threshold expressed in wall-clock seconds is a different
 * threshold in the two places. Reporting the worst block per file, with the file
 * named, turns an unattributable run-level failure into a line an operator can
 * act on — which is what was missing every previous time this happened.
 */
import { afterAll, beforeAll } from 'vitest';

/**
 * ## The RPC probe
 *
 * The watchdog below answers "did this worker stay away from its loop for too
 * long". Hosted CI run 33607930939 — the first with the watchdog — answered
 * no: the worst block in the whole suite was 20.4 s, and the run still exited 1
 * with `Timeout calling "onTaskUpdate"`, an error that carried no file
 * attribution because it fired after the file had finished, while the worker
 * was waiting in `rpcDone()` for the main thread's reply.
 *
 * So the question moved to the other end of the channel, and this measures the
 * channel itself: every call the worker makes to the main thread is wrapped,
 * the moment it was sent and the file it was sent during are kept, and a reply
 * that arrives late or never is written to stderr with both. The wrapper
 * returns the original promise untouched, so a timeout still surfaces to Vitest
 * exactly as before — this names it, it does not hide it.
 */
const RPC_REPORT_ABOVE_MS = 2_000;

interface WorkerStateLike {
  rpc: Record<string, unknown>;
  filepath?: string;
  otcRpcProbe?: boolean;
}

function probeLog(line: string): void {
  process.stderr.write(`[rpc-probe] ${new Date().toISOString()} ${line}\n`);
}

function installRpcProbe(): void {
  const state = (globalThis as { __vitest_worker__?: WorkerStateLike }).__vitest_worker__;
  if (state === undefined || state.otcRpcProbe === true) return;
  state.otcRpcProbe = true;
  const inner = state.rpc;
  state.rpc = new Proxy(inner, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      const method = property;
      const call = value as (...args: unknown[]) => unknown;
      const wrapped = (...args: unknown[]): unknown => {
        const sentAt = Date.now();
        const during = state.filepath ?? '(no file)';
        const result = call.apply(target, args);
        if (result instanceof Promise) {
          // `.then(onFulfilled, onRejected)` on the ORIGINAL promise would mark it
          // handled and Vitest would never see the timeout. The derived promise
          // this creates rejects with the same error and nothing handles it, so
          // the failure reaches Vitest as it always did — with a name attached.
          result.then(
            () => {
              const ms = Date.now() - sentAt;
              // `OTC_RPC_PROBE_ALL=1` logs every answered call, which is how the
              // probe itself is checked to be wrapping the channel at all.
              if (ms >= RPC_REPORT_ABOVE_MS || process.env['OTC_RPC_PROBE_ALL'] === '1') {
                probeLog(
                  `${method} answered after ${(ms / 1000).toFixed(1)}s ` +
                    `(sent ${new Date(sentAt).toISOString()} during ${during})`,
                );
              }
            },
            (error: unknown) => {
              probeLog(
                `${method} REJECTED after ${((Date.now() - sentAt) / 1000).toFixed(1)}s ` +
                  `(sent ${new Date(sentAt).toISOString()} during ${during}; ` +
                  `current file ${state.filepath ?? '(no file)'}): ${String(error)}`,
              );
              throw error;
            },
          );
        }
        return result;
      };
      Object.assign(wrapped, { asEvent: (call as { asEvent?: unknown }).asEvent });
      return wrapped;
    },
  });
}

installRpcProbe();

const INTERVAL_MS = 250;

/** Blocks below this are ordinary scheduling and not worth a line. */
const REPORT_ABOVE_MS = 2_000;

/**
 * A block above this fails the file, and says which one.
 *
 * Sixty seconds is not a performance budget — it is the point past which a
 * worker is so far from its own event loop that the run's exit code stops
 * describing the tests. It has to survive a hosted runner several times slower
 * than a developer machine, so it is set well above the worst block a healthy
 * suite produces (3.4s locally, at the time of writing) rather than close to it.
 *
 * The first thing it caught was a test written in the same commit as this file:
 * 99.9 seconds of unbroken solving in `catalogueScale.stat.test.ts`.
 */
const FAIL_ABOVE_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let expected = 0;
let worst = 0;

beforeAll(() => {
  expected = Date.now() + INTERVAL_MS;
  worst = 0;
  timer = setInterval(() => {
    const now = Date.now();
    const lag = now - expected;
    if (lag > worst) worst = lag;
    expected = now + INTERVAL_MS;
  }, INTERVAL_MS);
  // The watchdog must never be the reason a run stays alive.
  timer.unref();
});

afterAll(() => {
  if (timer !== null) clearInterval(timer);
  if (worst >= FAIL_ABOVE_MS) {
    throw new Error(
      `event-loop watchdog: this file blocked its worker for ${(worst / 1000).toFixed(1)}s. ` +
        `Make the long callback async and \`await new Promise((r) => setImmediate(r))\` ` +
        `periodically (CLAUDE.md §5). A worker that cannot answer the runner fails the ` +
        `whole run with every test passing, and that failure names no file.`,
    );
  }
  if (worst >= REPORT_ABOVE_MS) {
    // Straight to stdout, like the rest of this suite's evidence: the console
    // interception that would have relayed it is off, precisely because that
    // traffic is part of the same problem.
    console.info(
      `event-loop watchdog: worst block ${(worst / 1000).toFixed(1)}s in this file. ` +
        `A worker that cannot answer the runner fails the whole run with every test ` +
        `passing (CLAUDE.md §5).`,
    );
  }
});
