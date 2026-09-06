# PH-28 — The Durable Venue: The Served Record Across A Kill And A Restart, On The Thirty

Type: EVIDENCE
Recorded: 2026-09-06
Commit: `1417a56` (branch `feature/ph-28-durable-venue`)
Composition: `apps/api` in production composition (`main.ts`, `AppModule.register()` bare), thirty assets, state directory with `record.db`, publication on
Method: `~/.otc-local/ph284/run.mjs`, a script outside the repository that spawns the built service and reads it over HTTP only; its summary is `summary.json`

---

## 1. What was run

1. Boot on an empty state directory; thirty markets hosted, all `fresh`.
2. Run 150 s. Read every asset's served record from sequence 1 to that instant
   over `GET /markets/:id/stream` (`readServedRecord`, six assets at a time).
3. `SIGKILL` the process. Restart on the same directory.
4. For every asset, resume from the sequence the first read ended at; then wait
   130 s and read the stored one-minute bars from three minutes before the kill
   to the last closed minute.
5. `npm run assurance:served` against the restarted venue.
6. Stop the venue; `npm run state:verify` on the directory.

## 2. What was found

| Measure                                                                                           | Result                                                                                                |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Assets hosted                                                                                     | 30                                                                                                    |
| Ticks read before the kill (30 records from sequence 1)                                           | 11,352 — from 135 to 1363 per asset; 0 gaps, 0 discontinuities                                        |
| Recovery after the restart                                                                        | `resumed` for 30 of 30                                                                                |
| Resume from the pre-kill sequence honoured (no gap told, first tick = last + 1, no discontinuity) | **30 of 30**                                                                                          |
| One-minute bars through the kill contiguous in sequence, kill minute stored                       | **30 of 30** (5 bars read per asset)                                                                  |
| `assurance:served` on the restarted venue                                                         | exit 0 — 30 assets, 0 exploitable, 0 failed; every record read **from sequence 1** across the restart |
| `state:verify` after the run                                                                      | exit 0 — consistent: every checkpoint, record and history head agrees                                 |

PH-25.1's findings a and c, measured on one asset in a test, are closed on the
product: before PH-28.1 the second step of a read across a restart was refused
as evicted for every asset, and the minute the kill fell in was a hole in every
candle record.

What this does not show: a product-margin verdict. At 150 s the standing job
grades every asset `undecided` with its floors, as it must at this size
(`PH-25-SERVED-VERDICT.md` for a run of an hour).

## 3. The standing job's record, verbatim

# Served-record assurance — ph-28.4

Type: EVIDENCE (generated; do not edit by hand)
Venue: `http://127.0.0.1:7410`
Run at: 2026-09-06T00:46:30.794Z
Read per asset: up to 50000 ticks, the venue’s retained window if smaller
Venue as it described itself: boot nonce aa177bdd-3475-4fba-bd62-685a5c949da7, 30 assets, production composition (`/lab/markets` absent)
Job built from commit `1417a56`
Assets: 30 — 0 exploitable, 0 failed

Every number below came over `GET /markets/:id/stream` from the venue named
above; nothing was generated in this process. `undecided` means the battery
could not see a product-margin edge at this size, and the floors say how
far from seeing one it was (samples in parentheses).

| Asset        | Ticks | Covered | Outcome   | Hypotheses / families / withheld-unavailable | Detection floor per horizon                         | Worst z | Time | Sequences read · sha256 of the ticks |
| ------------ | ----- | ------- | --------- | -------------------------------------------- | --------------------------------------------------- | ------- | ---- | ------------------------------------ |
| eurusd-otc   | 732   | 0.09 h  | undecided | 0 / 26 / 2                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–732 4b28679b075e                   |
| gbpusd-otc   | 907   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–907 9b1939ee8af9                   |
| usdjpy-otc   | 695   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–695 f164ba227578                   |
| audusd-otc   | 857   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 99.051pp (2), 1m 140.079pp (1)                  | —       | 0s   | 1–857 0742073988e4                   |
| usdchf-otc   | 427   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–427 c977f89cfb18                   |
| eurgbp-otc   | 440   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–440 b8d0ea1a201f                   |
| gbpjpy-otc   | 1187  | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–1187 fd3ac344ea53                  |
| eurjpy-otc   | 1132  | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–1132 711f053ea60f                  |
| aapl-otc     | 406   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 99.051pp (2), 2m 140.079pp (1) | —       | 0s   | 1–406 d3762a35ead9                   |
| msft-otc     | 321   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–321 7d858bfea120                   |
| nvda-otc     | 530   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–530 06956ebfda0e                   |
| tsla-otc     | 446   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–446 b22dbdbb61d7                   |
| meta-otc     | 427   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–427 b0ffc87e393d                   |
| amzn-otc     | 523   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–523 9d020183110d                   |
| pbr-otc      | 560   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–560 d48dc55a76ae                   |
| nu-otc       | 428   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–428 0b1cc60d8755                   |
| btcusdt-otc  | 4373  | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–4373 33643fe7af4c                  |
| ethusdt-otc  | 1554  | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–1554 0d7ab7969364                  |
| bnbusdt-otc  | 960   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–960 032ec449581b                   |
| solusdt-otc  | 2003  | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–2003 e6807de9588e                  |
| xrpusdt-otc  | 1065  | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–1065 6a246c862519                  |
| dogeusdt-otc | 1960  | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–1960 f554fca82100                  |
| mmx-idx-otc  | 1536  | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–1536 e50e2c38071c                  |
| cgx-idx-otc  | 1928  | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 99.051pp (2), 1m 140.079pp (1)                  | —       | 0s   | 1–1928 3424b8c3d445                  |
| aix-idx-otc  | 313   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–313 88e6f1bcf9aa                   |
| tcx-idx-otc  | 334   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–334 e81642da986a                   |
| scx-idx-otc  | 380   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–380 80d24c70149d                   |
| gmx-idx-otc  | 507   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 99.051pp (2), 1m 140.079pp (1)                  | —       | 0s   | 1–507 cbcf99f1dc34                   |
| evx-idx-otc  | 409   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 80.875pp (3), 1m 140.079pp (1)                  | —       | 0s   | 1–409 c61cde43e80b                   |
| brx-idx-otc  | 346   | 0.09 h  | undecided | 0 / 27 / 1                                   | 30s 99.051pp (2), 1m 140.079pp (1)                  | —       | 0s   | 1–346 f9ddc377af27                   |

## Notes from the battery

- eurusd-otc: learned-logistic @ 30s: classified no entries; skipped.
- eurusd-otc: learned-logistic @ 1m: classified no entries; skipped.
- eurusd-otc: 2m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 3m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 4m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 5m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 10m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 15m: no decided outcomes in the evaluation split; skipped.
- eurusd-otc: 69 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurusd-otc: 155 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- gbpusd-otc: learned-logistic @ 30s: classified no entries; skipped.
- gbpusd-otc: learned-logistic @ 1m: classified no entries; skipped.
- gbpusd-otc: 2m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 3m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 4m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 5m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 10m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 15m: no decided outcomes in the evaluation split; skipped.
- gbpusd-otc: 72 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gbpusd-otc: 164 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gbpusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gbpusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- usdjpy-otc: learned-logistic @ 30s: classified no entries; skipped.
- usdjpy-otc: learned-logistic @ 1m: classified no entries; skipped.
- usdjpy-otc: 2m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 3m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 4m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 5m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 10m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 15m: no decided outcomes in the evaluation split; skipped.
- usdjpy-otc: 69 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- usdjpy-otc: 167 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- usdjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- usdjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- audusd-otc: learned-logistic @ 30s: classified no entries; skipped.
- audusd-otc: learned-logistic @ 1m: classified no entries; skipped.
- audusd-otc: 2m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 3m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 4m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 5m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 10m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 15m: no decided outcomes in the evaluation split; skipped.
- audusd-otc: 62 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- audusd-otc: 174 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- audusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- audusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- usdchf-otc: position-in-range @ 30s: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 30s: classified no entries; skipped.
- usdchf-otc: position-in-range @ 1m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 1m: classified no entries; skipped.
- usdchf-otc: 2m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 3m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 4m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 5m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 10m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 15m: no decided outcomes in the evaluation split; skipped.
- usdchf-otc: 75 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- usdchf-otc: 151 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- usdchf-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- usdchf-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- eurgbp-otc: position-in-range @ 30s: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 30s: classified no entries; skipped.
- eurgbp-otc: position-in-range @ 1m: classified no entries; skipped.
- eurgbp-otc: learned-logistic @ 1m: classified no entries; skipped.
- eurgbp-otc: 2m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 3m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 4m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 5m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 10m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 15m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 73 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurgbp-otc: 153 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurgbp-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurgbp-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- gbpjpy-otc: learned-logistic @ 30s: classified no entries; skipped.
- gbpjpy-otc: learned-logistic @ 1m: classified no entries; skipped.
- gbpjpy-otc: 2m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 3m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 4m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 5m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 10m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 15m: no decided outcomes in the evaluation split; skipped.
- gbpjpy-otc: 69 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gbpjpy-otc: 167 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gbpjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gbpjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- eurjpy-otc: learned-logistic @ 30s: classified no entries; skipped.
- eurjpy-otc: learned-logistic @ 1m: classified no entries; skipped.
- eurjpy-otc: 2m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 3m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 4m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 5m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 10m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 15m: no decided outcomes in the evaluation split; skipped.
- eurjpy-otc: 72 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurjpy-otc: 164 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- aapl-otc: position-in-range @ 30s: classified no entries; skipped.
- aapl-otc: learned-logistic @ 30s: classified no entries; skipped.
- aapl-otc: position-in-range @ 1m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 1m: classified no entries; skipped.
- aapl-otc: position-in-range @ 2m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 2m: classified no entries; skipped.
- aapl-otc: 3m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 4m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 5m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 10m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 15m: no decided outcomes in the evaluation split; skipped.
- aapl-otc: 111 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- aapl-otc: 228 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- aapl-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- aapl-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m. The single-test floor is not the gate's.
- msft-otc: position-in-range @ 30s: classified no entries; skipped.
- msft-otc: learned-logistic @ 30s: classified no entries; skipped.
- msft-otc: position-in-range @ 1m: classified no entries; skipped.
- msft-otc: learned-logistic @ 1m: classified no entries; skipped.
- msft-otc: 2m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 3m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 4m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 5m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 10m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 15m: no decided outcomes in the evaluation split; skipped.
- msft-otc: 68 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- msft-otc: 158 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- msft-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- msft-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- nvda-otc: position-in-range @ 30s: classified no entries; skipped.
- nvda-otc: learned-logistic @ 30s: classified no entries; skipped.
- nvda-otc: position-in-range @ 1m: classified no entries; skipped.
- nvda-otc: learned-logistic @ 1m: classified no entries; skipped.
- nvda-otc: 2m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 3m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 4m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 5m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 10m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 15m: no decided outcomes in the evaluation split; skipped.
- nvda-otc: 67 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- nvda-otc: 159 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- nvda-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- nvda-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- tsla-otc: position-in-range @ 30s: classified no entries; skipped.
- tsla-otc: learned-logistic @ 30s: classified no entries; skipped.
- tsla-otc: position-in-range @ 1m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 1m: classified no entries; skipped.
- tsla-otc: 2m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 3m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 4m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 5m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 10m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 15m: no decided outcomes in the evaluation split; skipped.
- tsla-otc: 67 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- tsla-otc: 159 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- tsla-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- tsla-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- meta-otc: position-in-range @ 30s: classified no entries; skipped.
- meta-otc: learned-logistic @ 30s: classified no entries; skipped.
- meta-otc: position-in-range @ 1m: classified no entries; skipped.
- meta-otc: learned-logistic @ 1m: classified no entries; skipped.
- meta-otc: 2m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 3m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 4m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 5m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 10m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 15m: no decided outcomes in the evaluation split; skipped.
- meta-otc: 66 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- meta-otc: 160 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- meta-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- meta-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- amzn-otc: position-in-range @ 30s: classified no entries; skipped.
- amzn-otc: learned-logistic @ 30s: classified no entries; skipped.
- amzn-otc: position-in-range @ 1m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 1m: classified no entries; skipped.
- amzn-otc: 2m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 3m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 4m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 5m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 10m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 15m: no decided outcomes in the evaluation split; skipped.
- amzn-otc: 68 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- amzn-otc: 158 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- amzn-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- amzn-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- pbr-otc: position-in-range @ 30s: classified no entries; skipped.
- pbr-otc: learned-logistic @ 30s: classified no entries; skipped.
- pbr-otc: position-in-range @ 1m: classified no entries; skipped.
- pbr-otc: learned-logistic @ 1m: classified no entries; skipped.
- pbr-otc: 2m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 3m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 4m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 5m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 10m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 15m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 71 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- pbr-otc: 155 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- pbr-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- pbr-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- nu-otc: position-in-range @ 30s: classified no entries; skipped.
- nu-otc: learned-logistic @ 30s: classified no entries; skipped.
- nu-otc: position-in-range @ 1m: classified no entries; skipped.
- nu-otc: learned-logistic @ 1m: classified no entries; skipped.
- nu-otc: 2m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 3m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 4m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 5m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 10m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 15m: no decided outcomes in the evaluation split; skipped.
- nu-otc: 65 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- nu-otc: 161 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- nu-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- nu-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- btcusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- btcusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- btcusdt-otc: 2m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- btcusdt-otc: 74 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- btcusdt-otc: 162 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- btcusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- btcusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- ethusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- ethusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- ethusdt-otc: 2m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- ethusdt-otc: 73 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- ethusdt-otc: 163 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- ethusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- ethusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- bnbusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- bnbusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- bnbusdt-otc: 2m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- bnbusdt-otc: 75 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- bnbusdt-otc: 161 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- bnbusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- bnbusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- solusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- solusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- solusdt-otc: 2m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- solusdt-otc: 70 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- solusdt-otc: 166 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- solusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- solusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- xrpusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- xrpusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- xrpusdt-otc: 2m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- xrpusdt-otc: 72 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- xrpusdt-otc: 164 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- xrpusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- xrpusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- dogeusdt-otc: learned-logistic @ 30s: classified no entries; skipped.
- dogeusdt-otc: previous-move @ 1m: classified no entries; skipped.
- dogeusdt-otc: run-length @ 1m: classified no entries; skipped.
- dogeusdt-otc: learned-logistic @ 1m: classified no entries; skipped.
- dogeusdt-otc: 2m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 3m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 4m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 5m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 10m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 15m: no decided outcomes in the evaluation split; skipped.
- dogeusdt-otc: 70 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- dogeusdt-otc: 158 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- dogeusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- dogeusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- mmx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- mmx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- mmx-idx-otc: 2m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- mmx-idx-otc: 77 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- mmx-idx-otc: 159 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- mmx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- mmx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- cgx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- cgx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- cgx-idx-otc: 2m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- cgx-idx-otc: 66 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- cgx-idx-otc: 170 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- cgx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- cgx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- aix-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- aix-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- aix-idx-otc: 2m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- aix-idx-otc: 66 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- aix-idx-otc: 160 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- aix-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- aix-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- tcx-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- tcx-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- tcx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- tcx-idx-otc: 2m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- tcx-idx-otc: 68 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- tcx-idx-otc: 158 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- tcx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- tcx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- scx-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- scx-idx-otc: trailing-return-sign-30 @ 1m: classified no entries; skipped.
- scx-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- scx-idx-otc: 2m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- scx-idx-otc: 69 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- scx-idx-otc: 155 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- scx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- scx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- gmx-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- gmx-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- gmx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- gmx-idx-otc: 2m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- gmx-idx-otc: 64 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gmx-idx-otc: 162 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gmx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gmx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- evx-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- evx-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- evx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- evx-idx-otc: 2m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- evx-idx-otc: 70 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- evx-idx-otc: 156 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- evx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- evx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
- brx-idx-otc: position-in-range @ 30s: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- brx-idx-otc: position-in-range @ 1m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- brx-idx-otc: 2m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 3m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 4m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 5m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 10m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 67 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- brx-idx-otc: 159 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- brx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- brx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m. The single-test floor is not the gate's.
