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
| Approved phases in current cycle | **2 of 3**                                                              |
| Cycle Audit state                | None active — 004 APPROVED; next runs when PH-15 closes the cycle       |
| Last Cycle Audit                 | [Cycle Audit 004](docs/audits/CYCLE-AUDIT-004.md) — APPROVED 2026-09-01 |

## Phase and subphase

| Field                  | Value                                                    |
| ---------------------- | -------------------------------------------------------- |
| Active phase           | None — PH-15 is next to create                           |
| Phase lifecycle        | n/a                                                      |
| Active subphase        | None                                                     |
| Subphase lifecycle     | n/a                                                      |
| Last approved phase    | PH-14 — Multi-Node Consistency and Horizontal Scale-Out  |
| Last approved subphase | PH-14.3 — Failover: no fork, no duplicate stream, a seam |

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
| Branch   | `feature/ph-14-multi-node` — to merge into `main`                              |

---

## EXACT NEXT LEGAL ACTION

**Merge `feature/ph-14-multi-node` into `main`, then create PH-15.**

PH-14 is APPROVED: all three subphases approved from executed evidence, the
integrated cluster verification passing, and the phase gate at exit 0. It
established [ADR-0012](docs/decisions/ADR-0012-single-writer-generation.md) —
generation is single-writer per asset, because two nodes cannot independently
generate the same asset and stay identical across a restart.

**PH-15 — Operations: the standing guarantee, running continuously** is the
third and final phase of Cycle 5. Three exclusions carried from PH-12 land
there: where commitment roots are published, key rotation procedure, and journal
retention. Alongside them, the assurance battery becomes a scheduled run against
accumulated history rather than a thing invoked by hand, and PH-14's
`CoordinatedStore` needs a deployment backend that passes its conformance
battery.

**When PH-15 is approved, Cycle 5 is complete and Cycle Audit 5 begins
automatically.** It must be conducted by **independent agents**
([ADR-0011](docs/decisions/ADR-0011-subagent-authority.md)) — Cycle Audit 3
measured what a self-conducted audit is worth: one finding against Cycle Audit
2's thirty-one, and Cycle Audit 4's seven independent agents found twelve
against code approved hours earlier.

No authorization is required for any of this and none should be requested
(`GOVERNANCE.md` §28).
