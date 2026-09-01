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
| Active development cycle         | Cycle 7                                                                 |
| Approved phases in current cycle | **0 of 3**                                                              |
| Cycle Audit state                | **006 recorded — 46 findings, 6 critical**; PH-19 remediates            |
| Last Cycle Audit                 | [Cycle Audit 006](docs/audits/CYCLE-AUDIT-006.md) — recorded 2026-09-01 |

## Phase and subphase

| Field                  | Value                                            |
| ---------------------- | ------------------------------------------------ |
| Active phase           | PH-19 — Close what Cycle Audit 6 falsified       |
| Phase lifecycle        | n/a                                              |
| Active subphase        | PH-19.1 — The instrument                         |
| Subphase lifecycle     | n/a                                              |
| Last approved phase    | PH-18 — The admin panel: Preview                 |
| Last approved subphase | PH-18.3 — Live preview: selection and timeframes |

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

Executed 2026-09-01 on the PH-18 phase gate: 116 files, 2,014 tests, 303 seconds.

| Check                            | Status                         |
| -------------------------------- | ------------------------------ |
| `npm run gate`                   | **PASSED (exit 0)**            |
| `npm run format:check`           | PASSED (exit 0)                |
| `npm run build` (full typecheck) | PASSED (exit 0)                |
| `npm run lint`                   | PASSED (exit 0), warning-free  |
| Unit suite                       | PASSED — 86 files, 1,792 tests |
| Statistical suite                | PASSED — 33 files, 222 tests   |
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
  _shape_ differentiation is 40.5% against a 20% null for the five hand-authored
  assets (PH-10, up from 30.0%), and 46.0-47.8% against an identical-personality
  control at 31.0-34.9% for three siblings drawn from one archetype (PH-17.2).
  Both are real and modest; neither is near-perfect.
- Per-asset battery floors (0.562pp) sit above the 0.2513pp product margin.
  PH-3's full-rigor run covers the canonical configuration at 0.217pp.
- **The multi-node design is proved against an in-memory store.** PH-14 makes
  the `CoordinatedStore` contract executable — `describeCoordinatedStore` is a
  battery a deployment backend must pass — but no such backend exists yet. A
  real cluster needs a store with native compare-and-set, and choosing one is
  PH-15's.
- **The panel can look and cannot touch.** PH-18 built Preview: browse the
  catalogue, chart any asset at any offered timeframe from stored history, watch
  it live. Creating, editing and retiring an asset are the next submenus; the
  pipeline they will drive exists and refuses for named reasons, and the surface
  does not.
- **Provisioning is manual and irreversible.** `OTC_BACKFILL_DAYS` defaults to
  zero, because a backfill is genesis and refuses to run twice. An operator asks
  for it; nothing asks on their behalf.
- **History is candles beyond the retention window.** Anything finer than a
  minute is available only as far back as the tick record keeps it, and
  `readTimeframe` refuses rather than returning a coarser series under a finer
  name.
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
| Backlog  | `docs/BACKLOG.md` — B-012 … B-020 **open** (Cycle Audit 5); B-001…B-011 closed |
| Roadmap  | `docs/phases/ROADMAP.md`                                                       |
| Branch   | `main` — PH-16 merged                                                          |

---

## EXACT NEXT LEGAL ACTION

**Continue Cycle Audit 5 remediation.** The audit is recorded in
[`docs/audits/CYCLE-AUDIT-005.md`](docs/audits/CYCLE-AUDIT-005.md); the open
findings are listed there in full and each is confirmed by a constructed
counterexample or an uncaught plant.

**Cycle 5's three phases are APPROVED WITH OPEN FINDINGS.** They delivered their
deliverables and several of their stated claims are false as built. That is the
honest state and it is deliberately not "approved": a phase whose central claim
an auditor falsified is not a phase whose approval should read the same as one
whose claims held.

### Closed by remediation so far

| Finding | What it was                                                               |
| ------- | ------------------------------------------------------------------------- |
| CA5-01  | A routine failover killed the asset permanently and silently, at defaults |
| CA5-02  | A retired key signed live history under a non-canonical hex alias         |
| CA5-03  | Rotation was not bound to any position in the record                      |
| CA5-04  | The append-only anchor was append-only only when nothing was appended     |
| M-11/12 | `NOT APPROVED` read as approved; a live contradiction it could not see    |

### Open, in rough order of severity

| Finding | What it is                                                               |
| ------- | ------------------------------------------------------------------------ |
| CA5-06  | The standing verdict runs no attack family — it checks four **names**    |
| CA5-05  | A follower can generate; INV-002 broken at 120 of 120 sampled instants   |
| CA5-07  | A profitable leak reports `undecided`, because it inflates its own floor |
| CA5-08  | The operator's headline risk spread is understated by (1+r)/r ≈ 2×       |
| CA5-09  | The limiter is defeated 39.6× by one millisecond of entry jitter         |
| CA5-10  | Retention deletes entry ticks of settlements still under dispute         |
| CA5-11  | Guardrail blind spots one syntactic form wide, across most guards        |
| SQL-1   | `acquire`/`renew` read the clock outside the transaction they atomise    |
| SQL-3   | The two `CoordinatedStore` implementations disagree on duplicate batches |

CA5-12 bounds the blast radius of CA5-08 through CA5-10: nothing in `apps/` or
`packages/runtime` calls the risk or retention modules yet. That is a reprieve,
not a defence — the first time they are wired up is the first time those defects
bite.

**Cycle 6 does not begin until these are closed or explicitly deferred with a
recorded reason.** No authorization is required for any of it and none should be
requested (`GOVERNANCE.md` §28).
