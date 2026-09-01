# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-09-01

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                                                                   |
| -------------------------------- | ----------------------------------------------------------------------- |
| Active development cycle         | Cycle 5                                                                 |
| Approved phases in current cycle | **3 of 3**                                                              |
| Cycle Audit state                | Cycle Audit 5 is the current work — begins automatically                |
| Last Cycle Audit                 | [Cycle Audit 004](docs/audits/CYCLE-AUDIT-004.md) — APPROVED 2026-09-01 |

## Phase and subphase

| Field                  | Value                                      |
| ---------------------- | ------------------------------------------ |
| Active phase           | None — PH-15 is next to create             |
| Phase lifecycle        | n/a                                        |
| Active subphase        | None                                       |
| Subphase lifecycle     | n/a                                        |
| Last approved phase    | PH-15 — Operations: The Standing Guarantee |
| Last approved subphase | PH-15.3 — The standing guarantee           |

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

**None, and none are possible from the Human side.** As of 2026-08-31 the
three-phase gate is removed and every code and product decision is the
Development Agent's ([ADR-0008](docs/decisions/ADR-0008-full-delegation.md)).
Development neither stops nor waits.

## Decision authority

Delegated in full: product purpose, business model, payout and settlement rules,
architecture, roadmap, and what is not built. Decisions are **recorded, not
escalated** — an ADR for something durable,
[`DECISION-LOG.md`](docs/decisions/DECISION-LOG.md) for everything else worth
finding later.

Two things remain the Human Owner's (`GOVERNANCE.md` §5.1): **amendments to
Governance itself**, and **commitments that bind them outside the repository**
(legal, contractual, real-money, custody, paid services).

**At-the-money settlement** was decided by the Human Owner before delegation and
is recorded in
[ADR-0007](docs/decisions/ADR-0007-at-the-money-settlement.md): a tie is refunded.
The realised at-the-money rate on the published lattice is 0.42%-0.53% per asset,
re-measured in PH-10.2 over 15 replicates.

## Verification standing

Two layers, and neither substitutes for the other:

- `npm run gate` — the authority for an approval, because it is what an agent can
  run before recording one.
- **Hosted CI** — required corroboration since
  [ADR-0009](docs/decisions/ADR-0009-hosted-ci-reinstated.md). The repository is
  public, so Actions is free, and both the quality gate and the statistical gate
  run on every push to `main`. A red CI on a green local gate is a finding about
  the gate, which is exactly how B-011 was found.

Build precedes lint, and that ordering is load-bearing: on a clean checkout the
type-aware rules resolve workspace types through emitted declarations, so linting
first reports 46 unresolved-type errors. Every `GATE_EXIT=0` recorded through
PH-10 was conditional on a previous build's `dist/` being present.

## Verification state

Executed 2026-09-01 at the PH-14 phase gate.

| Check                            | Status                         |
| -------------------------------- | ------------------------------ |
| `npm run gate`                   | **PASSED (exit 0)**            |
| `npm run format:check`           | PASSED (exit 0)                |
| `npm run build` (full typecheck) | PASSED (exit 0)                |
| `npm run lint`                   | PASSED (exit 0), warning-free  |
| Unit suite                       | PASSED — 66 files, 1,312 tests |
| Statistical suite                | PASSED — 27 files, 202 tests   |
| Unhandled errors                 | none                           |

Cycle 1's numbers, and the coverage figure, are in
[`docs/evidence/CYCLE-1-VERIFICATION.md`](docs/evidence/CYCLE-1-VERIFICATION.md).

## Known limitations carried forward

- Only the 30-second horizon is policed to the promotional-payout threshold at
  full rigor. PH-11 extended detection power to every horizon the product sells;
  independent samples at a horizon are still fixed by simulated duration, so the
  15-minute horizon needs roughly a hundred times the history. Every verdict
  states the floor it achieved.
- Assets are still easier to tell apart by size than by character. Scale-free
  _shape_ differentiation is 40.5% against a 20% null (PH-10, up from 30.0%),
  against a near-perfect figure on the full signature.
- Per-asset battery floors (0.562pp) sit above the 0.2513pp product margin.
  PH-3's full-rigor run covers the canonical configuration at 0.217pp.
- **The multi-node design is proved against an in-memory store.** PH-14 makes
  the `CoordinatedStore` contract executable — `describeCoordinatedStore` is a
  battery a deployment backend must pass — but no such backend exists yet. A
  real cluster needs a store with native compare-and-set, and choosing one is
  PH-15's.
- Nothing runs continuously. The assurance battery, the commitment publication
  and the standing guarantee are all things an operator _can_ do rather than
  things the venue _does_. That is PH-15's whole subject.

## Relevant records

| Kind     | Reference                                                                      |
| -------- | ------------------------------------------------------------------------------ |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                      |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                  |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED)   |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)              |
| ADR-0005 | A multifractal cascade as the volatility process (APPROVED)                    |
| ADR-0006 | A layered sign-blind market model (APPROVED)                                   |
| ADR-0007 | At-the-money settlement: a tie is refunded (APPROVED, Human Owner)             |
| ADR-0008 | Full delegation: automatic audits, autonomous decisions (APPROVED)             |
| ADR-0009 | Hosted CI reinstated after the repository was made public (APPROVED)           |
| ADR-0010 | The catch-up bound: no unobserved burst may span a contract (APPROVED)         |
| ADR-0011 | Subagents are an engineering decision; audits use independent ones (APPROVED)  |
| ADR-0012 | Generation is single-writer per asset; leadership is a fenced lease (APPROVED) |
| Backlog  | `docs/BACKLOG.md` B-001 … B-011 — **all closed**                               |
| Roadmap  | `docs/phases/ROADMAP.md`                                                       |
| Branch   | `feature/ph-15-operations` — to merge into `main`                              |

---

## EXACT NEXT LEGAL ACTION

**Merge `feature/ph-15-operations` into `main`, then run Cycle Audit 5.**

**Cycle 5 is complete.** PH-13 (operator risk), PH-14 (multi-node consistency)
and PH-15 (operations) are all APPROVED.

**Cycle Audit 5 begins automatically.** There is no Human gate
([ADR-0008](docs/decisions/ADR-0008-full-delegation.md)) and nothing is to be
requested or waited for (`GOVERNANCE.md` §28). It must be conducted by
**independent agents** ([ADR-0011](docs/decisions/ADR-0011-subagent-authority.md)),
and the measurement behind that requirement is the reason to take it seriously:

| Audit         | Method                   | Material findings |
| ------------- | ------------------------ | ----------------- |
| Cycle Audit 2 | ten independent agents   | 31                |
| Cycle Audit 3 | the authoring agent      | 1                 |
| Cycle Audit 4 | seven independent agents | 12                |

Cycle 5 is the largest surface yet audited: a multi-node design resting on an
impossibility result, a store that has never met two real processes outside its
own test, a key-rotation scheme, a retention policy that permits deletion, and a
verdict the product's central claim rests on. Every one of those is a place
where a guard could exist, be documented as sufficient, and have never been
watched failing.

**On completion:** record it in `docs/audits/CYCLE-AUDIT-005.md`, fix every
confirmed finding, reset the cycle counter, and begin Cycle 6 by deriving its
phases.
