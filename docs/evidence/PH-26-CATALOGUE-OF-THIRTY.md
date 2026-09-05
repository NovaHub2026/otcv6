# PH-26 — The catalogue of thirty: how every number was produced

Type: RECORDED EVIDENCE
Date: 2026-09-04
Verified by: `packages/engine/src/catalogue.test.ts` (clustering and volatility re-derive from each entry's record — the two traits the authoring solves), `tools/sim/src/catalogueBuild.stat.test.ts` (the ten sampled traits, the drawn tail weight and the retreats of every entry equal the seat's own draw; Cycle Audit 9 a3-02 found the first guard blind to those ten), `packages/engine/src/seats.test.ts` (every seat inside its archetype, feasible, and separable), `packages/engine/src/catalogue.stat.test.ts` (a stratified sample recalibrated at every gate)

---

## What this is

The run that produced the thirty compiled entries in
`packages/engine/src/catalogue.ts`, and the table it wrote as it went. Nothing
in the catalogue was typed: each asset's personality was drawn from its seat
(`packages/engine/src/seats.ts`) under a stream seeded by its own id, authored,
calibrated, and differentiated against everything before it, by
`tools/sim/src/buildCatalogue.ts`.

```
npm run catalogue:build -- --replicates 3
```

Keyring per asset: `MasterKeyring.forTesting(registrationKeyLabel(id))`, stream
label `registration-<id>`, environment `simulation` — exactly what
`registerAsset` derives with, so `catalogue.test.ts` can re-author every entry
from its recorded targets and get its recorded traits back.

## Three runs, and why the third is the one recorded

1. The first refused `dogeusdt-otc` at the dispersion span guard — "needs 32.0
   hours, this calibration spans 32.0" — because `span / replicates × replicates`
   is not `span` in floating point and the guard is strict. The builder now
   calibrates at one per cent over the span.
2. The second built all thirty and reproduced none of them: the builder had
   derived its authoring streams under a run-wide keyring while `registerAsset`
   derives under `registration-<id>`. The builder now derives as the pipeline
   does.
3. The third found `dogeusdt-otc` calibrated at **1.371%** ties against a 1%
   target, on 1.2 days × 3: its dispersion fit needs sixteen turnovers of a
   ninety-minute memory, which is enough for σ and far too few thirty-second
   horizons for a 1% quantile. The per-replicate span is now floored at a third
   of the catalogue's ten-day calibration span. This table is that run's: every
   tie rate sits between 0.894% and 1.236%, inside the 0.3pp band
   `catalogue.stat.test.ts` holds a fresh calibration to.

## How to read the columns

- **tail weight drawn → authored** — the excess kurtosis the seat drew, and what
  the solve achieved; `retreats` counts the nine-tenths steps taken when a drawn
  target was unreachable (none were).
- **quantum** — the lattice step in log units, the 1% quantile of the asset's
  own 30-second continuous return distribution across replicates.
- **precision** — decimals the lattice needs at the reference price; never
  supplied, always derived.
- **tie rate** — the fraction of calibration horizons that settled at the
  money, against the 1% target. The realised rate on the published lattice is
  about half this (`MEASURED_LATTICE_TIE_RATES`).
- **calibration** — days simulated per replicate × replicates, as each
  compiled entry records them (`evidence.simulatedMs`). **Corrected by Cycle
  Audit 9 (a3-01):** the run printed the dispersion fit's _total_ need under
  this header — three times the per-replicate figure for most assets, and for
  gbpjpy, eurjpy, solusdt, xrpusdt, dogeusdt and mmx-idx a figure below the
  ten-day floor the calibration actually ran at. All thirty cells are
  re-derived from the compiled entries, not re-run; the emitter prints the
  recorded span now (`catalogueBuild.test.ts`).

## The table

| asset        | archetype       | tail weight drawn → authored | quantum   | precision | tie rate | median steps | mean interval ms | calibration | time |
| ------------ | --------------- | ---------------------------- | --------- | --------- | -------- | ------------ | ---------------- | ----------- | ---- |
| eurusd-otc   | major-fx        | 51.7 → 51.7 (0 retreats)     | 3.1314e-7 | 7         | 0.950%   | 72           | 348.0            | 9.2 d × 3   | 10s  |
| gbpusd-otc   | major-fx        | 72.7 → 72.7 (0 retreats)     | 2.8963e-7 | 7         | 0.991%   | 74           | 273.7            | 5.6 d × 3   | 7s   |
| usdjpy-otc   | major-fx        | 63.4 → 63.4 (0 retreats)     | 4.1322e-7 | 5         | 1.014%   | 63           | 255.7            | 7.8 d × 3   | 12s  |
| audusd-otc   | major-fx        | 70.9 → 70.9 (0 retreats)     | 3.6734e-7 | 7         | 1.066%   | 69           | 327.1            | 6.4 d × 3   | 7s   |
| usdchf-otc   | major-fx        | 46.7 → 46.7 (0 retreats)     | 3.2281e-7 | 7         | 1.236%   | 60           | 514.4            | 9.1 d × 3   | 6s   |
| eurgbp-otc   | major-fx        | 60.3 → 60.3 (0 retreats)     | 2.7287e-7 | 7         | 1.133%   | 62           | 537.6            | 6.9 d × 3   | 5s   |
| gbpjpy-otc   | cross-fx        | 123.2 → 123.2 (0 retreats)   | 7.2245e-7 | 4         | 1.010%   | 87           | 131.7            | 3.3 d × 3   | 7s   |
| eurjpy-otc   | cross-fx        | 85.2 → 85.2 (0 retreats)     | 6.3190e-7 | 4         | 0.948%   | 91           | 255.8            | 3.3 d × 3   | 4s   |
| aapl-otc     | sector-etf      | 52.6 → 52.6 (0 retreats)     | 1.0383e-6 | 4         | 1.029%   | 64           | 657.6            | 8.8 d × 3   | 4s   |
| msft-otc     | sector-etf      | 47.1 → 47.1 (0 retreats)     | 8.7723e-7 | 4         | 0.943%   | 71           | 761.0            | 8.6 d × 3   | 3s   |
| nvda-otc     | sector-etf      | 64.9 → 64.9 (0 retreats)     | 1.7995e-6 | 4         | 0.965%   | 77           | 420.0            | 5.7 d × 3   | 4s   |
| tsla-otc     | sector-etf      | 62.6 → 62.6 (0 retreats)     | 2.5480e-6 | 4         | 1.083%   | 71           | 545.8            | 4.6 d × 3   | 3s   |
| meta-otc     | sector-etf      | 59.0 → 59.0 (0 retreats)     | 1.6350e-6 | 4         | 0.984%   | 71           | 556.2            | 7.3 d × 3   | 5s   |
| amzn-otc     | sector-etf      | 53.7 → 53.7 (0 retreats)     | 1.1107e-6 | 4         | 0.894%   | 77           | 518.3            | 6.0 d × 3   | 4s   |
| pbr-otc      | sector-etf      | 57.9 → 57.9 (0 retreats)     | 1.5279e-6 | 5         | 1.008%   | 71           | 475.1            | 4.6 d × 3   | 3s   |
| nu-otc       | sector-etf      | 56.5 → 56.5 (0 retreats)     | 2.1677e-6 | 5         | 1.005%   | 73           | 475.7            | 7.4 d × 3   | 4s   |
| btcusdt-otc  | major-crypto    | 116.9 → 116.9 (0 retreats)   | 1.7544e-6 | 1         | 1.048%   | 75           | 97.0             | 8.0 d × 3   | 29s  |
| ethusdt-otc  | major-crypto    | 152.6 → 152.6 (0 retreats)   | 1.6192e-6 | 3         | 0.965%   | 89           | 115.0            | 6.5 d × 3   | 21s  |
| bnbusdt-otc  | major-crypto    | 137.0 → 137.0 (0 retreats)   | 1.9399e-6 | 3         | 1.131%   | 72           | 157.7            | 5.5 d × 3   | 12s  |
| solusdt-otc  | alt-crypto      | 144.5 → 144.5 (0 retreats)   | 3.4473e-6 | 4         | 1.035%   | 76           | 112.8            | 3.3 d × 3   | 7s   |
| xrpusdt-otc  | alt-crypto      | 136.3 → 136.3 (0 retreats)   | 2.0346e-6 | 6         | 0.938%   | 93           | 129.6            | 3.3 d × 3   | 7s   |
| dogeusdt-otc | alt-crypto      | 153.4 → 153.4 (0 retreats)   | 3.5283e-6 | 7         | 0.962%   | 83           | 93.0             | 3.3 d × 3   | 9s   |
| mmx-idx-otc  | alt-crypto      | 149.9 → 149.9 (0 retreats)   | 4.1084e-6 | 3         | 1.163%   | 68           | 99.9             | 3.3 d × 3   | 9s   |
| cgx-idx-otc  | major-crypto    | 120.4 → 120.4 (0 retreats)   | 1.2807e-6 | 3         | 0.943%   | 97           | 141.1            | 7.9 d × 3   | 19s  |
| aix-idx-otc  | blue-chip-index | 48.6 → 48.6 (0 retreats)     | 1.8832e-6 | 3         | 0.919%   | 66           | 626.7            | 10.1 d × 3  | 5s   |
| tcx-idx-otc  | blue-chip-index | 38.8 → 38.8 (0 retreats)     | 1.2267e-6 | 3         | 0.993%   | 69           | 827.1            | 8.7 d × 3   | 3s   |
| scx-idx-otc  | blue-chip-index | 39.6 → 39.6 (0 retreats)     | 2.3276e-6 | 3         | 1.010%   | 64           | 667.8            | 8.6 d × 3   | 3s   |
| gmx-idx-otc  | sector-etf      | 65.5 → 65.5 (0 retreats)     | 1.5098e-6 | 3         | 0.960%   | 65           | 362.8            | 5.0 d × 3   | 3s   |
| evx-idx-otc  | sector-etf      | 65.8 → 65.8 (0 retreats)     | 2.8595e-6 | 3         | 1.058%   | 59           | 641.3            | 8.6 d × 3   | 4s   |
| brx-idx-otc  | sector-etf      | 42.6 → 42.6 (0 retreats)     | 1.4897e-6 | 3         | 0.942%   | 70           | 699.5            | 5.4 d × 3   | 2s   |

Keyring: `MasterKeyring.forTesting(registrationKeyLabel(id))` per asset. Run label: `catalogue-of-thirty`. Replicates: 3. Total run time: 3.7 minutes.

## The lattice tie rates

The realised at-the-money rate on the series that actually settles, one value
per asset: the source of `MEASURED_LATTICE_TIE_RATES` in
`packages/engine/src/asset.ts`. Produced by

```
npm run evidence:ties
```

`tools/sim/src/tieRateEvidence.ts`, which runs `latticeTies.stat.test.ts`'s
own procedure over every asset rather than a sample. The verifying test
measures a stratified sample of five on `ties-fresh-<asset>-<n>` at every gate.
Every rate below is under the 1% nominal target — the calibration measures a
continuous proxy for an integer-price event, and the published lattice ties
about half as often.

| asset        | lattice tie rate | 3se      | vs 1.0% nominal | time |
| ------------ | ---------------- | -------- | --------------- | ---- |
| eurusd-otc   | 0.400%           | ±0.106pp | below           | 11s  |
| gbpusd-otc   | 0.591%           | ±0.164pp | below           | 11s  |
| usdjpy-otc   | 0.462%           | ±0.069pp | below           | 14s  |
| audusd-otc   | 0.529%           | ±0.127pp | below           | 11s  |
| usdchf-otc   | 0.595%           | ±0.131pp | below           | 7s   |
| eurgbp-otc   | 0.553%           | ±0.125pp | below           | 7s   |
| gbpjpy-otc   | 0.529%           | ±0.101pp | below           | 19s  |
| eurjpy-otc   | 0.450%           | ±0.101pp | below           | 12s  |
| aapl-otc     | 0.425%           | ±0.092pp | below           | 5s   |
| msft-otc     | 0.524%           | ±0.097pp | below           | 4s   |
| nvda-otc     | 0.554%           | ±0.154pp | below           | 7s   |
| tsla-otc     | 0.440%           | ±0.101pp | below           | 6s   |
| meta-otc     | 0.446%           | ±0.118pp | below           | 6s   |
| amzn-otc     | 0.441%           | ±0.098pp | below           | 6s   |
| pbr-otc      | 0.549%           | ±0.150pp | below           | 7s   |
| nu-otc       | 0.502%           | ±0.124pp | below           | 6s   |
| btcusdt-otc  | 0.685%           | ±0.186pp | below           | 38s  |
| ethusdt-otc  | 0.413%           | ±0.082pp | below           | 32s  |
| bnbusdt-otc  | 0.489%           | ±0.084pp | below           | 24s  |
| solusdt-otc  | 0.565%           | ±0.081pp | below           | 24s  |
| xrpusdt-otc  | 0.559%           | ±0.093pp | below           | 22s  |
| dogeusdt-otc | 0.483%           | ±0.071pp | below           | 27s  |
| mmx-idx-otc  | 0.607%           | ±0.112pp | below           | 28s  |
| cgx-idx-otc  | 0.463%           | ±0.158pp | below           | 27s  |
| aix-idx-otc  | 0.545%           | ±0.141pp | below           | 5s   |
| tcx-idx-otc  | 0.501%           | ±0.160pp | below           | 3s   |
| scx-idx-otc  | 0.498%           | ±0.078pp | below           | 4s   |
| gmx-idx-otc  | 0.630%           | ±0.238pp | below           | 7s   |
| evx-idx-otc  | 0.558%           | ±0.098pp | below           | 5s   |
| brx-idx-otc  | 0.473%           | ±0.109pp | below           | 5s   |

Procedure: 12 replicates × 8000 horizons of 30 s on `ties-verify-<asset>-<n>`. Total run time: 6.5 minutes.
