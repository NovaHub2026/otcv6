# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-09-02

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                                                                   |
| -------------------------------- | ----------------------------------------------------------------------- |
| Active development cycle         | Cycle 7                                                                 |
| Approved phases in current cycle | **2 of 3**                                                              |
| Cycle Audit state                | **006 closed** — 40 of 46 findings closed in PH-19                      |
| Last Cycle Audit                 | [Cycle Audit 006](docs/audits/CYCLE-AUDIT-006.md) — recorded 2026-09-01 |

## Phase and subphase

| Field                  | Value                                    |
| ---------------------- | ---------------------------------------- |
| Active phase           | none — PH-21 is next and has not started |
| Phase lifecycle        | n/a                                      |
| Active subphase        | none                                     |
| Subphase lifecycle     | n/a                                      |
| Last approved phase    | PH-20 — The operator panel               |
| Last approved subphase | PH-20.3 — Editing and retiring           |

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

Executed 2026-09-02 on the PH-20 phase gate. The browser layer is part of it now:
`OTC_REQUIRE_BROWSER=1` makes a missing Chromium a failure rather than a skip.

| Check                            | Status               |
| -------------------------------- | -------------------- |
| `npm run gate`                   | **PASSED (exit 0)**  |
| `npm run format:check`           | PASSED (exit 0)      |
| `npm run build` (full typecheck) | PASSED (exit 0)      |
| `npm run typecheck:web`          | PASSED (exit 0)      |
| `npm run typecheck:config`       | PASSED (exit 0)      |
| `npm run lint`                   | PASSED (exit 0)      |
| Unit suite                       | PASSED — 1,866 tests |
| Statistical suite                | PASSED               |
| Unhandled errors                 | none                 |

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
- **The panel administers five assets, and has never been run against fifty.**
  PH-20 gave it Preview, Create and Assets: browse and chart any asset, register
  a new one as a job that reports each stage, rename one, retire one. What is
  untested is scale — a hundred-asset catalogue's cost in storage, scheduling
  and differentiation headroom is PH-21's subject, and the sidebar is a flat
  list that will not survive it.
- **A retired asset cannot come back.** That is a decision, not a gap
  (`DECISION-LOG.md`, 2026-09-02): resuming a market after a gap either invents
  the interval or seams a published record. Everything it published stays
  readable.
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

**Begin PH-21 — the catalogue at scale.**

Cycle 7 has two of its three phases approved. PH-19 closed 40 of Cycle Audit 6's
46 findings; PH-20 made the operator panel real and, in doing so, found that the
browser suite it had just shipped was testing the wrong engine.

PH-21's subject is the gap PH-20 leaves: **five assets is not a catalogue.**
PH-19.4 measured a registration failing on 36% of hundred-asset builds before the
tail-weight clamp; what a hundred assets cost in storage, in scheduling, in
differentiation headroom and in a sidebar that is currently a flat list is
unmeasured. The registration path exists and is exercised one asset at a time.

After PH-21: **Cycle Audit 7**, automatically and without asking
(`GOVERNANCE.md` §28, ADR-0008). One git worktree per auditor (B-020), and
plants against every guard the cycle added — the browser layer above all, since
it is the newest and it has already been green on a lie once.

### Open findings carried into PH-21

| Finding | What it is                                                                |
| ------- | ------------------------------------------------------------------------- |
| B-029   | `xauusd`'s realised quarterly spread exceeds its calibrated one by 20–33% |
| B-030   | One unit run in seven failed seven files; not reproduced in six attempts  |
| CA6-07  | Open from Cycle Audit 6                                                   |
| CA6-17  | Partly closed — the dispersion bias above                                 |
| B-018   | Open from an earlier cycle                                                |

No authorization is required for any of it and none should be requested
(`GOVERNANCE.md` §28).
