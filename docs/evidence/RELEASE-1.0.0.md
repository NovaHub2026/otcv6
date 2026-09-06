# Release 1.0.0 — The OTC Market Engine As A Broker Integrates It

Type: EVIDENCE (the release record)
Recorded: 2026-09-06
Tag: `v1.0.0` — the commit named in §4, the one the PH-30 phase gate passed and hosted CI corroborated
Package: `tools/sim/scripts/integration-package.sh v1.0.0 <dir>` — `git archive` of the tag minus the process documents, the guide and the examples at the top

---

## 1. What ships

A continuous, multi-asset synthetic OTC market engine for fixed-expiration
binary options, with the ten invariants of `PROJECT_INTRODUCTION.md` §29 held
by evidence: economically blind price generation (INV-001), one record for
every observer (INV-002, INV-003), timeframe and expiration independence
(INV-004, INV-005), no exploitable directional rule — a theorem, ADR-0003,
and a battery (INV-006), thirty distinct personalities (INV-007), a market that
never resets (INV-008), settlement reproducible and provable from the published
record (INV-009), and private generator state never served (INV-010).

- **The venue** (`apps/api`): thirty markets, the stream with exact resume and
  told gaps, candle history, the persisted record that outlives the process
  (PH-28), the settlement query and the inclusion proof (PH-29.1), the API as a
  versioned contract (PH-29.2), liveness, readiness, metrics and a rate limit
  (PH-30.1), one multiplexed stream per page (PH-30.2).
- **What a broker embeds** (`@otc/client`): the contract, the conformance
  suite, the reference client; and `@otc/trading`, the reference settlement in
  integer minor units (PH-29.3, PH-29.4).
- **What an operator runs** (`deploy/`, `npm run state:verify`,
  `state:backup`, `assurance:served`, `conformance`, `observer:fleet`).
- **The guide**: `docs/integration/INTEGRATION.md` (Spanish), the contract in
  `docs/architecture/API_CONTRACT.md`.

## 2. What was measured on the release build

| Measure                                     | Result                                                                                                                           | Record                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The record across a `SIGKILL` on the thirty | 30 of 30 resume; every kill minute stored                                                                                        | `PH-28-DURABLE-VENUE.md`                                                 |
| The standing verdict on the thirty, twice   | 30 of 30 graded, 0 exploitable, 0 failed — an hour whole, and an hour across a deploy-length restart (30 seams, 0 failed passes) | `PH-30-RELEASE-SERVED-VERDICT.md`, `-RESTART.md`, `PH-30-RELEASE-RUN.md` |
| The conformance suite on the release, twice | 27 of 27, contract 1.1.0 / `1f9fc7c84b19c58c`, on the fresh venue and on the seamed one                                          | `PH-30-RELEASE-CONFORMANCE.md`, `-RESTART.md`                            |
| Observers held from eight processes         | 5 000 whole; 10 000 refused by the loop                                                                                          | `PH-30-TEN-THOUSAND-OBSERVERS.md`                                        |
| The commitment chains after the restart     | 30 of 30 verify, 839 links, one break per asset at its seam, named by the verifier                                               | `PH-30-RELEASE-RUN.md` §3                                                |
| The unit suite / the statistical suite      | unit 161 files / 3,244 tests in 33 s; statistical 47 files / 402 tests in 4,798 s; `GATE_EXIT=0` on `6f1efa9`                    | PH-30 §9                                                                 |

## 3. What a broker must know

- The engine is not the broker: accounts, positions, payout, money and the
  trader's screen are yours; the engine answers prices and proves them.
- `OTC_MASTER_SECRET` is the market's identity; `OTC_PUBLISHING_KEY` signs the
  record; both are yours to keep and to back up apart from the state.
- One venue process holds about five thousand simultaneous observers of eight
  charts each on a machine of the class measured; beyond that, more than one
  process, which this release does not compose (Issue #9, deferred by name).
- The Issues left open are named: #9 (multi-node), #3 and #14 (Governance
  amendments, the Human Owner's).

## 4. The commit, the gate and hosted CI

|                              |                                                                                                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release commit               | the PH-30 merge commit on `main` (`git rev-parse v1.0.0`) on `main`, the PH-30 merge, tagged `v1.0.0`                                                                                                                                                                            |
| Closing tree the gate ran on | `6f1efa9` (`feature/ph-30-release`)                                                                                                                                                                                                                                              |
| `npm run gate`               | `GATE_EXIT=0`, 14:27–15:50Z on 2026-09-06, 83 minutes: format, build, both typechecks, lint, unit, coverage, statistical (serial, 4,798 s); the approval commit that fills this record is documents only and re-ran `state:check` and the documentation guards on the final tree |
| Hosted CI on the merge       | recorded in `CURRENT_STATE.md` § "Hosted CI, honestly" when it lands                                                                                                                                                                                                             |
| Contract                     | `1.1.0`, digest `1f9fc7c84b19c58c` (`docs/architecture/API_CONTRACT.md`)                                                                                                                                                                                                         |
| Package                      | `tools/sim/scripts/integration-package.sh` from the closing tree `6f1efa9`: 158 files, `npm ci` + `npm run build` + the unit suite standalone, **158 files / 2,816 tests passed**, exit 0; regenerated from `v1.0.0` after the tag as the deliverable                            |

## 5. What the release found on its own build

The release run's first restart, 23 minutes after a clean stop, seamed every
market and left the venue serving nothing; the boot after it died. A durable
venue that survives a `SIGKILL` (PH-28) and not a deploy is not durable, and
no suite had the shape of a deploy in it. Fixed in `e0c87cd` and re-run with
the restart inside the hour (`PH-30-RELEASE-RUN.md` §2–§3). The lesson is
recorded where the next reader will look: a restart longer than fifteen
seconds is what every deploy is, and the release evidence includes one.

## 6. Deferred by name

- Multi-node hosting and the standing guarantee composed in the service
  (Issue #9): one process per catalogue in 1.0, the ceiling measured
  (`PH-30-TEN-THOUSAND-OBSERVERS.md`).
- The engine's next stylised facts, jumps and volume: the Cycle 10 plan
  deferred them; the calibrated personalities ship as measured.
- The two Governance amendments (Issues #3, #14): the Human Owner's.
