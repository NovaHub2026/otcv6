# DOCUMENTATION INDEX

Type: SUPPORTING DOCUMENTATION (navigation)
Status: Living document
Rule: every kind of durable knowledge has exactly one canonical location. If two
documents disagree, the canonical one wins and the other is a defect.

---

## Authoritative foundations

| Document                                             | Class                | Canonical for                                                                                                                                                          |
| ---------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`GOVERNANCE.md`](GOVERNANCE.md)                     | GOVERNANCE           | How the project is run: authority, lifecycles, verification levels, audits, commands. Governance-protected; may not be materially changed without Human authorization. |
| [`PROJECT_INTRODUCTION.md`](PROJECT_INTRODUCTION.md) | PROJECT INTRODUCTION | What the project is, why it exists, product principles, foundational invariants INV-001..INV-010, anti-goals. Not a phase.                                             |

## Operational state

| Document                                   | Class           | Canonical for                                                                                                                              |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`CLAUDE.md`](CLAUDE.md)                   | SUPPORTING      | Agent operational entrypoint: how to work in this repository, commands, engineering rules.                                                 |
| [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) | PROJECT CONTEXT | Compact stable project facts: purpose, product surface, stack, package boundaries, durable constraints.                                    |
| [`CURRENT_STATE.md`](CURRENT_STATE.md)     | CURRENT STATE   | Current cycle, phase, subphase, lifecycle states, blockers, audit state, **exact next legal action**.                                      |
| [`SESSION_HANDOFF.md`](SESSION_HANDOFF.md) | SESSION HANDOFF | What a fresh session needs to resume immediately: branch, HEAD, completed/incomplete work, last executed verification, continuation point. |
| `DOCS_INDEX.md`                            | SUPPORTING      | This map.                                                                                                                                  |

## Planning and architecture

| Location                                           | Class                            | Canonical for                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/phases/ROADMAP.md`](docs/phases/ROADMAP.md) | SUPPORTING (living)              | Dynamic roadmap: completed / active / likely-next phases, dependencies, cycle boundaries.                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/phases/PH-N-*.md`                            | PHASE CONTEXT DOCUMENT           | One coherent capability: objective, scope, exclusions, invariants, acceptance intent, risks.                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/phases/PH-N.M-*.md`                          | SUBPHASE TECHNICAL DOCUMENT      | One implementation work block: contracts, behaviour, acceptance criteria, verification requirements.                                                                                                                                                                                                                                                                                                                                                                        |
| [`docs/architecture/`](docs/architecture/)         | SUPPORTING (living)              | Current architecture. Describes reality, not aspiration.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [`docs/decisions/`](docs/decisions/)               | ARCHITECTURAL / PRODUCT DECISION | Durable decisions (ADRs). States: PROPOSED / APPROVED / SUPERSEDED / REJECTED. Superseded ADRs are preserved, never deleted.                                                                                                                                                                                                                                                                                                                                                |
| [`docs/audits/`](docs/audits/)                     | CYCLE AUDIT                      | Records of three-phase Cycle Audits, including Memory Audit and Cold Start Audit results. Six have run: [001](docs/audits/CYCLE-AUDIT-001.md), [002](docs/audits/CYCLE-AUDIT-002.md), [003](docs/audits/CYCLE-AUDIT-003.md), [004](docs/audits/CYCLE-AUDIT-004.md), [005](docs/audits/CYCLE-AUDIT-005.md), [006](docs/audits/CYCLE-AUDIT-006.md).                                                                                                                           |
| [`docs/evidence/`](docs/evidence/)                 | SUPPORTING                       | Verification artefacts too large to keep in a phase document, including [CYCLE-6-DRIFT.md](docs/evidence/CYCLE-6-DRIFT.md) and [CYCLE-6-BACKFILL-SCALE.md](docs/evidence/CYCLE-6-BACKFILL-SCALE.md): [CYCLE-1-VERIFICATION.md](docs/evidence/CYCLE-1-VERIFICATION.md), [PH-11-HORIZON-COVERAGE.md](docs/evidence/PH-11-HORIZON-COVERAGE.md), [PH-11-COVERAGE.md](docs/evidence/PH-11-COVERAGE.md). Approvals otherwise record their measurements inline, next to the claim. |

## Backlog, history and verification

| Source                                       | Canonical for                                                                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/BACKLOG.md`](docs/BACKLOG.md)         | **Interim** backlog for verified bugs, technical debt, deferred work and blockers, used only until a GitHub remote exists. `GOVERNANCE.md` §42 makes GitHub Issues canonical once available; migration is tracked inside the file itself. |
| Git history and Pull Requests                | Implementation and integration history.                                                                                                                                                                                                   |
| Executed local verification + GitHub Actions | Verification evidence. Never report CI as passing if it did not run (`GOVERNANCE.md` §40).                                                                                                                                                |

## Architecture documents

| Document                                                                                 | Subject                                                                                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [`docs/architecture/OVERVIEW.md`](docs/architecture/OVERVIEW.md)                         | System decomposition, layers, dependency rules, and how the invariants are enforced structurally.                              |
| [`docs/architecture/MARKET_MODEL.md`](docs/architecture/MARKET_MODEL.md)                 | The generative market model: the sign boundary, the layer stack, how structure emerges without a level, and what was measured. |
| [`docs/architecture/ENTROPY.md`](docs/architecture/ENTROPY.md)                           | Deterministic randomness architecture: stream derivation, isolation, replay, secret handling.                                  |
| [`docs/architecture/TIME_AND_TICKS.md`](docs/architecture/TIME_AND_TICKS.md)             | Canonical time model, tick identity, candle aggregation and cross-timeframe coherence.                                         |
| [`docs/architecture/VALIDATION.md`](docs/architecture/VALIDATION.md)                     | The predictability and realism batteries: observer boundary, feature taxonomy, harness discipline, and achieved sensitivity.   |
| [`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md)                     | Which executable evidence discharges each of the ten invariants, and what is still pending                                     |
| [`docs/architecture/RUNTIME_AND_TRADING.md`](docs/architecture/RUNTIME_AND_TRADING.md)   | Hosting, scheduling, sealed persistence, the recovery policy, and where economic blindness is enforced                         |
| [`docs/architecture/CONSISTENCY_CONTRACT.md`](docs/architecture/CONSISTENCY_CONTRACT.md) | What the venue promises observers about agreement: exact by instant and sequence, approximate only for "now"                   |
| [`docs/architecture/PUBLICATION.md`](docs/architecture/PUBLICATION.md)                   | How the published record is made provable: Merkle commitments, the publishing key, and what a commitment does not prove        |

Documents listed above are created by the phase that first makes them true. A
missing architecture document means that layer does not exist yet — not that it
is undocumented.

## Decision records

| ADR                                                                          | Title                                                                                                      | Status   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| [ADR-0001](docs/decisions/ADR-0001-repository-and-toolchain-architecture.md) | Repository, toolchain and package architecture                                                             | APPROVED |
| [ADR-0002](docs/decisions/ADR-0002-deterministic-entropy-architecture.md)    | Deterministic entropy architecture                                                                         | APPROVED |
| [ADR-0003](docs/decisions/ADR-0003-conditional-sign-symmetry.md)             | Conditional sign symmetry as the anti-predictability architecture                                          | APPROVED |
| [ADR-0004](docs/decisions/ADR-0004-canonical-price-representation.md)        | Canonical price representation: an integer log lattice                                                     | APPROVED |
| [ADR-0005](docs/decisions/ADR-0005-volatility-cascade.md)                    | A multifractal cascade as the volatility process                                                           | APPROVED |
| [ADR-0006](docs/decisions/ADR-0006-layered-market-model.md)                  | A layered sign-blind market model                                                                          | APPROVED |
| [`ADR-0007`](docs/decisions/ADR-0007-at-the-money-settlement.md)             | A contract expiring exactly at the entry price is refunded — the house edge is the payout and nothing else | APPROVED |
| [ADR-0008](docs/decisions/ADR-0008-full-delegation.md)                       | Full delegation: automatic Cycle Audits, autonomous code and product decisions, no hosted CI               | APPROVED |
| [ADR-0009](docs/decisions/ADR-0009-hosted-ci-reinstated.md)                  | Hosted CI reinstated after the repository was made public; the gate had never passed on a clean checkout   | APPROVED |
| [ADR-0010](docs/decisions/ADR-0010-catch-up-bound.md)                        | The catch-up bound is 15s: no unobserved burst may span a complete contract                                | APPROVED |
| [ADR-0011](docs/decisions/ADR-0011-subagent-authority.md)                    | Subagents are an engineering decision; Cycle Audits must use independent agents                            | APPROVED |
| [ADR-0012](docs/decisions/ADR-0012-single-writer-generation.md)              | Generation is single-writer per asset; leadership is a fenced, expiring lease                              | APPROVED |
| [DECISION-LOG](docs/decisions/DECISION-LOG.md)                               | Running record of autonomous decisions that do not warrant a full ADR                                      | LIVING   |
