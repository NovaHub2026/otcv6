# Release 2.2.0 — The Market's Tempo Follows Its State

Type: EVIDENCE (the release record)
Recorded: 2026-09-22
Tag: `v2.2.0` — the PH-34 merge `8781ac6`, gated green locally on `3412049` and corroborated by hosted CI on both jobs
Supersedes: [`RELEASE-2.1.0.md`](RELEASE-2.1.0.md) for deployment
Package: `tools/sim/scripts/integration-package.sh v2.2.0 <dir>`

---

## 1. Why this release exists

The Human Owner, running the engine in their broker, said two things about how
it moves. That the tick rate was "bastante grande" and belonged to the asset's
family rather than to the asset: a calm pair ticked twice as often as a volatile
stock, and no asset ticked differently when its own market was agitated. And
that regimes changed from one candle to the next — on the most restless assets
the median stressed episode lasted a minute — where a real market holds a state
for hours. They also set the boundary this release is calibrated to: an OTC
market must be dynamic, so even its quietest stretches move more than the real
instrument does on an ordinary day.

## 2. What changed

- **The tick rate follows the asset and its regime.** Each asset's rate is
  derived from its own volatility (a square-root law across the thirty) and
  multiplied by the regime it is in. Catalogue medians: **1.86 / 2.34 / 3.49 /
  5.74** ticks a second from calm to stress, against a flat 4.12 before —
  **40% fewer ticks** overall, by decision.
- **Half of a regime's volatility arrives as ticks**, the other half as size,
  so a candle is the size its regime says whichever way the volatility comes.
- **Regimes last like a market's**: minimums of 30/45/20/10 minutes and a
  memoryless remainder, medians of about 1.6 h, 2.3 h, 55 min and 21 min, and
  a ladder — one step at a time, never calm to stress in a jump.
- **A floor under calm.** No combination of regime, cascade and structure phase
  takes the volatility level below the calm regime's, which sits above the real
  instrument's ordinary day. Measured: calm's typical five minutes at 1.45× a
  real ordinary day, its quietest tenth at 1.11×.
- **The market as a whole runs at 1.7× the real instrument**, the Human Owner's
  anchor, chosen with the arithmetic of the alternatives in front of them.
- **The thirty assets are recalibrated** on the new model, **keeping every
  recorded lattice**.

## 3. What a broker sees on upgrade

|                                                                  | Before (`v2.1.0`) |                                                          After |
| ---------------------------------------------------------------- | ----------------: | -------------------------------------------------------------: |
| Ticks a second, catalogue mean                                   |              4.12 |                                                           2.47 |
| At-the-money refunds at 30 s                                     |       0.42%–0.53% |                                              **0.085%–0.267%** |
| Candle open against previous close, over the candle's range (1m) |       0.023–0.061 |                                                    0.023–0.078 |
| Median ticks in a 1m candle                                      |            53–366 |                                                         53–367 |
| 30-second detection floor (single test)                          |           0.221pp | 0.223pp — still finer than the 0.2513pp the 99% payout implies |
| API contract                                                     |           `2.1.0` |                                             `2.1.0`, unchanged |

**One seam per asset, and no price jump.** The engine model is part of every
checkpoint's fingerprint, so a market resumed under this release takes a seam:
it continues from its last published price — the lattice is kept, so that price
means what it meant — with the discontinuity recorded, published by
`GET /markets/:id/seams`, and respected by `settle`. A contract whose window
touches it does not settle. It happens once, at the upgrade.

## 4. What was measured

| Measure                                                                       | Result                                                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Sixty simulated days per asset, on a stream family the calibration never used | [`PH-34-THE-MARKETS-TEMPO.md`](PH-34-THE-MARKETS-TEMPO.md), per asset and per regime                |
| Rate against each asset's target                                              | within ±2% on all thirty at calibration                                                             |
| Stressed episodes                                                             | never under ten minutes; 1.8%–3.3% of the time                                                      |
| Lattice tie rates                                                             | re-measured, 12 replicates per asset (`evidence:ties`)                                              |
| Predictability                                                                | battery clean; 30 s floor 0.223pp, finer than the payout margin                                     |
| Structure                                                                     | the mirror test passes on the full stack, every layer active                                        |
| Differentiation                                                               | 21.3–24.3% against an identical-personality control at 4.7–7.8%, no overlap                         |
| The phase gate                                                                | `GATE_EXIT=0` on `3412049` — unit 168 files / 3,478 tests; statistical 47 / 411 with a real browser |
| Hosted CI on the merge (`8781ac6`)                                            | green on both jobs                                                                                  |

## 5. Why 2.2.0 and not 3.0.0

The API contract is untouched at `2.1.0`: every route, field and refusal is
what it was, and a client built against `v2.1.0` needs no change. What changed
is the market's behaviour, which is a recalibration rather than a contract
break — and the one thing it does to a running deployment, the seam, is a
mechanism the contract already publishes and the reference settlement already
refuses to settle across.
