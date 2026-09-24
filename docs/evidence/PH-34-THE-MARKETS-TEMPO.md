# PH-34 — The Market's Tempo Follows Its State

Type: EVIDENCE (measured, per asset)
Recorded: 2026-09-22
Phase: [PH-34](../phases/PH-34-the-markets-tempo.md), subphase PH-34.1
Gate: `GATE_EXIT=0` on `ed7064f` — unit 168 files / 3,475 tests (32 s); coverage floors held (115 s); statistical 47 files / 411 tests (3,330 s), with a real browser

---

> **Every tick-rate figure below is from PH-34's engine and split, and both
> have moved (Cycle Audit 12).** PH-35 relevelled the ladder, PH-37.1 lowered
> `REGIME_ACTIVITY_SHARE` from ½ to ¼ and moved the arrival excitation onto the
> magnitude, and PH-37.2 rebuilt the catalogue. What this record is evidence of
> is what PH-34 measured on the day; for the rates a deployment runs today see
> [`PH-37-THE-STAIRCASE.md`](PH-37-THE-STAIRCASE.md).

## 1. What was measured, and how

Each of the thirty assets was run on its catalogue configuration for **sixty
simulated days** from a stream family the calibration never used
(`MasterKeyring.forTesting('ph34-evidence')`), reading its regime from the
engine's own snapshot every sixteenth tick. Per regime: the realised tick
rate, the median of five-minute realised volatilities, and the sojourn
lengths. The level is stated **against the real instrument's typical day** —
the seat's reference dispersion divided by the ratio of average to typical of
that asset's own cascade — because typical against typical is what the Human
Owner chose to compare (PH-34 §2).

## 2. Per asset

| Asset        | ticks/s before | ticks/s now (calm / normal / elevated / stressed) | level × the real instrument (calm / normal / elevated / stressed) | regime median (calm / normal / elevated / stressed) |
| ------------ | -------------: | ------------------------------------------------: | ----------------------------------------------------------------: | --------------------------------------------------: |
| eurusd-otc   |           2.87 |                         0.80 / 0.99 / 1.49 / 2.22 |                                         1.72 / 2.00 / 2.85 / 3.47 |                              92 / 154 / 55 / 25 min |
| gbpusd-otc   |           3.65 |                         0.82 / 1.03 / 1.65 / 2.48 |                                         1.38 / 1.56 / 2.46 / 3.43 |                              92 / 128 / 52 / 21 min |
| usdjpy-otc   |           3.91 |                         0.87 / 1.12 / 1.72 / 3.12 |                                         1.42 / 1.72 / 2.37 / 3.50 |                              91 / 147 / 60 / 21 min |
| audusd-otc   |           3.06 |                         0.95 / 1.18 / 1.95 / 3.23 |                                         1.45 / 1.69 / 2.54 / 3.55 |                              92 / 133 / 60 / 22 min |
| usdchf-otc   |           1.94 |                         0.74 / 0.94 / 1.38 / 2.13 |                                         1.19 / 1.49 / 2.09 / 3.12 |                             118 / 157 / 65 / 23 min |
| eurgbp-otc   |           1.86 |                         0.72 / 0.88 / 1.36 / 2.21 |                                         1.98 / 2.36 / 3.51 / 5.31 |                             110 / 148 / 62 / 21 min |
| gbpjpy-otc   |           7.60 |                         1.74 / 2.23 / 3.72 / 7.47 |                                         1.18 / 1.41 / 2.25 / 4.16 |                              80 / 105 / 42 / 17 min |
| eurjpy-otc   |           3.91 |                         1.51 / 1.91 / 3.10 / 5.71 |                                         1.37 / 1.66 / 2.50 / 3.96 |                              89 / 109 / 44 / 17 min |
| aapl-otc     |           1.52 |                         1.45 / 1.79 / 2.63 / 4.14 |                                         1.34 / 1.58 / 2.39 / 3.77 |                             100 / 153 / 58 / 21 min |
| msft-otc     |           1.31 |                         1.34 / 1.69 / 2.45 / 3.80 |                                         1.50 / 1.72 / 2.32 / 3.19 |                             112 / 159 / 64 / 28 min |
| nvda-otc     |           2.38 |                         2.06 / 2.57 / 3.87 / 6.26 |                                         1.29 / 1.51 / 2.01 / 2.78 |                              92 / 139 / 54 / 21 min |
| tsla-otc     |           1.83 |                         2.25 / 2.84 / 4.33 / 7.00 |                                         1.64 / 2.04 / 2.94 / 3.81 |                             113 / 149 / 58 / 22 min |
| meta-otc     |           1.80 |                         1.88 / 2.35 / 3.49 / 5.79 |                                         1.37 / 1.61 / 2.22 / 3.46 |                              98 / 140 / 61 / 21 min |
| amzn-otc     |           1.93 |                         1.69 / 2.13 / 3.16 / 5.07 |                                         1.34 / 1.68 / 2.24 / 3.30 |                             101 / 156 / 63 / 23 min |
| pbr-otc      |           2.10 |                         1.76 / 2.20 / 3.42 / 5.60 |                                         1.31 / 1.61 / 2.49 / 3.73 |                             108 / 134 / 55 / 22 min |
| nu-otc       |           2.10 |                         2.28 / 2.85 / 4.47 / 7.31 |                                         1.53 / 1.84 / 2.89 / 4.34 |                             100 / 133 / 54 / 23 min |
| btcusdt-otc  |          10.31 |                         2.23 / 2.80 / 4.50 / 9.01 |                                         1.61 / 1.94 / 2.72 / 4.62 |                              82 / 109 / 42 / 16 min |
| ethusdt-otc  |           8.70 |                        2.51 / 3.25 / 5.36 / 11.14 |                                         1.59 / 1.93 / 2.95 / 5.05 |                              74 / 102 / 40 / 17 min |
| bnbusdt-otc  |           6.34 |                         2.37 / 3.01 / 5.06 / 9.79 |                                         1.65 / 1.89 / 3.08 / 5.01 |                              73 / 103 / 41 / 16 min |
| solusdt-otc  |           8.86 |                        3.03 / 3.77 / 6.29 / 12.29 |                                         2.24 / 2.67 / 4.05 / 5.46 |                              70 / 104 / 40 / 16 min |
| xrpusdt-otc  |           7.72 |                        2.73 / 3.63 / 5.88 / 11.06 |                                         1.98 / 2.51 / 3.86 / 5.71 |                              80 / 107 / 41 / 15 min |
| dogeusdt-otc |          10.75 |                        3.08 / 3.94 / 6.62 / 13.17 |                                         2.30 / 2.69 / 3.92 / 6.01 |                              72 / 100 / 42 / 16 min |
| mmx-idx-otc  |          10.01 |                        3.03 / 3.80 / 6.43 / 12.67 |                                         2.28 / 2.69 / 4.18 / 7.34 |                              81 / 115 / 42 / 17 min |
| cgx-idx-otc  |           7.09 |                        2.28 / 2.94 / 5.00 / 10.04 |                                         1.29 / 1.56 / 2.52 / 3.93 |                              75 / 107 / 40 / 17 min |
| aix-idx-otc  |           1.60 |                         1.86 / 2.32 / 3.29 / 5.04 |                                         1.44 / 1.67 / 2.30 / 3.52 |                             129 / 189 / 68 / 29 min |
| tcx-idx-otc  |           1.21 |                         1.55 / 1.93 / 2.83 / 4.60 |                                         1.21 / 1.49 / 2.10 / 3.41 |                             127 / 163 / 67 / 24 min |
| scx-idx-otc  |           1.50 |                         2.04 / 2.53 / 3.73 / 5.74 |                                         1.45 / 1.73 / 2.61 / 3.77 |                             113 / 150 / 68 / 24 min |
| gmx-idx-otc  |           2.76 |                         1.84 / 2.34 / 3.47 / 5.30 |                                         1.28 / 1.54 / 2.20 / 3.66 |                             107 / 150 / 56 / 19 min |
| evx-idx-otc  |           1.56 |                         2.25 / 2.84 / 4.32 / 7.05 |                                         1.43 / 1.70 / 2.48 / 3.85 |                             121 / 158 / 61 / 23 min |
| brx-idx-otc  |           1.43 |                         1.70 / 2.16 / 3.18 / 5.26 |                                         1.51 / 1.86 / 2.61 / 4.19 |                              92 / 137 / 49 / 23 min |
| **median**   |       **2.76** |                     **1.86 / 2.34 / 3.49 / 5.74** |                                     **1.45 / 1.72 / 2.52 / 3.81** |                          **92 / 139 / 55 / 21 min** |

## 3. What the catalogue looks like now

|                                                                 |                             Before PH-34 |                                                                            After |
| --------------------------------------------------------------- | ---------------------------------------: | -------------------------------------------------------------------------------: |
| Mean tick rate per asset                                        |                                  4.12 /s |  2.47 /s at calibration, 2.61 /s measured over sixty days (**−40%** by decision) |
| Slowest / fastest asset                                         |             EUR/GBP 1.9 /s, DOGE 10.8 /s |                             EUR/GBP 0.88 /s, DOGE 3.94 /s (in the normal regime) |
| Rate against each asset's target                                |                                        — |                                          within ±2% on all thirty at calibration |
| Whole market against the real instrument                        |                                     ×1.0 | ×1.7 at calibration; ×1.86 median measured over sixty days (1.44–2.40 per asset) |
| Calm's quietest tenth of five minutes                           |                                        — |           ×1.11 of a real ordinary day: above it, which is what the floor is for |
| Median stressed episode                                         | 5 min (1 min on the most restless asset) |                                                           21 min, never under 10 |
| Time in the stressed regime                                     |                                        — |                                                                        1.8%–3.3% |
| Median ticks in a 1m candle                                     |                                   53–366 |                                53–367 (the calm forex pairs carry the whole cut) |
| Candle open against the previous close, over the candle's range |                              0.023–0.061 |                                                                      0.023–0.078 |
| At-the-money refunds at 30 s                                    |                              0.42%–0.53% |                                                                **0.085%–0.267%** |
| 30-second detection floor (single test)                         |                                  0.221pp |                    0.223pp, still finer than the 0.2513pp the 99% payout implies |
| Excess kurtosis, default engine, 10M ticks                      |                             62.3 (at 1M) |                                                                             18.6 |
| Asset differentiation, real vs identical-personality control    |                                        — |                                          21.3–24.3% against 4.7–7.8%, no overlap |

## 4. What the numbers cost

**Fewer ticks a candle means a wider gap** between one candle's close and the
next open: the median rose from about 4% of a candle's range to about 6%, worst
7.8% (GBP/USD). That is the metric PH-24.17 was created for, and it is still
far better than the 8%–15% it read before that subphase. It is the price of the
Human Owner's 40% cut, paid where they were told it would be paid.

**Tails are lighter.** The floor removes the low tail of the volatility level,
so the same cascade carries less kurtosis above it: the default engine reads
18.6 excess against 62.3 before, and three archetypes' bands were lowered to
what their cascades reach above the floor. The market still has spikes — the
stressed regime is ×3.8 of a real ordinary day and the cascade's upper states
multiply it — but fewer extreme ones.

**A broker's refunds halve.** A tie is refunded (ADR-0007), and at 1.7× the
movement on the lattice PH-26.3 recorded, a thirty-second contract lands exactly
at the money less than half as often.
