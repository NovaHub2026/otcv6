# Served-record assurance — first-run

Type: EVIDENCE (generated; do not edit by hand)
Venue: `http://127.0.0.1:7300`
Run at: 2026-09-05T06:25:14.332Z
Read per asset: up to 50000 ticks, the venue’s retained window if smaller
Assets: 31 — 0 exploitable, 0 failed

Every number below came over `GET /markets/:id/stream` from the venue named
above; nothing was generated in this process. `undecided` means the battery
could not see a product-margin edge at this size, and the floors say how
far from seeing one it was (samples in parentheses).

| Asset        | Ticks | Covered | Outcome   | Hypotheses / families / withheld-unavailable | Detection floor per horizon                                                                                                                   | Worst z | Time |
| ------------ | ----- | ------- | --------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| eurusd-otc   | 8652  | 1.04 h  | undecided | 0 / 26 / 2                                   | 30s 20.882pp (45), 1m 29.865pp (22), 2m 42.235pp (11), 3m 52.945pp (7), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| gbpusd-otc   | 10309 | 1.04 h  | undecided | 0 / 27 / 1                                   | 30s 22.431pp (39), 1m 31.323pp (20), 2m 44.297pp (10), 3m 57.187pp (6), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| usdjpy-otc   | 13334 | 0.94 h  | undecided | 0 / 27 / 1                                   | 30s 22.431pp (39), 1m 31.323pp (20), 2m 44.297pp (10), 3m 57.187pp (6), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| audusd-otc   | 13236 | 0.52 h  | undecided | 0 / 27 / 1                                   | 30s 31.323pp (20), 1m 44.297pp (10), 2m 62.645pp (5), 3m 80.875pp (3), 4m 99.051pp (2), 5m 99.051pp (2), 10m 140.079pp (1)                    | —       | 0s   |
| usdchf-otc   | 6632  | 1.04 h  | undecided | 0 / 27 / 1                                   | 30s 21.118pp (44), 1m 29.865pp (22), 2m 42.235pp (11), 3m 52.945pp (7), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| eurgbp-otc   | 6657  | 1.04 h  | undecided | 0 / 27 / 1                                   | 30s 22.431pp (39), 1m 31.323pp (20), 2m 44.297pp (10), 3m 57.187pp (6), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| gbpjpy-otc   | 13158 | 0.64 h  | undecided | 0 / 27 / 1                                   | 30s 42.235pp (11), 1m 62.645pp (5), 2m 99.051pp (2), 3m 140.079pp (1), 4m 140.079pp (1), 5m 140.079pp (1)                                     | —       | 0s   |
| eurjpy-otc   | 10810 | 1.04 h  | undecided | 0 / 27 / 1                                   | 30s 24.023pp (34), 1m 33.017pp (18), 2m 46.693pp (9), 3m 57.187pp (6), 4m 70.040pp (4), 5m 80.875pp (3), 10m 140.079pp (1), 15m 140.079pp (1) | —       | 0s   |
| aapl-otc     | 5464  | 1.04 h  | undecided | 0 / 27 / 1                                   | 30s 20.011pp (49), 1m 28.016pp (25), 2m 40.437pp (12), 3m 49.525pp (8), 4m 57.187pp (6), 5m 62.645pp (5), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| msft-otc     | 6069  | 1.04 h  | undecided | 0 / 27 / 1                                   | 30s 23.029pp (37), 1m 32.136pp (19), 2m 46.693pp (9), 3m 57.187pp (6), 4m 70.040pp (4), 5m 80.875pp (3), 10m 140.079pp (1), 15m 140.079pp (1) | —       | 0s   |
| nvda-otc     | 7467  | 1.04 h  | undecided | 0 / 27 / 1                                   | 30s 21.615pp (42), 1m 29.865pp (22), 2m 42.235pp (11), 3m 52.945pp (7), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| tsla-otc     | 9901  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 23.678pp (35), 1m 33.017pp (18), 2m 46.693pp (9), 3m 57.187pp (6), 4m 70.040pp (4), 5m 80.875pp (3), 10m 140.079pp (1), 15m 140.079pp (1) | —       | 0s   |
| meta-otc     | 6335  | 1.04 h  | undecided | 0 / 27 / 1                                   | 30s 23.347pp (36), 1m 33.017pp (18), 2m 46.693pp (9), 3m 57.187pp (6), 4m 70.040pp (4), 5m 80.875pp (3), 10m 140.079pp (1), 15m 140.079pp (1) | —       | 0s   |
| amzn-otc     | 5495  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 21.615pp (42), 1m 30.568pp (21), 2m 44.297pp (10), 3m 52.945pp (7), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| pbr-otc      | 6098  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 22.431pp (39), 1m 32.136pp (19), 2m 46.693pp (9), 3m 57.187pp (6), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1)  | —       | 0s   |
| nu-otc       | 7654  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 21.615pp (42), 1m 30.568pp (21), 2m 44.297pp (10), 3m 52.945pp (7), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| btcusdt-otc  | 13158 | 0.30 h  | undecided | 0 / 27 / 1                                   | 30s 38.851pp (13), 1m 57.187pp (6), 2m 80.875pp (3), 3m 99.051pp (2), 4m 140.079pp (1), 5m 140.079pp (1)                                      | —       | 0s   |
| ethusdt-otc  | 13158 | 0.43 h  | undecided | 0 / 27 / 1                                   | 30s 38.851pp (13), 1m 52.945pp (7), 2m 80.875pp (3), 3m 99.051pp (2), 4m 140.079pp (1), 5m 140.079pp (1)                                      | —       | 0s   |
| bnbusdt-otc  | 13158 | 0.83 h  | undecided | 0 / 27 / 1                                   | 30s 28.594pp (24), 1m 40.437pp (12), 2m 57.187pp (6), 3m 70.040pp (4), 4m 80.875pp (3), 5m 99.051pp (2), 10m 140.079pp (1)                    | —       | 0s   |
| solusdt-otc  | 12988 | 0.33 h  | undecided | 0 / 27 / 1                                   | 30s 38.851pp (13), 1m 57.187pp (6), 2m 80.875pp (3), 3m 99.051pp (2), 4m 140.079pp (1), 5m 140.079pp (1)                                      | —       | 0s   |
| xrpusdt-otc  | 13158 | 0.80 h  | undecided | 0 / 27 / 1                                   | 30s 22.148pp (40), 1m 31.323pp (20), 2m 44.297pp (10), 3m 57.187pp (6), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| dogeusdt-otc | 13158 | 0.13 h  | undecided | 0 / 27 / 1                                   | 30s 70.040pp (4), 1m 99.051pp (2), 2m 140.079pp (1)                                                                                           | —       | 0s   |
| mmx-idx-otc  | 12988 | 0.22 h  | undecided | 0 / 27 / 1                                   | 30s 57.187pp (6), 1m 80.875pp (3), 2m 140.079pp (1), 3m 140.079pp (1)                                                                         | —       | 0s   |
| cgx-idx-otc  | 13158 | 0.20 h  | undecided | 0 / 27 / 1                                   | 30s 49.525pp (8), 1m 70.040pp (4), 2m 99.051pp (2), 3m 140.079pp (1), 4m 140.079pp (1)                                                        | —       | 0s   |
| aix-idx-otc  | 7075  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 22.431pp (39), 1m 31.323pp (20), 2m 44.297pp (10), 3m 57.187pp (6), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| tcx-idx-otc  | 3667  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 21.362pp (43), 1m 29.865pp (22), 2m 42.235pp (11), 3m 52.945pp (7), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| scx-idx-otc  | 5596  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 20.882pp (45), 1m 29.209pp (23), 2m 42.235pp (11), 3m 52.945pp (7), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| gmx-idx-otc  | 7363  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 21.118pp (44), 1m 31.323pp (20), 2m 42.235pp (11), 3m 52.945pp (7), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| evx-idx-otc  | 4603  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 21.877pp (41), 1m 30.568pp (21), 2m 44.297pp (10), 3m 52.945pp (7), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| brx-idx-otc  | 5240  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 21.615pp (42), 1m 31.323pp (20), 2m 44.297pp (10), 3m 52.945pp (7), 4m 62.645pp (5), 5m 70.040pp (4), 10m 99.051pp (2), 15m 140.079pp (1) | —       | 0s   |
| eurchf4      | 5509  | 1.05 h  | undecided | 0 / 27 / 1                                   | 30s 24.763pp (32), 1m 35.020pp (16), 2m 49.525pp (8), 3m 62.645pp (5), 4m 70.040pp (4), 5m 80.875pp (3), 10m 140.079pp (1), 15m 140.079pp (1) | —       | 0s   |

## Notes from the battery

- eurusd-otc: learned-logistic @ 10m: classified no entries; skipped.
- eurusd-otc: learned-logistic @ 15m: classified no entries; skipped.
- eurusd-otc: 568 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurusd-otc: 358 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- gbpusd-otc: learned-logistic @ 15m: classified no entries; skipped.
- gbpusd-otc: 583 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gbpusd-otc: 396 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gbpusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gbpusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- usdjpy-otc: 537 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- usdjpy-otc: 447 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- usdjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- usdjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- audusd-otc: learned-logistic @ 10m: classified no entries; skipped.
- audusd-otc: 15m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 414 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- audusd-otc: 442 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- audusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- audusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- usdchf-otc: learned-logistic @ 4m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 5m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 10m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 15m: classified no entries; skipped.
- usdchf-otc: 543 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- usdchf-otc: 421 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- usdchf-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- usdchf-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- eurgbp-otc: learned-logistic @ 3m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 4m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 5m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 10m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 15m: classified no entries; skipped.
- eurgbp-otc: 560 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurgbp-otc: 399 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurgbp-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurgbp-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- gbpjpy-otc: 10m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 15m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 274 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gbpjpy-otc: 464 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gbpjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gbpjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- eurjpy-otc: learned-logistic @ 15m: classified no entries; skipped.
- eurjpy-otc: 535 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurjpy-otc: 444 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- aapl-otc: learned-logistic @ 30s: classified no entries; skipped.
- aapl-otc: learned-logistic @ 1m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 2m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 3m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 4m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 5m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 10m: classified no entries; skipped.
- aapl-otc: previous-move @ 15m: classified no entries; skipped.
- aapl-otc: run-length @ 15m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 15m: classified no entries; skipped.
- aapl-otc: 554 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- aapl-otc: 382 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- aapl-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- aapl-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- msft-otc: learned-logistic @ 3m: classified no entries; skipped.
- msft-otc: learned-logistic @ 4m: classified no entries; skipped.
- msft-otc: learned-logistic @ 5m: classified no entries; skipped.
- msft-otc: learned-logistic @ 10m: classified no entries; skipped.
- msft-otc: learned-logistic @ 15m: classified no entries; skipped.
- msft-otc: 532 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- msft-otc: 427 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- msft-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- msft-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- nvda-otc: learned-logistic @ 5m: classified no entries; skipped.
- nvda-otc: learned-logistic @ 10m: classified no entries; skipped.
- nvda-otc: learned-logistic @ 15m: classified no entries; skipped.
- nvda-otc: 536 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- nvda-otc: 433 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- nvda-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- nvda-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- tsla-otc: 534 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- tsla-otc: 450 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- tsla-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- tsla-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- meta-otc: learned-logistic @ 4m: classified no entries; skipped.
- meta-otc: learned-logistic @ 5m: classified no entries; skipped.
- meta-otc: learned-logistic @ 10m: classified no entries; skipped.
- meta-otc: learned-logistic @ 15m: classified no entries; skipped.
- meta-otc: 518 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- meta-otc: 446 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- meta-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- meta-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- amzn-otc: learned-logistic @ 30s: classified no entries; skipped.
- amzn-otc: learned-logistic @ 1m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 2m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 3m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 4m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 5m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 10m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 15m: classified no entries; skipped.
- amzn-otc: 569 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- amzn-otc: 375 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- amzn-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- amzn-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- pbr-otc: learned-logistic @ 3m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 4m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 5m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 10m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 15m: classified no entries; skipped.
- pbr-otc: 592 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- pbr-otc: 367 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- pbr-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- pbr-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- nu-otc: learned-logistic @ 5m: classified no entries; skipped.
- nu-otc: learned-logistic @ 10m: classified no entries; skipped.
- nu-otc: learned-logistic @ 15m: classified no entries; skipped.
- nu-otc: 591 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- nu-otc: 378 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- nu-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- nu-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- btcusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 305 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- btcusdt-otc: 433 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- btcusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- btcusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- ethusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 312 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- ethusdt-otc: 426 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- ethusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- ethusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- bnbusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 417 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- bnbusdt-otc: 444 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- bnbusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- bnbusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- solusdt-otc: learned-logistic @ 5m: classified no entries; skipped.
- solusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 304 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- solusdt-otc: 429 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- solusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- solusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- xrpusdt-otc: learned-logistic @ 15m: classified no entries; skipped.
- xrpusdt-otc: 549 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- xrpusdt-otc: 430 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- xrpusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- xrpusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- dogeusdt-otc: learned-logistic @ 2m: classified no entries; skipped.
- dogeusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 125 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- dogeusdt-otc: 239 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- dogeusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- dogeusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- mmx-idx-otc: wh-cross-asset @ 1m: classified no entries; skipped.
- mmx-idx-otc: wh-cross-asset @ 2m: classified no entries; skipped.
- mmx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- mmx-idx-otc: wh-cross-asset @ 3m: classified no entries; skipped.
- mmx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 171 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- mmx-idx-otc: 298 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- mmx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- mmx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m. The single-test floor is not the gate's.
- cgx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- cgx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- cgx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 231 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- cgx-idx-otc: 374 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- cgx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- cgx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m. The single-test floor is not the gate's.
- aix-idx-otc: wh-cross-asset @ 30s: classified no entries; skipped.
- aix-idx-otc: wh-cross-asset @ 1m: classified no entries; skipped.
- aix-idx-otc: wh-cross-asset @ 2m: classified no entries; skipped.
- aix-idx-otc: wh-cross-asset @ 3m: classified no entries; skipped.
- aix-idx-otc: wh-cross-asset @ 4m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- aix-idx-otc: wh-cross-asset @ 5m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- aix-idx-otc: wh-cross-asset @ 10m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 15m: classified no entries; skipped.
- aix-idx-otc: wh-cross-asset @ 15m: classified no entries; skipped.
- aix-idx-otc: 526 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- aix-idx-otc: 395 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- aix-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- aix-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- tcx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 15m: classified no entries; skipped.
- tcx-idx-otc: 531 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- tcx-idx-otc: 413 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- tcx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- tcx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- scx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 15m: classified no entries; skipped.
- scx-idx-otc: 567 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- scx-idx-otc: 377 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- scx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- scx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- gmx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 15m: classified no entries; skipped.
- gmx-idx-otc: 564 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gmx-idx-otc: 410 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gmx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gmx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- evx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 15m: classified no entries; skipped.
- evx-idx-otc: 594 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- evx-idx-otc: 350 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- evx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- evx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- brx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 15m: classified no entries; skipped.
- brx-idx-otc: 557 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- brx-idx-otc: 387 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- brx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- brx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- eurchf4: learned-logistic @ 30s: classified no entries; skipped.
- eurchf4: learned-logistic @ 1m: classified no entries; skipped.
- eurchf4: learned-logistic @ 2m: classified no entries; skipped.
- eurchf4: learned-logistic @ 3m: classified no entries; skipped.
- eurchf4: learned-logistic @ 4m: classified no entries; skipped.
- eurchf4: learned-logistic @ 5m: classified no entries; skipped.
- eurchf4: learned-logistic @ 10m: classified no entries; skipped.
- eurchf4: learned-logistic @ 15m: classified no entries; skipped.
- eurchf4: 511 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurchf4: 433 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurchf4: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurchf4: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
