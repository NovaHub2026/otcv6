# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-08-31

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                                                                     |
| -------------------------------- | ------------------------------------------------------------------------- |
| Active development cycle         | Cycle 1                                                                   |
| Approved phases in current cycle | 0 of 3                                                                    |
| Cycle Audit state                | NOT PENDING — becomes pending when the third phase of Cycle 1 is APPROVED |
| Last Cycle Audit                 | None                                                                      |

## Phase and subphase

| Field                  | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| Active phase           | PH-1 — Deterministic Market Kernel                                   |
| Phase lifecycle        | ACTIVE                                                               |
| Active subphase        | PH-1.1 — Canonical time model and deterministic entropy architecture |
| Subphase lifecycle     | ACTIVE                                                               |
| Last approved phase    | None                                                                 |
| Last approved subphase | None                                                                 |

## Current objective

Establish the deterministic substrate every later capability depends on: a
canonical time model, a keyed counter-based entropy architecture giving
reproducible replay with cryptographic public unpredictability, the market
domain primitives, and coherent tick-to-candle aggregation across timeframes.

## Blockers

None.

## Pending protected Human decisions

None blocking. Two items are recorded for a future decision point and do **not**
block current work:

1. **GitHub remote creation** (`docs/BACKLOG.md` B-001) — creating a repository
   under the Human Owner's account is outward-facing, so it is offered rather
   than performed. Until then Git history is local-only and hosted CI has not
   executed.
2. **At-the-money settlement policy** — whether a contract expiring exactly at
   the entry price is refunded or lost is a settlement rule with material
   business consequence (`GOVERNANCE.md` §5). It is not needed before the
   settlement phase and will be escalated then with a recommendation.

## Verification state

| Check                            | Status                              |
| -------------------------------- | ----------------------------------- |
| `npm run build` (full typecheck) | PASSED                              |
| `npm run lint`                   | PASSED                              |
| `npm run format:check`           | PASSED                              |
| `npx vitest run`                 | PASSED                              |
| Hosted CI                        | NOT EXECUTED — no remote configured |

## Relevant records

| Kind    | Reference                                                            |
| ------- | -------------------------------------------------------------------- |
| ADR     | ADR-0001 — Repository, toolchain and package architecture (APPROVED) |
| Backlog | `docs/BACKLOG.md` B-001                                              |
| Roadmap | `docs/phases/ROADMAP.md`                                             |

---

## EXACT NEXT LEGAL ACTION

Continue autonomous implementation of **PH-1.1** per
`docs/phases/PH-1.1-time-and-entropy.md`.
