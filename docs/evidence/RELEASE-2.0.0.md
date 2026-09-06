# Release 2.0.0 — The OTC Market Engine As A Broker Integrates It

Type: EVIDENCE (the release record)
Recorded: 2026-09-06
Tag: `v2.0.0` — the Cycle Audit 10 merge, gated green and corroborated by hosted CI
Supersedes: [`RELEASE-1.0.0.md`](RELEASE-1.0.0.md) — `v1.0.0`, tagged on a commit whose hosted run went red, kept as the record of that (`DECISION-LOG.md`, 2026-09-06)
Package: `tools/sim/scripts/integration-package.sh v2.0.0 <dir>`

---

## 1. Why this is 2.0.0 and not 1.0.1

The API contract went from `1.1.0` to `2.0.0` in Cycle Audit 10.
`GET /markets/:id/price?at=` now **refuses** an instant inside a recorded
discontinuity where a 1.x venue answered it with a price, and
`GET /markets/:id/seams` publishes what `settle()` needs to refuse the same
window. A broker that pinned `1.x` and treats a non-200 as a transport error
changes behaviour on requests it was already making, so this is a major
version, and calling it a patch to make the first tag look like a near miss
would be the wrong kind of tidy.

## 2. What ships

A continuous, multi-asset synthetic OTC market engine for fixed-expiration
binary options, with the ten invariants of `PROJECT_INTRODUCTION.md` §29 held
by evidence: economically blind price generation (INV-001), one record for
every observer (INV-002, INV-003), timeframe and expiration independence
(INV-004, INV-005), no exploitable directional rule — a theorem, ADR-0003, and
a battery (INV-006), thirty distinct personalities (INV-007), a market that
never resets (INV-008), settlement reproducible and provable from the published
record (INV-009), and private generator state never served (INV-010).

- **The venue** (`apps/api`): thirty markets; the stream with exact resume and
  told gaps; candle history; the persisted record that outlives the process
  (PH-28) and now remembers its seams; the settlement query, the seam list and
  the inclusion proof (PH-29.1, Cycle Audit 10); the API as a versioned
  contract (PH-29.2); liveness, readiness, metrics and a rate limit keyed on
  the client (PH-30.1, Cycle Audit 10); one multiplexed stream per page
  (PH-30.2); one writer per state directory.
- **What a broker embeds** (`@otc/client`): the contract, the conformance
  suite, the reference client — which verifies a commitment's signature, and
  now has a fault that proves it does; and `@otc/trading`, the reference
  settlement in integer minor units.
- **What an operator runs** (`deploy/`, `npm run state:verify`,
  `state:backup`, `assurance:served`, `conformance`, `observer:fleet`) — with
  backups that restore, which they did not before this audit.
- **The guide**: `docs/integration/INTEGRATION.md` (Spanish), the contract in
  `docs/architecture/API_CONTRACT.md`.

## 3. What was measured

| Measure                                     | Result                                                                                               | Record                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The record across a `SIGKILL` on the thirty | 30 of 30 resume; every kill minute stored                                                            | `PH-28-DURABLE-VENUE.md`                                                 |
| The standing verdict on the thirty, twice   | 30 of 30 graded, 0 exploitable, 0 failed — an hour whole, and an hour across a deploy-length restart | `PH-30-RELEASE-SERVED-VERDICT.md`, `-RESTART.md`, `PH-30-RELEASE-RUN.md` |
| The conformance suite, twice                | 27 of 27, on a fresh venue and on a seamed one                                                       | `PH-30-RELEASE-CONFORMANCE.md`, `-RESTART.md`                            |
| The commitment chains after a restart       | 30 of 30 verify, one break each, named by the verifier                                               | `PH-30-RELEASE-RUN.md` §3                                                |
| Observers held from eight processes         | 5,000 whole; 10,000 refused by the event loop, not memory                                            | `PH-30-TEN-THOUSAND-OBSERVERS.md`                                        |
| The audit that closed the cycle             | 98 claims, 86 confirmed, 12 partial, 0 refuted; 45 plants, 23 survived and are closed                | `docs/audits/CYCLE-AUDIT-010.md`                                         |
| The phase gate on the shipped tree          | `GATE_EXIT=0` — unit 163 files / 3,348 tests; statistical 47 files / 402 tests in 4,838 s            | audit record §7                                                          |

## 4. What a broker must know

- The engine is not the broker: accounts, positions, payout, money and the
  trader's screen are yours; the engine answers prices and proves them.
- `OTC_MASTER_SECRET` is the market's identity; `OTC_PUBLISHING_KEY` signs the
  record; both are yours to keep and to back up apart from the state.
- **Behind a proxy, set `OTC_TRUSTED_PROXIES`** (1 behind the shipped nginx),
  or the rate limit sees only the proxy and every client shares one bucket.
- **A restart longer than fifteen seconds seams a market**, and every deploy
  is. The record keeps both sides, `/markets/:id/seams` lists them, and
  `settle()` must be given them — a contract whose window crosses a seam is
  refused rather than settled against a price nobody published.
- One venue process holds about five thousand simultaneous observers of eight
  charts each on a machine of the class measured; beyond that, more than one
  process, which this release does not compose (Issue #9, deferred by name).
- The Issues left open are named: #9 (multi-node), #3 and #14 (Governance
  amendments, the Human Owner's).

## 5. The commit, the gate and hosted CI

|                        |                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Release commit         | the Cycle Audit 10 merge on `main`, tagged `v2.0.0`                                        |
| Tree the gate ran on   | `970f54b` (`audit/ca10-fixes`)                                                             |
| `npm run gate`         | `GATE_EXIT=0`, 2026-09-06 21:27–22:51Z                                                     |
| Hosted CI on the merge | recorded in `CURRENT_STATE.md` § "Hosted CI, honestly"; the tag is cut only on a green run |
| Contract               | `2.0.0` (`docs/architecture/API_CONTRACT.md`)                                              |

## 6. What this release learned the hard way

`v1.0.0` was tagged six seconds after its CI run was created, and that run went
red two hours later on a real defect. The audit that followed found ninety-eight
claims, four of them critical, and none of them in the price path. The engine
that ships here is the one that survived being audited after it was called
finished — which is a better thing to hand a broker than the one that was
called finished on time.
