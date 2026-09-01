# Terminal price dispersion, measured

Type: RECORDED EVIDENCE
Produced: 2026-09-01
Method: 100 replicates per asset, 90 simulated days each, 14 parallel processes
Command: `node runner.mjs 90 100` against `packages/engine/dist`, seeds `drift-r0…99`

---

## Why this exists

An earlier three-replicate measurement was presented as if it described asset
behaviour. One of the three btcusd samples read **+141.3%**, and it went into a
table beside +10.4% and +13.8% as though that were what the asset does.

Three samples do not characterise a distribution, and least of all one this
engine builds fat tails into on purpose. That +141.3% sits at roughly the 95th
percentile of the real distribution — it was the tail, not the asset. Recorded
here because the project's discipline is to measure rather than assert, and
that measurement failed it.

## Result

| Asset  | median | p10    | p25    | p75    | p90     | σ     | min    | max     | >2σ |
| ------ | ------ | ------ | ------ | ------ | ------- | ----- | ------ | ------- | --- |
| eurusd | +0.2%  | −5.1%  | −2.2%  | +2.5%  | +4.2%   | 4.0%  | −10.0% | +9.2%   | 4   |
| gbpjpy | −0.5%  | −22.0% | −10.3% | +8.3%  | +28.4%  | 18.4% | −35.2% | +45.9%  | 5   |
| btcusd | +1.5%  | −62.2% | −34.1% | +49.5% | +106.3% | 75.6% | −79.3% | +281.4% | 6   |
| spx    | +0.2%  | −2.4%  | −1.5%  | +1.2%  | +2.2%   | 1.7%  | −5.0%  | +3.3%   | 1   |
| xauusd | +0.4%  | −8.5%  | −4.7%  | +4.8%  | +9.4%   | 8.4%  | −23.5% | +29.8%  | 6   |

## What it says

**There is no drift.** The median is within half a percent of zero on all five
assets, which is exactly what ADR-0003 predicts: the process is an exact
martingale, so the expected terminal price _is_ the starting price. What grows
with time is dispersion, not displacement — and conflating the two is what
produced the earlier error.

**The terminal distribution is nearly Gaussian by 90 days.** Counts beyond 2σ
are 4, 5, 6, 1 and 6 out of 100 against a Gaussian expectation of 4.6. Per-tick
increments are heavy-tailed by design; over roughly 2.3–23 million of them the
central limit theorem has largely done its work. Residual excess shows further
out — btcusd reached +281%, about 3.7σ.

**Dispersion is what high volatility _is_, not a side effect of it.** btcusd's
σ of 75.6% per quarter is not a defect to be capped; it is the asset being
volatile. Narrowing it threefold would produce a threefold flatter chart.

## Reconciliation with the analytic estimate

Computed from `authored.tickRms` and `evidence.meanIntervalMs`:

| Asset  | analytic σ | measured σ | ratio |
| ------ | ---------- | ---------- | ----- |
| eurusd | 3.4%       | 4.0%       | 1.18  |
| gbpjpy | 15.0%      | 18.4%      | 1.23  |
| btcusd | 46.8%      | 75.6%      | 1.62  |
| spx    | 1.3%       | 1.7%       | 1.31  |
| xauusd | 5.8%       | 8.4%       | 1.45  |

The analytic figure is low, and correctly so: `tickRms` covers base volatility
and the cascade, and two further multiplier layers — regime and structure — sit
above them. The ratio varies per asset because `regimeSpread` and
`structureSpread` do. The measured column is the one to design against.

## Consequence for the catalogue

No volatility cap. The dispersion budget is a **family design parameter** chosen
at authoring time, price-blind and outcome-blind:

| Band        | σ per 90 days |
| ----------- | ------------- |
| calm        | ~2%           |
| normal      | ~4–8%         |
| active      | ~15–20%       |
| high-octane | ~50–75%       |

A price ceiling was considered and refused. Near a boundary `P(down) > P(up)`,
which is a directional rule and the easiest exploit this system could contain —
INV-006 and ADR-0003 exist to forbid exactly it. The reference price is chosen
instead so that a wide range stays plausible, and high-dispersion assets are not
named after real instruments whose price level a reader already knows.
