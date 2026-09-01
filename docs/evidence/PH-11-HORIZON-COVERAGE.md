# PH-11 — Long-horizon directional coverage

Type: RECORDED EVIDENCE
Produced by: `npm run evidence:horizons` (tools/sim/src/horizonEvidence.ts)
Date: 2026-08-31
Verified by: `tools/sim/src/horizonCoverage.stat.test.ts`, which re-derives every row below

---

## What this is

The directional verdict at **every expiration the product sells**, for every
asset, at the sensitivity each run actually achieved.

At the 99% promotional payout a trader breaks even at a 50.2513% win rate, so an
edge is worth exploiting at **0.2513 percentage points**. A verdict of "no edge"
means nothing unless the test could have seen an edge that size. Until PH-11 only
the 30-second horizon had ever been policed to that threshold (B-002).

**All forty asset/horizon cells are now policed below it.**

## How to read the columns

- **Decided** — non-overlapping windows that settled a direction. Windows tile
  the timeline; they do not slide, because overlapping windows share increments
  and would be dependent by construction.
- **z** — deviation from a fair coin, stated at the **effective** sample size,
  which carries the measured design effect rather than assuming independence.
- **Path bias z** — how strongly this path's terminal displacement biases every
  horizon in the same direction. Non-overlapping window returns telescope: at
  every horizon they sum to the same number, so a path that ends up displaced
  looks like a consistent edge at every expiry. Reliable for sign and flatness,
  not for magnitude (see §Interpretation).
- **Design effect** — observed variance across 100 contiguous segments, divided
  by what independence predicts. 1 means the error bar is honest.
- **Floor** — the minimum detectable effect the run achieved, carrying the design
  effect. This is the number the verdict is worth.

---

## Primary run

Ten simulated years per asset, 100 contiguous segments, one continuous market
history each. `btcusd` was extended to twelve years because its 15-minute cell
came in at 0.2545pp against the 0.2513pp threshold — a 1.3% shortfall — and
"close" is not "policed".

eurusd: 225,106,647 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -332,241 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,449,445 | 0.50010 | +0.0105   | 0.61  | -0.18       | 1.24 ±14%     | 0.0482     | yes     |
| 1m      | 5,232,857  | 0.50014 | +0.0144   | 0.66  | -0.19       | 0.94 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,235  | 0.50019 | +0.0192   | 0.57  | -0.19       | 1.17 ±14%     | 0.0935     | yes     |
| 3m      | 1,747,055  | 0.49976 | -0.0242   | -0.64 | -0.19       | 0.88 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,609  | 0.50011 | +0.0107   | 0.23  | -0.20       | 1.13 ±14%     | 0.1302     | yes     |
| 5m      | 1,048,638  | 0.49974 | -0.0261   | -0.50 | -0.20       | 1.13 ±14%     | 0.1453     | yes     |
| 10m     | 524,558    | 0.49940 | -0.0597   | -0.86 | -0.20       | 1.01 ±14%     | 0.1948     | yes     |
| 15m     | 349,782    | 0.50000 | +0.0003   | 0.00  | -0.20       | 1.08 ±14%     | 0.2456     | yes     |

gbpjpy: 432,936,201 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -1,317,631 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,451,490 | 0.50011 | +0.0106   | 0.69  | -0.35       | 0.80 ±14%     | 0.0433     | yes     |
| 1m      | 5,233,997  | 0.50006 | +0.0058   | 0.26  | -0.36       | 0.82 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,762  | 0.50006 | +0.0059   | 0.19  | -0.37       | 0.88 ±14%     | 0.0865     | yes     |
| 3m      | 1,747,382  | 0.50004 | +0.0037   | 0.10  | -0.38       | 0.90 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,879  | 0.49980 | -0.0198   | -0.45 | -0.38       | 0.84 ±14%     | 0.1223     | yes     |
| 5m      | 1,048,855  | 0.49996 | -0.0041   | -0.08 | -0.39       | 1.05 ±14%     | 0.1403     | yes     |
| 10m     | 524,658    | 0.49958 | -0.0417   | -0.60 | -0.41       | 0.85 ±14%     | 0.1934     | yes     |
| 15m     | 349,832    | 0.50001 | +0.0014   | 0.02  | -0.43       | 0.89 ±14%     | 0.2368     | yes     |

spx: 93,219,558 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -984,766 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,453,735 | 0.49988 | -0.0116   | -0.73 | -0.61       | 1.05 ±14%     | 0.0444     | yes     |
| 1m      | 5,235,413  | 0.49993 | -0.0066   | -0.30 | -0.62       | 0.94 ±14%     | 0.0612     | yes     |
| 2m      | 2,620,061  | 0.49984 | -0.0161   | -0.51 | -0.63       | 1.05 ±14%     | 0.0888     | yes     |
| 3m      | 1,747,330  | 0.50009 | +0.0092   | 0.24  | -0.64       | 0.99 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,806  | 0.49980 | -0.0203   | -0.45 | -0.64       | 1.05 ±14%     | 0.1251     | yes     |
| 5m      | 1,048,797  | 0.49927 | -0.0735   | -1.33 | -0.65       | 1.28 ±14%     | 0.1548     | yes     |
| 10m     | 524,615    | 0.49972 | -0.0285   | -0.40 | -0.67       | 1.08 ±14%     | 0.2010     | yes     |
| 15m     | 349,821    | 0.49878 | -0.1222   | -1.38 | -0.68       | 1.10 ±14%     | 0.2486     | yes     |

xauusd: 157,667,862 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 331,209 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,444,760 | 0.50009 | +0.0090   | 0.56  | 0.12        | 1.10 ±14%     | 0.0455     | yes     |
| 1m      | 5,232,064  | 0.49997 | -0.0027   | -0.12 | 0.12        | 1.01 ±14%     | 0.0615     | yes     |
| 2m      | 2,619,119  | 0.50027 | +0.0274   | 0.89  | 0.12        | 0.86 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,998  | 0.50009 | +0.0093   | 0.25  | 0.12        | 0.94 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,578  | 0.50006 | +0.0062   | 0.14  | 0.13        | 0.83 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,674  | 0.50001 | +0.0011   | 0.02  | 0.13        | 1.06 ±14%     | 0.1410     | yes     |
| 10m     | 524,576    | 0.49985 | -0.0154   | -0.22 | 0.13        | 1.05 ±14%     | 0.1977     | yes     |
| 15m     | 349,779    | 0.50101 | +0.1008   | 1.17  | 0.14        | 1.04 ±14%     | 0.2418     | yes     |

btcusd: 1,106,265,172 ticks, 4375.0 simulated days (11.99 years), 100 segments, payout threshold 0.2513pp, net displacement 3,342,739 steps

| Horizon | Decided    | Up rate | Edge (pp) | z    | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ---- | ----------- | ------------- | ---------- | ------- |
| 30s     | 12,541,574 | 0.50022 | +0.0222   | 1.33 | 0.78        | 1.39 ±14%     | 0.0466     | yes     |
| 1m      | 6,280,445  | 0.50052 | +0.0520   | 2.34 | 0.80        | 1.24 ±14%     | 0.0622     | yes     |
| 2m      | 3,143,614  | 0.50081 | +0.0811   | 2.55 | 0.82        | 1.27 ±14%     | 0.0891     | yes     |
| 3m      | 2,096,641  | 0.50064 | +0.0636   | 1.74 | 0.84        | 1.13 ±14%     | 0.1027     | yes     |
| 4m      | 1,572,978  | 0.50097 | +0.0969   | 2.12 | 0.85        | 1.31 ±14%     | 0.1279     | yes     |
| 5m      | 1,258,655  | 0.50075 | +0.0746   | 1.48 | 0.87        | 1.28 ±14%     | 0.1410     | yes     |
| 10m     | 629,607    | 0.50180 | +0.1799   | 2.64 | 0.92        | 1.17 ±14%     | 0.1908     | yes     |
| 15m     | 419,786    | 0.50121 | +0.1210   | 1.42 | 0.95        | 1.22 ±14%     | 0.2393     | yes     |

Run time: 1625s (extended to close the 15m cell).

---

## Result

**Forty of forty cells policed below 0.2513pp.** Worst |z| across the forty
tests is 2.64 (btcusd, 10m); Benjamini–Hochberg at q = 0.05 rejects nothing.

Total: **2.0 billion ticks**, roughly 52 asset-years of simulated market, in
about 70 minutes of compute.

## Interpretation

### These are not forty independent tests

Within one asset, the eight horizons are measured from **one price path**, and
non-overlapping window returns telescope: at every horizon they sum to the same
terminal displacement. Conditioning on that displacement, the expected excess of
up-windows is `D · E|X| / σ²`, and the horizon dependence cancels — so a path that
happens to end up displaced biases every horizon the same way.

The `Path bias z` column measures it, and the flatness is the evidence:

| Asset  | Path bias z across all eight horizons | Observed sign consistency |
| ------ | ------------------------------------- | ------------------------- |
| btcusd | +0.78 → +0.95                         | 8 of 8 positive           |
| spx    | −0.61 → −0.68                         | 6 of 8 negative           |
| gbpjpy | −0.35 → −0.43                         | mixed                     |
| eurusd | −0.18 → −0.20                         | mixed                     |
| xauusd | +0.12 → +0.14                         | mixed                     |

Across a thirtyfold range of horizons the diagnostic moves by about a tenth,
exactly as the cancellation predicts, and its magnitude orders the assets by how
consistent their observed signs are.

**Corrected by Cycle Audit 4 (CA4-02).** The paragraph above argued from the
mechanism and then guessed at its size, concluding "closer to five tests than to
forty". That was wrong by a factor of about five, and it was wrong in the
dangerous direction.

Measured — 400 independent realisations of eurusd and 200 of btcusd, all eight
horizon z-scores per path:

| Quantity                                        | eurusd | btcusd |
| ----------------------------------------------- | ------ | ------ |
| Mean off-diagonal correlation between horizons  | 0.664  | 0.584  |
| Effective independent horizons (Li–Ji spectral) | 5.29   | 5.89   |
| Variance of z explained by path displacement    | 28-41% | 16-29% |

The horizons correlate at ρ ≈ 0.6, **not** at 1. Path displacement explains only
a third of it; most of the rest comes from a mechanism the original paragraph
never named — a 30-second window and a one-minute window literally **share
increments**, they are nested, not merely summing to the same total.

Across the full design of five independent assets by eight correlated horizons,
the effective number of independent tests is **≈ 26 of 40**, not 5.

**Benjamini–Hochberg over m = 40 is therefore very nearly the correct
correction**, not the large over-correction the original text apologised for. The
family-wise error rate for the observed worst cell is 0.194 — nothing
significant, and the conclusion is unchanged.

**Acting on the withdrawn claim would have manufactured a false positive.** At
m = 5, btcusd 10m (p = 0.0083) crosses 0.05/5 and is _rejected_ — by both BH and
Bonferroni. The phase spent a whole subphase establishing that this cell is path
displacement rather than a leak; quoting "five tests" would have undone that
finding with arithmetic.

### The one pattern that needed settling

`btcusd` came back **positive at all eight horizons**, with edges growing
monotonically from +0.022pp to +0.180pp. Nothing was significant after
correction, but a consistent sign across every expiry on the asset with the
deepest cascade is not something to footnote.

An independent second realisation of the same asset — same configuration,
different stream family, ten simulated years — came back **negative at all
eight**, and the path-bias diagnostic changed sign with it:

| Realisation | Path bias z | Observed edges  | Worst z |
| ----------- | ----------- | --------------- | ------- |
| Primary     | +0.78→+0.95 | 8 of 8 positive | +2.64   |
| Replication | −0.59→−0.71 | 8 of 8 negative | −0.99   |

It was path displacement, not a directional leak. This is the reading ADR-0003
predicts and the mirror test independently confirms — btcusd mirrors exactly,
with zero divergences — but the replication is what turns an argument into
evidence.

### What this instrument does not do

It conditions on **nothing**. There are no features, no buckets, no learned
family — that is the price of a sample size the battery cannot reach.

**A clean result here is not stronger evidence than a clean battery verdict.** A
leak that needs conditioning to see will not appear in this table at any sample
size. The two instruments answer different questions, and this one answers the
narrower question much harder.

### Known limitations

- ~~The path-bias diagnostic's magnitude runs between 0.8× and 3.3× the observed
  z.~~ **Withdrawn by Cycle Audit 4.** That compared single draws against a
  quantity with a residual standard deviation of 0.82 — reading noise as bias.
  Measured properly, the regression slope of observed z on `pathBiasZ` is
  **1.04 ± 0.07** (eurusd) and 0.87–0.94 (btcusd): the projection predicts
  magnitude correctly, and the derivation is exact rather than first-order.
- The prose above says the expected excess of up-windows is `D · E|X| / σ²`. That
  is `ups − downs`; the excess over `n/2` is half it. The code is self-consistent;
  the sentence is loose by a factor of two.
- `btcusd` ran twelve years and the others ten. The asymmetry is recorded rather
  than smoothed: btcusd needed the extra history because its measured design
  effect was the highest in the catalogue.
- One realisation per asset, except btcusd. The others' cross-horizon sign
  patterns are consistent with their own path-bias figures, but only btcusd has
  been replicated.
