# Release 2.3.0 — The Level The Market Runs At

Type: EVIDENCE (the release record)
Recorded: 2026-09-23
Tag: `v2.3.0` — the PH-35 merge `e9b6966`, gated green locally on `622859f` and corroborated by hosted CI on both jobs
Supersedes: [`RELEASE-2.2.0.md`](RELEASE-2.2.0.md) for deployment
Package: `tools/sim/scripts/integration-package.sh v2.3.0 <dir>`

---

## 1. Why this release exists

`v2.2.0` gave the market a tempo that follows its state: ticks that rise with
the regime, regimes that last like a market's, and a floor under calm. It left
the market running at **1.7× the real instrument** — the anchor the Human Owner
chose at the time, with the arithmetic in front of them. Running it, they said
the normal regime was still too volatile, and that a ladder that keeps climbing
from there is the part that worries them.

Both halves are answered here, and both were the Human Owner's decision once the
alternatives were measured: the market runs at **the same level as the real
instrument** it is named for, and the rungs above normal are **compressed**.

## 2. What changed

- **`OTC_DISPERSION_FACTOR` 1.7 → 1.0.** An asset's volatility budget is the
  real instrument's, typical against typical. The thirty are recalibrated on it.
- **The regime ladder is gentler.** Levels are now relative to normal —
  compressed **0.8**, normal **1**, elevated **1.24**, stressed **1.6** — where
  they were 1.2 / 1.5 / 2.2 / 3.5 of the real typical level. A stressed
  five-minute candle is **1.6 normal ones** instead of 2.3.
- **Everything else from `v2.2.0` stands**: tick rates follow the asset and its
  regime, half of a regime's volatility arrives as ticks, regime minimums are
  30/45/20/10 minutes with a memoryless remainder, and the floor still holds
  calm above nothing.
- **The thirty are rebuilt keeping every recorded lattice**, as in `v2.2.0`.

## 3. What a broker sees on upgrade

|                                                          |   Before (`v2.2.0`) |                                   After |
| -------------------------------------------------------- | ------------------: | --------------------------------------: |
| EUR/USD, normal five-minute candle                       |     0.039% (~4.5 p) |                  **0.022%** (~2.5 pips) |
| EUR/USD, median day                                      |               1.28% |                               **0.59%** |
| BTC, median day                                          |              12.55% |                               **4.21%** |
| TSLA, median day                                         |               7.21% |                               **3.44%** |
| The market against the real instrument (60 days, median) |               1.86× |                               **0.99×** |
| Level by regime, against a real ordinary day             | 1.45/1.72/2.52/3.81 |                 **0.92/1.07/1.31/1.64** |
| A stressed candle against a normal one                   |                2.3× |                                **1.6×** |
| EUR/USD after a simulated year                           |                ±14% |                               **±7.7%** |
| At-the-money refunds at 30 s                             |       0.085%–0.267% |                       **0.167%–0.435%** |
| Ticks a second (median, calm → stress)                   | 1.86/2.34/3.49/5.74 |                     1.84/2.33/2.93/3.91 |
| 30-second detection floor (single test)                  |             0.223pp | **0.215pp** — still finer than 0.2513pp |
| API contract                                             |             `2.1.0` |                      `2.1.0`, unchanged |

**One seam per asset, and no price jump.** As at `v2.2.0`: the engine model is
part of every checkpoint's fingerprint, so a running market continues from its
last published price — every lattice is kept, so that price means what it meant
— with the discontinuity recorded, published by `GET /markets/:id/seams`, and
respected by `settle`. A contract whose window touches it does not settle. It
happens once, at the upgrade. Verified live on the local venue: 30 assets,
30 seams, prices continuous across every one.

**Refunds roughly double back to their pre-`v2.2.0` range**, because a contract
on the same lattice travels about half as far as it did at 1.7×. At-the-money is
refunded (ADR-0007), so this is a cost of carry, not an edge.

## 4. What was measured

| Measure                                                                       | Result                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Sixty simulated days per asset, on a stream family the calibration never used | [`PH-35-THE-LEVEL.md`](PH-35-THE-LEVEL.md), per asset and per regime                                                |
| The market against the real instrument                                        | 0.99× the median asset (0.77–1.34 across the thirty)                                                                |
| Lattice tie rates                                                             | re-measured, 12 replicates per asset (`evidence:ties`): 0.167%–0.435%                                               |
| Predictability                                                                | battery clean; 30 s floor 0.215pp against the 0.2513pp the 99% payout implies                                       |
| Structure                                                                     | the mirror test passes on the full stack, every layer active                                                        |
| Realism                                                                       | 27 of 30 pass all fifteen metrics; the aggregational-gaussianity band moved 0.85 → 0.95, measured across all thirty |
| Candle gaps                                                                   | worst 10.9% (GBP/USD) against a 12% band                                                                            |
| The phase gate                                                                | `GATE_EXIT=0` on `622859f` — unit 168 files / 3,484 tests; statistical 47 / 411 with a real browser                 |
| Hosted CI on the merge (`e9b6966`)                                            | green on both jobs                                                                                                  |

Five statistical assertions moved with the recalibration and every one was
**re-measured by its own procedure**, never retuned to a seed.

## 5. Why 2.3.0 and not 3.0.0

The API contract is untouched at `2.1.0`: every route, field and refusal is what
it was, and a client built against `v2.1.0` needs no change. What changed is the
market's level, which is a recalibration — and the one thing it does to a
running deployment, the seam, is a mechanism the contract already publishes and
the reference settlement already refuses to settle across.

## 6. Upgrading

Replace the binary and restart, with the state directory intact. Each market
takes one seam, visible at `GET /markets/:id/seams`; a contract whose window
touches it is refused rather than settled. Nothing else is required, and a
client needs no change.
