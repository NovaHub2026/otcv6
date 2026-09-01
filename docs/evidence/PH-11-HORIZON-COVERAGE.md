# PH-11 — Long-horizon directional coverage

Type: RECORDED EVIDENCE
Date: 2026-09-01 (regenerated after Cycle Audit 004)
Verified by: `tools/sim/src/horizonCoverage.stat.test.ts`, which re-derives every row below

---

## How this document was produced

**Three runs, not one, and each one's command is recorded beside it.** Cycle
Audit 4 (Minor 6) found the previous version headed "Produced by
`npm run evidence:horizons`" while being a hand-assembled composite — btcusd
moved to the end, four assets missing their run time, and a hand-added
parenthetical the tool cannot emit. Nothing in the suite could tell which numbers
came from the tool.

The runs are separate because `btcusd` needs more history: its first pass put the
15-minute cell at 0.2545pp against the 0.2513pp threshold, a 1.3% shortfall, and
"close" is not "policed".

## What this is

The directional verdict at **every expiration the product sells**, for every
asset, at the sensitivity each run actually achieved.

At the 99% promotional payout a trader breaks even at a 50.2513% win rate, so an
edge is worth exploiting at **0.2513 percentage points**. A verdict of "no edge"
means nothing unless the test could have seen an edge that size. Until PH-11 only
the 30-second horizon had ever been policed to that threshold (B-002).

**All forty asset/horizon cells are policed below it.**

## How to read the columns

- **Decided** — non-overlapping windows that settled a direction. Windows tile
  the timeline; they do not slide, because overlapping windows share increments
  and would be dependent by construction.
- **z** — deviation from a fair coin at the **effective** sample size, carrying
  the measured design effect rather than assuming independence.
- **Path bias z** — how strongly this path's terminal displacement biases every
  horizon in the same direction. Non-overlapping window returns telescope: at
  every horizon they sum to the same number, so a displaced path looks like a
  consistent edge at every expiry.
- **Design effect** — variance across 100 contiguous segments over what
  independence predicts. See the limitation below: it is blind to a component
  shared by _every_ segment.
- **Floor** — the minimum detectable effect achieved, carrying the design effect.

---

## Run 1 — the catalogue

`npm run evidence:horizons` — ten simulated years per asset, 100 contiguous
segments, one continuous market history each.

eurusd: 225,106,647 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -332,241 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,449,429 | 0.50011 | +0.0108   | 0.63  | -0.18       | 1.24 ±14%     | 0.0482     | yes     |
| 1m      | 5,232,849  | 0.50014 | +0.0139   | 0.64  | -0.19       | 0.94 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,235  | 0.50019 | +0.0189   | 0.57  | -0.19       | 1.16 ±14%     | 0.0934     | yes     |
| 3m      | 1,747,058  | 0.49976 | -0.0243   | -0.64 | -0.19       | 0.88 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,610  | 0.50011 | +0.0108   | 0.23  | -0.20       | 1.13 ±14%     | 0.1301     | yes     |
| 5m      | 1,048,638  | 0.49975 | -0.0252   | -0.49 | -0.20       | 1.13 ±14%     | 0.1453     | yes     |
| 10m     | 524,558    | 0.49940 | -0.0597   | -0.86 | -0.20       | 1.02 ±14%     | 0.1950     | yes     |
| 15m     | 349,782    | 0.50000 | -0.0003   | -0.00 | -0.20       | 1.08 ±14%     | 0.2457     | yes     |

Run time: 550s.

gbpjpy: 432,936,201 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -1,317,631 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,451,492 | 0.50011 | +0.0107   | 0.69  | -0.35       | 0.81 ±14%     | 0.0433     | yes     |
| 1m      | 5,234,000  | 0.50006 | +0.0058   | 0.26  | -0.36       | 0.83 ±14%     | 0.0612     | yes     |
| 2m      | 2,619,759  | 0.50006 | +0.0058   | 0.19  | -0.37       | 0.88 ±14%     | 0.0865     | yes     |
| 3m      | 1,747,388  | 0.50003 | +0.0030   | 0.08  | -0.38       | 0.90 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,876  | 0.49981 | -0.0191   | -0.44 | -0.38       | 0.84 ±14%     | 0.1223     | yes     |
| 5m      | 1,048,855  | 0.49996 | -0.0042   | -0.08 | -0.39       | 1.05 ±14%     | 0.1403     | yes     |
| 10m     | 524,660    | 0.49958 | -0.0419   | -0.61 | -0.41       | 0.85 ±14%     | 0.1934     | yes     |
| 15m     | 349,832    | 0.50001 | +0.0011   | 0.01  | -0.43       | 0.88 ±14%     | 0.2368     | yes     |

Run time: 980s.

spx: 93,219,558 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement -984,766 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,453,747 | 0.49989 | -0.0114   | -0.72 | -0.61       | 1.05 ±14%     | 0.0445     | yes     |
| 1m      | 5,235,416  | 0.49993 | -0.0067   | -0.31 | -0.62       | 0.94 ±14%     | 0.0612     | yes     |
| 2m      | 2,620,062  | 0.49984 | -0.0163   | -0.51 | -0.63       | 1.05 ±14%     | 0.0887     | yes     |
| 3m      | 1,747,333  | 0.50009 | +0.0087   | 0.23  | -0.64       | 0.99 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,804  | 0.49980 | -0.0204   | -0.46 | -0.64       | 1.05 ±14%     | 0.1251     | yes     |
| 5m      | 1,048,796  | 0.49927 | -0.0732   | -1.32 | -0.65       | 1.28 ±14%     | 0.1550     | yes     |
| 10m     | 524,615    | 0.49972 | -0.0283   | -0.39 | -0.67       | 1.08 ±14%     | 0.2009     | yes     |
| 15m     | 349,821    | 0.49878 | -0.1219   | -1.37 | -0.68       | 1.10 ±14%     | 0.2488     | yes     |

Run time: 109s.

xauusd: 157,667,862 ticks, 3645.8 simulated days (9.99 years), 100 segments, payout threshold 0.2513pp, net displacement 331,209 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 10,444,765 | 0.50009 | +0.0091   | 0.56  | 0.12        | 1.11 ±14%     | 0.0456     | yes     |
| 1m      | 5,232,057  | 0.49997 | -0.0027   | -0.12 | 0.12        | 1.01 ±14%     | 0.0614     | yes     |
| 2m      | 2,619,121  | 0.50028 | +0.0279   | 0.90  | 0.12        | 0.87 ±14%     | 0.0866     | yes     |
| 3m      | 1,746,997  | 0.50009 | +0.0088   | 0.23  | 0.12        | 0.94 ±14%     | 0.1060     | yes     |
| 4m      | 1,310,576  | 0.50006 | +0.0060   | 0.14  | 0.13        | 0.82 ±14%     | 0.1224     | yes     |
| 5m      | 1,048,675  | 0.50001 | +0.0009   | 0.02  | 0.13        | 1.06 ±14%     | 0.1408     | yes     |
| 10m     | 524,576    | 0.49985 | -0.0147   | -0.21 | 0.13        | 1.05 ±14%     | 0.1978     | yes     |
| 15m     | 349,779    | 0.50100 | +0.0999   | 1.16  | 0.14        | 1.04 ±14%     | 0.2417     | yes     |

Run time: 212s.

## Run 2 — btcusd, extended

`node tools/sim/dist/horizonEvidence.js --assets btcusd --windows 420000 --segments 100 --label horizon-evidence`

Twelve simulated years rather than ten, to bring the 15-minute cell below the
threshold rather than near it.

btcusd: 1,106,265,172 ticks, 4375.0 simulated days (11.99 years), 100 segments, payout threshold 0.2513pp, net displacement 3,342,739 steps

| Horizon | Decided    | Up rate | Edge (pp) | z    | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ---- | ----------- | ------------- | ---------- | ------- |
| 30s     | 12,541,568 | 0.50022 | +0.0224   | 1.34 | 0.78        | 1.40 ±14%     | 0.0467     | yes     |
| 1m      | 6,280,455  | 0.50052 | +0.0520   | 2.35 | 0.80        | 1.23 ±14%     | 0.0619     | yes     |
| 2m      | 3,143,608  | 0.50080 | +0.0803   | 2.53 | 0.82        | 1.27 ±14%     | 0.0890     | yes     |
| 3m      | 2,096,637  | 0.50064 | +0.0639   | 1.75 | 0.84        | 1.12 ±14%     | 0.1024     | yes     |
| 4m      | 1,572,980  | 0.50097 | +0.0969   | 2.13 | 0.85        | 1.31 ±14%     | 0.1276     | yes     |
| 5m      | 1,258,654  | 0.50074 | +0.0740   | 1.47 | 0.87        | 1.28 ±14%     | 0.1410     | yes     |
| 10m     | 629,607    | 0.50179 | +0.1794   | 2.64 | 0.92        | 1.17 ±14%     | 0.1907     | yes     |
| 15m     | 419,785    | 0.50121 | +0.1214   | 1.42 | 0.95        | 1.23 ±14%     | 0.2394     | yes     |

Run time: 2657s.

## Run 3 — btcusd, an independent realisation

`node tools/sim/dist/horizonEvidence.js --assets btcusd --windows 420000 --segments 100 --label horizon-replication-b`

**Cycle Audit 4 (Minor 7) found this run recorded only as four numbers in prose**
— no table, no label, no seed — while being the phase's single most load-bearing
result. It is the whole basis for reading btcusd's eight positive horizons as
path displacement rather than a directional leak, and nobody could regenerate it.
The full table is recorded now, with the command above.

btcusd: 1,106,270,394 ticks, 4375.0 simulated days (11.99 years), 100 segments, payout threshold 0.2513pp, net displacement -3,939,187 steps

| Horizon | Decided    | Up rate | Edge (pp) | z     | Path bias z | Design effect | Floor (pp) | Policed |
| ------- | ---------- | ------- | --------- | ----- | ----------- | ------------- | ---------- | ------- |
| 30s     | 12,541,643 | 0.49987 | -0.0130   | -0.91 | -0.91       | 1.02 ±14%     | 0.0399     | yes     |
| 1m      | 6,280,273  | 0.49990 | -0.0105   | -0.52 | -0.93       | 1.03 ±14%     | 0.0567     | yes     |
| 2m      | 3,143,636  | 0.49964 | -0.0356   | -1.26 | -0.96       | 0.98 ±14%     | 0.0790     | yes     |
| 3m      | 2,096,696  | 0.49965 | -0.0345   | -1.00 | -0.98       | 0.94 ±14%     | 0.0967     | yes     |
| 4m      | 1,572,991  | 0.49965 | -0.0350   | -0.88 | -0.99       | 0.96 ±14%     | 0.1117     | yes     |
| 5m      | 1,258,657  | 0.49946 | -0.0538   | -1.16 | -1.01       | 1.08 ±14%     | 0.1296     | yes     |
| 10m     | 629,581    | 0.49938 | -0.0620   | -0.98 | -1.07       | 0.87 ±14%     | 0.1765     | yes     |
| 15m     | 419,798    | 0.49964 | -0.0362   | -0.46 | -1.10       | 1.02 ±14%     | 0.2183     | yes     |

Run time: 1714s.

---

## Result

**Forty of forty cells policed below 0.2513pp.** Worst |z| across the forty is
2.64 (btcusd, 10m); Benjamini–Hochberg at q = 0.05 rejects nothing.

Total across all three runs: **3.12 billion ticks**, 63.9 asset-years. The forty policed cells are runs 1 and 2 alone: **2.0 billion ticks**, 52.0 asset-years, which is the figure every other document carries. (Cycle Audit 5 finding 4: this line previously read 2.5 billion / 62 asset-years, which is neither total. The test that advertises itself as re-deriving this record parses the run headers and the table rows and never touched the summary line.)

## Interpretation

### These are not forty independent tests, and they are not five either

Within one asset the eight horizons come from **one price path**, and
non-overlapping window returns telescope to the same terminal displacement. The
`Path bias z` column measures the resulting common bias, and its flatness is the
evidence — across a thirtyfold range of horizons it moves by about a tenth.

PH-11.2 concluded from that mechanism that the forty cells were "closer to five
tests than to forty". **Cycle Audit 4 measured it and the guess was wrong by a
factor of five.** Over 400 independent realisations, horizons correlate at
ρ ≈ 0.66, not 1; path displacement explains only 30–40% of that, and most of the
rest is nesting — a 30-second window and a one-minute window share increments.

Effective independent tests: **≈ 26 of 40**. Benjamini–Hochberg over 40 is
therefore very nearly the right correction, not the over-correction the previous
version of this document apologised for. Family-wise error rate for the observed
worst cell: 0.194.

**The withdrawn claim was dangerous, not merely wrong.** At m = 5, btcusd 10m
(p = 0.0083) crosses 0.05/5 and is _rejected_ — manufacturing the false positive
that Run 3 exists to rule out.

### The pattern Run 3 settles

btcusd returns **positive at all eight horizons** in Run 2, edges growing from
+0.022pp to +0.179pp. Nothing is significant after correction, but a consistent
sign across every expiry on the asset with the deepest cascade is not something
to footnote.

Run 3 is the same asset, same configuration, an independent stream family:

| Realisation                     | Path bias z   | Observed edges  | Worst z |
| ------------------------------- | ------------- | --------------- | ------- |
| Run 2 (`horizon-evidence`)      | +0.78 → +0.95 | 8 of 8 positive | +2.64   |
| Run 3 (`horizon-replication-b`) | −0.91 → −1.10 | 8 of 8 negative | −1.26   |

All eight flipped, and the diagnostic flipped with them. It is path displacement,
not a directional leak — the reading ADR-0003 predicts and the mirror test
confirms independently.

A null measured over 400 realisations puts P(8-of-8 same sign) at **36%**, rising
to 59% in the highest |pathBiasZ| quartile. btcusd's 0.85 sits at the 90th
percentile of that null. The pattern is unremarkable once the null is known, and
nobody had computed it.

## What this instrument does not do

It conditions on **nothing** — no features, no buckets, no learned family. That is
the price of a sample size the battery cannot reach.

**A clean result here is not stronger evidence than a clean battery verdict.** A
leak needing conditioning to see will not appear in this table at any sample
size. The two instruments answer different questions; this one answers the
narrower question much harder.

## Known limitations

- **The design effect is blind to a run-wide common component.** A component
  shared by every segment is removed by the sample variance by construction: the
  estimator reads 1.000 where the pooled statistic carries 11.6× its assumed
  variance. So segmentation licenses the error bar against dependence at lags
  shorter than a segment and nothing longer — and the invisible mode is the
  path-displacement channel this document's own column measures. That the pooled
  z is honest was established separately, across 400 independent realisations.
- **btcusd ran twelve years and the others ten.** Recorded rather than smoothed:
  it needed the extra history because its measured design effect is the highest
  in the catalogue.
- **Only btcusd has been replicated.** The other four assets' cross-horizon sign
  patterns are consistent with their own path-bias figures, but each rests on one
  realisation.
