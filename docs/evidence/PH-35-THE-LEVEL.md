# PH-35 — The Level The Market Runs At

Type: EVIDENCE (measured, per asset)
Recorded: 2026-09-23
Phase: [PH-35](../phases/PH-35-the-level.md), subphase PH-35.1
Gate: `GATE_EXIT=0` on `622859f` — unit 168 files / 3,484 tests; coverage floors held; statistical 47 files / 411 tests, with a real browser

---

## 1. What was measured, and how

Each of the thirty assets on its catalogue configuration for **sixty simulated
days**, from a stream family the calibration never used, reading its regime
from the engine's own snapshot every sixteenth tick. Per regime: the realised
tick rate, the median five-minute candle as a percentage of price, the median
of five-minute realised volatilities against the real instrument's typical day,
and sojourn lengths. The day range is the median of sixty daily high-low
spans.

## 2. Per asset

> **The `ticks/s` column is stale, and knowingly so (Cycle Audit 12).** It was
> measured with `REGIME_ACTIVITY_SHARE` at ½; PH-37.1 lowered it to ¼ so a
> regime would arrive as a bigger step rather than almost entirely as more
> ticks, and PH-37.2 then rebuilt the catalogue. Re-measured at the shipped ¼,
> the calm rate is 10–15% higher, elevated 5.5–9.0% lower and stressed 11–23%
> lower than the column below; the stressed/calm _rate_ ratio is 1.50–1.71
> where this table implies 2.13. Nothing caught it because the split preserves
> variance per unit time: **the level, day-range, `avg × real`, refund and
> kurtosis columns are unaffected and still reproduce.** The current rates are
> the `mean interval ms` column of
> [`PH-37-THE-STAIRCASE.md`](PH-37-THE-STAIRCASE.md).

| Asset        | ticks/s (calm / normal / elevated / stressed) | 5m candle % (calm / normal / elevated / stressed) | day range % | level × real (calm / normal / elev / stress) | avg × real |        regime median (min) |
| ------------ | --------------------------------------------: | ------------------------------------------------: | ----------: | -------------------------------------------: | ---------: | -------------------------: |
| eurusd-otc   |                     0.79 / 0.99 / 1.25 / 1.60 |                     0.019 / 0.022 / 0.028 / 0.038 |        0.59 |                    1.00 / 1.26 / 1.61 / 2.10 |       1.17 |         92 / 154 / 55 / 25 |
| gbpusd-otc   |                     0.81 / 1.02 / 1.31 / 1.58 |                     0.014 / 0.017 / 0.020 / 0.022 |        0.60 |                    0.87 / 1.07 / 1.27 / 1.39 |       0.91 |         92 / 128 / 52 / 21 |
| usdjpy-otc   |                     0.87 / 1.11 / 1.46 / 1.95 |                     0.023 / 0.028 / 0.036 / 0.046 |        0.98 |                    1.09 / 1.33 / 1.74 / 2.20 |       1.13 |         92 / 147 / 60 / 21 |
| audusd-otc   |                     0.92 / 1.19 / 1.52 / 2.06 |                     0.025 / 0.030 / 0.038 / 0.050 |        0.93 |                    0.99 / 1.27 / 1.60 / 2.01 |       1.21 |         93 / 133 / 59 / 22 |
| usdchf-otc   |                     0.75 / 0.93 / 1.16 / 1.45 |                     0.014 / 0.016 / 0.018 / 0.023 |        0.47 |                    0.91 / 1.04 / 1.23 / 1.52 |       1.00 |        118 / 157 / 65 / 23 |
| eurgbp-otc   |                     0.69 / 0.88 / 1.10 / 1.51 |                     0.013 / 0.015 / 0.018 / 0.026 |        0.46 |                    0.95 / 1.13 / 1.30 / 1.91 |       1.06 |        111 / 147 / 62 / 21 |
| gbpjpy-otc   |                     1.76 / 2.27 / 3.01 / 4.01 |                     0.075 / 0.089 / 0.111 / 0.112 |        3.70 |                    0.92 / 1.15 / 1.45 / 1.67 |       1.10 |         80 / 105 / 42 / 17 |
| eurjpy-otc   |                     1.48 / 1.88 / 2.50 / 3.59 |                     0.040 / 0.046 / 0.057 / 0.081 |        1.91 |                    0.76 / 0.91 / 1.15 / 1.64 |       0.85 |         89 / 109 / 44 / 17 |
| aapl-otc     |                     1.42 / 1.79 / 2.20 / 2.76 |                     0.058 / 0.064 / 0.073 / 0.079 |        1.97 |                    0.97 / 1.10 / 1.31 / 1.43 |       1.11 |        100 / 153 / 58 / 21 |
| msft-otc     |                     1.34 / 1.68 / 2.06 / 2.59 |                     0.047 / 0.053 / 0.059 / 0.081 |        1.48 |                    0.88 / 1.02 / 1.19 / 1.64 |       0.98 |        112 / 159 / 64 / 28 |
| nvda-otc     |                     2.00 / 2.52 / 3.25 / 4.25 |                     0.080 / 0.090 / 0.112 / 0.130 |        3.20 |                    0.69 / 0.83 / 1.06 / 1.23 |       0.88 |         92 / 139 / 54 / 21 |
| tsla-otc     |                     2.22 / 2.77 / 3.51 / 4.45 |                     0.112 / 0.122 / 0.147 / 0.163 |        3.44 |                    0.83 / 0.90 / 1.12 / 1.36 |       0.80 |        113 / 149 / 58 / 22 |
| meta-otc     |                     1.87 / 2.36 / 2.93 / 3.91 |                     0.086 / 0.101 / 0.113 / 0.150 |        3.49 |                    0.81 / 0.97 / 1.14 / 1.44 |       0.98 |         98 / 140 / 61 / 21 |
| amzn-otc     |                     1.68 / 2.12 / 2.68 / 3.73 |                     0.072 / 0.086 / 0.105 / 0.139 |        2.85 |                    0.83 / 1.03 / 1.31 / 1.72 |       1.05 |        101 / 156 / 63 / 23 |
| pbr-otc      |                     1.76 / 2.20 / 2.75 / 3.58 |                     0.065 / 0.073 / 0.085 / 0.102 |        2.14 |                    0.78 / 0.89 / 1.06 / 1.25 |       0.77 |        108 / 134 / 55 / 22 |
| nu-otc       |                     2.23 / 2.85 / 3.59 / 5.14 |                     0.143 / 0.169 / 0.201 / 0.317 |        5.82 |                    1.06 / 1.30 / 1.54 / 2.42 |       1.25 |        100 / 133 / 54 / 23 |
| btcusdt-otc  |                     2.13 / 2.77 / 3.79 / 5.43 |                     0.091 / 0.109 / 0.148 / 0.195 |        4.21 |                    0.73 / 0.93 / 1.26 / 1.59 |       0.87 |         82 / 109 / 42 / 16 |
| ethusdt-otc  |                     2.58 / 3.20 / 4.26 / 6.31 |                     0.142 / 0.148 / 0.189 / 0.266 |        5.56 |                    1.00 / 1.05 / 1.41 / 1.92 |       0.96 |         74 / 102 / 40 / 17 |
| bnbusdt-otc  |                     2.39 / 3.10 / 4.07 / 5.80 |                     0.156 / 0.183 / 0.230 / 0.323 |        7.31 |                    1.13 / 1.38 / 1.76 / 2.50 |       1.15 |         73 / 103 / 41 / 16 |
| solusdt-otc  |                     2.87 / 3.71 / 4.87 / 6.67 |                     0.231 / 0.277 / 0.318 / 0.410 |        9.28 |                    1.41 / 1.74 / 2.01 / 2.45 |       1.05 |         70 / 104 / 40 / 16 |
| xrpusdt-otc  |                     2.77 / 3.57 / 4.59 / 6.19 |                     0.144 / 0.175 / 0.210 / 0.229 |        7.20 |                    0.96 / 1.23 / 1.47 / 1.62 |       0.91 |         80 / 107 / 41 / 15 |
| dogeusdt-otc |                     3.11 / 3.92 / 5.30 / 7.71 |                     0.315 / 0.359 / 0.445 / 0.587 |       10.07 |                    1.50 / 1.70 / 2.12 / 2.72 |       0.98 |         72 / 100 / 42 / 16 |
| mmx-idx-otc  |                     2.94 / 3.77 / 5.04 / 7.16 |                     0.179 / 0.220 / 0.261 / 0.354 |        8.74 |                    1.05 / 1.29 / 1.51 / 2.07 |       0.86 |         81 / 115 / 42 / 17 |
| cgx-idx-otc  |                     2.39 / 2.97 / 4.01 / 5.84 |                     0.127 / 0.145 / 0.182 / 0.243 |        6.18 |                    0.87 / 1.02 / 1.33 / 1.68 |       0.96 |         75 / 107 / 40 / 17 |
| aix-idx-otc  |                     1.84 / 2.30 / 2.82 / 3.54 |                     0.087 / 0.103 / 0.122 / 0.134 |        2.75 |                    0.79 / 0.99 / 1.18 / 1.28 |       0.93 |        128 / 189 / 68 / 29 |
| tcx-idx-otc  |                     1.53 / 1.92 / 2.39 / 2.94 |                     0.062 / 0.075 / 0.083 / 0.088 |        1.92 |                    0.82 / 1.05 / 1.19 / 1.30 |       1.00 |        127 / 163 / 67 / 24 |
| scx-idx-otc  |                     2.03 / 2.50 / 3.14 / 3.94 |                     0.104 / 0.116 / 0.143 / 0.162 |        3.56 |                    0.81 / 0.93 / 1.21 / 1.39 |       0.99 |        113 / 151 / 68 / 24 |
| gmx-idx-otc  |                     1.81 / 2.33 / 2.85 / 3.46 |                     0.107 / 0.110 / 0.131 / 0.149 |        3.89 |                    1.00 / 1.09 / 1.34 / 1.68 |       1.34 |        107 / 150 / 56 / 19 |
| evx-idx-otc  |                     2.25 / 2.81 / 3.58 / 4.62 |                     0.124 / 0.143 / 0.189 / 0.192 |        3.92 |                    0.88 / 1.02 / 1.39 / 1.45 |       0.91 |        121 / 158 / 61 / 23 |
| brx-idx-otc  |                     1.69 / 2.12 / 2.64 / 3.34 |                     0.088 / 0.100 / 0.121 / 0.141 |        2.70 |                    0.92 / 1.08 / 1.31 / 1.63 |       1.03 |         92 / 137 / 49 / 22 |
| **median**   |                 **1.84 / 2.33 / 2.93 / 3.91** |                 **0.087 / 0.101 / 0.121 / 0.141** |    **3.44** |                **0.92 / 1.07 / 1.31 / 1.64** |   **0.99** | **93 / 139 / 55 / 21 min** |

## 3. Against PH-34's market, which this phase answered

|                                                          |          PH-34 (`v2.2.0`) |                                  PH-35 |
| -------------------------------------------------------- | ------------------------: | -------------------------------------: |
| EUR/USD, normal five-minute candle                       |        0.039% (~4.5 pips) |                 **0.022%** (~2.5 pips) |
| EUR/USD, median day                                      |                     1.28% |                              **0.59%** |
| BTC, median day                                          |                    12.55% |                              **4.21%** |
| TSLA, median day                                         |                     7.21% |                              **3.44%** |
| The market against the real instrument (60 days, median) |                     1.86× |                              **0.99×** |
| Level by regime, against a real ordinary day             | 1.45 / 1.72 / 2.52 / 3.81 |          **0.92 / 1.07 / 1.31 / 1.64** |
| A stressed candle against a normal one                   |                      2.3× |                               **1.6×** |
| Where the price stands after a year, EUR/USD             |                      ±14% |                              **±7.7%** |
| At-the-money refunds at 30 s                             |             0.085%–0.267% |                      **0.167%–0.435%** |
| Tick rates (median, calm → stress)                       | 1.86 / 2.34 / 3.49 / 5.74 |              1.84 / 2.33 / 2.93 / 3.91 |
| 30-second detection floor                                |                   0.223pp | **0.215pp**, still finer than 0.2513pp |
| Default engine excess kurtosis (10M ticks)               |                     18.63 |            **18.03** (predicted 20.90) |

The stressed regime's tick rate falls with its level, because half of a
regime's volatility arrives as ticks (PH-34): a gentler ladder is a gentler
burst as well as a smaller candle.

## 4. What it cost

- **Three assets of thirty leave the aggregational-gaussianity band** it held
  until now, which is why that band moved from 0.85 to 0.95: measured across
  all thirty on the test's own procedure, 0.259 to 0.909 with a median of
  0.573 — eurjpy 0.909, aapl 0.900, gmx 0.893 — and sixty ticks is twenty to
  sixty seconds of these markets, a horizon at which a real market's kurtosis
  barely falls either. All thirty are clean on predictability; twenty-seven
  pass all fifteen realism metrics.
- **Candle gaps**: the share of candles opening more than a quarter of their
  range from the previous close reaches 10.9% on GBP/USD (the band is 12%),
  against 8.1% at PH-34's level and 16–31% before PH-24.17.
- **Refunds return to roughly where they were before PH-34**, because a
  contract on the same lattice travels about half as far as it did at 1.7×.
