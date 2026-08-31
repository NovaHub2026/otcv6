# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-08-31

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                                               |
| -------------------------------- | --------------------------------------------------- |
| Active development cycle         | Cycle 1                                             |
| Approved phases in current cycle | **1 of 3** (PH-1)                                   |
| Cycle Audit state                | NOT PENDING — becomes pending when PH-3 is APPROVED |
| Last Cycle Audit                 | None                                                |

## Phase and subphase

| Field                  | Value                                                      |
| ---------------------- | ---------------------------------------------------------- |
| Active phase           | PH-2 — Calibrated Adversarial Predictability Laboratory    |
| Phase lifecycle        | ACTIVE                                                     |
| Active subphase        | PH-2.1 — Public-observer dataset and the attack contract   |
| Subphase lifecycle     | ACTIVE                                                     |
| Last approved phase    | PH-1 — Deterministic Market Substrate                      |
| Last approved subphase | PH-1.4 — Simulation runner and planted-edge fixture corpus |

## Current objective

Build and **calibrate** the instrument that decides project success: a
public-observer attack battery measuring directional edge at the eight binary
horizons, paired with a realism battery. Its acceptance is about the instrument,
not the market — it must detect every planted edge at or above a declared minimum
detectable effect, report nothing on the control, and publish power curves.

## Blockers

None.

## Pending protected Human decisions

None blocking. Two are recorded for later escalation and do **not** block work:

1. **At-the-money settlement policy** — refund or loss when a contract expires
   exactly at the entry price. A settlement rule with material business
   consequence (`GOVERNANCE.md` §5). Needed at PH-6. Recommendation: **void and
   refund** — ADR-0003 §3 shows this is the only remaining way the architecture
   could produce a directional edge, since `P(up) = P(down)` holds exactly.
2. **Fairness-proof mechanism** — whether the product publishes verifiable
   settlement proofs, and in what form. Relevant at PH-6/PH-9. Recommendation:
   Merkle roots of the tick journal with inclusion proofs, never disclosure of
   generator keys.

Non-blocking infrastructure item: **no GitHub remote exists** (`docs/BACKLOG.md`
B-001), so history is local-only and hosted CI has never executed.

## Verification state

| Check                            | Status                              |
| -------------------------------- | ----------------------------------- |
| `npm run format:check`           | PASSED                              |
| `npm run lint`                   | PASSED                              |
| `npm run build` (full typecheck) | PASSED                              |
| `npx vitest run`                 | PASSED — 381 tests, 22 files        |
| Coverage (unit)                  | 99.74% statements, 98.37% branches  |
| Hosted CI                        | NOT EXECUTED — no remote configured |

## Relevant records

| Kind     | Reference                                                                                |
| -------- | ---------------------------------------------------------------------------------------- |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                                |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                            |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED)             |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)                        |
| Backlog  | `docs/BACKLOG.md` B-001                                                                  |
| Roadmap  | `docs/phases/ROADMAP.md`                                                                 |
| Branch   | `feature/ph-1-deterministic-market-kernel` (PH-1 work; PH-2 continues on its own branch) |

---

## EXACT NEXT LEGAL ACTION

Continue autonomous implementation of **PH-2.1** per
`docs/phases/PH-2.1-observer-dataset-and-attack-contract.md`.
