# PH-25 — The Battery Against A Production Venue's Own Record

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-25
Status: APPROVED
Approved: 2026-09-05 — from the integrated phase verification in §9
Cycle: 9 (phase 2 of 3)
Created: 2026-09-04
Branch: `feature/ph-25-production-record-battery`

---

## 1. What is actually unknown

Every adversarial run in this repository builds its own engine, or runs against
the Lab's composition. `runValidation` takes an `ObserverDataset` built from a
`MarketEngine` the test constructs; `multiAsset.stat.test.ts` calls
`engineFor(index)`; the Lab's quality verdict runs on a fork of a hosted
market. **Nothing attacks the feed a real observer reads** — the sequence of
ticks that leaves `apps/api` over the distribution path, after retention,
after the candle fold, after a restart seam, after a checkpoint resume, after
whatever a production composition does to a stream between the engine and the
socket.

That is a gap in evidence rather than a suspected defect, and it is the one
thing Cycle Audit 8 refused to close with a fix because it is not one (a1,
carried to the roadmap). The invariants it bears on are the ones the whole
product rests on: INV-002 (the same price for every observer), INV-003 (one
underlying stream), INV-006 (no exploitable rule), INV-009 (reproducible
settlement). The unit and statistical suites grade all four "Enforced" from
evidence taken inside the process. The question this phase answers is whether
the market a customer can see is the market the tests certified.

## 2. Why this phase, and why now

Because the catalogue it would measure now exists. PH-26 replaced the five
hand-authored assets with the thirty that will ship, so a battery run against
the served record is a statement about the product rather than about a
fixture. And because Cycle 9 owes a review phase after it (PH-27): a review
that had never seen the production record attacked would be reviewing a
guarantee it could not have checked.

## 3. What this phase may not do

- **It may not read anything an observer cannot.** The instrument consumes the
  public surface — `GET /markets/:id/stream`, `/history`, `/catalogue` — and
  nothing else. A battery that peeked at engine state would be measuring the
  engine again.
- **It may not touch the price path.** `packages/engine` and the generation
  code in `packages/core` are not in scope; INV-001 and INV-006 are not
  reachable from an observer.
- **It may not weaken a sensitivity floor to make a verdict fit.** A cell the
  served record cannot police at the payout threshold is recorded as unpoliced,
  with the reason.

## 4. Phase invariants

INV-002, INV-003, INV-006 and INV-009 are what is measured; INV-001, INV-005
and INV-010 are what the instrument must not violate while measuring.

## 5. Subphases

| Subphase | Title                                                            |
| -------- | ---------------------------------------------------------------- |
| PH-25.1  | An observer that builds a dataset from the served record alone   |
| PH-25.2  | The battery on the served record, across a restart and a resume  |
| PH-25.3  | The recorded verdict, and the standing job that keeps it current |

## 6. What "the served record" means here

The `ObserverDataset` the battery consumes is built today from an engine. PH-25.1
builds it from an SSE client instead: connect, resume from sequence 1, read to a
target instant, fold nothing, and hand the battery exactly the ticks a browser
would have held. Two observers on two connections must produce byte-identical
datasets (INV-002), and a dataset built across a deliberate restart of the
service — checkpoint, kill, resume — must be the continuation the engine would
have produced uninterrupted (INV-008), which the record's seam markers must
explain when it is not.

## 7. What the phase leaves open, deliberately

The multi-node composition (PH-14) is not hosted by the shipped service and is
not attacked here. A battery against a fleet is a different instrument, and
`docs/architecture/MULTI_NODE_AND_OPERATIONS.md` records that the shipped
`apps/api` composes none of it.

## 8. What the phase found

The instrument was the point, and the instrument's first use produced the
phase's results (PH-25.1 §5, PH-25.2 §5, PH-25.3 §5):

1. **The venue joined a told-gap client at the live edge, past ticks it
   retained** — nine of them on the first run. Fixed in both stream
   endpoints: the `gap` frame is written first, names `resumesAt`, and the
   retained window follows it. Guarded in `adminSurface.test.ts`, watched
   failing. Issue #22 is closed by this.
2. **The replay window is process-local.** A restart forgets everything
   published before the resume point; a client holding an older sequence is
   refused as evicted though nothing was evicted. The ticks are reproducible
   (INV-009) and unservable. Measured, asserted as the honest behaviour, and
   carried to the improvement report as the first item of Cycle 10.
3. **A SIGKILL costs the candle record up to the minute it fell in** — the
   open bar dies with the process and the resumed recorder withholds the
   partial bucket (CA6-30). Measured at 0 and 1 bars spanning the hole on two
   runs, printed rather than asserted; same fix as 2.
4. **The battery through the wire loses nothing**: a Thue–Morse record
   served as frames is `exploitable`; the venue's own served record is
   `undecided` at the sizes read, never `exploitable`, with its floors named —
   an hour of record on 31 assets after a boot, 21–31pp at 30 s.
5. **The state guard sorted by number, not by chronology**, and named PH-26.4
   as the latest approved subphase the day PH-25.1 was approved. Anchored on
   the roadmap's phase order, watched failing.

## 9. Integrated phase verification

| Check                                                                            | Result                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every subphase document APPROVED and the roadmap agrees                          | `documentation.test.ts`, `stateConsistency.test.ts` green                                                                                                                                                                                                                                       |
| The observer imports the public read surface only                                | the boundary scan in `servedRecord.test.ts`, watched failing against a planted `@otc/fixtures` import                                                                                                                                                                                           |
| Two observers, the stored record, a kill; the battery alone and joined across it | `servedRecord.stat.test.ts`, 2 tests, 345.9 s, six runs recorded in PH-25.1 §5                                                                                                                                                                                                                  |
| The job as a scheduler runs it                                                   | `servedAssuranceJob.test.ts`, exit 2 on a leak, 1 on a refusal                                                                                                                                                                                                                                  |
| Anti-predictability after the stream change (no price path touched)              | the mirror tests and the full battery in the gate below                                                                                                                                                                                                                                         |
| Phase quality gate `npm run gate` with the browser prefix                        | `GATE_EXIT=0` on the first attempt — format, build, `typecheck:web`, `typecheck:config`, lint, unit 140 files / 2,973 tests in 108 s, statistical 44 files / 395 tests in 4,352 s (72.5 min, the browser suites included), `GATE COMPLETE`; started 06:26:57Z, finished 07:42:15Z, on `79c63c3` |
| Hosted CI on the merge commit                                                    | recorded in `CURRENT_STATE.md` when the run on the merge commit lands                                                                                                                                                                                                                           |
