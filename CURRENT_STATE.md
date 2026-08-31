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
| Approved phases in current cycle | **2 of 3** (PH-1, PH-2)                             |
| Cycle Audit state                | NOT PENDING — becomes pending when PH-3 is APPROVED |
| Last Cycle Audit                 | None                                                |

## Phase and subphase

| Field                  | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| Active phase           | PH-3 — Core Generative Market Process Under Continuous Falsification |
| Phase lifecycle        | ACTIVE                                                               |
| Active subphase        | PH-3.1 — Sign-blind engine skeleton and the mirror test              |
| Subphase lifecycle     | ACTIVE                                                               |
| Last approved phase    | PH-2 — Calibrated Adversarial Predictability Laboratory              |
| Last approved subphase | PH-2.3 — Realism battery and the combined report                     |

## Current objective

Build the real generative market model inside a generate → attack → diagnose →
correct loop against the PH-2 laboratory, until one asset simultaneously passes
the realism battery and the anti-predictability verdict.

The architecture is fixed by ADR-0003 and ADR-0004: increments are a **sign-blind
magnitude times an independent fair coin**, accumulated on an **integer log
lattice**. All richness lives in the magnitude and timing process. The **mirror
test** is the primary structural gate.

## Blockers

None.

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

Non-blocking infrastructure item: **no GitHub remote exists** (`docs/BACKLOG.md`
B-001), so history is local-only and hosted CI has never executed.

## Verification state

| Check                            | Status                              |
| -------------------------------- | ----------------------------------- |
| `npm run format:check`           | PASSED                              |
| `npm run lint`                   | PASSED                              |
| `npm run build` (full typecheck) | PASSED                              |
| `npx vitest run`                 | PASSED                              |
| Hosted CI                        | NOT EXECUTED — no remote configured |

## Known limitations carried forward

- The validation laboratory currently policies only the 30-second horizon to the
  0.2513pp threshold implied by the 99% promotional payout. Longer horizons need
  proportionally more simulated time, and every verdict states the floor it
  achieved.

## Relevant records

| Kind     | Reference                                                                    |
| -------- | ---------------------------------------------------------------------------- |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                    |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED) |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)            |
| Backlog  | `docs/BACKLOG.md` B-001                                                      |
| Roadmap  | `docs/phases/ROADMAP.md`                                                     |
| Branch   | `feature/ph-3-generative-market-process`                                     |

---

## EXACT NEXT LEGAL ACTION

Continue autonomous implementation of **PH-3.1** per
`docs/phases/PH-3.1-sign-blind-engine-and-mirror-test.md`.
