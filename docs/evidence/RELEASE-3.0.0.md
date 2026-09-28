# Release 3.0.0 — The Engine A Broker Settles Against

Type: EVIDENCE (the release record)
Recorded: 2026-09-28
Tag: `v3.0.0` — @@COMMIT@@, gated green locally and corroborated by hosted CI on both jobs
Supersedes: [`RELEASE-2.4.0.md`](RELEASE-2.4.0.md) for deployment
Package: `tools/sim/scripts/integration-package.sh v3.0.0 <dir>`
API contract: **3.7.0** (`b0d3c7c839be46dd`), from `2.1.0` in `v2.4.0`

---

## 1. Why this release exists

`v2.4.0` gave the market its texture. This release makes the market **safe for a
broker to settle against**, and closes the two defects that would have shown on
any deployment before it.

Three of them came from the Human Owner watching a real broker's code, and one
sentence decided the largest: _"una operación siempre debe liquidarse en el
milisegundo final que es para terminar, si un usuario abre un contrato de 1
minuto nunca puede liquidarse antes"_. The engine had been refusing to settle any
contract whose window touched a recorded discontinuity — a restart, a host that
withheld the CPU — which a broker turns into a refund. Measured on a day of the
live venue's own record: **20.5% of fifteen-minute contracts** opened while the
market was publishing. That rule is gone (ADR-0021); what replaced it is in §2.

The other two were defects a deployment would meet without doing anything
unusual:

- **The chart drew prices nobody published.** A canonical price is an integer
  count of log quanta above a reference, and the stores kept the integer and threw
  away the pair that makes it a price. When `v2.4.0` moved all thirty lattices,
  the whole retained past began rendering on a lattice it was never written on:
  **3,728,119 of 7,500,278 retained ticks, 49.7%, on 30 of 30 assets, median
  error 31.8%, worst 1,483%** (PH-38).
- **A venue that lost its host needed an operator.** A market past its catch-up
  bound stayed dead until someone restarted the process; on 2026-09-25 that
  happened three times in one day on ordinary developer load. It reopens itself
  now (ADR-0020), and a reopening that starves before its first tick is re-armed
  rather than refused for the life of the process (PH-39).

## 2. What changed in the contract: 2.1.0 → 3.7.0

**3.0.0 — a published price says what it counts in** (PH-38.3). `PUBLISHED`
carries `logQuantum` and `referencePrice`, so a broker that archived integers can
render them itself; `GET /markets/:id/lattices` lists every frame the record has
held. **This is the one breaking change in the release**: `displayPrice` is now
`string|null`, and a venue that cannot say what an integer counted in answers
**null** rather than a number derived from a frame nobody published it on. A
parser that rejects null will fail on exactly the deep-history requests a broker
makes to reconcile a statement.

**3.1.0 — a contract settles at its final millisecond** (PH-40.1, ADR-0021).
`GET /markets/:id/price?at=` no longer answers `409` inside a recorded seam: it
answers **the price in force** — the last tick before the gap, which the market
reopened from — and names the seam beside it in a new `seam` key, `null` outside
one. Every entry of `GET /markets/:id/seams` now says whether the lattice changed
there (`reframes`), because that is the one seam settlement still refuses.

**3.2.0 — a market that is open says so** (PH-40.2). A stream asked for
`?heartbeat=<ms>` (500–30000) writes an `event: heartbeat` frame between ticks
carrying the tick in force and `asOf`, the instant that price is final through.
`asOf` is how far the market has been published and recorded, **never the wall
clock**. And `/price?at=` answers every instant up to that point rather than only
up to the last tick, so a contract settles as soon as its final millisecond has
passed instead of waiting for the market's next tick.

**3.3.0 — what a chart consumes is in the contract** (PH-40.4). The candle item
is declared — four integers, `tickCount`, the sequences it was folded from and the
frame they count in — where the route said only `array`; and every published price
and candle carries `displayPrecision`, which is TradingView's `pricescale` as
`10 ** displayPrecision`.

**3.4.0 — the refund rate is published, and the proxy is named as one.** `GET
/catalogue` serves `realisedRefundRate` beside `tieRate`, and both are defined.
`tieRate` is a proxy — the fraction of horizons whose continuous return was
smaller than one quantum — and it reads 11%–17% where the engine actually refunds
**3,47%–4,78%** (mean 4,07%). A broker that sized a payout off the only rate the
catalogue used to publish was working from a figure 3 to 4 times too large.

**3.5.0 — every route a broker calls declares its `429`.** The rate limit is 600
requests a minute per address by default (`OTC_RATE_LIMIT_PER_MINUTE`), it has
always applied, and no route said so. `GET /markets/:id/price` — the settlement
route — is among the seventeen; this is the one refusal a broker's own traffic
causes, and it is not an engine fault. The operational probes are exempt.

**3.6.0 — `GET /health` says which composition answered** (ADR-0018). A
Lab-composed process serves every route in this contract **and** `/lab`, whose
controls push, pulse and target a market's price. Nothing distinguished them, so a
broker's conformance run could have passed against a venue whose prices were being
steered by hand. `composition` is `production` or `lab`, and the conformance suite
fails a venue that answers `lab`.

**3.7.0 — a sequence the record skipped says so.** The record's sequences are not
contiguous: a market resuming past its catch-up bound leases fresh ones and never
republishes what it skipped. `GET /markets/:id/ticks/:sequence` answered every
missing sequence by naming the record's bounds — and after a restored backup the
bounds _contain_ the gap. The live restore drill asked for 2,399 and was told "not
in the record, which holds 1–102446". A sequence inside the bounds now says it
fell in a gap and points at `/markets/:id/seams`; one genuinely past the record
still gets the bounds, because there the answer is "ask again later".

The heartbeat is opt-in and the other additions are keys, so apart from the
nullable `displayPrice` a client built against `2.1.0` keeps working.

## 3. What changed in the engine

- **Settlement takes a contract across an ordinary seam** and refuses only a
  window that crosses a **change of lattice**, where the entry and expiry
  integers count in different units. `RecordSeam.reframes` is required — silence
  must not read as "ordinary" — and `Settlement` reports `seamsCrossed`. A seam
  never closes a market: opening contracts is the broker's trading rule, not the
  engine's.
- **Six assets show one more decimal**: `meta-otc`, `tsla-otc`, `bnbusdt-otc`,
  `tcx-idx-otc` and `aix-idx-otc` from 2 to 3, `btcusdt-otc` from 0 to 1. A step
  is now at least one displayed digit down to **half** an asset's reference
  price, not merely at it — `meta-otc` stepped 1.03 digits and was trading 3.8%
  below its reference on the live record, where two adjacent prices printed the
  same two decimals and the engine's own `displayPrice` called a real move no
  move. **No quantum and no reference changed**, so no stored integer moved, no
  tie rate moved, and nothing is re-expressed: the catalogue diff is six lines.
- **A stall reopens itself** (ADR-0020), a starved reopening is **re-armed**
  without a second seam (PH-39.1), and **one restart writes one seam** however
  long the boot takes (PH-40.5, issue #23).
- **The record's retention trim is amortised.** It was a `COUNT` and an `OFFSET`
  walk over each asset's 250,000-row window on every checkpoint — 6.7 s of 40 s
  on the live venue — and on a process's first checkpoint after a long outage,
  with the record's pages evicted, 11.3 s in one pass, which once ran past the
  catch-up bound and reopened every market. An asset is trimmed once it has
  appended a hundredth of its window, plus one owed trim per market at a
  process's start, at most one per checkpoint.
- **A publish pass says where it spent its time**: `otc_pass_{advance,record,
publish,checkpoint}_max_seconds`, `otc_slow_passes_total`, and a `SLOW PASS`
  log line with the checkpoint's own split, at most once a minute.
- **A provisioned past declares the frame it was generated on.** Without it a
  fresh deployment's chart was empty: the backfill stored its bars with no frame,
  the venue's first checkpoint declared the store's first epoch at its own high
  sequence, and every backfilled bar fell below it and answered null — 1,437 of
  1,439 minute bars and 288 of 288 five-minute bars, within a hundred seconds of
  boot. Only a **new** deployment could show it, which is what a broker is.

## 4. What a broker sees on upgrade

1. **`displayPrice` can be null** (§2). Treat it as "no displayable price", never
   as zero; render from `logQuantum` and `referencePrice`, which every price now
   carries.
2. **Six assets publish one more decimal.** Read `displayPrecision` per asset —
   it has always been in `/catalogue` — and set `pricescale = 10 **
displayPrecision`. A broker that shows fewer decimals than the engine
   publishes settles a real move as a draw: at five decimals `usdchf-otc` refunds
   **16.0%** of thirty-second contracts against settlement's 3.9%
   ([BROKER-FIT-2026-09-27](BROKER-FIT-2026-09-27.md)).
3. **Nothing needs to handle seams any more.** A contract settles at its final
   millisecond whatever happened to the venue in between. Do not map a seam to a
   paused market.
4. **A quote must be the price in force when the server accepts it.** Not the
   engine's change, but the measurement is in this release: a client who opens at
   a price quoted one second earlier, in the direction the market already moved,
   wins **56–61%** of thirty-second contracts, against 54% break-even at an 85%
   payout.
5. **Do not upgrade with contracts in flight, if you settle on formatted
   strings.** The six precision changes of §3 are deliberately **not** a change of
   lattice: no quantum and no reference moved, so every stored integer still means
   what it meant, `reframes` is `false`, and `settle()` crosses the restart
   normally — which is the correct answer for anyone settling on integers. But a
   broker comparing the _strings_ would compare a two-decimal entry against a
   three-decimal expiry, and the engine cannot see that it is doing so. Settle on
   `sequence` and the integer, with the frame beside it; or drain the six assets
   first.
6. **Re-take the client and the conformance suite from this package.** Both are
   version-locked to the contract they were built for: the suite asserts
   `3.7.0` and refuses a venue that answers anything else, so last release's
   checklist reports a failure against this release's engine and this release's
   checklist reports one against an un-upgraded venue. That is the intended
   behaviour — a checklist that passed across a version boundary would be
   checking nothing — and it means the package is the unit of upgrade, not the
   binary alone.

## 5. What was measured

| Measure                                                            | Result                                                                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **The readiness audit**                                            | twenty confirmed findings, one refuted, seventy-one agents — [`PH-40-READINESS-2026-09-28.md`](PH-40-READINESS-2026-09-28.md)       |
| The broker's checklist against a live venue, with publication      | **36 of 36, exit 0**, the proof row independent                                                                                     |
| Settlement across seams, on a day of the live venue's record       | 20.5% of fifteen-minute contracts were refused before ADR-0021; **0 now**                                                           |
| A fresh deployment's chart, two days provisioned                   | **0 undated bars** at 1m, 5m, 1h and 1d, epoch declared at sequence 1 (1,437/1,439 undated before the fix)                          |
| Seams under a saturated host, after the bound fix                  | **0** — [`SEAM-RATE-2026-09-27.md`](SEAM-RATE-2026-09-27.md)                                                                        |
| The backup's signed commitment chain                               | **724 files** copied and counted, where it copied none                                                                              |
| The retained past that rendered on a lattice it was not written on | 3,728,119 of 7,500,278 ticks (49.7%), 30 of 30 assets, median error 31.8%, worst 1,483% — repaired by declaration                   |
| Refund per asset at 30 s, from the shipped catalogue               | **3,47%–4,78%**, mean **4,07%**, published as `realisedRefundRate`                                                                  |
| A broker displaying fewer decimals than the engine publishes       | `usdchf-otc` refunds **16.0%** of 30 s contracts against settlement's 3.9% — [`BROKER-FIT-2026-09-27.md`](BROKER-FIT-2026-09-27.md) |
| A quote one second stale, played in the direction of the move      | **56–61%** win rate at 30 s, against 54% break-even at an 85% payout                                                                |
| The integration package's own links                                | **every target resolves**, across 56 delivered documents — the script refuses to build otherwise                                    |
| Predictability                                                     | battery clean; the mirror test passes on the full stack                                                                             |
| @@GATE@@                                                           |                                                                                                                                     |

## 6. Why 3.0.0

The release major follows the API contract, as `v2.4.0` §6 said when it stayed at
2.x for an untouched contract. The contract has moved from `2.1.0` to `3.7.0`
since that release and one of those steps is breaking: `displayPrice` is
`string|null`. Everything else is additive.

## 7. Upgrading

**Replace the binary and restart with the state directory intact.** The engine's
fingerprint is unchanged since `v2.4.0` — `personality.ts` is byte-identical — so
this release does not seam a market by itself. A market seams only if the process
was down longer than the fifteen-second catch-up bound, which an ordinary deploy
is; that seam is recorded, the price continues from the one it published, and a
contract across it settles at its final millisecond.

**Declare the past once, per store.** Ticks written before `v3.0.0` carry no
frame, so they render as `displayPrice: null` until declared:

```
npm run state:lattice -- check   --dir <state dir> --from-release v2.4.0
npm run state:lattice -- declare --dir <state dir> --from-release v2.4.0
npm run state:lattice -- declare --dir <state dir> --store candle
```

`check` writes nothing and shows what each asset renders as before and after;
`declare` refuses any asset it cannot corroborate against the record rather than
guessing. Then `npm run state:verify -- --dir <state dir>`.

**One thing cannot be repaired after the fact.** A deployment whose past was
**provisioned** (`OTC_BACKFILL_DAYS`) by a build before this release stored those
bars with no frame, and their ticks were never in the tick record, so nothing can
corroborate them: `--store candle` dates what the record covers and leaves the
rest undated, and the chart begins where the live history begins. A deployment
that has not gone live yet should provision fresh on this release.

## 8. What this release does not do

- **It does not choose the broker's display.** The six assets of §4.2 are
  displayable at the engine's precision; showing fewer decimals is the broker's
  decision and its cost is measured.
- **It does not serve a price-steering surface, and never will** (INV-001).
- **`GET /markets/:id/proof/:sequence` needs `OTC_PUBLICATION_DIR`** and a
  publishing key; without them the route answers 404 and a broker's conformance
  run says its proof check was not independent.
- **Multi-node replication is not offered for settlement.** A follower still
  refuses a price inside a seam; a single-node deployment never reads it.
- **The calibration still simulates a market the engine does not run** (Cycle
  Audit 12, finding 7, a refund bias of +1.91pp). It is the next phase.
