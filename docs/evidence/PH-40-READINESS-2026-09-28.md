# Readiness Audit, 2026-09-28 — Is the engine actually ready for a broker?

Type: EVIDENCE (a recorded verification)
Recorded: 2026-09-28
Subject: the tree at `7f9dffd` (PH-40.6), asking one question — **would a broker
deploying this release meet a defect?**
Outcome: **twenty confirmed findings, one refuted.** Sixteen are fixed in code with
a guard watched failing; four are recorded as things a broker must be told.

---

## 1. Why this audit exists and why it is not a Cycle Audit

PH-40 closed with every phase gate green, hosted CI green on both jobs, and a
conformance run reporting 37 of 37. The Human Owner then asked for something the
loop does not produce on its own: not _is the work correct against its
specification_, which the gates answer, but **is this ready to hand to a broker**.

Those are different questions, and the difference is the whole finding of this
audit. Every one of the twenty was inside a green gate. Ten of them are invisible
to any suite this repository could reasonably have had, for one of three reasons
that are worth naming because they will recur:

- **No suite had the input.** The provisioned-past defect (§3.1) needs a
  _deployment that has never run before_ — every long-lived one had its past
  declared by hand two phases earlier, so the fixture that would have caught it
  was the one state no fixture was in. This is the same shape as
  `upgrade-paths-have-no-test-input`.
- **The fixture agreed with the defect.** `--key` demanded 64 hex characters and
  the fixture supplied 64 hex characters (§3.2), so the guard asserted the bug.
- **The measurement was not taken on the thing that ships.** The catch-up bound
  (§3.5) is a wall-clock property of a _live process under load_; every test that
  touched it drove a clock by hand.

## 2. Method

Eight dimensions, each read by an independent agent with no write access, each
asked to falsify rather than to confirm: deployment from zero, the broker's own
integration path, settlement and the record, the runtime under a hostile host, the
API contract against what is served, the shipped proxy and container, the
documents a broker is handed, and the state directory's lifecycle.

Every candidate finding was then put to **three adversarial refuters**, each told
to default to _refuted_ under uncertainty, and each given a distinct lens
(does it reproduce / is the consequence real / is it already handled elsewhere). A
finding survived on a majority. **Seventy-one agents, read-only throughout**; the
fixes were authored afterwards, in one tree, each with its own guard.

The refuters earned their cost twice. They **killed** a claim that the record's
retention keeps "under seven hours" of ticks — the arithmetic had used a tick rate
the engine no longer prints. And they **raised** the severity of the catch-up-bound
finding, which had been filed as a performance note, to the worst defect of the
set.

## 3. The twenty, and what each one would have cost a broker

### Fixed in code (sixteen)

| #   | What a broker would have met                                                                                                                                                                                                                                                                                                                                                                                     | Fixed in  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | **A fresh deployment's chart is empty.** A provisioned past stored no frame; the first live flush dated the store above it and every backfilled bar answered `null` — 1,437 of 1,439 minute bars within 100 s of boot. Only a new deployment could show it.                                                                                                                                                      | `d0f5bb4` |
| 2   | **The broker's own checklist cannot be run.** `--key` demanded the 64-hex _seed_; an engine publishes its identity as 88-hex DER SPKI. The published key was refused (exit 2); truncated to 64 it produced a report **accusing the engine** of an invalid signature.                                                                                                                                             | `d80a7ae` |
| 3   | **A backwards clock froze every market, silently.** A negative `behind` was absorbed: 5 minutes of passes, 0 ticks, 0 throws, `/health` `ok`. Worse, `/price?at=` kept answering instants inside the frozen window — a realised path readable forward, which INV-006 exists to deny.                                                                                                                             | `5164e3b` |
| 4   | **A backup left the signed commitment chain behind** and still printed "Consistent". A restore could prove nothing committed before it, and had lost the published identity.                                                                                                                                                                                                                                     | `5164e3b` |
| 5   | **The engine seamed its own thirty markets with no external cause.** The pass charged its record write, publish and checkpoint to the _next_ advance's 15 s bound: `otc_pass_checkpoint_max_seconds` **17.294**, thirty simultaneous reopenings, ~100,000 sequences burned per asset, every stream subscriber dropped, 17 minutes after a clean boot — and the log dedup suppressed the line for that very pass. | `2719810` |
| 6   | **A coarse bar folded across a withheld hour was served as complete.** A live daily bar was byte-for-byte the one surviving hourly bar of its day: wrong open, low 54 pips high, tick count 1,377 against the minute tier's 4,783 — internally consistent, so nothing gave it away, while `/price?at=` inside the day answered below that bar's low.                                                             | `bee9375` |
| 7   | **Adjacent history pages overlapped**: a client paging by fixed windows got the boundary candle twice. `[from, to)` now means it on both edges.                                                                                                                                                                                                                                                                  | `bee9375` |
| 8   | **`/catalogue` published only a proxy for the refund rate**, undefined anywhere: `tieRate` reads 11%–17% where the engine refunds 3.5%–4.8% — 3.7× apart on `eurusd-otc`, and a payout sized off it is wrong.                                                                                                                                                                                                    | `bee9375` |
| 9   | **A retired market answered the same `400` for ever**, which the broker's guide tells it to _retry_.                                                                                                                                                                                                                                                                                                             | `bee9375` |
| 10  | **The Lab marked a state directory before taking its writer lock**, so a Lab pointed at production by a mistyped `OTC_STATE_DIR` left the marker that stops production booting — for ever — even though the Lab then refused to start.                                                                                                                                                                           | `bee9375` |
| 11  | **`429` was on no route and in no guide.** 600/minute/address by default, including `/markets/:id/price` — the settlement route. The one refusal a broker's own traffic causes, and it was told only "400 means retry, 404 means alert".                                                                                                                                                                         | `8c47201` |
| 12  | **Nothing distinguished the Lab composition from production.** A Lab-composed process serves every contracted route _plus_ `/lab`, whose controls push, pulse and target a price — and a pre-production gate passed 37 of 37 against one.                                                                                                                                                                        | `8c47201` |
| 13  | **The shipped proxy's protections were case-sensitive while the router was not**: `/Assets/…` reached the write surface, `/Metrics` and `/metrics/` reached the monitor surface. The guard had asserted the very regex that leaked.                                                                                                                                                                              | `8c47201` |
| 14  | **`docker-compose.yml` crash-looped the engine as its own header documented it**: it set `OTC_PUBLICATION_DIR` unconditionally, which makes a publishing key mandatory, and the header's invocation has none.                                                                                                                                                                                                    | `8c47201` |
| 15  | **The lattice tool could not repair a record written by this release**: its table of past frames stopped at `v2.4.0`, so an operator upgrading past the six precision changes had no `--from-release` to name.                                                                                                                                                                                                   | `cceb9c4` |
| 16  | **The integration guide quoted a refund rate ten times too small** — the pre-`v2.4.0` range, asserted as current — while `ORBIT.md` in the same package gave the true figure. Nothing re-derived it; now a guard does, and it reddened on the _correction_ before it passed.                                                                                                                                     | `cceb9c4` |

### Recorded rather than changed (four)

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Where it is written                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 17  | **A quote must be the price in force when the server accepts it.** A client opening at a price quoted one second earlier, in the direction the market already moved, wins **56–61%** of 30 s contracts against 54% break-even at an 85% payout. This is the broker's rule to enforce, not the engine's — and it is the largest number in this audit.                                                                                                               | `RELEASE-3.0.0.md` §4.4, `ORBIT.md` §3 |
| 18  | **Six assets gain a decimal on upgrade, and that is deliberately not a reframe.** No quantum and no reference moved, so every stored integer still means what it meant and `settle()` crosses the restart normally (verified: `reframesAt` is `false` for a precision-only epoch change, `true` for a quantum change). A broker settling on _formatted strings_ would compare a 2-decimal entry against a 3-decimal expiry, and the engine cannot see it doing so. | `RELEASE-3.0.0.md` §4.5                |
| 19  | **The client and the conformance suite are version-locked** (`venueVersion === API_VERSION`), so the package — not the binary — is the unit of upgrade: last release's checklist reports a failure against this release's engine, by design.                                                                                                                                                                                                                       | `RELEASE-3.0.0.md` §4.6                |
| 20  | **The proof route needs `OTC_PUBLICATION_DIR` and a key**, or it answers 404 and the broker's conformance run records that its proof check was not independent.                                                                                                                                                                                                                                                                                                    | `RELEASE-3.0.0.md` §8                  |

### Refuted (one)

**"The record retains under seven hours of ticks."** Refuted by all three refuters:
the arithmetic assumed a tick rate the engine stopped printing at PH-24.17. A
second suspicion of my own — that `docker-compose` lost the state directory — was
refuted the same way: the Dockerfile sets `OTC_STATE_DIR`.

## 4. What was measured live, and on which tree

Every row was taken against a built engine on a real venue, not a fixture.

| Measure                                                                  | Result                                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| The broker's checklist against a live venue with publication, pinned key | **36 of 36, exit 0**, the proof row independent (`d80a7ae`)                              |
| The backup's commitment chain, live venue with publication configured    | **724 files** copied, counted in the manifest, printed by the tool                       |
| A fresh production venue's chart after the fix, 2 days provisioned       | **0 undated** bars at 1m, 5m, 1h and 1d (0/2,880, 0/576, 0/48, 0/2), epoch at sequence 1 |
| The same venue before the fix                                            | 1,437/1,439 minute bars and 288/288 five-minute bars undated                             |
| The catch-up bound under a saturated host, after the fix                 | **seam rate 0** ([`SEAM-RATE-2026-09-27.md`](SEAM-RATE-2026-09-27.md))                   |
| A backwards clock step of thirty minutes, before the fix                 | 5 min of passes, 0 ticks, 0 throws, `/health` `ok`, `stalled` empty                      |
| A precision-only epoch change                                            | `reframesAt` **false**; a quantum change **true**                                        |
| Refund per asset at 30 s, re-derived from the shipped catalogue          | **3,47%–4,78%**, mean **4,07%** — what `realisedRefundRate` now publishes                |

## 5. What this audit does not claim

It read the tree at one commit and it is not a Cycle Audit: it did not plant a
defect against every guard in the repository, and it did not examine the
governance records. Its dimensions were chosen for a **broker's** exposure, so a
defect that costs the operator nothing outward-facing was out of scope by
construction. The calibration bias of Cycle Audit 12 finding 7 (+1.91pp on the
refund) is still open and is still the next phase.
