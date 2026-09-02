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

| Field                  | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| Active phase           | PH-21 — The catalogue at scale                              |
| Phase lifecycle        | ACTIVE                                                      |
| Active subphase        | PH-21.1 — A hundred assets, and what registering them costs |
| Subphase lifecycle     | ACTIVE                                                      |
| Last approved phase    | PH-20 — The operator panel                                  |
| Last approved subphase | PH-20.3 — Editing and retiring                              |

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

**Hosted CI is red on `main`.** The three pushes since PH-19 merged — the PH-19
merge itself, the docs push after it, and the PH-20 merge — all failed the
Statistical Gate the same way: every test passing, one
`Error: [vitest-worker]: Timeout calling "onTaskUpdate"`, exit 1. PH-20 was
approved on a green local gate with that corroboration outstanding, which is
CA6-02 repeated and is recorded as such. Nothing below is a phase approval under
`GOVERNANCE.md` §40.1 until CI is green on the same tree.

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

- **Detection power is stated per instrument, and the two instruments differ.**
  The single-test minimum detectable effect at 30 s is 0.217pp on the
  full-rigor run, finer than the 0.2513pp margin of the 99% payout, and every
  asset/horizon cell is policed below that margin at that resolution (PH-11).
  The **gate** — Benjamini–Hochberg over ~750 hypotheses, confirmation on a
  held-out sample, and a materiality floor — reaches 50% power for a uniform
  30-second edge near 0.45–0.5pp (out-of-band audit, a4-01); the unconditional
  family and the gate MDE the audit added are what state it honestly. Per-asset
  battery floors (0.562pp) sit above the product margin; PH-3's full-rigor run
  covers the canonical configuration.
- **Assets are still easier to tell apart by size than by character.** Scale-free
  _shape_ differentiation is 40.5% against a 20% null for the five hand-authored
  assets (PH-10), and 46.0–47.8% against an identical-personality control at
  31.0–34.9% for three siblings drawn from one archetype (PH-17.2). Both are real
  and modest.
- **The multi-node design is proved against SQLite and an in-memory reference,
  never a cluster.** PH-15.1 delivered the durable `CoordinatedStore`; both
  implementations pass the conformance battery; the SQLite one is single-machine
  by its own docstring, and no follower is composed into `apps/api` yet
  (`docs/architecture/MULTI_NODE_AND_OPERATIONS.md`).
- **The catalogue has been registered at a hundred and hosted at five.** PH-21.1
  measured a hundred-asset registration (0.6s to 20.5s per asset, closest pair
  2.8× the floor); hosting a hundred markets and the panel that holds them are
  PH-21.2 and PH-21.3.
- **A retired asset cannot come back** — a decision (`DECISION-LOG.md`,
  2026-09-02): resuming a market after a gap either invents the interval or
  seams a published record. Everything it published stays readable.
- **Provisioning is manual and irreversible.** `OTC_BACKFILL_DAYS` defaults to
  zero and is capped at 365, because a backfill is genesis and refuses to run
  twice.
- **History is candles beyond the retention window**, and a restart leaves a
  visible one-minute hole rather than a short bar labelled whole (out-of-band
  audit, a5-01). Anything finer than a minute is served from the tick record
  only, and `readTimeframe` refuses rather than returning a coarser series under
  a finer name.
- **The browser layer runs only where Chromium can launch.** Hosted CI installs
  the system libraries and requires the browser; on a host without them the six
  panel tests are reported as skipped, not passed (out-of-band audit, a6-03).
- **The write surface requires an operator token.** Every non-GET route needs
  `OTC_ADMIN_TOKEN`; the service binds `127.0.0.1` unless `OTC_BIND` says
  otherwise (out-of-band audit, a6-01).

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
| Branch   | `feature/ph-21-catalogue-at-scale`, from `main` at the PH-20 merge             |

---

## EXACT NEXT LEGAL ACTION

**Run the out-of-band full audit the Human Owner requested on 2026-09-02, fix
what it finds, and make hosted CI green; then continue PH-21.1.**

The Human Owner asked for a complete audit of the project with authority to fix
everything found — `GOVERNANCE.md` §29 and §33 both name an explicit Human
request as sufficient for a full audit before a cycle completes. It is conducted
by independent agents, one git worktree each (§4.2, B-020), and recorded under
`docs/audits/`. It does not reset the cycle counter: Cycle Audit 7 still runs
after PH-21 is approved.

The first finding is already known and is the one everything else is verified
through: **hosted CI is red on `main`**, three runs in a row, with every test
passing. Until the statistical gate is green on a hosted runner, no approval in
Cycle 7 after PH-19 stands under §40.1.

PH-21.1 is ACTIVE with its implementation in the tree and its verification
pending: the hundred-asset run is recorded, the gate on this tree has not yet
been executed by the approving session, and the watchdog it added has to be
watched failing before it counts as a guard.

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
