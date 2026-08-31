# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-08-31

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                           |
| -------------------------------- | ------------------------------- |
| Active development cycle         | Cycle 1                         |
| Approved phases in current cycle | **3 of 3** (PH-1, PH-2, PH-3)   |
| Cycle Audit state                | **PENDING HUMAN AUTHORIZATION** |
| Last Cycle Audit                 | None                            |

## Phase and subphase

| Field                  | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| Active phase           | None — development is paused at the Governance Human Gate            |
| Phase lifecycle        | n/a                                                                  |
| Active subphase        | None                                                                 |
| Subphase lifecycle     | n/a                                                                  |
| Last approved phase    | PH-3 — Core Generative Market Process Under Continuous Falsification |
| Last approved subphase | PH-3.4 — Canonical engine, restart continuity, and phase validation  |

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

- Only the 30-second horizon is policed to the promotional-payout threshold.
  Independent samples at a horizon are fixed by simulated duration, so the
  15-minute horizon needs roughly a hundred times the history. Every verdict
  states the floor it achieved.
- One asset, one parameter set. Personalities are PH-4.
- The engine has never run continuously; restart continuity is proven in-process
  only. A durable store and a runtime arrive in PH-5.

## Relevant records

| Kind     | Reference                                                                    |
| -------- | ---------------------------------------------------------------------------- |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                    |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED) |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)            |
| ADR-0005 | A multifractal cascade as the volatility process (APPROVED)                  |
| ADR-0006 | A layered sign-blind market model (APPROVED)                                 |
| Backlog  | `docs/BACKLOG.md` B-001                                                      |
| Roadmap  | `docs/phases/ROADMAP.md`                                                     |
| Branch   | `main`; PH-2 and PH-3 were developed on `feature/ph-2-and-ph-3`, now merged  |

---

## EXACT NEXT LEGAL ACTION

**Await the Human `EJECUTA` command**, which authorizes the pending Cycle Audit
(`GOVERNANCE.md` §29).

No new phase may begin until that audit has been authorized and completed
successfully (`GOVERNANCE.md` §28). On `EJECUTA`, perform the comprehensive Cycle
Audit over PH-1, PH-2 and PH-3 — product coherence, architecture, implementation
quality, integrated verification, security and reliability, performance,
technical debt, documentation, Memory Audit, Cold Start Audit and Git integrity —
fix delegated findings autonomously, then create PH-4 and resume.
