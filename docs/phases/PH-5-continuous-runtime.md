# PH-5 — Continuous Runtime, Sealed State Persistence and Restart Continuity

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-5
Status: ACTIVE
Cycle: 2 (phase 2 of 3)
Created: 2026-08-31
Branch: `feature/ph-5-runtime`
Depends on: PH-1 (APPROVED), PH-2 (APPROVED), PH-3 (APPROVED), PH-4 (APPROVED)
Decisions applied: [ADR-0002](../decisions/ADR-0002-deterministic-entropy-architecture.md), [ADR-0004](../decisions/ADR-0004-canonical-price-representation.md)

---

## 1. Objective

Make the market **run**. Until now the engine has only ever been something a test
could drive: it produces ticks as fast as it is asked, in a process that exists
for the length of one assertion. PH-5 turns it into a service that hosts the
catalogue continuously, in real time, across restarts, without ever resetting the
market or redrawing a keystream position it has already spent.

## 2. Problem

Four things are genuinely hard here, and only the first is obvious.

### 2.1 A market is a function of time, not of uptime

The engine advances when `next()` is called. A hosted market advances because
time passed. Those are not the same thing, and the difference is where INV-008
(continuous market state) and INV-002 (shared market) are won or lost.

If the process is down for five minutes, the market did not stop. Two observers —
one who watched throughout on another node, one who reconnects afterwards — must
agree about what happened in those five minutes. So a restart cannot simply
resume generating from where it left off and pretend no time passed: the price at
12:05 has to be the price at 12:05.

### 2.2 Replaying the gap and leasing the cursor pull in opposite directions

PH-1 built cursor leasing precisely so a crash can never cause a keystream
position to be drawn twice. PH-3's restart tests use it by starting _beyond_ the
consumed position, which deliberately abandons latent state and accepts a seam.

But a market that is a function of time wants the opposite: restore the snapshot
and **replay** the gap deterministically, which redraws exactly the positions the
crashed process would have drawn.

Both are correct, for different failure modes, and the phase has to say which
applies when:

- **Snapshot intact** — replay the gap. The redraw is not a reuse: it reproduces
  the same ticks the same market would have had, which is what INV-009 requires.
- **Snapshot lost or unusable** — fall back to the leased high-water mark and
  accept a seam, because continuing to publish from an unknown latent state is
  worse than a discontinuity.

Getting this backwards is the interesting failure: replaying from a _stale_
snapshot after new ticks were already published would republish different prices
for instants observers have already seen, which breaks INV-002 outright.

### 2.3 Catch-up must be bounded, and the bound is a product decision

Replaying five minutes of a one-second market is 300 ticks — microseconds of
work at 800k ticks/s. Replaying three weeks is 1.8 million ticks per asset, still
seconds. But there is a horizon past which "catch up" is the wrong answer and the
honest answer is that the venue was closed. Where that line sits, and what a
client is told about the gap, is a product question this phase must surface
rather than silently pick.

### 2.4 The engine must not learn about I/O

`packages/engine` and the price path in `packages/core` are economically blind
and framework-free, enforced by the guardrail scan. A runtime is the natural
place for that to erode: a persistence hook inside the engine, a clock read in
the magnitude path, an asset id that arrives with a request context attached.
The scaffolding must be arranged so the batteries can still drive the engine
directly, with no NestJS anywhere in the dependency graph below `apps/api`.

## 3. Expected product value

A market that is simply _there_: five assets ticking continuously, surviving
deploys and crashes without a visible seam, and answering "what was the price at
12:05" identically for everyone who asks.

## 4. Scope

- A framework-free runtime core: a hosted market that advances against an
  injected clock and emits ticks at their scheduled instants.
- A `StateStore` boundary with a durable implementation: snapshots plus leased
  cursor high-water marks.
- Restart continuity across a **real process boundary**, not in-process.
- The recovery policy of §2.2, implemented and tested on both branches.
- NestJS scaffolded in `apps/api`, hosting the PH-4 catalogue.
- Health and state endpoints sufficient to observe the runtime. Public market
  distribution and multi-user consistency are PH-7.

## 5. Exclusions

- Contracts, settlement, positions, payout — PH-6. Nothing economic enters here.
- Public/multi-user distribution semantics and fan-out — PH-7.
- Any frontend — PH-8.
- A production database. The store is an interface with a durable local
  implementation; choosing a hosted engine is a PH-7 concern, and doing it now
  would be guessing at a load profile that does not exist.

## 6. Architectural direction

### 6.1 The runtime owns the clock; the engine is still given one

`SystemClock` is the one sanctioned ambient time read in the codebase and it
already exists. The runtime reads it; the engine continues to receive time as
data. Nothing in `packages/engine` gains a dependency.

### 6.2 Snapshot cadence is a recovery-cost decision, not a tuning knob

The gap replayed on restart is bounded by the snapshot interval plus the outage.
Snapshotting is cheap — 584 bytes, and PH-4's composed restore path is now
tested — so the interval should be set by how much replay is acceptable, and
written down as that.

### 6.3 The seam must stay invisible to the battery

PH-3 established that a restart seam is not detectable in the return statistics.
That was proven in-process. It has to survive being real, and the same test has
to be runnable against a runtime that actually stopped and started.

## 7. Phase invariants

- INV-002 and INV-008 are the phase's subject: same price for every observer at
  every instant, across restarts, with no reset.
- INV-009 strengthens: settlement-grade reproduction now has to work from
  persisted records rather than from an in-process snapshot.
- INV-010 must survive persistence. A snapshot on disk containing key material
  would be a far worse leak than one in memory.

## 8. Dependencies

PH-4's catalogue and PH-1's entropy, leasing and time model. All approved.

## 9. Initial decomposition strategy

Provisional:

- **PH-5.1** — runtime core: hosted market, scheduling against an injected clock,
  multi-asset supervision.
- **PH-5.2** — sealed persistence: the store boundary, snapshot cadence, leased
  cursors, and the recovery policy on both branches.
- **PH-5.3** — NestJS service, catalogue hosting, and phase integration including
  a real process-boundary restart.

## 10. Acceptance intent

A service that hosts all five assets, is killed uncleanly, is restarted, and
resumes with prices that agree at every instant with what a continuously running
observer recorded — with the seam invisible to the battery and no key material
anywhere in the persisted state.

## 11. Risks and unknowns

| Risk                                                                | Assessment                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Replay from a stale snapshot republishing already-observed instants | The central correctness risk; §2.2 exists for it.                                                   |
| The engine acquiring an I/O or framework dependency by convenience  | Real. The guardrail scan covers vocabulary, not dependency direction — this phase should extend it. |
| Persisted state leaking key material                                | Real, and cheap to test for. PH-1 found exactly this defect in memory.                              |
| Catch-up horizon chosen silently                                    | Surfaced in §2.3 rather than picked.                                                                |
