# Served-record assurance — second-run-production

Type: EVIDENCE (generated; do not edit by hand)
Venue: `http://127.0.0.1:7402`
Run at: 2026-09-05T10:59:43.154Z
Read per asset: up to 50000 ticks, the venue’s retained window if smaller
Venue as it described itself: boot nonce ca9-a4-02-production, 30 assets, production composition (`/lab/markets` absent)
Job built from commit `5b3c154`
Assets: 30 — 0 exploitable, 0 failed

Every number below came over `GET /markets/:id/stream` from the venue named
above; nothing was generated in this process. `undecided` means the battery
could not see a product-margin edge at this size, and the floors say how
far from seeing one it was (samples in parentheses).

| Asset        | Ticks | Covered | Outcome   | Hypotheses / families / withheld-unavailable | Detection floor per horizon                          | Worst z | Time | Sequences read · sha256 of the ticks |
| ------------ | ----- | ------- | --------- | -------------------------------------------- | ---------------------------------------------------- | ------- | ---- | ------------------------------------ |
| eurusd-otc   | 1092  | 0.12 h  | undecided | 0 / 26 / 2                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–1092 e368100fd1fd                  |
| gbpusd-otc   | 1131  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–1131 67f85481d01f                  |
| usdjpy-otc   | 1462  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–1462 7d433a62bbb5                  |
| audusd-otc   | 1146  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                   | —       | 0s   | 1–1146 4ef7d52bb8e5                  |
| usdchf-otc   | 619   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–619 8d7c2cc46a31                   |
| eurgbp-otc   | 603   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–603 caa1d6691ca2                   |
| gbpjpy-otc   | 8038  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–8038 35aac837afbc                  |
| eurjpy-otc   | 967   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–967 e9e3166dfaa9                   |
| aapl-otc     | 957   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                   | —       | 0s   | 1–957 cebb97ddfe71                   |
| msft-otc     | 459   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–459 ab8d88df2350                   |
| nvda-otc     | 989   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–989 4ea7a0e2849f                   |
| tsla-otc     | 595   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–595 2e64780f6010                   |
| meta-otc     | 539   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–539 85fcd6b21856                   |
| amzn-otc     | 1015  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–1015 6a2913124938                  |
| pbr-otc      | 889   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–889 3cfc43136fb1                   |
| nu-otc       | 678   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–678 b3a0f13cad1b                   |
| btcusdt-otc  | 5852  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                   | —       | 0s   | 1–5852 3b5443c0012e                  |
| ethusdt-otc  | 3775  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1), 2m 140.079pp (1) | —       | 0s   | 1–3775 721cbda59468                  |
| bnbusdt-otc  | 1652  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–1652 bae7ba07740a                  |
| solusdt-otc  | 2497  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 62.645pp (5), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–2497 ceb4bcfac2ff                  |
| xrpusdt-otc  | 2721  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–2721 df3b2518d1d7                  |
| dogeusdt-otc | 2516  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 62.645pp (5), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–2516 d08123afc89f                  |
| mmx-idx-otc  | 5703  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–5703 72a81abd66ce                  |
| cgx-idx-otc  | 1778  | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–1778 5250924a2d92                  |
| aix-idx-otc  | 471   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–471 4998c4063b67                   |
| tcx-idx-otc  | 410   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–410 9434259a5a6f                   |
| scx-idx-otc  | 513   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–513 927b1211345f                   |
| gmx-idx-otc  | 699   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–699 b2fd9b8df1d8                   |
| evx-idx-otc  | 560   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–560 81c50f74f150                   |
| brx-idx-otc  | 462   | 0.12 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)  | —       | 0s   | 1–462 ccedc7bc512d                   |

## Notes from the battery

- eurusd-otc: learned-logistic @ 30s: classified no entries; skipped.
- eurusd-otc: learned-logistic @ 1m: classified no entries; skipped.
- eurusd-otc: learned-logistic @ 2m: classified no entries; skipped.
- eurusd-otc: 3m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 4m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 5m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 10m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 15m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 103 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurusd-otc: 233 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- gbpusd-otc: learned-logistic @ 30s: classified no entries; skipped.
- gbpusd-otc: learned-logistic @ 1m: classified no entries; skipped.
- gbpusd-otc: learned-logistic @ 2m: classified no entries; skipped.
- gbpusd-otc: 3m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 4m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 5m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 10m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 15m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 114 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gbpusd-otc: 240 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gbpusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gbpusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- usdjpy-otc: learned-logistic @ 30s: classified no entries; skipped.
- usdjpy-otc: learned-logistic @ 1m: classified no entries; skipped.
- usdjpy-otc: learned-logistic @ 2m: classified no entries; skipped.
- usdjpy-otc: 3m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 4m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 5m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 10m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 15m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 112 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- usdjpy-otc: 242 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- usdjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- usdjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- audusd-otc: learned-logistic @ 30s: classified no entries; skipped.
- audusd-otc: learned-logistic @ 1m: classified no entries; skipped.
- audusd-otc: 2m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 3m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 4m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 5m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 10m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 15m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 78 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- audusd-otc: 158 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- audusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- audusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- usdchf-otc: learned-logistic @ 30s: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 1m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 2m: classified no entries; skipped.
- usdchf-otc: 3m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 4m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 5m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 10m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 15m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 122 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- usdchf-otc: 232 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- usdchf-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- usdchf-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- eurgbp-otc: learned-logistic @ 30s: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 1m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 2m: classified no entries; skipped.
- eurgbp-otc: 3m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 4m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 5m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 10m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 15m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 121 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurgbp-otc: 233 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurgbp-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurgbp-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- gbpjpy-otc: learned-logistic @ 1m: classified no entries; skipped.
- gbpjpy-otc: learned-logistic @ 2m: classified no entries; skipped.
- gbpjpy-otc: 3m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 4m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 5m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 10m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 15m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 131 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gbpjpy-otc: 228 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gbpjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gbpjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- eurjpy-otc: learned-logistic @ 30s: classified no entries; skipped.
- eurjpy-otc: learned-logistic @ 1m: classified no entries; skipped.
- eurjpy-otc: learned-logistic @ 2m: classified no entries; skipped.
- eurjpy-otc: 3m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 4m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 5m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 10m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 15m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 122 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurjpy-otc: 232 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- aapl-otc: learned-logistic @ 30s: classified no entries; skipped.
- aapl-otc: learned-logistic @ 1m: classified no entries; skipped.
- aapl-otc: 2m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 3m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 4m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 5m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 10m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 15m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 71 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- aapl-otc: 165 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- aapl-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- aapl-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- msft-otc: position-in-range @ 30s: classified no entries; skipped.
- msft-otc: learned-logistic @ 30s: classified no entries; skipped.
- msft-otc: position-in-range @ 1m: classified no entries; skipped.
- msft-otc: learned-logistic @ 1m: classified no entries; skipped.
- msft-otc: position-in-range @ 2m: classified no entries; skipped.
- msft-otc: learned-logistic @ 2m: classified no entries; skipped.
- msft-otc: 3m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 4m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 5m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 10m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 15m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 128 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- msft-otc: 211 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- msft-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- msft-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- nvda-otc: learned-logistic @ 30s: classified no entries; skipped.
- nvda-otc: learned-logistic @ 1m: classified no entries; skipped.
- nvda-otc: learned-logistic @ 2m: classified no entries; skipped.
- nvda-otc: 3m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 4m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 5m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 10m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 15m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 120 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- nvda-otc: 234 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- nvda-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- nvda-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- tsla-otc: position-in-range @ 30s: classified no entries; skipped.
- tsla-otc: learned-logistic @ 30s: classified no entries; skipped.
- tsla-otc: position-in-range @ 1m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 1m: classified no entries; skipped.
- tsla-otc: position-in-range @ 2m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 2m: classified no entries; skipped.
- tsla-otc: 3m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 4m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 5m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 10m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 15m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 116 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- tsla-otc: 223 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- tsla-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- tsla-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- meta-otc: position-in-range @ 30s: classified no entries; skipped.
- meta-otc: learned-logistic @ 30s: classified no entries; skipped.
- meta-otc: position-in-range @ 1m: classified no entries; skipped.
- meta-otc: learned-logistic @ 1m: classified no entries; skipped.
- meta-otc: position-in-range @ 2m: classified no entries; skipped.
- meta-otc: learned-logistic @ 2m: classified no entries; skipped.
- meta-otc: 3m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 4m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 5m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 10m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 15m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 107 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- meta-otc: 232 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- meta-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- meta-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- amzn-otc: learned-logistic @ 30s: classified no entries; skipped.
- amzn-otc: learned-logistic @ 1m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 2m: classified no entries; skipped.
- amzn-otc: 3m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 4m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 5m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 10m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 15m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 114 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- amzn-otc: 240 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- amzn-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- amzn-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- pbr-otc: learned-logistic @ 30s: classified no entries; skipped.
- pbr-otc: learned-logistic @ 1m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 2m: classified no entries; skipped.
- pbr-otc: 3m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 4m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 5m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 10m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 15m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 128 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- pbr-otc: 226 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- pbr-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- pbr-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- nu-otc: learned-logistic @ 30s: classified no entries; skipped.
- nu-otc: learned-logistic @ 1m: classified no entries; skipped.
- nu-otc: learned-logistic @ 2m: classified no entries; skipped.
- nu-otc: 3m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 4m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 5m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 10m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 15m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 113 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- nu-otc: 241 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- nu-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- nu-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- btcusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- btcusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- btcusdt-otc: 2m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 78 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- btcusdt-otc: 158 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- btcusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- btcusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- ethusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- ethusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- ethusdt-otc: learned-logistic @ 2m: classified no entries; skipped.
- ethusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 95 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- ethusdt-otc: 259 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- ethusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- ethusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- bnbusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- bnbusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- bnbusdt-otc: learned-logistic @ 2m: classified no entries; skipped.
- bnbusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 110 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- bnbusdt-otc: 244 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- bnbusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- bnbusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- solusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- solusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- solusdt-otc: learned-logistic @ 2m: classified no entries; skipped.
- solusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 120 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- solusdt-otc: 234 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- solusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- solusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- xrpusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- xrpusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- xrpusdt-otc: learned-logistic @ 2m: classified no entries; skipped.
- xrpusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 126 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- xrpusdt-otc: 228 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- xrpusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- xrpusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- dogeusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- dogeusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- dogeusdt-otc: learned-logistic @ 2m: classified no entries; skipped.
- dogeusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 113 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- dogeusdt-otc: 241 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- dogeusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- dogeusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- mmx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- mmx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- mmx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- mmx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 117 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- mmx-idx-otc: 237 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- mmx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- mmx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- cgx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- cgx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- cgx-idx-otc: trailing-return-sign-30 @ 2m: classified no entries; skipped.
- cgx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- cgx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 113 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- cgx-idx-otc: 239 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- cgx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- cgx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- aix-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- aix-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- aix-idx-otc: position-in-range @ 2m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- aix-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 113 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- aix-idx-otc: 226 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- aix-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- aix-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- tcx-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- tcx-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- tcx-idx-otc: position-in-range @ 2m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- tcx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 104 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- tcx-idx-otc: 235 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- tcx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- tcx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- scx-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- scx-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- scx-idx-otc: position-in-range @ 2m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- scx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 114 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- scx-idx-otc: 225 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- scx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- scx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- gmx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- gmx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 121 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gmx-idx-otc: 233 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gmx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gmx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- evx-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- evx-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- evx-idx-otc: position-in-range @ 2m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- evx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 112 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- evx-idx-otc: 227 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- evx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- evx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- brx-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- brx-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- brx-idx-otc: position-in-range @ 2m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- brx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 105 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- brx-idx-otc: 234 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- brx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- brx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
