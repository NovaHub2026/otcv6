# PH-5.1 — Runtime core: hosted markets, scheduling and venue supervision

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-5.1
Parent phase: PH-5 — Continuous Runtime, Sealed State Persistence and Restart Continuity
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Make a market advance because time passed. Everything the engine has ever done
has happened because a test asked for a tick; this subphase introduces the
distinction between producing a tick and a tick being **due**.

## 2. Problem

`MarketEngine.next()` returns a tick carrying the instant it belongs to. In a
test that instant is a label. Hosted, it is a deadline, and three things follow
that are not obvious until they are written down.

### 2.1 The market must not depend on how often it is polled

If a runtime published a tick each time it was asked, an observer polling twice
as fast would see a faster market. That breaks INV-002 outright — the same asset
would have different prices for different observers — and it makes INV-008
meaningless, because "continuous" would depend on process scheduling.

So the operation is not "give me a tick" but "publish everything due at `now`".
Polling twice as often yields the same ticks at the same instants; not polling
for a minute yields a minute of ticks at once. `hosted.test.ts` asserts this
directly: an observer stepping one second at a time for ten minutes and one
stepping ten minutes in a single jump produce **identical** tick arrays.

### 2.2 The engine cannot say when its next tick falls without producing it

There is no `peek`. The runtime therefore draws one tick ahead and holds it
un-published until the clock reaches it. That pending tick is the only thing the
runtime knows about the future, and it is what lets `advance` decide that nothing
is due without consuming a tick it would have to throw away — which would
silently skip a tick and break replay.

### 2.3 Catch-up is unbounded work, and its limit is a business decision

The engine will generate three weeks of a one-second market, and at 800k ticks/s
it will do it in seconds. So "catch up on restart" has no natural stopping point.
Past some outage length the honest statement is that the venue was closed, not
that a month of prices happened while nobody was watching.

This subphase does **not** decide where that line sits. It implements a bound,
defaults it generously to one hour, and surfaces the question in the phase
document. Choosing it silently would be picking a venue policy with business
consequences under the guise of a constant.

## 3. Architectural direction

**The venue shares a clock and nothing else.** Each hosted market has its own
engine, its own key material and its own latent state. A venue is a scheduling
convenience, not a market-level entity — and that matters, because a shared
object here would be the obvious route for one asset's state to reach another's
prices.

**Scheduling is deadline-driven, not interval-driven.** The catalogue spans 334ms
to 3187ms of mean interval, so any single polling interval would either burn CPU
on the slow assets or publish the fast ones late. `Venue.msUntilNextTick` returns
the soonest deadline across all markets.

**A new package, deliberately.** `@otc/runtime` sits between the engine and the
eventual service, and depends on neither NestJS nor I/O. The batteries must keep
being able to drive the engine from a plain Node process.

## 4. What this subphase added beyond its scope, and why

The PH-5 phase document lists "the engine acquiring an I/O or framework
dependency by convenience" as a real risk, and notes that the existing guardrail
scan covers _vocabulary_ rather than dependency direction. It would catch a
`payout` field in the magnitude path; it could not catch `@nestjs/common` being
imported into the engine.

`dependencies.test.ts` closes that. It enforces, per workspace: that internal
dependencies match an explicit allowlist, that nothing under `packages/` imports
a framework or server, that every `@otc/*` import is actually declared — workspace
hoisting makes an undeclared dependency work right up until the package is built
alone — and that the graph is acyclic.

Verified to have teeth: importing `@nestjs/common` into the engine fails it, and
so does importing `@otc/lab` without declaring it.

## 5. Acceptance criteria

1. A hosted market publishes exactly the ticks due at the clock's reading, in
   order, once each.
2. Polling frequency does not change what is published.
3. No tick is ever published before its instant.
4. Catch-up beyond the bound is refused, with the shortfall reported.
5. A venue advances all five catalogue assets and reports the soonest deadline.
6. Dependencies point only downward, enforced by a test with teeth.

## 6. Approval record

**APPROVED** from executed evidence, 2026-08-31.

### Verification executed

| Check                         | Result            |
| ----------------------------- | ----------------- |
| `npm run format:check`        | PASSED (exit 0)   |
| `npm run lint`                | PASSED (exit 0)   |
| `npm run build`               | PASSED (exit 0)   |
| `packages/runtime` unit tests | PASSED — 13 tests |
| `dependencies.test.ts`        | PASSED — 20 tests |
| Guardrail suite               | PASSED            |

### What the subphase learned

**A test assumption failed before the code did.** The first catch-up test
advanced the clock five seconds and expected ticks to have been published. None
had: the Hawkes arrival process starts with zero excitation, so the first
intervals run near the 3000ms baseline rather than the 1295ms stationary mean.
The engine was right and the test was wrong, which is worth recording because the
same assumption — that a market's early behaviour matches its long-run statistics
— would be easy to make again in PH-5.2's restart tests.

**The layout guardrail caught the new package immediately.** Adding
`packages/runtime` failed `lists every workspace package` before any of it was
documented. That is the Cycle Audit 001 guardrail doing exactly its job, on the
first new package created since it was written.

### Known limitations carried forward

- Nothing is persisted. A hosted market is still in-process only, and a restart
  loses everything. That is PH-5.2.
- The catch-up bound is a placeholder default with defined behaviour, not a
  decided venue policy.
