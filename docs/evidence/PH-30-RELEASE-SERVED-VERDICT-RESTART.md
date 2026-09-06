# Served-record assurance — ph-30.4-release-restart

Type: EVIDENCE (generated; do not edit by hand)
Venue: `http://127.0.0.1:7420`
Run at: 2026-09-06T12:33:45.320Z
Read per asset: up to 50000 ticks, the venue’s retained window if smaller
Venue as it described itself: boot nonce none, 30 assets, production composition (`/lab/markets` absent)
Job built from commit `e0c87cd`
Assets: 30 — 0 exploitable, 0 failed

Every number below came over `GET /markets/:id/stream` from the venue named
above; nothing was generated in this process. `undecided` means the battery
could not see a product-margin edge at this size, and the floors say how
far from seeing one it was (samples in parentheses).

| Asset        | Ticks | Covered | Outcome   | Hypotheses / families / withheld-unavailable | Detection floor per horizon                                                                                                                                                                                                                              | Worst z | Time | Sequences read · sha256 of the ticks |
| ------------ | ----- | ------- | --------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- | ------------------------------------ |
| eurusd-otc   | 5420  | 0.58 h  | undecided | 0 / 26 / 2                                   | 30s 32.136pp / gate Infinitypp (19), 1m 46.693pp / gate Infinitypp (9), 2m 70.040pp / gate Infinitypp (4), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 140.079pp / gate Infinitypp (1)                                      | —       | 0s   | 103552–108971 0283ad18ebc8           |
| gbpusd-otc   | 8583  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 29.209pp / gate Infinitypp (23), 1m 40.437pp / gate Infinitypp (12), 2m 57.187pp / gate Infinitypp (6), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 103591–112173 23421ec01c1d           |
| usdjpy-otc   | 6455  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 28.594pp / gate Infinitypp (24), 1m 40.437pp / gate Infinitypp (12), 2m 57.187pp / gate Infinitypp (6), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 104598–111052 99712820eb10           |
| audusd-otc   | 7920  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 28.016pp / gate Infinitypp (25), 1m 38.851pp / gate Infinitypp (13), 2m 57.187pp / gate Infinitypp (6), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 104212–112131 7601cea6cd23           |
| usdchf-otc   | 3891  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 30.568pp / gate Infinitypp (21), 1m 42.235pp / gate Infinitypp (11), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 102869–106759 e7f6ce861a35           |
| eurgbp-otc   | 5434  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 32.136pp / gate Infinitypp (19), 1m 44.297pp / gate Infinitypp (10), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 102442–107875 9826aaf2b61f           |
| gbpjpy-otc   | 23837 | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 35.020pp / gate Infinitypp (16), 1m 49.525pp / gate Infinitypp (8), 2m 70.040pp / gate Infinitypp (4), 3m 99.051pp / gate Infinitypp (2), 4m 99.051pp / gate Infinitypp (2), 5m 140.079pp / gate Infinitypp (1)                                      | —       | 1s   | 111600–135436 d1aa7a8b38c8           |
| eurjpy-otc   | 15446 | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 28.016pp / gate Infinitypp (25), 1m 38.851pp / gate Infinitypp (13), 2m 57.187pp / gate Infinitypp (6), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 104049–119494 f6e94a0c0eb5           |
| aapl-otc     | 4011  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 30.568pp / gate Infinitypp (21), 1m 44.297pp / gate Infinitypp (10), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 102118–106128 cb9b331fb46f           |
| msft-otc     | 2977  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 28.594pp / gate Infinitypp (24), 1m 40.437pp / gate Infinitypp (12), 2m 57.187pp / gate Infinitypp (6), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 101596–104572 c4f444e87bd9           |
| nvda-otc     | 3950  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 29.209pp / gate Infinitypp (23), 1m 40.437pp / gate Infinitypp (12), 2m 57.187pp / gate Infinitypp (6), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 105255–109204 9166ab4ff7ac           |
| tsla-otc     | 3630  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 31.323pp / gate Infinitypp (20), 1m 46.693pp / gate Infinitypp (9), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1)  | —       | 0s   | 102110–105739 c9dbd42983a3           |
| meta-otc     | 5160  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 37.438pp / gate Infinitypp (14), 1m 52.945pp / gate Infinitypp (7), 2m 80.875pp / gate Infinitypp (3), 3m 99.051pp / gate Infinitypp (2), 4m 140.079pp / gate Infinitypp (1), 5m 140.079pp / gate Infinitypp (1)                                     | —       | 0s   | 103740–108899 b7d0e915bbb3           |
| amzn-otc     | 4977  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 32.136pp / gate Infinitypp (19), 1m 46.693pp / gate Infinitypp (9), 2m 70.040pp / gate Infinitypp (4), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 140.079pp / gate Infinitypp (1)                                      | —       | 0s   | 103055–108031 5c95203a56d5           |
| pbr-otc      | 3500  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 31.323pp / gate Infinitypp (20), 1m 44.297pp / gate Infinitypp (10), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 108533–112032 0492cc5253d9           |
| nu-otc       | 4742  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 30.568pp / gate Infinitypp (21), 1m 42.235pp / gate Infinitypp (11), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 103076–107817 b50e56d35c74           |
| btcusdt-otc  | 9373  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 28.594pp / gate Infinitypp (24), 1m 40.437pp / gate Infinitypp (12), 2m 62.645pp / gate Infinitypp (5), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 107191–116563 815282c800d4           |
| ethusdt-otc  | 8449  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 29.209pp / gate Infinitypp (23), 1m 42.235pp / gate Infinitypp (11), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 117968–126416 5530d90417f2           |
| bnbusdt-otc  | 18283 | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 38.851pp / gate Infinitypp (13), 1m 57.187pp / gate Infinitypp (6), 2m 80.875pp / gate Infinitypp (3), 3m 99.051pp / gate Infinitypp (2), 4m 140.079pp / gate Infinitypp (1), 5m 140.079pp / gate Infinitypp (1)                                     | —       | 0s   | 111245–129527 79b3bb0a0958           |
| solusdt-otc  | 14194 | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 30.568pp / gate Infinitypp (21), 1m 42.235pp / gate Infinitypp (11), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 111083–125276 2169a4c07066           |
| xrpusdt-otc  | 10957 | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 26.472pp / gate Infinitypp (28), 1m 37.438pp / gate Infinitypp (14), 2m 52.945pp / gate Infinitypp (7), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 120885–131841 6e0612e1885c           |
| dogeusdt-otc | 26518 | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 36.168pp / gate Infinitypp (15), 1m 49.525pp / gate Infinitypp (8), 2m 70.040pp / gate Infinitypp (4), 3m 99.051pp / gate Infinitypp (2), 4m 99.051pp / gate Infinitypp (2), 5m 140.079pp / gate Infinitypp (1)                                      | —       | 0s   | 110706–137223 fa4647fed9fb           |
| mmx-idx-otc  | 14444 | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 32.136pp / gate Infinitypp (19), 1m 46.693pp / gate Infinitypp (9), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1)  | —       | 0s   | 115325–129768 611d8ba4ba6c           |
| cgx-idx-otc  | 18519 | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 28.594pp / gate Infinitypp (24), 1m 40.437pp / gate Infinitypp (12), 2m 57.187pp / gate Infinitypp (6), 3m 80.875pp / gate Infinitypp (3), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 107193–125711 843036a3cc4c           |
| aix-idx-otc  | 3339  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 31.323pp / gate Infinitypp (20), 1m 44.297pp / gate Infinitypp (10), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 102642–105980 58165b4681ee           |
| tcx-idx-otc  | 2339  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 30.568pp / gate Infinitypp (21), 1m 44.297pp / gate Infinitypp (10), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 101348–103686 1d26ad046ebf           |
| scx-idx-otc  | 3566  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 33.974pp / gate Infinitypp (17), 1m 49.525pp / gate Infinitypp (8), 2m 70.040pp / gate Infinitypp (4), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 140.079pp / gate Infinitypp (1)                                      | —       | 0s   | 101843–105408 fa3b287d54c6           |
| gmx-idx-otc  | 5619  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 28.594pp / gate Infinitypp (24), 1m 40.437pp / gate Infinitypp (12), 2m 57.187pp / gate Infinitypp (6), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 104123–109741 3d714abd431c           |
| evx-idx-otc  | 3350  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 30.568pp / gate Infinitypp (21), 1m 42.235pp / gate Infinitypp (11), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 102104–105453 1c2c421a0b1b           |
| brx-idx-otc  | 3461  | 0.58 h  | undecided | 0 / 27 / 1                                   | 30s 30.568pp / gate Infinitypp (21), 1m 42.235pp / gate Infinitypp (11), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1) | —       | 0s   | 101757–105217 72066bc26a62           |

## Notes from the battery

- eurusd-otc: learned-logistic @ 30s: classified no entries; skipped.
- eurusd-otc: learned-logistic @ 1m: classified no entries; skipped.
- eurusd-otc: learned-logistic @ 2m: classified no entries; skipped.
- eurusd-otc: learned-logistic @ 3m: classified no entries; skipped.
- eurusd-otc: learned-logistic @ 4m: classified no entries; skipped.
- eurusd-otc: learned-logistic @ 5m: classified no entries; skipped.
- eurusd-otc: 10m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 15m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 333 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurusd-otc: 339 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- gbpusd-otc: learned-logistic @ 4m: classified no entries; skipped.
- gbpusd-otc: learned-logistic @ 5m: classified no entries; skipped.
- gbpusd-otc: learned-logistic @ 10m: classified no entries; skipped.
- gbpusd-otc: 15m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 427 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gbpusd-otc: 419 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gbpusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gbpusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- usdjpy-otc: learned-logistic @ 2m: classified no entries; skipped.
- usdjpy-otc: learned-logistic @ 3m: classified no entries; skipped.
- usdjpy-otc: learned-logistic @ 4m: classified no entries; skipped.
- usdjpy-otc: learned-logistic @ 5m: classified no entries; skipped.
- usdjpy-otc: previous-move @ 10m: classified no entries; skipped.
- usdjpy-otc: run-length @ 10m: classified no entries; skipped.
- usdjpy-otc: learned-logistic @ 10m: classified no entries; skipped.
- usdjpy-otc: 15m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 432 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- usdjpy-otc: 396 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- usdjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- usdjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- audusd-otc: learned-logistic @ 4m: classified no entries; skipped.
- audusd-otc: learned-logistic @ 5m: classified no entries; skipped.
- audusd-otc: learned-logistic @ 10m: classified no entries; skipped.
- audusd-otc: 15m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 473 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- audusd-otc: 373 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- audusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- audusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- usdchf-otc: learned-logistic @ 30s: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 1m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 2m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 3m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 4m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 5m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 10m: classified no entries; skipped.
- usdchf-otc: 15m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 404 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- usdchf-otc: 422 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- usdchf-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- usdchf-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- eurgbp-otc: learned-logistic @ 30s: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 1m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 2m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 3m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 4m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 5m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 10m: classified no entries; skipped.
- eurgbp-otc: 15m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 389 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurgbp-otc: 437 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurgbp-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurgbp-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- gbpjpy-otc: 10m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 15m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 345 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gbpjpy-otc: 393 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gbpjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gbpjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- eurjpy-otc: learned-logistic @ 5m: classified no entries; skipped.
- eurjpy-otc: learned-logistic @ 10m: classified no entries; skipped.
- eurjpy-otc: 15m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 450 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurjpy-otc: 401 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- aapl-otc: learned-logistic @ 30s: classified no entries; skipped.
- aapl-otc: learned-logistic @ 1m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 2m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 3m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 4m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 5m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 10m: classified no entries; skipped.
- aapl-otc: 15m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 412 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- aapl-otc: 414 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- aapl-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- aapl-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- msft-otc: learned-logistic @ 30s: classified no entries; skipped.
- msft-otc: learned-logistic @ 1m: classified no entries; skipped.
- msft-otc: learned-logistic @ 2m: classified no entries; skipped.
- msft-otc: learned-logistic @ 3m: classified no entries; skipped.
- msft-otc: learned-logistic @ 4m: classified no entries; skipped.
- msft-otc: learned-logistic @ 5m: classified no entries; skipped.
- msft-otc: learned-logistic @ 10m: classified no entries; skipped.
- msft-otc: 15m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 412 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- msft-otc: 414 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- msft-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- msft-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- nvda-otc: learned-logistic @ 30s: classified no entries; skipped.
- nvda-otc: learned-logistic @ 1m: classified no entries; skipped.
- nvda-otc: learned-logistic @ 2m: classified no entries; skipped.
- nvda-otc: learned-logistic @ 3m: classified no entries; skipped.
- nvda-otc: learned-logistic @ 4m: classified no entries; skipped.
- nvda-otc: learned-logistic @ 5m: classified no entries; skipped.
- nvda-otc: learned-logistic @ 10m: classified no entries; skipped.
- nvda-otc: 15m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 420 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- nvda-otc: 406 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- nvda-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- nvda-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- tsla-otc: learned-logistic @ 30s: classified no entries; skipped.
- tsla-otc: learned-logistic @ 1m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 2m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 3m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 4m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 5m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 10m: classified no entries; skipped.
- tsla-otc: 15m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 366 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- tsla-otc: 460 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- tsla-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- tsla-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- meta-otc: learned-logistic @ 30s: classified no entries; skipped.
- meta-otc: learned-logistic @ 1m: classified no entries; skipped.
- meta-otc: learned-logistic @ 2m: classified no entries; skipped.
- meta-otc: learned-logistic @ 3m: classified no entries; skipped.
- meta-otc: learned-logistic @ 4m: classified no entries; skipped.
- meta-otc: learned-logistic @ 5m: classified no entries; skipped.
- meta-otc: 10m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 15m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 294 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- meta-otc: 414 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- meta-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- meta-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- amzn-otc: learned-logistic @ 30s: classified no entries; skipped.
- amzn-otc: learned-logistic @ 1m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 2m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 3m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 4m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 5m: classified no entries; skipped.
- amzn-otc: 10m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 15m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 329 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- amzn-otc: 379 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- amzn-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- amzn-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- pbr-otc: learned-logistic @ 30s: classified no entries; skipped.
- pbr-otc: learned-logistic @ 1m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 2m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 3m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 4m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 5m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 10m: classified no entries; skipped.
- pbr-otc: 15m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 402 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- pbr-otc: 424 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- pbr-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- pbr-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- nu-otc: learned-logistic @ 30s: classified no entries; skipped.
- nu-otc: learned-logistic @ 1m: classified no entries; skipped.
- nu-otc: learned-logistic @ 2m: classified no entries; skipped.
- nu-otc: learned-logistic @ 3m: classified no entries; skipped.
- nu-otc: learned-logistic @ 4m: classified no entries; skipped.
- nu-otc: learned-logistic @ 5m: classified no entries; skipped.
- nu-otc: previous-move @ 10m: classified no entries; skipped.
- nu-otc: run-length @ 10m: classified no entries; skipped.
- nu-otc: learned-logistic @ 10m: classified no entries; skipped.
- nu-otc: 15m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 421 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- nu-otc: 397 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- nu-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- nu-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- btcusdt-otc: learned-logistic @ 10m: classified no entries; skipped.
- btcusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 445 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- btcusdt-otc: 411 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- btcusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- btcusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- ethusdt-otc: previous-move @ 4m: classified no entries; skipped.
- ethusdt-otc: run-length @ 4m: classified no entries; skipped.
- ethusdt-otc: previous-move @ 5m: classified no entries; skipped.
- ethusdt-otc: run-length @ 5m: classified no entries; skipped.
- ethusdt-otc: previous-move @ 10m: classified no entries; skipped.
- ethusdt-otc: run-length @ 10m: classified no entries; skipped.
- ethusdt-otc: learned-logistic @ 10m: classified no entries; skipped.
- ethusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 386 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- ethusdt-otc: 446 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- ethusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- ethusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- bnbusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 314 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- bnbusdt-otc: 424 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- bnbusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- bnbusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- solusdt-otc: learned-logistic @ 10m: classified no entries; skipped.
- solusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 412 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- solusdt-otc: 444 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- solusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- solusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- xrpusdt-otc: learned-logistic @ 10m: classified no entries; skipped.
- xrpusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 472 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- xrpusdt-otc: 384 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- xrpusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- xrpusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- dogeusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 350 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- dogeusdt-otc: 388 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- dogeusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- dogeusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- mmx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- mmx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 400 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- mmx-idx-otc: 456 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- mmx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- mmx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- cgx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 456 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- cgx-idx-otc: 405 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- cgx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- cgx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- aix-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- aix-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 426 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- aix-idx-otc: 400 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- aix-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- aix-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- tcx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- tcx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 393 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- tcx-idx-otc: 433 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- tcx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- tcx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- scx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- scx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 353 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- scx-idx-otc: 355 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- scx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- scx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m. The single-test floor is not the gate's.
- gmx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- gmx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 424 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gmx-idx-otc: 402 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gmx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gmx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- evx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- evx-idx-otc: previous-move @ 10m: classified no entries; skipped.
- evx-idx-otc: run-length @ 10m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- evx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 407 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- evx-idx-otc: 411 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- evx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- evx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- brx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- brx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 403 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- brx-idx-otc: 423 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- brx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- brx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
