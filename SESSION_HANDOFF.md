# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                          |
| ------------------ | -------------------------------------------------------------- |
| Last clean session | 2026-08-31                                                     |
| Branch             | `feature/ph-10-market-rhythm` — PH-10 approved, ready to merge |
| Remote             | `origin` → NovaHub2026/otcv6 — pushed, in sync                 |
| Active cycle       | Cycle 4, **1 of 3** phases approved                            |
| Active phase       | PH-11 — next to be created                                     |
| Active subphase    | none                                                           |
| Cycle Audit        | 003 **APPROVED** — next due after PH-10/11/12                  |
| Blockers           | none                                                           |

## Completed

- **PH-1 APPROVED** — deterministic substrate: canonical time, keyed
  counter-addressable entropy with cursor leasing, portable elementary
  functions, distribution samplers, the integer log-lattice market domain,
  tick-to-OHLC projection, snapshot and replay across a restart seam,
  architecture guardrails, a simulation runner and the planted-edge corpus.
- **PH-2 APPROVED** — the validation laboratory: observer dataset, economic edge
  metric, statistical core with FDR and block bootstrap, twenty attack families
  across four feature kinds, a held-out confirmation split, the realism battery,
  and a combined report.
- **PH-3 APPROVED** — the generative market model: sign-blind magnitude and a
  fair coin, a multifractal volatility cascade, volatility regimes, structure
  phases, self-exciting arrivals, duration coupling, and the mirror test.
- **Cycle Audit 001 APPROVED** — fourteen findings, all resolved within the
  audit. Five were material: INV-005 had no enforcement at all, the composed
  snapshot/restore path was never exercised, two of five packages were missing
  from canonical documentation, no invariant→evidence map existed, and the Git
  remote was misdescribed in twelve documents. Two guardrails were added so the
  same class of defect fails the build rather than waiting for an audit.
- **PH-4 APPROVED** — the asset personality system: seven bounded traits per
  asset, an analytic volatility-inflation gate that rejects unsafe combinations
  in microseconds, per-asset lattice calibration derived from each asset's own
  30-second return distribution, a five-asset catalogue, and a differentiation
  metric with a reachable null. INV-007 promoted to enforced.
- **PH-5 APPROVED** — the runtime: hosted markets that advance with the clock
  rather than with polling, sealed state persistence with an explicit recovery
  policy, and a NestJS service that survives SIGKILL and resumes every market.
- **PH-6 APPROVED** — the trading boundary: contracts, deterministic settlement
  computed from the published record alone, and the demonstration that closes
  INV-001. Identical tick streams between a quiet market and one under heavy
  adversarial trading, on all five assets.
- **PH-8 APPROVED** — the observer frontend: a rendering contract that invents no
  price and hides no extreme, a client that reconstructs the server's record
  across a disconnection, Next.js 15 and React 19 scaffolded.
- **PH-7 APPROVED** — public market distribution: a sequence-addressed feed that
  disconnects rather than degrades, exact resumption, and INV-002 re-established
  across concurrent observers, a real socket, and two nodes under clock skew.
- **PH-9 APPROVED** — continuous integrity assurance: attack families withheld
  from all tuning, a guardrail suite audited by mutation, and a verdict a
  counterparty can recompute from the published record with no key.
- **Cycle Audit 003 APPROVED** — one material finding, fixed. Its §1 records that
  it was run by the authoring agent and that Cycle 4's must not be (B-008).
- **PH-10 APPROVED** — per-asset market rhythm. The cascade's time structure,
  regime tempo and arrival memory moved into the personality vector; the
  catalogue was re-authored so the five assets differ in the ladder of timescales
  their volatility moves on. Scale-free shape differentiation 30.0% to 40.5%
  against a 20% null, p = 0.005, with amplitude and tail weight pinned so the
  gain is attributable. B-004 closed.
- **Cycle Audit 002 APPROVED** — 31 material findings, all fixed; 103 claims
  re-executed and held. Read §2 first: an audit plant reached `main` via a
  concurrent `git add -A`, was never pushed, and was excised.
- ADRs 0001–0007 persisted. ADR-0007 records the Human Owner's at-the-money
  decision: a tie is refunded.

## Incomplete

Nothing is in progress. Cycle 2 is complete and development is paused at the
Governance Human Gate.

## Last executed verification

Full gate green at the close of Cycle Audit 001 — `format:check`, `lint`,
`build`, and `test:cov` across both projects: **713 tests, 44 files, 0 failed**,
98.04% statement coverage. Phase acceptance run: 24M ticks, 327 simulated days,
verdict clean at a 0.217pp detection floor, realism 15/15, mirror test zero
divergences. Recorded in
[`docs/evidence/CYCLE-1-VERIFICATION.md`](docs/evidence/CYCLE-1-VERIFICATION.md).

Hosted CI has still never executed. `main` was pushed on 2026-08-31 and the
workflow triggered, but GitHub Actions refused to start the job: "recent account
payments have failed or your spending limit needs to be increased". This needs
the Human Owner (`docs/BACKLOG.md` B-001).

## Continuation point

Read `CURRENT_STATE.md`. Cycle 1 is closed and its audit is approved, so
development continues **without further Human authorization**
(`GOVERNANCE.md` §32).

Read `CURRENT_STATE.md`. Cycle 2 is closed and its audit approved, so development
continues **without further Human authorization** (`GOVERNANCE.md` §32).

Create the **PH-11 Phase Context Document** — detection power across every
horizon the product sells — on `feature/ph-11-detection-power`. It closes B-002
(only the 30-second horizon is policed to the threshold the 99% payout implies)
and B-003 (`tools/*` is excluded from coverage measurement).

Start from what PH-10 established, not from B-002's original framing: **every
statistic of this market is limited by simulated duration, not by sample count.**
The volatility process has memory measured in days, so consecutive observations
are never independent draws. That one fact is behind Cycle Audit 2's binomial
finding on INV-007, behind B-002's hundred-fold history requirement at 15
minutes, and behind the lattice tie rates PH-10.2 had to re-measure over 15
replicates. Simulating longer is one answer; an estimator that respects the
dependence is probably a better one.

Standing rules, all learned the hard way:

- **A guard is not finished until it has been watched failing.** Every material
  finding in Cycle Audit 2 was a guard that existed, was documented as
  sufficient, and had never been tested against the thing it guarded against.
- **A recorded number that nothing reads is a comment.** PH-10 found
  `MEASURED_LATTICE_TIE_RATES` — the rate at which stakes are refunded — stale
  and unfalsifiable.
- **Never `git add -A` while subagents are running**, and keep audit plants in an
  isolated clone.
- **A long test body must yield to the event loop** (`CLAUDE.md` §5). The gate
  otherwise exits 1 with every test reported as passing. It has happened twice.

Before changing anything in the engine, read the last section of `CLAUDE.md`.
