# PH-5.2 — Sealed state persistence and the recovery policy

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-5.2
Parent phase: PH-5 — Continuous Runtime, Sealed State Persistence and Restart Continuity
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Let a market survive the death of the process that was running it, and be
explicit about the cases where it cannot.

## 2. The record, and why it has three fields

A checkpoint is `(snapshot, pending, lastPublished)`, and the relationship
between them is the design:

- `snapshot` is the engine's latent state **after** every draw it has made,
  including a tick that was generated but is not yet due;
- `pending` is that tick, held separately;
- `lastPublished` is what observers have actually seen.

`pending` exists because restoring the snapshot alone **skips a tick**. The
snapshot is taken after every draw, so a restored engine's next tick is the one
_after_ the pending one. Losing it is the quietest possible way to break replay:
nothing errors, the market simply omits a price that observers may already have.

## 3. The recovery policy

Two branches, pulling in opposite directions, both correct for different
failures.

**Snapshot intact — continue.** Restore the latent state and let the clock pull
the market forward. Ticks published before the crash but never persisted are
regenerated, drawing the _same_ keystream positions again. That is not a reuse:
deterministic replay reproduces identical ticks, which is exactly what INV-009
asks for, and it keeps INV-002 true for an observer who saw them the first time.

**Snapshot unusable — take the seam.** Start from the last published price with
every stream moved past its leased high-water mark. The internal state genuinely
restarts, and the outcome says `seam` rather than `resumed`, because calling it a
resumption would be a lie an operator would later have to debug.

The check separating them is executed rather than assumed: a restored snapshot
must agree with the record's own pending tick, on both sequence and price. A
disagreement means the record does not describe this engine, and continuing would
publish a different market than observers already saw.

## 4. The finding: a corrupt record is more dangerous than a missing one

The first implementation treated an unparseable record as absent, returning
`null` and starting fresh. A test caught it, and the reasoning is worth keeping.

A **missing** record means nothing ever ran, so starting at genesis is safe. A
**corrupt** record means something did run and its lease marks are gone.
Restarting from genesis would then re-consume keystream positions already spent —
the precise failure cursor leasing was built to prevent — and publish a second,
different market under the same asset id, with observers on either side of the
restart holding irreconcilable histories.

There is no safe automatic recovery: the information needed to seam is the thing
that was lost. So the market **refuses to start** and an operator decides.
`CorruptRecordError` says so in those terms.

This is the second time in the project that the dangerous case turned out to be
the one that _looks_ like the benign one — the first was PH-1's leverage effect,
a three-line change that reads as an improvement and is worth 2.9 percentage
points of edge.

## 5. Scope

- `MarketStateRecord`, `StateStore`, and the record's validity rules.
- `FileStateStore` — one JSON file per asset, atomic by `rename`, so a crash
  mid-save leaves either the old record or the new one, never a torn one.
- `MemoryStateStore` — for tests, and for a runtime that must not persist.
- `checkpointMarket` and `resumeMarket`, including both recovery branches.
- Leases written _ahead_ of the engine's position on every checkpoint.

## 6. Acceptance criteria

1. A checkpointed and resumed market publishes **exactly** the ticks an
   uninterrupted market would have.
2. The pending tick survives the restart.
3. A gap in wall-clock time is replayed on resume.
4. A structurally invalid record produces a seam, not a silent resumption, and
   the seam starts beyond every leased position.
5. A corrupt record refuses to start.
6. Persisted state contains no key material.

## 7. Approval record

**APPROVED** from executed evidence, 2026-08-31.

### Verification executed

| Check                         | Result            |
| ----------------------------- | ----------------- |
| `npm run format:check`        | PASSED (exit 0)   |
| `npm run lint`                | PASSED (exit 0)   |
| `npm run build`               | PASSED (exit 0)   |
| `packages/runtime` unit tests | PASSED — 26 tests |

The headline test runs two markets in lockstep — one straight through, one
checkpointed, destroyed and resumed — and requires their published ticks to be
**identical arrays**, not merely statistically similar.

Persisted records are checked for key material two ways: a structural walk for
hex runs of 32 characters or more, and a regex over the serialised form. A full
record is under 4 kB.

### Known limitations carried forward

- Checkpoint cadence is the caller's decision; nothing schedules it yet. PH-5.3
  wires it to the service loop.
- Recovery has been exercised across an in-process restart and a real
  filesystem, but not yet across a real **process** boundary. That is PH-5.3's
  integration test and the phase's acceptance intent.
