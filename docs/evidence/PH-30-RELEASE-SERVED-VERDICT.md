# Served-record assurance — ph-30.4-release

Type: EVIDENCE (generated; do not edit by hand)
Venue: `http://127.0.0.1:7420`
Run at: 2026-09-06T11:31:21.040Z
Read per asset: up to 50000 ticks, the venue’s retained window if smaller
Venue as it described itself: boot nonce none, 30 assets, production composition (`/lab/markets` absent)
Job built from commit `0ff85aa`
Assets: 30 — 0 exploitable, 0 failed

Every number below came over `GET /markets/:id/stream` from the venue named
above; nothing was generated in this process. `undecided` means the battery
could not see a product-margin edge at this size, and the floors say how
far from seeing one it was (samples in parentheses).

> **Note added by hand 2026-09-06 (Cycle Audit 10, a5-11 / a7-06); no row was
> touched.** `gate Infinitypp` below is not a number. It is
> `gateMinimumDetectableEffectPoints` — the edge at which the largest tested
> bucket would reach the corrected and confirmation thresholds — rendered by
> `toFixed(3)` when the value is `Infinity`, which is what the battery returns
> when no bucket reached those thresholds at this sample size. An hour of ticks
> gives one 15m sample, so there is no gate floor to state; that is the honest
> reading, and it is the ordinary answer at this size rather than a defect in
> the run. The renderer said `Infinity` here 237 times while
> `packages/lab/src/attacks/battery.ts` had always written the same value as
> `unconfirmable`; `tools/sim/src/servedAssuranceRun.ts` now writes the
> battery's word too, so a regeneration of this record prints
> `gate unconfirmable` in each of those places and nothing else changes.

| Asset        | Ticks | Covered | Outcome   | Hypotheses / families / withheld-unavailable | Detection floor per horizon                                                                                                                                                                                                                                                                   | Worst z | Time | Sequences read · sha256 of the ticks |
| ------------ | ----- | ------- | --------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- | ------------------------------------ |
| eurusd-otc   | 8475  | 1.00 h  | undecided | 0 / 26 / 2                                   | 30s 22.148pp / gate Infinitypp (40), 1m 32.136pp / gate Infinitypp (19), 2m 44.297pp / gate Infinitypp (10), 3m 57.187pp / gate Infinitypp (6), 4m 62.645pp / gate Infinitypp (5), 5m 70.040pp / gate Infinitypp (4), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–8475 61d1783e0ff6                  |
| gbpusd-otc   | 9233  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 22.431pp / gate Infinitypp (39), 1m 31.323pp / gate Infinitypp (20), 2m 44.297pp / gate Infinitypp (10), 3m 57.187pp / gate Infinitypp (6), 4m 62.645pp / gate Infinitypp (5), 5m 70.040pp / gate Infinitypp (4), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–9233 3430131c1e74                  |
| usdjpy-otc   | 12929 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 24.763pp / gate Infinitypp (32), 1m 35.020pp / gate Infinitypp (16), 2m 49.525pp / gate Infinitypp (8), 3m 62.645pp / gate Infinitypp (5), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–12929 e4143292fe66                 |
| audusd-otc   | 10413 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 24.763pp / gate Infinitypp (32), 1m 35.020pp / gate Infinitypp (16), 2m 49.525pp / gate Infinitypp (8), 3m 62.645pp / gate Infinitypp (5), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–10413 b8f2d6877d53                 |
| usdchf-otc   | 6386  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 21.615pp / gate Infinitypp (42), 1m 30.568pp / gate Infinitypp (21), 2m 44.297pp / gate Infinitypp (10), 3m 52.945pp / gate Infinitypp (7), 4m 62.645pp / gate Infinitypp (5), 5m 70.040pp / gate Infinitypp (4), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–6386 fc2ba97de203                  |
| eurgbp-otc   | 7450  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 26.472pp / gate Infinitypp (28), 1m 37.438pp / gate Infinitypp (14), 2m 52.945pp / gate Infinitypp (7), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1)                                      | —       | 0s   | 1–7450 ef9164b13e4a                  |
| gbpjpy-otc   | 35298 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 24.385pp / gate Infinitypp (33), 1m 33.974pp / gate Infinitypp (17), 2m 49.525pp / gate Infinitypp (8), 3m 62.645pp / gate Infinitypp (5), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 1s   | 1–35298 4d446306fae2                 |
| eurjpy-otc   | 11635 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 24.763pp / gate Infinitypp (32), 1m 35.020pp / gate Infinitypp (16), 2m 49.525pp / gate Infinitypp (8), 3m 62.645pp / gate Infinitypp (5), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–11635 7ea81853fb17                 |
| aapl-otc     | 4866  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 22.431pp / gate Infinitypp (39), 1m 31.323pp / gate Infinitypp (20), 2m 44.297pp / gate Infinitypp (10), 3m 57.187pp / gate Infinitypp (6), 4m 62.645pp / gate Infinitypp (5), 5m 70.040pp / gate Infinitypp (4), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–4866 370a44cdf62d                  |
| msft-otc     | 5373  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 26.012pp / gate Infinitypp (29), 1m 36.168pp / gate Infinitypp (15), 2m 52.945pp / gate Infinitypp (7), 3m 62.645pp / gate Infinitypp (5), 4m 80.875pp / gate Infinitypp (3), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–5373 74a30ca34a44                  |
| nvda-otc     | 9783  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 20.011pp / gate Infinitypp (49), 1m 28.016pp / gate Infinitypp (25), 2m 40.437pp / gate Infinitypp (12), 3m 49.525pp / gate Infinitypp (8), 4m 57.187pp / gate Infinitypp (6), 5m 62.645pp / gate Infinitypp (5), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–9783 6642440d1b4d                  |
| tsla-otc     | 5811  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 22.431pp / gate Infinitypp (39), 1m 31.323pp / gate Infinitypp (20), 2m 44.297pp / gate Infinitypp (10), 3m 62.645pp / gate Infinitypp (5), 4m 62.645pp / gate Infinitypp (5), 5m 70.040pp / gate Infinitypp (4), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–5811 dd1c385d9f29                  |
| meta-otc     | 8305  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 22.148pp / gate Infinitypp (40), 1m 31.323pp / gate Infinitypp (20), 2m 44.297pp / gate Infinitypp (10), 3m 57.187pp / gate Infinitypp (6), 4m 62.645pp / gate Infinitypp (5), 5m 70.040pp / gate Infinitypp (4), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–8305 36876a299adc                  |
| amzn-otc     | 8016  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 23.678pp / gate Infinitypp (35), 1m 33.017pp / gate Infinitypp (18), 2m 46.693pp / gate Infinitypp (9), 3m 57.187pp / gate Infinitypp (6), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–8016 375fae23b947                  |
| pbr-otc      | 17185 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 29.865pp / gate Infinitypp (22), 1m 42.235pp / gate Infinitypp (11), 2m 62.645pp / gate Infinitypp (5), 3m 80.875pp / gate Infinitypp (3), 4m 99.051pp / gate Infinitypp (2), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1)                                      | —       | 0s   | 1–17185 d42eab80b45e                 |
| nu-otc       | 8546  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 23.678pp / gate Infinitypp (35), 1m 33.017pp / gate Infinitypp (18), 2m 46.693pp / gate Infinitypp (9), 3m 57.187pp / gate Infinitypp (6), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–8546 a3b4cb852d20                  |
| btcusdt-otc  | 15912 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 21.615pp / gate Infinitypp (42), 1m 30.568pp / gate Infinitypp (21), 2m 42.235pp / gate Infinitypp (11), 3m 52.945pp / gate Infinitypp (7), 4m 70.040pp / gate Infinitypp (4), 5m 70.040pp / gate Infinitypp (4), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–15912 5b4afe9d8415                 |
| ethusdt-otc  | 50000 | 0.96 h  | undecided | 0 / 27 / 1                                   | 30s 26.012pp / gate Infinitypp (29), 1m 36.168pp / gate Infinitypp (15), 2m 52.945pp / gate Infinitypp (7), 3m 62.645pp / gate Infinitypp (5), 4m 80.875pp / gate Infinitypp (3), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 1s   | 2567–52566 d62f1f725362              |
| bnbusdt-otc  | 27065 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 19.615pp / gate Infinitypp (51), 1m 26.958pp / gate Infinitypp (27), 2m 38.851pp / gate Infinitypp (13), 3m 46.693pp / gate Infinitypp (9), 4m 57.187pp / gate Infinitypp (6), 5m 62.645pp / gate Infinitypp (5), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 1s   | 1–27065 ece09f221800                 |
| solusdt-otc  | 19327 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 19.425pp / gate Infinitypp (52), 1m 27.472pp / gate Infinitypp (26), 2m 38.851pp / gate Infinitypp (13), 3m 49.525pp / gate Infinitypp (8), 4m 57.187pp / gate Infinitypp (6), 5m 62.645pp / gate Infinitypp (5), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–19327 db087b642650                 |
| xrpusdt-otc  | 30724 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 22.724pp / gate Infinitypp (38), 1m 32.136pp / gate Infinitypp (19), 2m 46.693pp / gate Infinitypp (9), 3m 57.187pp / gate Infinitypp (6), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 1s   | 1–30724 2f0f74c835cc                 |
| dogeusdt-otc | 28368 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 24.385pp / gate Infinitypp (33), 1m 36.168pp / gate Infinitypp (15), 2m 49.525pp / gate Infinitypp (8), 3m 62.645pp / gate Infinitypp (5), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 1s   | 1–28368 28a2909aa95f                 |
| mmx-idx-otc  | 37481 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 19.425pp / gate Infinitypp (52), 1m 28.016pp / gate Infinitypp (25), 2m 38.851pp / gate Infinitypp (13), 3m 49.525pp / gate Infinitypp (8), 4m 57.187pp / gate Infinitypp (6), 5m 62.645pp / gate Infinitypp (5), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 1s   | 1–37481 88a9d7f52937                 |
| cgx-idx-otc  | 19467 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 22.431pp / gate Infinitypp (39), 1m 31.323pp / gate Infinitypp (20), 2m 44.297pp / gate Infinitypp (10), 3m 57.187pp / gate Infinitypp (6), 4m 62.645pp / gate Infinitypp (5), 5m 70.040pp / gate Infinitypp (4), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 1s   | 1–19467 d10676aa43bc                 |
| aix-idx-otc  | 7139  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 23.678pp / gate Infinitypp (35), 1m 33.017pp / gate Infinitypp (18), 2m 46.693pp / gate Infinitypp (9), 3m 57.187pp / gate Infinitypp (6), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–7139 25d7c1ec1c7e                  |
| tcx-idx-otc  | 3596  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 23.029pp / gate Infinitypp (37), 1m 32.136pp / gate Infinitypp (19), 2m 49.525pp / gate Infinitypp (8), 3m 57.187pp / gate Infinitypp (6), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–3596 dc0f04800137                  |
| scx-idx-otc  | 4730  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 22.724pp / gate Infinitypp (38), 1m 31.323pp / gate Infinitypp (20), 2m 44.297pp / gate Infinitypp (10), 3m 57.187pp / gate Infinitypp (6), 4m 62.645pp / gate Infinitypp (5), 5m 70.040pp / gate Infinitypp (4), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–4730 ebfa0629c90a                  |
| gmx-idx-otc  | 10130 | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 24.385pp / gate Infinitypp (33), 1m 33.974pp / gate Infinitypp (17), 2m 49.525pp / gate Infinitypp (8), 3m 62.645pp / gate Infinitypp (5), 4m 70.040pp / gate Infinitypp (4), 5m 80.875pp / gate Infinitypp (3), 10m 140.079pp / gate Infinitypp (1), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–10130 0e27f0249821                 |
| evx-idx-otc  | 5369  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 22.148pp / gate Infinitypp (40), 1m 31.323pp / gate Infinitypp (20), 2m 44.297pp / gate Infinitypp (10), 3m 57.187pp / gate Infinitypp (6), 4m 62.645pp / gate Infinitypp (5), 5m 70.040pp / gate Infinitypp (4), 10m 99.051pp / gate Infinitypp (2), 15m 140.079pp / gate Infinitypp (1) | —       | 0s   | 1–5369 3fca40f48fe7                  |
| brx-idx-otc  | 6194  | 1.00 h  | undecided | 0 / 27 / 1                                   | 30s 26.472pp / gate Infinitypp (28), 1m 37.438pp / gate Infinitypp (14), 2m 52.945pp / gate Infinitypp (7), 3m 70.040pp / gate Infinitypp (4), 4m 80.875pp / gate Infinitypp (3), 5m 99.051pp / gate Infinitypp (2), 10m 140.079pp / gate Infinitypp (1)                                      | —       | 0s   | 1–6194 85b6fedb960b                  |

## Notes from the battery

- eurusd-otc: learned-logistic @ 10m: classified no entries; skipped.
- eurusd-otc: learned-logistic @ 15m: classified no entries; skipped.
- eurusd-otc: 555 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurusd-otc: 371 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- gbpusd-otc: learned-logistic @ 10m: classified no entries; skipped.
- gbpusd-otc: learned-logistic @ 15m: classified no entries; skipped.
- gbpusd-otc: 580 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gbpusd-otc: 394 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gbpusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gbpusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- usdjpy-otc: 540 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- usdjpy-otc: 444 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- usdjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- usdjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- audusd-otc: learned-logistic @ 10m: classified no entries; skipped.
- audusd-otc: learned-logistic @ 15m: classified no entries; skipped.
- audusd-otc: 512 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- audusd-otc: 462 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- audusd-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- audusd-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- usdchf-otc: learned-logistic @ 3m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 4m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 5m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 10m: classified no entries; skipped.
- usdchf-otc: learned-logistic @ 15m: classified no entries; skipped.
- usdchf-otc: 568 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- usdchf-otc: 391 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- usdchf-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- usdchf-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- eurgbp-otc: learned-logistic @ 10m: classified no entries; skipped.
- eurgbp-otc: 15m: no decided outcomes in the evaluation split; skipped.
- eurgbp-otc: 439 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurgbp-otc: 417 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurgbp-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurgbp-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- gbpjpy-otc: 532 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gbpjpy-otc: 452 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- gbpjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- gbpjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- eurjpy-otc: learned-logistic @ 15m: classified no entries; skipped.
- eurjpy-otc: 515 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- eurjpy-otc: 464 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- eurjpy-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- eurjpy-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- aapl-otc: learned-logistic @ 30s: classified no entries; skipped.
- aapl-otc: learned-logistic @ 1m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 2m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 3m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 4m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 5m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 10m: classified no entries; skipped.
- aapl-otc: learned-logistic @ 15m: classified no entries; skipped.
- aapl-otc: 550 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- aapl-otc: 394 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- aapl-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- aapl-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- msft-otc: learned-logistic @ 30s: classified no entries; skipped.
- msft-otc: learned-logistic @ 1m: classified no entries; skipped.
- msft-otc: learned-logistic @ 2m: classified no entries; skipped.
- msft-otc: learned-logistic @ 3m: classified no entries; skipped.
- msft-otc: learned-logistic @ 4m: classified no entries; skipped.
- msft-otc: learned-logistic @ 5m: classified no entries; skipped.
- msft-otc: learned-logistic @ 10m: classified no entries; skipped.
- msft-otc: learned-logistic @ 15m: classified no entries; skipped.
- msft-otc: 468 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- msft-otc: 476 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- msft-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- msft-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- nvda-otc: learned-logistic @ 10m: classified no entries; skipped.
- nvda-otc: learned-logistic @ 15m: classified no entries; skipped.
- nvda-otc: 594 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- nvda-otc: 380 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- nvda-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- nvda-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- tsla-otc: learned-logistic @ 1m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 2m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 3m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 4m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 5m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 10m: classified no entries; skipped.
- tsla-otc: learned-logistic @ 15m: classified no entries; skipped.
- tsla-otc: 568 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- tsla-otc: 381 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- tsla-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- tsla-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- meta-otc: learned-logistic @ 10m: classified no entries; skipped.
- meta-otc: learned-logistic @ 15m: classified no entries; skipped.
- meta-otc: 581 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- meta-otc: 393 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- meta-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- meta-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- amzn-otc: learned-logistic @ 10m: classified no entries; skipped.
- amzn-otc: learned-logistic @ 15m: classified no entries; skipped.
- amzn-otc: 564 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- amzn-otc: 410 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- amzn-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- amzn-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- pbr-otc: 15m: no decided outcomes in the evaluation split; skipped.
- pbr-otc: 429 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- pbr-otc: 432 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- pbr-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- pbr-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
- nu-otc: learned-logistic @ 10m: classified no entries; skipped.
- nu-otc: learned-logistic @ 15m: classified no entries; skipped.
- nu-otc: 563 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- nu-otc: 411 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- nu-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- nu-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- btcusdt-otc: learned-logistic @ 15m: classified no entries; skipped.
- btcusdt-otc: 557 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- btcusdt-otc: 422 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- btcusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- btcusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- ethusdt-otc: 508 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- ethusdt-otc: 476 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- ethusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- ethusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- bnbusdt-otc: 577 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- bnbusdt-otc: 407 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- bnbusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- bnbusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- solusdt-otc: learned-logistic @ 10m: classified no entries; skipped.
- solusdt-otc: learned-logistic @ 15m: classified no entries; skipped.
- solusdt-otc: 602 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- solusdt-otc: 372 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- solusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- solusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- xrpusdt-otc: learned-logistic @ 10m: classified no entries; skipped.
- xrpusdt-otc: learned-logistic @ 15m: classified no entries; skipped.
- xrpusdt-otc: 541 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- xrpusdt-otc: 433 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- xrpusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- xrpusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- dogeusdt-otc: 539 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- dogeusdt-otc: 445 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- dogeusdt-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- dogeusdt-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- mmx-idx-otc: 619 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- mmx-idx-otc: 365 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- mmx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- mmx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- cgx-idx-otc: 595 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- cgx-idx-otc: 389 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- cgx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- cgx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- aix-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- aix-idx-otc: learned-logistic @ 15m: classified no entries; skipped.
- aix-idx-otc: 551 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- aix-idx-otc: 418 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
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
- tcx-idx-otc: 517 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- tcx-idx-otc: 427 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- tcx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- tcx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- scx-idx-otc: learned-logistic @ 30s: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 1m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 2m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- scx-idx-otc: trailing-return-sign-30 @ 15m: classified no entries; skipped.
- scx-idx-otc: learned-logistic @ 15m: classified no entries; skipped.
- scx-idx-otc: 560 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- scx-idx-otc: 382 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- scx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- scx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- gmx-idx-otc: learned-logistic @ 15m: classified no entries; skipped.
- gmx-idx-otc: 518 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- gmx-idx-otc: 461 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
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
- evx-idx-otc: 540 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- evx-idx-otc: 404 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- evx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- evx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m. The single-test floor is not the gate's.
- brx-idx-otc: learned-logistic @ 3m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 4m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 5m: classified no entries; skipped.
- brx-idx-otc: learned-logistic @ 10m: classified no entries; skipped.
- brx-idx-otc: 15m: no decided outcomes in the evaluation split; skipped.
- brx-idx-otc: 467 buckets held fewer than 500 decided outcomes and were not tested. A bucket with a handful of samples cannot support a finding.
- brx-idx-otc: 374 buckets received no entry at all and were not tested. That is a gap in what was sampled, not a shortage of samples: the family never saw that condition.
- brx-idx-otc: Sensitivity is coarser than the 99% payout threshold of 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".
- brx-idx-otc: The gate itself — one correction over 0 hypotheses, plus confirmation — could not have turned on an edge below 0.25pp at: 30s, 1m, 2m, 3m, 4m, 5m, 10m. The single-test floor is not the gate's.
