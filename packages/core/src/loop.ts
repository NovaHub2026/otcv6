/**
 * The one correct way to give the event loop a full turn.
 *
 * Lives in `@otc/core` so the engine, the runtime and the laboratory share one
 * definition; `@otc/lab` re-exports it.
 */
/**
 * Yield to the event loop — a full turn, not half of one.
 *
 * `await new Promise((r) => setImmediate(r))` was this project's convention for
 * letting a long computation breathe, and it is not a guarantee. A continuation
 * scheduled from the poll phase runs in the check phase of the *same* loop
 * iteration, with no poll in between — so a reply waiting on the worker's IPC
 * channel is still unread when the next synchronous stretch begins. The
 * out-of-band audit of 2026-09-02 (a1-01) reproduced the consequence: one
 * immediate between two 35-second blocks still failed the run with
 * `Timeout calling "onTaskUpdate"` (reproduction R3); two chained immediates
 * passed (R7). The second immediate cannot run until the loop has been through
 * a poll phase, which is where the channel is read.
 *
 * Use this wherever a computation yields, and before a test's first long
 * synchronous stretch — not merely "every few hundred thousand ticks".
 */
export function yieldToLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(() => setImmediate(resolve));
  });
}
