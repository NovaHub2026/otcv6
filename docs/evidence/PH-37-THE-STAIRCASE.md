# PH-37 — The Staircase

Type: EVIDENCE (measured, per asset)
Recorded: 2026-09-23
Phase: [PH-37](../phases/PH-37-the-staircase.md), subphases PH-37.1 and PH-37.2

---

## 1. What the price looked like before, and why

Measured on the live venue's own tape — 3,667 ticks of three assets over ten
minutes — and reproduced offline over 33 hours of market time per asset. The
same EUR/USD minute, read at different precisions:

| the price is published with             | ticks that leave it unchanged |                   typical step |
| --------------------------------------- | ----------------------------: | -----------------------------: |
| 7 decimals (what we shipped)            |                      **2.2%** | **44 units** of the last digit |
| 6 decimals                              |                          8.5% |                        4 units |
| 5 decimals (what a real EUR/USD quotes) |                     **45.8%** |                     **1 unit** |

The market underneath was right: 0.75 pips of range in 68 seconds is a calm
EUR/USD. What was wrong was the resolution — the catalogue published between 6
and 356 times finer than the instruments it is named for:

|         | our lattice | the real instrument |           ratio |
| ------- | ----------: | ------------------: | --------------: |
| EUR/USD |  0.00000036 |             0.00001 |       27× finer |
| EUR/GBP |  0.00000023 |             0.00001 |       43× finer |
| AAPL    |     0.00032 |                0.01 |       31× finer |
| NU      |    0.000031 |                0.01 |      320× finer |
| BNB     |      0.0013 |                 0.1 |       79× finer |
| BTC     |       0.123 |                0.01 | 12× **coarser** |

## 2. Why the ceiling, and not the real instrument

Anchoring each asset to its instrument's own increment was measured across the
thirty and rejected: it is not uniform. At the real increment, PBR and NU — an
18-dollar and a 14-dollar stock on a one-cent lattice — leave 92% and 97% of
their ticks unchanged and settle **26% and 45%** of thirty-second contracts at
the money. A ceiling on the refund is uniform, and the texture each asset gets
under it is whatever its own volatility allows.

The Human Owner set the ceiling at **5%**, with this measured against it:

|                | EUR/USD ticks unchanged | refund at 30 s |
| -------------- | ----------------------: | -------------: |
| before         |                    2.3% |           0.2% |
| ceiling 3%     |                   14.9% |           2.7% |
| **ceiling 5%** |               **24.4%** |       **4.2%** |
| the real tape  |                   48.6% |           8.9% |

## 3. Why PH-37.1 had to come first

Every candidate lattice was a different market until it did. The arrival
process was excited by the floored step count, so coarsening the lattice
starved it: 1.00 ticks a second against 0.74 across a factor of 27 on EUR/USD,
3.67 against 1.52 on BNB. After the fix the rate is **identical at ×1, ×8 and
×32** — 1.400 /s — and the startup bias a market opens with fell from −44% to
−2.3%, measured over 150 independent markets.

## 4. The build

Every asset under the ceiling. The `lattice` column is the factor against the
quantile the search starts from — **×12 on eight assets, ×16 on twenty-two** —
which is ×9.10 to ×22.97 (median ×13.69) against the lattice `v2.3.1`
published on. `median steps` is the
median thirty-second move in lattice steps: EUR/USD's is **4**, where the old
lattice made it about seventy.

| asset        | archetype       | tail weight drawn → authored                 | quantum   | precision | refund 30s | lattice | tie rate | median steps | mean interval ms | calibration | time |
| ------------ | --------------- | -------------------------------------------- | --------- | --------- | ---------- | ------- | -------- | ------------ | ---------------- | ----------- | ---- |
| eurusd-otc   | major-fx        | 51.7 → 51.7 (0 retreats)                     | 4.0446e-6 | 6         | 3.47%      | x12     | 12.881%  | 5            | 972.3            | 9.2 d × 3   | 11s  |
| gbpusd-otc   | major-fx        | 72.7 → 72.7 (0 retreats)                     | 4.0710e-6 | 6         | 3.86%      | x16     | 14.749%  | 5            | 915.3            | 5.6 d × 3   | 7s   |
| usdjpy-otc   | major-fx        | 63.4 → 63.4 (0 retreats)                     | 4.7218e-6 | 4         | 4.32%      | x16     | 13.683%  | 5            | 828.5            | 7.8 d × 3   | 11s  |
| audusd-otc   | major-fx        | 70.9 → 70.9 (0 retreats)                     | 5.7885e-6 | 6         | 4.40%      | x16     | 14.678%  | 5            | 786.2            | 6.4 d × 3   | 10s  |
| usdchf-otc   | major-fx        | 46.7 → 46.7 (0 retreats)                     | 2.9360e-6 | 6         | 4.16%      | x12     | 11.184%  | 6            | 1043.6           | 9.1 d × 3   | 9s   |
| eurgbp-otc   | major-fx        | 60.3 → 60.3 (0 retreats)                     | 2.9286e-6 | 6         | 3.91%      | x12     | 12.106%  | 6            | 1096.9           | 6.9 d × 3   | 8s   |
| gbpjpy-otc   | cross-fx        | 46.5 → 41.9 (1 retreats, clamped from 120)   | 1.5096e-5 | 3         | 4.16%      | x16     | 15.483%  | 5            | 420.6            | 3.3 d × 3   | 7s   |
| eurjpy-otc   | cross-fx        | 85.2 → 85.2 (0 retreats)                     | 1.2147e-5 | 3         | 4.78%      | x16     | 17.181%  | 4            | 484.4            | 3.3 d × 3   | 4s   |
| aapl-otc     | sector-etf      | 52.6 → 52.6 (0 retreats)                     | 1.2790e-5 | 3         | 3.53%      | x16     | 14.017%  | 5            | 547.4            | 8.8 d × 3   | 14s  |
| msft-otc     | sector-etf      | 47.1 → 47.1 (0 retreats)                     | 1.0787e-5 | 3         | 4.13%      | x12     | 12.606%  | 5            | 582.2            | 8.6 d × 3   | 12s  |
| nvda-otc     | sector-etf      | 64.9 → 64.9 (0 retreats)                     | 2.1226e-5 | 3         | 3.85%      | x16     | 14.341%  | 5            | 367.6            | 5.7 d × 3   | 14s  |
| tsla-otc     | sector-etf      | 62.6 → 62.6 (0 retreats)                     | 3.9769e-5 | 2         | 4.07%      | x16     | 15.627%  | 4            | 344.8            | 4.6 d × 3   | 12s  |
| meta-otc     | sector-etf      | 59.0 → 59.0 (0 retreats)                     | 1.7928e-5 | 2         | 4.02%      | x12     | 11.114%  | 6            | 408.0            | 7.3 d × 3   | 17s  |
| amzn-otc     | sector-etf      | 53.7 → 53.7 (0 retreats)                     | 2.1552e-5 | 3         | 3.85%      | x16     | 14.903%  | 4            | 460.5            | 6.0 d × 3   | 14s  |
| pbr-otc      | sector-etf      | 57.9 → 57.9 (0 retreats)                     | 2.0978e-5 | 4         | 4.53%      | x12     | 12.981%  | 5            | 430.8            | 4.6 d × 3   | 12s  |
| nu-otc       | sector-etf      | 56.5 → 56.5 (0 retreats)                     | 2.7620e-5 | 4         | 4.71%      | x16     | 15.021%  | 5            | 332.1            | 7.4 d × 3   | 18s  |
| btcusdt-otc  | major-crypto    | 116.9 → 116.9 (0 retreats)                   | 2.4009e-5 | 0         | 3.95%      | x16     | 14.864%  | 5            | 325.5            | 8.0 d × 3   | 26s  |
| ethusdt-otc  | major-crypto    | 152.6 → 152.6 (0 retreats)                   | 3.7196e-5 | 2         | 4.36%      | x16     | 16.761%  | 5            | 285.8            | 6.5 d × 3   | 21s  |
| bnbusdt-otc  | major-crypto    | 137.0 → 137.0 (0 retreats)                   | 2.4697e-5 | 2         | 3.65%      | x16     | 13.428%  | 6            | 303.8            | 5.5 d × 3   | 26s  |
| solusdt-otc  | alt-crypto      | 117.7 → 106.0 (1 retreats, clamped from 140) | 4.5938e-5 | 3         | 3.96%      | x16     | 14.080%  | 5            | 246.2            | 3.3 d × 3   | 12s  |
| xrpusdt-otc  | alt-crypto      | 136.3 → 136.3 (0 retreats)                   | 3.3871e-5 | 5         | 4.06%      | x16     | 16.701%  | 5            | 255.9            | 3.3 d × 3   | 13s  |
| dogeusdt-otc | alt-crypto      | 72.2 → 65.0 (1 retreats, clamped from 150)   | 7.4494e-5 | 6         | 4.09%      | x16     | 15.066%  | 5            | 235.2            | 3.3 d × 3   | 10s  |
| mmx-idx-otc  | alt-crypto      | 149.9 → 149.9 (0 retreats)                   | 5.3631e-5 | 2         | 3.77%      | x16     | 16.285%  | 5            | 238.2            | 3.3 d × 3   | 11s  |
| cgx-idx-otc  | major-crypto    | 120.4 → 120.4 (0 retreats)                   | 2.8298e-5 | 2         | 3.70%      | x16     | 13.296%  | 6            | 309.0            | 7.9 d × 3   | 23s  |
| aix-idx-otc  | blue-chip-index | 48.6 → 48.6 (0 retreats)                     | 1.9375e-5 | 2         | 3.91%      | x12     | 11.029%  | 6            | 423.1            | 10.1 d × 3  | 17s  |
| tcx-idx-otc  | blue-chip-index | 38.8 → 38.8 (0 retreats)                     | 1.6246e-5 | 2         | 4.31%      | x16     | 15.075%  | 4            | 502.5            | 8.7 d × 3   | 12s  |
| scx-idx-otc  | blue-chip-index | 39.6 → 39.6 (0 retreats)                     | 2.6868e-5 | 2         | 4.40%      | x16     | 13.807%  | 5            | 386.7            | 8.6 d × 3   | 14s  |
| gmx-idx-otc  | sector-etf      | 65.5 → 65.5 (0 retreats)                     | 2.2526e-5 | 2         | 3.96%      | x16     | 15.038%  | 5            | 408.8            | 5.0 d × 3   | 10s  |
| evx-idx-otc  | sector-etf      | 65.8 → 65.8 (0 retreats)                     | 4.0857e-5 | 2         | 4.50%      | x16     | 15.171%  | 4            | 344.8            | 8.6 d × 3   | 20s  |
| brx-idx-otc  | sector-etf      | 42.6 → 42.6 (0 retreats)                     | 2.0520e-5 | 2         | 3.63%      | x12     | 11.906%  | 5            | 458.3            | 5.4 d × 3   | 11s  |

Keyring: `MasterKeyring.forTesting(registrationKeyLabel(id))` per asset. Run label: `catalogue-of-thirty`. Replicates: 3. Total run time: 6.8 minutes.
