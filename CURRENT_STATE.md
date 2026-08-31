# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-08-31

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                                                                   |
| -------------------------------- | ----------------------------------------------------------------------- |
| Active development cycle         | Cycle 3                                                                 |
| Approved phases in current cycle | **0 of 3**                                                              |
| Cycle Audit state                | None active — next due after three more phases                          |
| Last Cycle Audit                 | [Cycle Audit 002](docs/audits/CYCLE-AUDIT-002.md) — APPROVED 2026-08-31 |

## Phase and subphase

| Field                  | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| Active phase           | None — PH-7 is next to be created                                  |
| Phase lifecycle        | n/a                                                                |
| Active subphase        | None                                                               |
| Subphase lifecycle     | n/a                                                                |
| Last approved phase    | PH-6 — Trading Boundary: contracts, settlement, economic blindness |
| Last approved subphase | PH-6.2 — The trading boundary and verified economic blindness      |

## Cycle 1 result

The cycle existed to settle one question: can a synthetic market be
simultaneously plausible and provably unexploitable, with executed evidence for
both?

**It can.** On 24 million ticks spanning 327 simulated days, one asset is:

|                              | Result                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Unexploitable                | clean verdict across ~570 hypotheses and all four attack feature kinds                   |
| At a resolution that matters | 30-second detection floor 0.217pp, finer than the 0.2513pp margin the 99% payout implies |
| Plausible                    | 15/15 realism metrics, targets fixed before the model existed                            |
| Structurally guaranteed      | mirror test passes with zero divergences                                                 |

## Blockers

None. Development is paused at the Governance Human Gate (`GOVERNANCE.md` §28),
not blocked.

## Pending protected Human decisions

None blocking. Two are recorded for later escalation:

1. **At-the-money settlement policy** — refund or loss when a contract expires
   exactly at the entry price. Needed at PH-6. Recommendation: **void and
   refund**; ADR-0003 §3 shows this is the only remaining way the architecture
   could produce a directional edge, since `P(up) = P(down)` holds exactly.
2. **Fairness-proof mechanism** — whether the product publishes verifiable
   settlement proofs, and in what form. Relevant at PH-6/PH-9. Recommendation:
   Merkle roots of the tick journal with inclusion proofs, never disclosure of
   generator keys.

Infrastructure item requiring the Human Owner: `main` was pushed to
`origin → https://github.com/NovaHub2026/otcv6` on 2026-08-31 (commit `6766b8a`,
20 commits). The CI workflow triggered correctly and **could not run**:

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased.

So hosted CI still has not executed, and the reason is now an account billing
state rather than a missing push. This is the one thing a local gate cannot
substitute for — PH-4 lost a phase gate to a failing lint that two subphase
approvals had recorded as passing, precisely because no independent check ever
ran (`docs/BACKLOG.md` B-001).

Cycle Audit 001 found this stated as "no remote configured" throughout PH-1, PH-2
and PH-3. The remote existed the whole time; the claim was asserted repeatedly
without ever running `git remote -v`. See [Cycle Audit 001](docs/audits/CYCLE-AUDIT-001.md).

## Verification state

Executed 2026-08-31 during Cycle Audit 2, on the post-fix tree.

| Check                            | Status                                   |
| -------------------------------- | ---------------------------------------- |
| `npm run format:check`           | PASSED (exit 0)                          |
| `npm run lint`                   | PASSED (exit 0)                          |
| `npm run build` (full typecheck) | PASSED (exit 0)                          |
| `npm run test` (both suites)     | see the Cycle Audit 2 record             |
| Hosted CI                        | BLOCKED — GitHub Actions account billing |

Cycle 1's numbers, and the coverage figure, are in
[`docs/evidence/CYCLE-1-VERIFICATION.md`](docs/evidence/CYCLE-1-VERIFICATION.md).
They were presented here as the project's current verification state until Cycle
Audit 2 re-executed them and found both re-checkable rows false.

## Known limitations carried forward

- Only the 30-second horizon is policed to the promotional-payout threshold.
  Independent samples at a horizon are fixed by simulated duration, so the
  15-minute horizon needs roughly a hundred times the history. Every verdict
  states the floor it achieved.
- Assets differ mostly in pace and scale; scale-free _shape_ differentiation is
  weak (30.0% against a 20% null). Tracked as B-004.
- Per-asset battery floors (0.562pp) sit above the 0.2513pp product margin.
  PH-3's full-rigor run covers the canonical configuration at 0.217pp.
- The venue is single-node and read-only; clients poll. Distribution, fan-out and
  a tick feed are PH-7.
- The catch-up bound is a default with defined behaviour, not a decided venue
  policy. It needs an owner before a real venue runs.

## Relevant records

| Kind     | Reference                                                                    |
| -------- | ---------------------------------------------------------------------------- |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                    |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED) |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)            |
| ADR-0005 | A multifractal cascade as the volatility process (APPROVED)                  |
| ADR-0006 | A layered sign-blind market model (APPROVED)                                 |
| ADR-0007 | At-the-money settlement: a tie is refunded (APPROVED, Human Owner)           |
| Backlog  | `docs/BACKLOG.md` B-001 … B-005                                              |
| Roadmap  | `docs/phases/ROADMAP.md`                                                     |
| Branch   | `main` — every phase branch merged and deleted                               |

---

## EXACT NEXT LEGAL ACTION

**Cycle Audit 001 is APPROVED and closed.** Fourteen findings were raised and all
fourteen resolved within the audit; the record is
[`docs/audits/CYCLE-AUDIT-001.md`](docs/audits/CYCLE-AUDIT-001.md). The cycle
counter has been reset and Cycle 2 has begun.

**Cycle Audit 002 is APPROVED and closed.** 31 confirmed material findings, 40
minor, 2 refuted, and 103 recorded claims re-executed and held. The record is
[`docs/audits/CYCLE-AUDIT-002.md`](docs/audits/CYCLE-AUDIT-002.md). The cycle
counter has been reset and Cycle 3 has begun.

Read §2 of that record before anything else: an audit agent's deliberately
planted INV-001 backdoor was swept into `main` by a concurrent `git add -A`. It
never reached `origin`, and `main` was reset and re-committed clean — but it is
the most serious process failure in the project's history, and the rule it
produced is standing: **never `git add -A` while subagents are running, and keep
audit plants in an isolated clone.**

**Create the PH-7 Phase Context Document** — public market distribution and
multi-user consistency — on branch `feature/ph-7-distribution`. It opens Cycle 3.

Two things Cycle 2 hands it directly:

- The economic-blindness demonstration covers a **single process**. PH-7 separates
  trading and price generation across a network boundary, and the claim has to be
  re-established there.
- The venue is single-node and read-only; clients poll. A tick feed, fan-out and
  multi-user consistency semantics are PH-7's subject.

No Human authorization is required to proceed (`GOVERNANCE.md` §32).
