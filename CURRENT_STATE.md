# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-09-02

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Active development cycle         | Cycle 8                                                                                                                |
| Approved phases in current cycle | **0 of 3** — Cycle 8 opens with PH-22                                                                                  |
| Cycle Audit state                | **007 closed** — 34 of 35 findings closed in the audit itself, one carried (Issue #22)                                 |
| Last Cycle Audit                 | [Cycle Audit 007](docs/audits/CYCLE-AUDIT-007.md) — recorded 2026-09-03, eight independent auditors, one worktree each |

## Phase and subphase

| Field                  | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| Active phase           | PH-22 — Distribution under thousands of observers              |
| Phase lifecycle        | ACTIVE                                                         |
| Active subphase        | PH-22.1 — An instrument that can hold thousands of connections |
| Subphase lifecycle     | ACTIVE                                                         |
| Last approved phase    | PH-21 — The catalogue at scale                                 |
| Last approved subphase | PH-21.3 — A panel that can hold a hundred assets               |

Nothing is active because PH-21 closed and the cycle boundary is here: three
approved phases, and `GOVERNANCE.md` §28 turns the work from building to
examining. Cycle Audit 7 is the next action, and it is not a phase.

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

Executed on `feature/ph-21-catalogue-at-scale` at `e451647`, 2026-09-02/03,
with `OTC_REQUIRE_BROWSER=1` so a missing Chromium is a failure rather than a
skip — **zero tests reported skipped in either layer**.

```
npm run gate  ->  GATE_EXIT=0
  format:check     0
  build            0
  typecheck:web    0
  typecheck:config 0
  lint             0
  unit          90 files, 2,203 tests        29.8s
  statistical   40 files,   273 tests     3,386.5s
```

| Layer                | Result                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Local gate           | **PASSED (exit 0)** — worst RPC round trip 11.6 s against the 30 s guard                                          |
| Hosted CI, same tree | [run 33701581822](https://github.com/NovaHub2026/otcv6/actions/runs/33701581822) — **success**, both jobs, 48 min |
| — Quality Gate       | 90 files, 2,203 unit tests                                                                                        |
| — Statistical Gate   | 40 files, 273 tests, 2,837.8 s; worst RPC round trip 9.5 s                                                        |
| Browser suite        | 8 tests, run in both layers — including `draws the bucket now forming, however the stream had to reach it`        |

**The browser suite ran locally as well as hosted**, which it had not done since
a6-03 recorded that no Chromium could launch on this host. The three libraries
were supplied without root (PH-21.3 §5.2); that prefix is a local artefact
outside the repository, so **the hosted run is the authority** and the local one
is what made the defects measurable while they were being fixed.

Two honest notes on the numbers. The local statistical suite took 3,386 s
against the runner's 2,838 s — 19% slower, because two audit fan-outs were
competing for the machine for part of it. CA6-01 is this project's record of
what a contended wall-clock measurement is worth, so it is said rather than
hidden: every wall-clock assertion in the suite passed anyway, and the figure to
compare against the runner's is the hosted one. And the run recorded above is
the **second** attempt: the first exited 1 on four state-consistency guardrails
that caught the closure being written — the roadmap moved to APPROVED while
PH-21.3's own document still read ACTIVE, and `CURRENT_STATE.md` named a phase
the roadmap had just approved. The guards were right; the record was mid-edit.

The forming-bucket test passing **on the runner** is the load-bearing line. A CI
engine is always freshly started, so its feed can never replay from the stored
candle a client resumes at — which is exactly the condition that froze the
candle. The defect cannot return without that test saying so.

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

| Kind     | Reference                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                                                                                                                                                                          |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                                                                                                                                                                      |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED)                                                                                                                                                       |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)                                                                                                                                                                  |
| ADR-0005 | A multifractal cascade as the volatility process (APPROVED)                                                                                                                                                                        |
| ADR-0006 | A layered sign-blind market model (APPROVED)                                                                                                                                                                                       |
| ADR-0007 | At-the-money settlement: a tie is refunded (APPROVED, Human Owner)                                                                                                                                                                 |
| ADR-0008 | Full delegation: automatic audits, autonomous decisions (APPROVED)                                                                                                                                                                 |
| ADR-0009 | Hosted CI reinstated after the repository was made public (APPROVED)                                                                                                                                                               |
| ADR-0010 | The catch-up bound: no unobserved burst may span a contract (APPROVED)                                                                                                                                                             |
| ADR-0011 | Subagents are an engineering decision; audits use independent ones (APPROVED)                                                                                                                                                      |
| ADR-0012 | Generation is single-writer per asset; leadership is a fenced lease (APPROVED)                                                                                                                                                     |
| ADR-0013 | Governance says what is true (PROPOSED — the Human Owner's to apply, Issue #14)                                                                                                                                                    |
| ADR-0014 | Chart library and repository licence: Lightweight Charts, Apache-2.0 (APPROVED)                                                                                                                                                    |
| ADR-0015 | The Lab may amend the rules that describe the system, not the guarantees it validates (APPROVED, Human Owner)                                                                                                                      |
| Backlog  | [GitHub Issues](https://github.com/NovaHub2026/otcv6/issues) #1–#22; #1 and #13 closed. Two remain the Human Owner's: #3 and #14                                                                                                   |
| Roadmap  | `docs/phases/ROADMAP.md`                                                                                                                                                                                                           |
| Branch   | `main`. PH-21 merged at `3e4ec7e`; Cycle Audit 7 fixes merged after it. PH-21.1 sits under two hashes (`3a5f0a5`, `36bbf89`) because the branch was merged rather than rebased; both are ancestors and the duplication is cosmetic |
| Audit    | [`docs/audits/OUT-OF-BAND-AUDIT-001.md`](docs/audits/OUT-OF-BAND-AUDIT-001.md) — 83 findings, 6 critical, seven independent auditors                                                                                               |

---

## EXACT NEXT LEGAL ACTION

**PH-22.1 — an instrument that can hold thousands of connections.**

PH-22 is open and its phase document states what nobody knows
([PH-22](docs/phases/PH-22-distribution-under-thousands-of-observers.md) §1).
Nothing in this phase may be built on an argument, and there is nothing to
measure with until the harness exists — so the harness is first, and it is
audited as an instrument rather than as a tool.

This project's most expensive class of defect is an instrument that silently
stops measuring: a gate config in no TypeScript program, six browser tests
reporting passed while launching no browser. A load harness that fails to open
the connections it claims would produce exactly the reassuring numbers this
phase must not generate, so PH-22.1 owes a planted defect against itself.

Two measurements Cycle Audit 7 produced while looking elsewhere are its
starting point: **CA7-04**, a replay bound of 1 MB chosen rather than measured,
and **CA7-33**, 5.01 MB of feed retention per asset — 501 MB at a hundred.

Then the OTC Market Lab, specified by the Human Owner on 2026-09-03 and
authorised in [ADR-0015](docs/decisions/ADR-0015-lab-authority-and-isolation.md).
It follows PH-22 rather than preceding it because the Lab is a heavy observer —
many charts, dense ticks — and building it on the delivery path PH-22 is about
to rewrite would build it twice.

No authorization is required for any of it and none should be requested.
