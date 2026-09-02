/**
 * Two instruments for the statistical suite, and the failure they exist for.
 *
 * ## The failure
 *
 * `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` — every test passing,
 * the run exiting 1. It cost this project a phase gate (B-005), recurred in
 * PH-10.3, and failed hosted CI on every push to `main` from the PH-18 merge to
 * the PH-21.1 push: six pushes, five red, one cancelled (B-021).
 *
 * The out-of-band audit of 2026-09-02 (a1-01) reproduced it in a ten-line file
 * and named the mechanism. Vitest's worker talks to the main thread over birpc;
 * each request arms a sixty-second timer, and the reply is read from the IPC
 * channel in the event loop's **poll** phase. Task updates are sent
 * synchronously at every test boundary. If the next test then runs for sixty
 * seconds without a full loop turn, the expired timer fires before the queued
 * reply is read, the request rejects, and the file's run rejects with it — after
 * every test in it has passed. Console output is an event with no timer and was
 * never the cause; neither was file parallelism after `--no-file-parallelism`.
 *
 * On `main` the file was `sampledCatalogue.stat.test.ts`: its last test built
 * signatures for twenty-four assets in one macrotask-free stretch, 55 s locally
 * and 92–94 s on the hosted runner.
 *
 * ## The instruments
 *
 * **The round-trip guard** wraps every call the worker makes to the main thread
 * and measures how long the reply took to be *read*. That is the quantity that
 * fails the run, so it is the quantity that fails the file: a request unanswered
 * for `FAIL_ROUND_TRIP_ABOVE_MS` fails the file by name, with the request and
 * the moment it was sent, at half the timeout the runner would have hit.
 *
 * **The lag watchdog** is diagnostic: a 250 ms timer and the gap between when
 * it should have fired and when it did. It reports the worst gap per file, and
 * it folds in the gap still pending when the file ends — the audit found the
 * first version blind to a block in a file's tail, because `afterAll` is
 * reached through microtasks and the timer never got another turn.
 *
 * Both write to stderr directly, so nothing here adds to the channel it measures.
 *
 * ## The convention this replaces
 *
 * `await new Promise((r) => setImmediate(r))` is not enough: a continuation
 * scheduled from the poll phase runs in the check phase of the same iteration,
 * without a poll in between (a1-01, reproduction R3). Use `yieldToLoop()` from
 * `@otc/lab` — two chained immediates, which guarantee a full loop turn — and
 * use it before any test's first thirty seconds of synchronous work, not merely
 * "every few hundred thousand ticks".
 */
import { afterAll, beforeAll } from 'vitest';

/** Round trips below this are ordinary and not worth a line. */
const REPORT_ABOVE_MS = 2_000;

/**
 * A request the main thread's reply could not reach for this long fails the
 * file. Vitest's birpc `DEFAULT_TIMEOUT` is 60 s; failing at half of it turns an
 * anonymous run-level error into a named file with headroom to spare.
 */
const FAIL_ROUND_TRIP_ABOVE_MS = 30_000;

const INTERVAL_MS = 250;

interface WorkerStateLike {
  rpc: Record<string, unknown>;
  filepath?: string;
  otcRpcProbe?: boolean;
}

interface PendingRequest {
  readonly method: string;
  readonly sentAt: number;
  readonly during: string;
}

interface RoundTrip {
  readonly ms: number;
  readonly method: string;
  readonly during: string;
  readonly sentAt: number;
}

const pending = new Set<PendingRequest>();
let worstRoundTrip: RoundTrip | null = null;

function stamp(at: number = Date.now()): string {
  return new Date(at).toISOString();
}

function probeLog(line: string): void {
  process.stderr.write(`[rpc-probe] ${stamp()} ${line}\n`);
}

function noteRoundTrip(trip: RoundTrip): void {
  if (worstRoundTrip === null || trip.ms > worstRoundTrip.ms) worstRoundTrip = trip;
  if (trip.ms >= REPORT_ABOVE_MS || process.env['OTC_RPC_PROBE_ALL'] === '1') {
    probeLog(
      `${trip.method} answered after ${(trip.ms / 1000).toFixed(1)}s ` +
        `(sent ${stamp(trip.sentAt)} during ${trip.during})`,
    );
  }
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
        const request: PendingRequest = {
          method,
          sentAt: Date.now(),
          during: state.filepath ?? '(no file)',
        };
        const result = call.apply(target, args);
        if (result instanceof Promise) {
          pending.add(request);
          // `.then(onFulfilled, onRejected)` on the ORIGINAL promise would mark
          // it handled and Vitest would never see a timeout. The derived promise
          // this creates rejects with the same error and nothing handles it, so
          // the failure still reaches Vitest as it always did — named.
          result.then(
            () => {
              pending.delete(request);
              noteRoundTrip({ ...request, ms: Date.now() - request.sentAt });
            },
            (error: unknown) => {
              pending.delete(request);
              const ms = Date.now() - request.sentAt;
              noteRoundTrip({ ...request, ms });
              probeLog(
                `${method} REJECTED after ${(ms / 1000).toFixed(1)}s ` +
                  `(sent ${stamp(request.sentAt)} during ${request.during}; ` +
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

let timer: NodeJS.Timeout | null = null;
let expected = 0;
let worstLag = 0;

beforeAll(() => {
  pending.clear();
  worstRoundTrip = null;
  expected = Date.now() + INTERVAL_MS;
  worstLag = 0;
  timer = setInterval(() => {
    const now = Date.now();
    const lag = now - expected;
    if (lag > worstLag) worstLag = lag;
    expected = now + INTERVAL_MS;
  }, INTERVAL_MS);
  // The watchdog must never be the reason a run stays alive.
  timer.unref();
});

afterAll(() => {
  if (timer !== null) clearInterval(timer);
  // The gap still pending when the file ends is a block the timer never got to
  // measure (a1-02). It counts.
  const now = Date.now();
  worstLag = Math.max(worstLag, now - expected);

  // A request still unanswered at the end of the file has been waiting for as
  // long as its age; the round trip it will eventually record is at least that.
  let offender: RoundTrip | null = worstRoundTrip;
  for (const request of pending) {
    const age = now - request.sentAt;
    if (offender === null || age > offender.ms) offender = { ...request, ms: age };
  }

  if (offender !== null && offender.ms >= FAIL_ROUND_TRIP_ABOVE_MS) {
    throw new Error(
      `rpc probe: this file kept a "${offender.method}" request to the main thread ` +
        `unanswered for ${(offender.ms / 1000).toFixed(1)}s (sent ${stamp(offender.sentAt)} ` +
        `during ${offender.during}). Vitest gives up at 60s and fails the whole run with ` +
        `every test passing. Yield with \`await yieldToLoop()\` from @otc/lab before any ` +
        `test's first thirty seconds of synchronous work, and between long units of it ` +
        `(CLAUDE.md §5).`,
    );
  }
  if (worstLag >= REPORT_ABOVE_MS || (offender !== null && offender.ms >= REPORT_ABOVE_MS)) {
    probeLog(
      `worst block ${(worstLag / 1000).toFixed(1)}s, worst round trip ` +
        `${offender === null ? '0.0' : (offender.ms / 1000).toFixed(1)}s` +
        `${offender === null ? '' : ` (${offender.method})`} in this file.`,
    );
  }
});
