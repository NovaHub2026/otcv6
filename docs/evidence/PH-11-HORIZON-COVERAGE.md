# PH-11 — Long-horizon directional coverage (the catalogue of thirty)

Type: RECORDED EVIDENCE
Date: 2026-09-04 (regenerated for PH-26.3, the catalogue of thirty)
Verified by: `tools/sim/src/horizonCoverage.stat.test.ts`, which re-derives every row below

---

## How this document was produced

**One run per asset, in parallel, each command recorded beside its numbers.**
Thirty assets at the runner's defaults are seventeen hours of single-core time
in sequence — the fast tapes need ten simulated years each — so PH-26.3 ran
`npm run evidence:horizons -- --assets <id>` one asset per process, six at a
time, and composed this document from the sections with a script that computes
every total from the headers. The replication in Run 3 is the same procedure
under a second label for the fastest tape, so its eight cells are an
independent realisation of the same market.

## What this is

The directional verdict at **every expiration the product sells**, for every
asset, at the sensitivity each run actually achieved.

At the 99% promotional payout a trader breaks even at a 50.2513% win rate, so an
edge is worth exploiting at **0.2513 percentage points**. A verdict of "no edge"
means nothing unless the test could have seen an edge that size.

**235 of 240 asset/horizon cells are policed below it**; the 5 that are not are named in the Result.

## How to read the columns

- **Decided** — non-overlapping windows that settled a direction. Windows tile
  the timeline; they do not slide, because overlapping windows share increments
  and would be dependent by construction.
- **z** — deviation from a fair coin at the **effective** sample size, carrying
  the measured design effect rather than assuming independence.
- **Path bias z** — the common displacement the eight horizons of one path
  share; flat across horizons by construction.
- **Floor** — the smallest edge this cell could have detected at 3σ, re-derived
  by the verifying test from the sample count and the design effect.
- **Policed** — whether that floor is below the payout threshold.

## Run 1 — the catalogue

aapl-otc: 471,688,625 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -1,104,922 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,453,558 | 0.49976 | -0.0240   | -1.55 | -0.68       | 0.87 ±14%     | 0.0433     | yes     |
| 1m      | 5,233,892  | 0.49999 | -0.0009   | -0.04 | -0.69       | 1.14 ±14%     | 0.0652     | yes     |
| 2m      | 2,619,554  | 0.49946 | -0.0542   | -1.75 | -0.69       | 0.93 ±14%     | 0.0865     | yes     |
| 3m      | 1,747,075  | 0.49981 | -0.0193   | -0.48 | -0.70       | 1.13 ±14%     | 0.1126     | yes     |
| 4m      | 1,310,691  | 0.49945 | -0.0552   | -1.26 | -0.71       | 0.87 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,733  | 0.49929 | -0.0710   | -1.45 | -0.71       | 0.73 ±14%     | 0.1368     | yes     |
| 10m     | 524,602    | 0.49964 | -0.0356   | -0.52 | -0.74       | 0.83 ±14%     | 0.1934     | yes     |
| 15m     | 349,787    | 0.50043 | +0.0430   | 0.51  | -0.75       | 0.85 ±14%     | 0.2368     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets aapl-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 1154s.

Total run time: 19.2 minutes.

aix-idx-otc: 492,544,277 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -536,632 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,442,592 | 0.49970 | -0.0305   | -1.97 | -0.47       | 0.99 ±14%     | 0.0433     | yes     |
| 1m      | 5,230,344  | 0.49976 | -0.0244   | -1.11 | -0.48       | 1.00 ±14%     | 0.0614     | yes     |
| 2m      | 2,618,284  | 0.49933 | -0.0667   | -2.14 | -0.49       | 1.02 ±14%     | 0.0874     | yes     |
| 3m      | 1,746,505  | 0.49934 | -0.0655   | -1.68 | -0.49       | 1.06 ±14%     | 0.1090     | yes     |
| 4m      | 1,310,339  | 0.49929 | -0.0712   | -1.52 | -0.49       | 1.16 ±14%     | 0.1317     | yes     |
| 5m      | 1,048,512  | 0.49917 | -0.0829   | -1.70 | -0.50       | 1.00 ±14%     | 0.1370     | yes     |
| 10m     | 524,519    | 0.49939 | -0.0609   | -0.88 | -0.52       | 0.94 ±14%     | 0.1934     | yes     |
| 15m     | 349,707    | 0.49950 | -0.0499   | -0.59 | -0.52       | 0.93 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets aix-idx-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 1512s.

Total run time: 25.2 minutes.

amzn-otc: 596,707,627 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -100,073 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,454,234 | 0.49994 | -0.0062   | -0.40 | -0.06       | 0.92 ±14%     | 0.0433     | yes     |
| 1m      | 5,234,245  | 0.49976 | -0.0240   | -1.10 | -0.06       | 0.87 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,688  | 0.49965 | -0.0346   | -1.12 | -0.06       | 0.95 ±14%     | 0.0865     | yes     |
| 3m      | 1,747,206  | 0.49980 | -0.0201   | -0.52 | -0.06       | 1.05 ±14%     | 0.1085     | yes     |
| 4m      | 1,310,697  | 0.49974 | -0.0259   | -0.59 | -0.06       | 0.91 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,728  | 0.49991 | -0.0090   | -0.18 | -0.06       | 1.01 ±14%     | 0.1377     | yes     |
| 10m     | 524,590    | 0.49990 | -0.0101   | -0.14 | -0.06       | 1.05 ±14%     | 0.1984     | yes     |
| 15m     | 349,797    | 0.50107 | +0.1071   | 1.27  | -0.07       | 0.93 ±14%     | 0.2368     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets amzn-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 2015s.

Total run time: 33.6 minutes.

audusd-otc: 924,894,155 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 262,855 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,447,153 | 0.49991 | -0.0089   | -0.55 | 0.14        | 1.10 ±14%     | 0.0455     | yes     |
| 1m      | 5,232,038  | 0.50011 | +0.0109   | 0.50  | 0.14        | 0.96 ±14%     | 0.0612     | yes     |
| 2m      | 2,618,833  | 0.50001 | +0.0012   | 0.04  | 0.14        | 1.06 ±14%     | 0.0890     | yes     |
| 3m      | 1,746,848  | 0.49981 | -0.0186   | -0.49 | 0.14        | 0.96 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,425  | 0.49932 | -0.0683   | -1.56 | 0.14        | 0.83 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,581  | 0.49917 | -0.0834   | -1.71 | 0.14        | 0.89 ±14%     | 0.1368     | yes     |
| 10m     | 524,548    | 0.49895 | -0.1049   | -1.41 | 0.15        | 1.16 ±14%     | 0.2082     | yes     |
| 15m     | 349,774    | 0.49989 | -0.0109   | -0.13 | 0.15        | 0.87 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets audusd-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 3344s.

Total run time: 55.7 minutes.

bnbusdt-otc: 1,917,639,789 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 2,807,571 steps

| Horizon | Decided    | Up rate | Edge (pp) | z    | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ---- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,446,011 | 0.50034 | +0.0341   | 2.21 | 0.97        | 0.90 ±14%     | 0.0433     | yes     |
| 1m      | 5,232,001  | 0.50020 | +0.0204   | 0.93 | 0.98        | 0.97 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,183  | 0.50048 | +0.0483   | 1.54 | 1.01        | 1.03 ±14%     | 0.0877     | yes     |
| 3m      | 1,746,996  | 0.50075 | +0.0750   | 1.85 | 1.03        | 1.14 ±14%     | 0.1134     | yes     |
| 4m      | 1,310,591  | 0.50081 | +0.0815   | 1.73 | 1.05        | 1.16 ±14%     | 0.1316     | yes     |
| 5m      | 1,048,600  | 0.50109 | +0.1087   | 2.23 | 1.06        | 0.89 ±14%     | 0.1368     | yes     |
| 10m     | 524,585    | 0.50190 | +0.1902   | 2.75 | 1.11        | 0.78 ±14%     | 0.1934     | yes     |
| 15m     | 349,787    | 0.50212 | +0.2117   | 2.50 | 1.15        | 0.94 ±14%     | 0.2368     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets bnbusdt-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 7442s.

Total run time: 124.0 minutes.

brx-idx-otc: 447,305,086 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -401,102 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,449,683 | 0.49989 | -0.0110   | -0.66 | -0.32       | 1.18 ±14%     | 0.0472     | yes     |
| 1m      | 5,232,925  | 0.50007 | +0.0069   | 0.31  | -0.32       | 1.05 ±14%     | 0.0629     | yes     |
| 2m      | 2,619,078  | 0.50004 | +0.0044   | 0.14  | -0.32       | 0.84 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,950  | 0.50025 | +0.0248   | 0.63  | -0.33       | 1.08 ±14%     | 0.1099     | yes     |
| 4m      | 1,310,540  | 0.50044 | +0.0438   | 1.00  | -0.33       | 0.89 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,669  | 0.50033 | +0.0327   | 0.60  | -0.33       | 1.23 ±14%     | 0.1516     | yes     |
| 10m     | 524,607    | 0.50003 | +0.0031   | 0.04  | -0.34       | 1.20 ±14%     | 0.2115     | yes     |
| 15m     | 349,750    | 0.50035 | +0.0352   | 0.38  | -0.35       | 1.19 ±14%     | 0.2584     | no      |

Run label: `catalogue-of-thirty` (regenerate with `--assets brx-idx-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 1081s.

Total run time: 18.0 minutes.

btcusdt-otc: 3,001,519,086 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -1,862,309 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,434,521 | 0.49979 | -0.0206   | -1.33 | -0.72       | 0.98 ±14%     | 0.0434     | yes     |
| 1m      | 5,227,936  | 0.49953 | -0.0467   | -2.13 | -0.73       | 0.95 ±14%     | 0.0613     | yes     |
| 2m      | 2,617,641  | 0.49952 | -0.0479   | -1.45 | -0.75       | 1.15 ±14%     | 0.0927     | yes     |
| 3m      | 1,746,147  | 0.49958 | -0.0418   | -1.11 | -0.76       | 0.92 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,091  | 0.49918 | -0.0819   | -1.88 | -0.78       | 1.00 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,311  | 0.49903 | -0.0971   | -1.99 | -0.78       | 0.96 ±14%     | 0.1368     | yes     |
| 10m     | 524,513    | 0.49874 | -0.1263   | -1.83 | -0.82       | 0.96 ±14%     | 0.1934     | yes     |
| 15m     | 349,721    | 0.49927 | -0.0731   | -0.86 | -0.85       | 0.91 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets btcusdt-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 9834s.

Total run time: 163.9 minutes.

cgx-idx-otc: 2,150,484,419 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 1,030,632 steps

| Horizon | Decided    | Up rate | Edge (pp) | z    | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ---- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,453,252 | 0.50007 | +0.0074   | 0.48 | 0.29        | 0.79 ±14%     | 0.0433     | yes     |
| 1m      | 5,234,143  | 0.50025 | +0.0255   | 1.17 | 0.30        | 0.77 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,856  | 0.50052 | +0.0516   | 1.67 | 0.30        | 0.83 ±14%     | 0.0865     | yes     |
| 3m      | 1,747,283  | 0.50067 | +0.0674   | 1.78 | 0.31        | 0.74 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,715  | 0.50049 | +0.0490   | 1.12 | 0.32        | 0.91 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,789  | 0.50060 | +0.0598   | 1.23 | 0.32        | 0.87 ±14%     | 0.1368     | yes     |
| 10m     | 524,674    | 0.50077 | +0.0774   | 1.12 | 0.34        | 0.97 ±14%     | 0.1934     | yes     |
| 15m     | 349,849    | 0.50078 | +0.0779   | 0.89 | 0.35        | 1.07 ±14%     | 0.2449     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets cgx-idx-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 8402s.

Total run time: 140.0 minutes.

dogeusdt-otc: 3,138,260,898 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -2,185,707 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,446,907 | 0.49984 | -0.0165   | -1.03 | -1.00       | 1.06 ±14%     | 0.0446     | yes     |
| 1m      | 5,232,461  | 0.50006 | +0.0057   | 0.26  | -1.03       | 0.82 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,367  | 0.49974 | -0.0256   | -0.83 | -1.06       | 0.95 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,998  | 0.49960 | -0.0400   | -1.01 | -1.08       | 1.09 ±14%     | 0.1107     | yes     |
| 4m      | 1,310,643  | 0.50010 | +0.0103   | 0.23  | -1.09       | 1.08 ±14%     | 0.1270     | yes     |
| 5m      | 1,048,709  | 0.50056 | +0.0560   | 1.11  | -1.11       | 1.07 ±14%     | 0.1413     | yes     |
| 10m     | 524,605    | 0.49963 | -0.0367   | -0.53 | -1.15       | 0.95 ±14%     | 0.1934     | yes     |
| 15m     | 349,825    | 0.49994 | -0.0056   | -0.07 | -1.18       | 1.02 ±14%     | 0.2395     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets dogeusdt-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 8461s.

Total run time: 141.0 minutes.

ethusdt-otc: 2,630,180,021 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -121,546 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,456,534 | 0.49986 | -0.0145   | -0.88 | -0.03       | 1.13 ±14%     | 0.0461     | yes     |
| 1m      | 5,235,418  | 0.50023 | +0.0232   | 1.06  | -0.03       | 0.89 ±14%     | 0.0612     | yes     |
| 2m      | 2,620,198  | 0.49955 | -0.0453   | -1.46 | -0.03       | 1.01 ±14%     | 0.0869     | yes     |
| 3m      | 1,747,617  | 0.49987 | -0.0131   | -0.35 | -0.03       | 0.85 ±14%     | 0.1060     | yes     |
| 4m      | 1,311,010  | 0.49995 | -0.0053   | -0.12 | -0.03       | 1.00 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,937  | 0.49940 | -0.0595   | -1.20 | -0.03       | 1.04 ±14%     | 0.1392     | yes     |
| 10m     | 524,690    | 0.49945 | -0.0553   | -0.74 | -0.03       | 1.17 ±14%     | 0.2094     | yes     |
| 15m     | 349,844    | 0.49917 | -0.0829   | -0.93 | -0.03       | 1.10 ±14%     | 0.2485     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets ethusdt-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 9036s.

Total run time: 150.6 minutes.

eurgbp-otc: 573,016,239 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 63,373 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,444,540 | 0.50024 | +0.0240   | 1.38  | 0.04        | 1.26 ±14%     | 0.0487     | yes     |
| 1m      | 5,231,026  | 0.50022 | +0.0221   | 1.01  | 0.05        | 0.94 ±14%     | 0.0612     | yes     |
| 2m      | 2,618,526  | 0.49997 | -0.0033   | -0.10 | 0.05        | 1.08 ±14%     | 0.0900     | yes     |
| 3m      | 1,746,618  | 0.50049 | +0.0488   | 1.29  | 0.05        | 0.97 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,368  | 0.50065 | +0.0647   | 1.44  | 0.05        | 1.05 ±14%     | 0.1256     | yes     |
| 5m      | 1,048,455  | 0.50101 | +0.1007   | 2.06  | 0.05        | 0.96 ±14%     | 0.1368     | yes     |
| 10m     | 524,528    | 0.50083 | +0.0831   | 1.20  | 0.05        | 0.82 ±14%     | 0.1934     | yes     |
| 15m     | 349,730    | 0.49959 | -0.0412   | -0.49 | 0.05        | 0.81 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets eurgbp-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 2161s.

Total run time: 36.0 minutes.

eurjpy-otc: 1,204,909,588 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -845,942 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,456,086 | 0.50004 | +0.0041   | 0.26  | -0.29       | 1.01 ±14%     | 0.0435     | yes     |
| 1m      | 5,234,967  | 0.50004 | +0.0038   | 0.17  | -0.29       | 1.03 ±14%     | 0.0620     | yes     |
| 2m      | 2,619,978  | 0.49995 | -0.0048   | -0.14 | -0.30       | 1.19 ±14%     | 0.0946     | yes     |
| 3m      | 1,747,405  | 0.49997 | -0.0034   | -0.09 | -0.31       | 0.93 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,850  | 0.49987 | -0.0126   | -0.28 | -0.31       | 1.09 ±14%     | 0.1279     | yes     |
| 5m      | 1,048,912  | 0.49982 | -0.0179   | -0.36 | -0.31       | 1.06 ±14%     | 0.1411     | yes     |
| 10m     | 524,636    | 0.49983 | -0.0172   | -0.24 | -0.33       | 1.04 ±14%     | 0.1974     | yes     |
| 15m     | 349,832    | 0.50012 | +0.0123   | 0.13  | -0.34       | 1.26 ±14%     | 0.2660     | no      |

Run label: `catalogue-of-thirty` (regenerate with `--assets eurjpy-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 3648s.

Total run time: 60.8 minutes.

eurusd-otc: 888,276,547 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 1,290,031 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,455,434 | 0.49979 | -0.0206   | -1.33 | 0.74        | 0.84 ±14%     | 0.0433     | yes     |
| 1m      | 5,234,971  | 0.49987 | -0.0132   | -0.61 | 0.75        | 0.77 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,941  | 0.50018 | +0.0179   | 0.58  | 0.76        | 0.93 ±14%     | 0.0865     | yes     |
| 3m      | 1,747,237  | 0.50015 | +0.0151   | 0.40  | 0.77        | 0.68 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,817  | 0.49982 | -0.0182   | -0.42 | 0.78        | 0.70 ±14%     | 0.1223     | yes     |
| 5m      | 1,048,787  | 0.49980 | -0.0205   | -0.42 | 0.79        | 0.93 ±14%     | 0.1368     | yes     |
| 10m     | 524,590    | 0.50015 | +0.0147   | 0.21  | 0.81        | 0.75 ±14%     | 0.1934     | yes     |
| 15m     | 349,801    | 0.50098 | +0.0985   | 1.16  | 0.82        | 0.87 ±14%     | 0.2368     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets eurusd-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 3521s.

Total run time: 58.7 minutes.

evx-idx-otc: 479,862,999 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 785,213 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,440,773 | 0.50016 | +0.0163   | 1.05  | 0.63        | 0.90 ±14%     | 0.0434     | yes     |
| 1m      | 5,229,620  | 0.50018 | +0.0181   | 0.83  | 0.64        | 0.98 ±14%     | 0.0613     | yes     |
| 2m      | 2,618,174  | 0.50019 | +0.0194   | 0.63  | 0.65        | 0.92 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,467  | 0.50031 | +0.0310   | 0.82  | 0.66        | 0.73 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,145  | 0.50034 | +0.0341   | 0.78  | 0.66        | 0.84 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,326  | 0.49987 | -0.0128   | -0.26 | 0.67        | 0.79 ±14%     | 0.1368     | yes     |
| 10m     | 524,513    | 0.50030 | +0.0296   | 0.43  | 0.69        | 0.90 ±14%     | 0.1934     | yes     |
| 15m     | 349,715    | 0.50022 | +0.0224   | 0.27  | 0.70        | 0.88 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets evx-idx-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 1582s.

Total run time: 26.4 minutes.

gbpjpy-otc: 2,347,326,795 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 3,051,821 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,449,143 | 0.50008 | +0.0076   | 0.44  | 0.65        | 1.23 ±14%     | 0.0481     | yes     |
| 1m      | 5,232,995  | 0.49999 | -0.0011   | -0.05 | 0.66        | 1.18 ±14%     | 0.0666     | yes     |
| 2m      | 2,619,422  | 0.50013 | +0.0132   | 0.40  | 0.68        | 1.15 ±14%     | 0.0929     | yes     |
| 3m      | 1,747,082  | 0.50033 | +0.0329   | 0.80  | 0.69        | 1.17 ±14%     | 0.1149     | yes     |
| 4m      | 1,310,728  | 0.49990 | -0.0101   | -0.22 | 0.71        | 1.08 ±14%     | 0.1272     | yes     |
| 5m      | 1,048,782  | 0.50030 | +0.0300   | 0.58  | 0.71        | 1.14 ±14%     | 0.1460     | yes     |
| 10m     | 524,603    | 0.50014 | +0.0136   | 0.19  | 0.76        | 1.14 ±14%     | 0.2063     | yes     |
| 15m     | 349,803    | 0.50129 | +0.1285   | 1.31  | 0.78        | 1.35 ±14%     | 0.2755     | no      |

Run label: `catalogue-of-thirty` (regenerate with `--assets gbpjpy-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 6095s.

Total run time: 101.6 minutes.

gbpusd-otc: 1,101,878,491 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 65,043 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,442,973 | 0.49992 | -0.0081   | -0.52 | 0.04        | 1.02 ±14%     | 0.0437     | yes     |
| 1m      | 5,230,782  | 0.49989 | -0.0106   | -0.46 | 0.04        | 1.10 ±14%     | 0.0644     | yes     |
| 2m      | 2,618,515  | 0.49970 | -0.0303   | -0.89 | 0.04        | 1.22 ±14%     | 0.0958     | yes     |
| 3m      | 1,746,490  | 0.49960 | -0.0397   | -1.01 | 0.04        | 1.08 ±14%     | 0.1103     | yes     |
| 4m      | 1,310,367  | 0.49956 | -0.0443   | -0.98 | 0.04        | 1.08 ±14%     | 0.1272     | yes     |
| 5m      | 1,048,534  | 0.50014 | +0.0140   | 0.29  | 0.04        | 0.98 ±14%     | 0.1368     | yes     |
| 10m     | 524,533    | 0.49972 | -0.0275   | -0.39 | 0.04        | 1.05 ±14%     | 0.1979     | yes     |
| 15m     | 349,748    | 0.49893 | -0.1066   | -1.26 | 0.04        | 0.98 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets gbpusd-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 3606s.

Total run time: 60.1 minutes.

gmx-idx-otc: 835,576,340 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 772,856 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,439,418 | 0.49999 | -0.0008   | -0.05 | 0.43        | 1.18 ±14%     | 0.0470     | yes     |
| 1m      | 5,228,729  | 0.50009 | +0.0085   | 0.37  | 0.44        | 1.12 ±14%     | 0.0649     | yes     |
| 2m      | 2,617,695  | 0.50012 | +0.0118   | 0.38  | 0.44        | 0.95 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,049  | 0.50018 | +0.0181   | 0.48  | 0.45        | 0.97 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,017  | 0.50013 | +0.0128   | 0.29  | 0.45        | 0.82 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,168  | 0.50040 | +0.0396   | 0.81  | 0.46        | 0.90 ±14%     | 0.1368     | yes     |
| 10m     | 524,436    | 0.50040 | +0.0402   | 0.53  | 0.47        | 1.20 ±14%     | 0.2120     | yes     |
| 15m     | 349,708    | 0.49985 | -0.0146   | -0.17 | 0.48        | 1.05 ±14%     | 0.2424     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets gmx-idx-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 2423s.

Total run time: 40.4 minutes.

meta-otc: 557,681,571 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -369,021 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,450,135 | 0.49985 | -0.0148   | -0.93 | -0.23       | 1.05 ±14%     | 0.0445     | yes     |
| 1m      | 5,233,060  | 0.49998 | -0.0020   | -0.09 | -0.24       | 0.99 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,149  | 0.49976 | -0.0242   | -0.78 | -0.24       | 0.92 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,982  | 0.50002 | +0.0023   | 0.06  | -0.24       | 0.86 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,552  | 0.49951 | -0.0490   | -1.12 | -0.25       | 0.74 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,620  | 0.49943 | -0.0566   | -1.16 | -0.25       | 0.95 ±14%     | 0.1368     | yes     |
| 10m     | 524,536    | 0.50011 | +0.0109   | 0.16  | -0.26       | 0.93 ±14%     | 0.1934     | yes     |
| 15m     | 349,781    | 0.49966 | -0.0345   | -0.41 | -0.26       | 0.87 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets meta-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 1779s.

Total run time: 29.6 minutes.

mmx-idx-otc: 2,958,113,441 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -12,519 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,439,542 | 0.49993 | -0.0072   | -0.46 | -0.01       | 1.02 ±14%     | 0.0437     | yes     |
| 1m      | 5,229,697  | 0.49989 | -0.0114   | -0.50 | -0.01       | 1.09 ±14%     | 0.0639     | yes     |
| 2m      | 2,618,304  | 0.49984 | -0.0155   | -0.49 | -0.01       | 1.06 ±14%     | 0.0889     | yes     |
| 3m      | 1,746,449  | 0.49984 | -0.0161   | -0.42 | -0.01       | 0.84 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,306  | 0.49979 | -0.0210   | -0.46 | -0.01       | 1.11 ±14%     | 0.1287     | yes     |
| 5m      | 1,048,499  | 0.50011 | +0.0108   | 0.22  | -0.01       | 1.06 ±14%     | 0.1409     | yes     |
| 10m     | 524,522    | 0.49985 | -0.0154   | -0.21 | -0.01       | 1.16 ±14%     | 0.2083     | yes     |
| 15m     | 349,754    | 0.49975 | -0.0252   | -0.28 | -0.01       | 1.10 ±14%     | 0.2481     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets mmx-idx-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 8606s.

Total run time: 143.4 minutes.

msft-otc: 408,889,197 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -78,443 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,447,428 | 0.49989 | -0.0108   | -0.64 | -0.06       | 1.18 ±14%     | 0.0471     | yes     |
| 1m      | 5,232,179  | 0.49992 | -0.0080   | -0.37 | -0.06       | 0.97 ±14%     | 0.0612     | yes     |
| 2m      | 2,618,878  | 0.50003 | +0.0029   | 0.09  | -0.06       | 1.08 ±14%     | 0.0899     | yes     |
| 3m      | 1,746,878  | 0.49949 | -0.0513   | -1.23 | -0.06       | 1.21 ±14%     | 0.1167     | yes     |
| 4m      | 1,310,453  | 0.50006 | +0.0061   | 0.13  | -0.06       | 1.12 ±14%     | 0.1296     | yes     |
| 5m      | 1,048,596  | 0.49953 | -0.0474   | -0.97 | -0.06       | 0.96 ±14%     | 0.1368     | yes     |
| 10m     | 524,545    | 0.49938 | -0.0622   | -0.85 | -0.06       | 1.13 ±14%     | 0.2057     | yes     |
| 15m     | 349,776    | 0.49888 | -0.1118   | -1.28 | -0.07       | 1.07 ±14%     | 0.2455     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets msft-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 977s.

Total run time: 16.3 minutes.

nu-otc: 647,506,411 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -711,744 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,444,382 | 0.50003 | +0.0034   | 0.22  | -0.45       | 0.95 ±14%     | 0.0433     | yes     |
| 1m      | 5,230,914  | 0.50000 | -0.0001   | -0.00 | -0.45       | 0.95 ±14%     | 0.0612     | yes     |
| 2m      | 2,618,422  | 0.50001 | +0.0009   | 0.03  | -0.46       | 0.87 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,581  | 0.49957 | -0.0426   | -1.13 | -0.47       | 0.97 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,365  | 0.49989 | -0.0113   | -0.26 | -0.47       | 0.98 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,544  | 0.50006 | +0.0062   | 0.12  | -0.47       | 1.05 ±14%     | 0.1400     | yes     |
| 10m     | 524,476    | 0.50046 | +0.0458   | 0.66  | -0.49       | 0.91 ±14%     | 0.1934     | yes     |
| 15m     | 349,740    | 0.50041 | +0.0409   | 0.48  | -0.50       | 0.82 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets nu-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 1888s.

Total run time: 31.5 minutes.

nvda-otc: 734,888,068 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -422,453 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,439,555 | 0.49990 | -0.0102   | -0.66 | -0.27       | 1.01 ±14%     | 0.0436     | yes     |
| 1m      | 5,228,923  | 0.50007 | +0.0065   | 0.29  | -0.27       | 1.03 ±14%     | 0.0621     | yes     |
| 2m      | 2,617,631  | 0.50038 | +0.0383   | 1.23  | -0.27       | 1.01 ±14%     | 0.0870     | yes     |
| 3m      | 1,746,077  | 0.49976 | -0.0240   | -0.63 | -0.28       | 1.01 ±14%     | 0.1065     | yes     |
| 4m      | 1,310,045  | 0.50030 | +0.0300   | 0.66  | -0.28       | 1.07 ±14%     | 0.1266     | yes     |
| 5m      | 1,048,354  | 0.49977 | -0.0226   | -0.46 | -0.28       | 0.87 ±14%     | 0.1368     | yes     |
| 10m     | 524,428    | 0.49996 | -0.0040   | -0.06 | -0.29       | 1.07 ±14%     | 0.1997     | yes     |
| 15m     | 349,738    | 0.49965 | -0.0349   | -0.40 | -0.30       | 1.05 ±14%     | 0.2431     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets nvda-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 2205s.

Total run time: 36.8 minutes.

pbr-otc: 649,371,879 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -4,723 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,447,080 | 0.50019 | +0.0191   | 1.24  | -0.00       | 0.83 ±14%     | 0.0433     | yes     |
| 1m      | 5,231,982  | 0.50011 | +0.0113   | 0.52  | -0.00       | 0.68 ±14%     | 0.0612     | yes     |
| 2m      | 2,618,946  | 0.50030 | +0.0296   | 0.96  | -0.00       | 0.77 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,812  | 0.49999 | -0.0014   | -0.04 | -0.00       | 0.83 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,469  | 0.50029 | +0.0293   | 0.67  | -0.00       | 0.83 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,574  | 0.50015 | +0.0149   | 0.30  | -0.00       | 1.01 ±14%     | 0.1375     | yes     |
| 10m     | 524,526    | 0.50037 | +0.0370   | 0.54  | -0.00       | 0.97 ±14%     | 0.1934     | yes     |
| 15m     | 349,775    | 0.50105 | +0.1048   | 1.24  | -0.00       | 0.86 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets pbr-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 2201s.

Total run time: 36.7 minutes.

scx-idx-otc: 464,678,337 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -756,742 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,450,198 | 0.49986 | -0.0135   | -0.84 | -0.58       | 1.09 ±14%     | 0.0452     | yes     |
| 1m      | 5,233,217  | 0.50017 | +0.0173   | 0.79  | -0.58       | 0.96 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,172  | 0.50010 | +0.0102   | 0.33  | -0.58       | 0.83 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,924  | 0.50013 | +0.0131   | 0.35  | -0.59       | 0.95 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,494  | 0.50020 | +0.0205   | 0.46  | -0.60       | 1.02 ±14%     | 0.1235     | yes     |
| 5m      | 1,048,619  | 0.49997 | -0.0034   | -0.07 | -0.60       | 0.78 ±14%     | 0.1368     | yes     |
| 10m     | 524,545    | 0.50035 | +0.0348   | 0.50  | -0.62       | 0.98 ±14%     | 0.1934     | yes     |
| 15m     | 349,774    | 0.50037 | +0.0366   | 0.43  | -0.63       | 0.77 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets scx-idx-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 1028s.

Total run time: 17.1 minutes.

solusdt-otc: 2,633,577,562 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -699,028 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,443,108 | 0.49999 | -0.0009   | -0.06 | -0.30       | 0.93 ±14%     | 0.0433     | yes     |
| 1m      | 5,231,026  | 0.49965 | -0.0354   | -1.61 | -0.31       | 1.01 ±14%     | 0.0615     | yes     |
| 2m      | 2,618,812  | 0.49967 | -0.0331   | -0.94 | -0.32       | 1.30 ±14%     | 0.0987     | yes     |
| 3m      | 1,746,737  | 0.49990 | -0.0095   | -0.24 | -0.32       | 1.13 ±14%     | 0.1127     | yes     |
| 4m      | 1,310,477  | 0.49967 | -0.0330   | -0.76 | -0.33       | 0.89 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,575  | 0.49953 | -0.0474   | -0.95 | -0.33       | 1.05 ±14%     | 0.1401     | yes     |
| 10m     | 524,553    | 0.50008 | +0.0083   | 0.12  | -0.34       | 0.99 ±14%     | 0.1934     | yes     |
| 15m     | 349,795    | 0.49912 | -0.0885   | -0.96 | -0.36       | 1.19 ±14%     | 0.2589     | no      |

Run label: `catalogue-of-thirty` (regenerate with `--assets solusdt-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 7445s.

Total run time: 124.1 minutes.

tcx-idx-otc: 378,171,296 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 23,088 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,447,319 | 0.50002 | +0.0021   | 0.13  | 0.02        | 0.88 ±14%     | 0.0433     | yes     |
| 1m      | 5,231,921  | 0.50000 | +0.0002   | 0.01  | 0.02        | 0.90 ±14%     | 0.0612     | yes     |
| 2m      | 2,618,818  | 0.49984 | -0.0164   | -0.53 | 0.02        | 0.95 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,655  | 0.50006 | +0.0056   | 0.14  | 0.02        | 1.09 ±14%     | 0.1105     | yes     |
| 4m      | 1,310,521  | 0.50002 | +0.0025   | 0.06  | 0.02        | 0.87 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,487  | 0.49973 | -0.0273   | -0.56 | 0.02        | 0.95 ±14%     | 0.1368     | yes     |
| 10m     | 524,535    | 0.49977 | -0.0232   | -0.33 | 0.02        | 1.04 ±14%     | 0.1970     | yes     |
| 15m     | 349,746    | 0.49991 | -0.0094   | -0.11 | 0.02        | 1.00 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets tcx-idx-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 901s.

Total run time: 15.0 minutes.

tsla-otc: 573,732,552 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -769,791 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,454,249 | 0.49959 | -0.0407   | -2.63 | -0.44       | 0.76 ±14%     | 0.0433     | yes     |
| 1m      | 5,234,583  | 0.49956 | -0.0441   | -2.02 | -0.45       | 0.91 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,772  | 0.49948 | -0.0521   | -1.69 | -0.46       | 0.97 ±14%     | 0.0865     | yes     |
| 3m      | 1,747,174  | 0.49961 | -0.0391   | -1.03 | -0.46       | 0.96 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,762  | 0.49959 | -0.0407   | -0.93 | -0.47       | 0.78 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,778  | 0.49935 | -0.0646   | -1.32 | -0.47       | 0.80 ±14%     | 0.1368     | yes     |
| 10m     | 524,607    | 0.49992 | -0.0079   | -0.11 | -0.48       | 0.85 ±14%     | 0.1934     | yes     |
| 15m     | 349,784    | 0.49919 | -0.0812   | -0.96 | -0.50       | 0.82 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets tsla-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 1775s.

Total run time: 29.6 minutes.

usdchf-otc: 593,791,570 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -1,131,400 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,434,959 | 0.49975 | -0.0254   | -1.36 | -1.01       | 1.46 ±14%     | 0.0525     | yes     |
| 1m      | 5,227,716  | 0.49969 | -0.0313   | -1.43 | -1.02       | 1.00 ±14%     | 0.0613     | yes     |
| 2m      | 2,617,600  | 0.49949 | -0.0506   | -1.54 | -1.04       | 1.13 ±14%     | 0.0918     | yes     |
| 3m      | 1,746,148  | 0.49931 | -0.0692   | -1.62 | -1.04       | 1.27 ±14%     | 0.1196     | yes     |
| 4m      | 1,309,961  | 0.49908 | -0.0916   | -1.95 | -1.06       | 1.16 ±14%     | 0.1318     | yes     |
| 5m      | 1,048,200  | 0.49983 | -0.0167   | -0.33 | -1.06       | 1.07 ±14%     | 0.1414     | yes     |
| 10m     | 524,373    | 0.49887 | -0.1134   | -1.64 | -1.09       | 0.99 ±14%     | 0.1934     | yes     |
| 15m     | 349,661    | 0.49867 | -0.1334   | -1.48 | -1.11       | 1.14 ±14%     | 0.2528     | no      |

Run label: `catalogue-of-thirty` (regenerate with `--assets usdchf-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 2129s.

Total run time: 35.5 minutes.

usdjpy-otc: 1,179,081,145 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 103,819 steps

| Horizon | Decided    | Up rate | Edge (pp) | z    | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ---- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,445,203 | 0.50024 | +0.0235   | 1.44 | 0.06        | 1.12 ±14%     | 0.0458     | yes     |
| 1m      | 5,231,432  | 0.50011 | +0.0112   | 0.50 | 0.06        | 1.05 ±14%     | 0.0628     | yes     |
| 2m      | 2,618,774  | 0.50041 | +0.0413   | 1.34 | 0.06        | 0.75 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,775  | 0.50065 | +0.0645   | 1.66 | 0.06        | 1.06 ±14%     | 0.1089     | yes     |
| 4m      | 1,310,392  | 0.50139 | +0.1393   | 3.12 | 0.06        | 1.05 ±14%     | 0.1252     | yes     |
| 5m      | 1,048,581  | 0.50101 | +0.1013   | 2.08 | 0.06        | 0.90 ±14%     | 0.1368     | yes     |
| 10m     | 524,483    | 0.50020 | +0.0205   | 0.29 | 0.07        | 1.04 ±14%     | 0.1977     | yes     |
| 15m     | 349,763    | 0.50011 | +0.0110   | 0.13 | 0.07        | 0.91 ±14%     | 0.2369     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets usdjpy-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 4408s.

Total run time: 73.5 minutes.

xrpusdt-otc: 2,311,689,783 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -445,732 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,443,481 | 0.49998 | -0.0018   | -0.12 | -0.16       | 0.75 ±14%     | 0.0433     | yes     |
| 1m      | 5,231,242  | 0.50007 | +0.0071   | 0.33  | -0.17       | 0.91 ±14%     | 0.0612     | yes     |
| 2m      | 2,618,875  | 0.49979 | -0.0205   | -0.66 | -0.17       | 0.76 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,815  | 0.50006 | +0.0059   | 0.16  | -0.18       | 1.00 ±14%     | 0.1062     | yes     |
| 4m      | 1,310,523  | 0.49948 | -0.0520   | -1.17 | -0.18       | 1.04 ±14%     | 0.1248     | yes     |
| 5m      | 1,048,552  | 0.49984 | -0.0156   | -0.32 | -0.18       | 0.95 ±14%     | 0.1368     | yes     |
| 10m     | 524,531    | 0.49893 | -0.1069   | -1.55 | -0.19       | 0.97 ±14%     | 0.1934     | yes     |
| 15m     | 349,790    | 0.49890 | -0.1101   | -1.30 | -0.20       | 0.94 ±14%     | 0.2368     | yes     |

Run label: `catalogue-of-thirty` (regenerate with `--assets xrpusdt-otc --windows 350000 --segments 100 --label catalogue-of-thirty`). Run time: 6901s.

Total run time: 115.0 minutes.

## Run 3 — dogeusdt-otc, an independent realisation

dogeusdt-otc: 3,137,796,318 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -290,906 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,447,387 | 0.49982 | -0.0182   | -1.16 | -0.13       | 1.04 ±14%     | 0.0442     | yes     |
| 1m      | 5,232,400  | 0.49971 | -0.0290   | -1.27 | -0.14       | 1.09 ±14%     | 0.0640     | yes     |
| 2m      | 2,619,401  | 0.49949 | -0.0511   | -1.66 | -0.14       | 0.98 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,973  | 0.49947 | -0.0526   | -1.39 | -0.14       | 0.91 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,604  | 0.49954 | -0.0462   | -1.06 | -0.15       | 0.67 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,703  | 0.49973 | -0.0268   | -0.55 | -0.15       | 0.94 ±14%     | 0.1368     | yes     |
| 10m     | 524,604    | 0.49899 | -0.1006   | -1.46 | -0.16       | 0.97 ±14%     | 0.1934     | yes     |
| 15m     | 349,790    | 0.49865 | -0.1349   | -1.60 | -0.16       | 0.87 ±14%     | 0.2368     | yes     |

Run label: `catalogue-of-thirty-replication` (regenerate with `--assets dogeusdt-otc --windows 350000 --segments 100 --label catalogue-of-thirty-replication`). Run time: 3254s.

Total run time: 54.2 minutes.

---

## Result

**235 of 240 cells policed below 0.2513pp.** Worst |z| across the 240 is
3.12 (usdjpy-otc, 4m); Benjamini–Hochberg at q = 0.05 rejects nothing.

**Five cells are not policed at this run length, and are named rather than hidden:** brx-idx-otc 15m (floor 0.2584pp), eurjpy-otc 15m (floor 0.2660pp), gbpjpy-otc 15m (floor 0.2755pp), solusdt-otc 15m (floor 0.2589pp), usdchf-otc 15m (floor 0.2528pp). All five are fifteen-minute cells whose measured design effect — 1.14, 1.19, 1.26, 1.35 against about 1.0–1.1 elsewhere — lifts the floor above the threshold at 350,000 windows; the largest shortfall is 0.0242pp. The verdict there is "no significant edge at a floor just above the payout threshold", which is a weaker statement than the other cells make, and the column says so. A longer run would police them; it is not pretended here.

Total across all runs: **40.43 billion ticks**, 309.6 asset-years. The 240 cells are run 1 alone: **37.3 billion ticks**, 299.7 asset-years.

## Interpretation

### These are not 240 independent tests

Within one asset the eight horizons come from **one price path**, and
non-overlapping window returns telescope to the same terminal displacement. The
`Path bias z` column measures the resulting common bias, and its flatness is the
evidence.

Cycle Audit 4 measured the horizon correlation at ρ ≈ 0.66 over 400 independent
realisations, which made five assets' forty cells about 26 effective tests —
5.2 per asset. Assets are independent realisations, so the figure scales with
the catalogue.

Effective independent tests: **≈ 156 of 240**. Family-wise error rate for the observed
worst cell: 0.246.

### What Run 3 is for

A pattern that looks striking on one path is settled by generating a second,
independent one, not by arguing about it. Run 3 is the fastest tape again under
another label; its eight cells are a different realisation of the same market,
and the verifying test asserts that they are different.
