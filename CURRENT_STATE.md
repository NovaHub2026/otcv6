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
| Active development cycle         | Cycle 2                                                                 |
| Approved phases in current cycle | **0 of 3**                                                              |
| Cycle Audit state                | None active — next due after three more phases                          |
| Last Cycle Audit                 | [Cycle Audit 001](docs/audits/CYCLE-AUDIT-001.md) — APPROVED 2026-08-31 |

## Phase and subphase

| Field                  | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| Active phase           | None — PH-5 is next to be created                              |
| Phase lifecycle        | n/a                                                            |
| Active subphase        | None                                                           |
| Subphase lifecycle     | n/a                                                            |
| Last approved phase    | PH-4 — Asset Personality System and Multi-Asset Instantiation  |
| Last approved subphase | PH-4.3 — Multi-asset validation and the differentiation metric |

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

Executed 2026-08-31 at the close of Cycle Audit 001. Full record:
[`docs/evidence/CYCLE-1-VERIFICATION.md`](docs/evidence/CYCLE-1-VERIFICATION.md).

| Check                            | Status                             |
| -------------------------------- | ---------------------------------- |
| `npm run format:check`           | PASSED                             |
| `npm run lint`                   | PASSED                             |
| `npm run build` (full typecheck) | PASSED                             |
| `npm run test:cov` (both suites) | PASSED — 713 tests, 44 files       |
| Coverage (both suites)           | 98.04% statements, 96.04% branches |
| Hosted CI                        | NOT EXECUTED — nothing pushed yet  |

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

**Cycle Audit 001 is APPROVED and closed.** Fourteen findings were raised and all
fourteen resolved within the audit; the record is
[`docs/audits/CYCLE-AUDIT-001.md`](docs/audits/CYCLE-AUDIT-001.md). The cycle
counter has been reset and Cycle 2 has begun.

**PH-4 is ACTIVE** on branch `feature/ph-4-asset-personalities`. Its Phase
Context Document is
[`docs/phases/PH-4-asset-personalities.md`](docs/phases/PH-4-asset-personalities.md).

**PH-5 is APPROVED.** The market runs: `apps/api` hosts all five assets
continuously, checkpoints them, and survives SIGKILL — every market resumes with
a sequence that never goes backwards.

**Create PH-6 — the trading boundary: contracts, settlement and verified
economic blindness.** It is the last phase of Cycle 2, so on its approval the
Three-Phase Human Gate applies: STOP and request `EJECUTA` for the second Cycle
Audit.

PH-6 is the phase the whole architecture was built to make safe, and it carries
the one genuinely Protected Human Decision already on record:

- **At-the-money settlement policy** — whether a contract expiring exactly at the
  entry price is refunded or lost. It has material business consequence
  (`GOVERNANCE.md` §5), and PH-4.2 coupled the lattice calibration to it: the
  quantum is set so 1% of 30-second contracts land at the money.

The phase must also close INV-001 empirically rather than structurally: today the
guardrail scan proves the price path never _names_ an economic quantity. PH-6
must demonstrate that economic state cannot influence price generation even when
both exist in the same process.

No Human authorization is required to proceed (`GOVERNANCE.md` §32).
