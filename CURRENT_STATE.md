# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-09-02

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active development cycle         | Cycle 7                                                                                                                                             |
| Approved phases in current cycle | **3 of 3** — PH-19, PH-20, PH-21                                                                                                                    |
| Cycle Audit state                | **006 closed**; out-of-band audit 001 run 2026-09-02 (does not reset the counter)                                                                   |
| Last Cycle Audit                 | [Cycle Audit 006](docs/audits/CYCLE-AUDIT-006.md) — recorded 2026-09-01; [Out-of-band Audit 001](docs/audits/OUT-OF-BAND-AUDIT-001.md) — 2026-09-02 |

## Phase and subphase

| Field                  | Value                                                      |
| ---------------------- | ---------------------------------------------------------- |
| Active phase           | none — PH-21 is closed; **Cycle Audit 7** is the next work |
| Phase lifecycle        | —                                                          |
| Active subphase        | none                                                       |
| Subphase lifecycle     | —                                                          |
| Last approved phase    | PH-21 — The catalogue at scale                             |
| Last approved subphase | PH-21.3 — A panel that can hold a hundred assets           |

## Cycle 1 result

The cycle existed to settle one question: can a synthetic market be
simultaneously plausible and provably unexploitable, with executed evidence for
both?

**It can.** On 24 million ticks spanning 327 simulated days, one asset is:

|                              | Result                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unexploitable                | clean verdict across ~570 hypotheses and all four attack feature kinds                                                                                                                                          |
| At a resolution that matters | 30-second single-test detection floor 0.221pp, finer than the 0.2513pp margin the 99% payout implies; the gate's own 50%-power figure at 30 s is 0.315pp, and `VALIDATION.md` says which claim is which (a4-01) |
| Plausible                    | 15/15 realism metrics, bands unchanged since the commit that introduced the engine (906e398)                                                                                                                    |
| Structurally guaranteed      | mirror test passes with zero divergences                                                                                                                                                                        |

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

> **Verification in flight.** The gate and the hosted run for this tree are
> executing as this is written; this block is filled from their exit codes, and
> is not an approval until it is. `GOVERNANCE.md` §68: only executed checks may
> be reported as passing.

Cycle 1's numbers, and the coverage figure, are in
[`docs/evidence/CYCLE-1-VERIFICATION.md`](docs/evidence/CYCLE-1-VERIFICATION.md);
coverage has not been re-measured since 2026-08-31 (Issue #2).

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
- **The multi-node design and the standing guarantee are built and tested, and
  the service composes neither.** PH-15.1 delivered the durable
  `CoordinatedStore` and both implementations pass the conformance battery, but
  `apps/api` composes `FileStateStore`, `SqliteCandleHistory` and
  `FileAssetRegistry` only: no `LeaderSession`, no follower, no
  `SqliteCoordinatedStore`, and no non-test caller of `runStandingAssurance`,
  `signRotation` or `partitionForRetention` exists anywhere (out-of-band audit,
  a7-25; `docs/architecture/MULTI_NODE_AND_OPERATIONS.md` §8). PH-15's
  acceptance intent — a venue that, left running, produces a current assurance
  verdict — is not what the shipped service does. The limiter is likewise not at
  the venue's trading boundary (PH-13.3 §6).
- **The catalogue has been registered and scheduled at a hundred, and deployed
  at five.** PH-21.1 measured a hundred-asset registration (100 of 100, closest
  pair 2.8× the floor); PH-21.2 measured the venue's scheduling loop and the
  store at a hundred markets (413,177 ticks/s, 0.67 GB per quarter). What is
  **not** measured at a hundred is the publication and history path downstream
  of the scheduling loop, and no deployment has hosted a hundred markets
  continuously.
- **A retired asset cannot come back** — a decision (`DECISION-LOG.md`,
  2026-09-02): resuming a market after a gap either invents the interval or
  seams a published record. Everything it published stays readable.
- **Provisioning is manual and irreversible.** `OTC_BACKFILL_DAYS` defaults to
  zero, must be whole days written as digits, and is capped at 365 (anything
  else is refused by name at boot, a6-15), because a backfill is genesis and
  refuses to run twice.
- **History is candles beyond the retention window**, and a restart leaves a
  visible one-minute hole rather than a short bar labelled whole (out-of-band
  audit, a5-01). Anything finer than a minute is served from the tick record
  only, and `readTimeframe` refuses rather than returning a coarser series under
  a finer name.
- **The browser layer runs only where Chromium can launch.** Hosted CI installs
  the system libraries and requires the browser; on a host without them the
  eight panel tests are reported as skipped, not passed (out-of-band audit,
  a6-03). A host without root can supply the three libraries by hand — the
  recipe sits in `panel.stat.test.ts` beside the skip message — but such a
  prefix is a local artefact outside the repository, so **the hosted run is the
  authority for browser evidence** (PH-21.3 §5.2).
- **The write surface requires an operator token.** Every non-GET route needs
  `OTC_ADMIN_TOKEN`; the service binds `127.0.0.1` unless `OTC_BIND` says
  otherwise (out-of-band audit, a6-01).

## Relevant records

| Kind     | Reference                                                                                                                                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                                                                                                                                                                                                              |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                                                                                                                                                                                                          |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED)                                                                                                                                                                                           |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)                                                                                                                                                                                                      |
| ADR-0005 | A multifractal cascade as the volatility process (APPROVED)                                                                                                                                                                                                            |
| ADR-0006 | A layered sign-blind market model (APPROVED)                                                                                                                                                                                                                           |
| ADR-0007 | At-the-money settlement: a tie is refunded (APPROVED, Human Owner)                                                                                                                                                                                                     |
| ADR-0008 | Full delegation: automatic audits, autonomous decisions (APPROVED)                                                                                                                                                                                                     |
| ADR-0009 | Hosted CI reinstated after the repository was made public (APPROVED)                                                                                                                                                                                                   |
| ADR-0010 | The catch-up bound: no unobserved burst may span a contract (APPROVED)                                                                                                                                                                                                 |
| ADR-0011 | Subagents are an engineering decision; audits use independent ones (APPROVED)                                                                                                                                                                                          |
| ADR-0012 | Generation is single-writer per asset; leadership is a fenced lease (APPROVED)                                                                                                                                                                                         |
| ADR-0013 | Governance says what is true (PROPOSED — the Human Owner's to apply, Issue #14)                                                                                                                                                                                        |
| ADR-0014 | Chart library and repository licence: Lightweight Charts, Apache-2.0 (APPROVED)                                                                                                                                                                                        |
| Backlog  | [GitHub Issues](https://github.com/NovaHub2026/otcv6/issues) #1–#18; #1 and #13 are closed. Two remain the Human Owner's: #3 and #14                                                                                                                                   |
| Roadmap  | `docs/phases/ROADMAP.md`                                                                                                                                                                                                                                               |
| Branch   | `feature/ph-21-catalogue-at-scale`, merged into `main` at the close of PH-21. It was **merged** with `origin/main` at `6579a2e` rather than rebased, so PH-21.1 sits on it under two hashes (`3a5f0a5`, `36bbf89`); both are ancestors and the duplication is cosmetic |
| Audit    | [`docs/audits/OUT-OF-BAND-AUDIT-001.md`](docs/audits/OUT-OF-BAND-AUDIT-001.md) — 83 findings, 6 critical, seven independent auditors                                                                                                                                   |

---

## EXACT NEXT LEGAL ACTION

**Run Cycle Audit 7.** PH-19, PH-20 and PH-21 are three approved phases, and
`GOVERNANCE.md` §28 stops normal development at that boundary. Nothing is
requested and nothing is waited for (ADR-0008); the pause changes the mode of
work from building to examining, and that is all it changes.

§67 lets the audit's depth be chosen by risk, and two things should shape it:

1. **The out-of-band audit of 2026-09-02 already covered most of this cycle's
   surface** — seven auditors, 83 findings. Repeating its sweep would mostly
   re-derive it. What it did _not_ see is everything PH-21 added afterwards.
2. **The PH-21 closure audit is the model to beat.** Seven readers, each told to
   falsify one claim area, every finding put to an adversarial refuter: twenty
   survived, and **three were live defects in code written the same day** — a
   latch that survived a reconnect, a guard comparing the wrong field, and two
   clock reads with an await between them. None would have been found by
   reading. Cycle Audit 7 should execute sequences, not inspect guards
   (`GOVERNANCE.md` §28.1), and plant against every guard this cycle added.

Then **PH-22 — distribution under thousands of observers**, which the Human
Owner prioritised ahead of everything else on 2026-09-02.

No authorization is required for any of it and none should be requested.
