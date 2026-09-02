# Architecture — Validation

Type: SUPPORTING DOCUMENTATION (living)
Describes: what exists in `packages/lab/` today

---

## What the laboratory is for

It decides whether the project succeeds. `PROJECT_INTRODUCTION.md` §25 requires
the engine to withstand adversarial attempts to find exploitable directional
patterns in public market data. The laboratory is the adversary, and its verdict
is the evidence.

It is deliberately **not** trusted on the strength of finding nothing. A battery
that reports "no edge found" is worthless until it has been shown capable of
reporting the opposite, which is why the PH-1 planted-edge corpus exists and why
calibration against it is part of the gate.

## Shape

```
ObserverDataset          ticks, instants, canonical prices, OHLC on any timeframe
        │                (no source, no keyring, no cursor, no model state)
        ▼
   FeatureFrame          rolling features precomputed once, in O(n)
        │
        ▼
  AttackFamily[]         four feature kinds; each declares what it conditions on
        │
        ▼
    runBattery           temporal split -> per family x horizon x bucket
        │                -> one Benjamini-Hochberg correction over the whole surface
        ▼
     Verdict             findings, significance, materiality, sensitivity, coverage
```

## The observer boundary

The dataset holds arrays and candles and nothing else. An attack cannot reach
private state because it never receives anything that carries any. The boundary
is structural rather than a rule someone has to remember, and it becomes the
public API contract in PH-7 — so the surface that ships and the surface that was
attacked are provably the same one.

## The feature taxonomy, and why it exists

| Kind                  | Conditions on                           | Example                                            |
| --------------------- | --------------------------------------- | -------------------------------------------------- |
| translation-invariant | price _differences_                     | previous move, volatility state, candle morphology |
| temporal              | wall-clock phase                        | second of minute, phase within a 15-minute grid    |
| level-anchored        | the absolute price                      | price modulo a swept cell width                    |
| learned               | a fitted model over engineered features | regularised logistic regression                    |

The taxonomy is not bookkeeping. **A conventional battery — translation-invariant
and temporal families, which is everything a normal validation suite contains —
certifies a demonstrably exploitable engine as clean.**

Measured directly, against PH-1's `levelAnchoredVolatility` fixture at six
million ticks (`npx vitest run --project statistical
packages/lab/src/attacks/calibration.stat.test.ts`, 2026-09-02, after the
out-of-band audit's fixes; the previous figures — 11 / 354 clean, 20 / 570
exploitable — were PH-2.2's and had not been refreshed as families were added,
a4-09):

| Battery                          | Families | Hypotheses | Verdict         | Worst                          |
| -------------------------------- | -------- | ---------- | --------------- | ------------------------------ |
| Conventional (no level-anchored) | 15       | 595        | **clean**       | z = −3.36, `run-length`        |
| Full                             | 24       | 808        | **EXPLOITABLE** | z = −5.36, `price-modulo-4000` |

The swept cell family recovers the fixture's actual 4000-step cell, with the
correct opposite signs either side of the cell centre — volatility troughs sit at
the boundaries, so the median drifts toward whichever is nearer.

A level-anchored mechanism is exactly what a designer reaches for when asked to
make support and resistance feel real. Without a level-anchored family, that
change would ship.

## Discipline the harness enforces

1. **No look-ahead.** A bucket may read only up to the entry index. This is
   audited generically: truncate the dataset after the entry and the bucket must
   not change. A deliberately peeking family is planted in the tests, because a
   check that never fails proves nothing about the checks that pass.
2. **Out-of-sample only.** Families fit thresholds and coefficients on a temporal
   training split and are scored only on the later portion.
3. **One correction over the whole surface.** Benjamini–Hochberg across every
   family × horizon × bucket at once. Correcting per family and then taking the
   worst would reintroduce the multiplicity the correction removes.
4. **Occupancy floor.** A bucket below the floor is reported as skipped, never
   tested — a bucket with a handful of samples cannot support a finding. A
   bucket that received **no entry at all** is counted separately
   (`bucketsNeverVisited`): that is a gap in what was sampled, not a shortage
   of samples, and the out-of-band audit (a4-02) found 46 of the 48 skips on
   the calibration control were gaps described as scarcity.
5. **Nothing is dropped silently.** Skipped families, skipped buckets and bound
   caps all appear in the verdict.
6. **The entry grid sweeps every clock phase.** Clock entries used to sit at
   `t0 + k·H`, so at every horizon that divides a minute `second-of-minute`
   saw one sixth of it. The default stride is now `H + 1 s`: one second is
   coprime, on the one-second lattice, to every grid a temporal family
   conditions on (15 s to 3600 s, all products of 2, 3 and 5), so the entry
   phase visits every residue of every grid, windows stay non-overlapping, and
   the cost is 3.2% of the 30-second sample. `outcomes.test.ts` asserts the
   sweep at every horizon. On the calibration control the occupancy skips went
   from 48 to 2.
7. **The full sample is a hypothesis.** Every conditioning family splits the
   sample; the `unconditional` family tests it whole, one bucket per horizon,
   so a uniform edge — the smallest leak — is tested at the `n` the sensitivity
   figure assumes (a4-01, below).

## Significance is not materiality

A large enough sample makes a 0.02pp bias statistically significant. It is not
exploitable. At the 99% promotional payout an observer needs **0.25pp** to break
even; at the typical 85%, **4.05pp**.

The verdict therefore separates:

- **significant** — survives the FDR correction;
- **material** — clears the profitability threshold at the tightest payout;
- **exploitable** — both. This is what the gate turns on.

## Sensitivity is part of the answer — and there are two of them

"Clean" without a sensitivity is not a result. Every verdict reports, per
horizon, **two** figures, and the distinction is the out-of-band audit's
finding a4-01:

- **The single-test MDE** — `(z_α + z_power)·√(0.25/n)` for one test of the
  whole decided sample at α = 0.05 and 80% power. This is the classical figure,
  the one every earlier document quoted, and **the one the 0.2513pp claim refers
  to**: "the 30-second floor is finer than the product margin" means this
  number is below 0.2513pp.
- **The gate MDE** — the edge at which the largest bucket actually tested at
  the horizon reaches both the first Benjamini–Hochberg rejection over the
  whole surface (`|z| ≥ Φ⁻¹(1 − q/2m)`, about 3.99 over ~800 hypotheses) and the
  confirmation threshold on its held-out split: `max(z_BH·√(0.25/n_bucket),
1.96·√(0.25/n_confirmation))`, a 50%-power point. This is the smallest edge
  the verdict could actually have turned on. It was not computed before the
  audit, and the audit's plant showed why it matters: a coin re-signed at a
  realised 0.23pp at 30 s — "detectable" by the single-test figure — produced no
  significant 30-second hypothesis, because the largest bucket any conditioning
  family offered was about half the sample.

Measured on the calibration control — seven million ticks at a five-second mean
interval, about 1.1 simulated years, 40/35/25 training/evaluation/confirmation
(`npx vitest run --project statistical
packages/lab/src/attacks/calibration.stat.test.ts`, 2026-09-02):

| Horizon | Samples | Single-test MDE | Largest tested bucket (eval / confirmation) | Gate MDE    | Finer than 0.2513pp? (single / gate) |
| ------- | ------- | --------------- | ------------------------------------------- | ----------- | ------------------------------------ |
| 30s     | 385,699 | **0.226pp**     | 385,699 / 275,718                           | **0.323pp** | yes / no                             |
| 1m      | 198,039 | 0.315pp         | 198,039 / 141,516                           | 0.450pp     | no / no                              |
| 2m      | 100,373 | 0.442pp         | 100,373 / 71,643                            | 0.632pp     | no / no                              |
| 3m      | 67,158  | 0.541pp         | 67,158 / 47,991                             | 0.773pp     | no / no                              |
| 4m      | 50,500  | 0.623pp         | 50,500 / 36,083                             | 0.892pp     | no / no                              |
| 5m      | 40,478  | 0.696pp         | 40,478 / 28,915                             | 0.996pp     | no / no                              |
| 10m     | 20,299  | 0.983pp         | 20,299 / 14,491                             | 1.406pp     | no / no                              |
| 15m     | 13,563  | 1.203pp         | 13,563 / 9,672                              | 1.720pp     | no / no                              |

The largest tested bucket is the whole sample because the `unconditional`
family now exists; before it, the gate figure at 30 s would have been about
0.45pp. On the PH-3 acceptance run (24 million ticks, 327 simulated days,
`tools/sim/src/phaseAcceptance.stat.test.ts`, 2026-09-02) the 30-second figures
are **0.221pp** single-test and **0.315pp** gate, and both are asserted there to
three decimals.

**Measured against the leak the figure is quoted for**
(`packages/lab/src/attacks/gateSensitivity.stat.test.ts`, the `biasedCoin`
fixture on the calibration configuration, 2026-09-02): a coin re-signed at a
realised **0.501pp** at 30 s is found at 30 s at the full sample — `unconditional`,
z = 6.04, significant, material, confirmed. At a realised **0.251pp** over the
record (0.234pp on the evaluation split) the unconditional 30-second hypothesis
reads z = 2.90: significant and confirmed, but not material at the tightest
payout, so the gate does not turn on it at 30 s. That plant's verdict is
EXPLOITABLE anyway, because a per-tick bias grows with the horizon — 0.35pp at
1 m through 0.89pp at 5 m, every one exploitable at full `n`. **A leak confined
to 30 seconds at the product margin would not be found by the gate on this
configuration**; the gate's 50%-power point for it is 0.32pp, about 30% above
the margin. That is what the second column says, and it is why the second
column exists.

That table is a **battery** run, and it shows what a short run buys. It is not
the project's coverage claim, and Cycle Audit 4 found this section still stating
the opposite of what PH-11 established.

**Every horizon the product sells is policed to the payout threshold — by the
single-test floor.** All forty asset/horizon cells sit below 0.2513pp — 2.0
billion ticks, roughly 52 asset-years, recorded in
[`PH-11-HORIZON-COVERAGE.md`](../evidence/PH-11-HORIZON-COVERAGE.md). B-002 is
closed on that figure. The same distinction as above applies to it: those floors
are one-test, 80%-power figures. The record's own correction is
Benjamini–Hochberg over forty cells, whose first rejection needs `|z| ≥ 3.02`,
so each cell's 50%-power point is 1.08× its quoted floor — 0.265pp for the
coarsest 15-minute cell (eurusd, 0.2457pp) — and its 80%-power point under that
correction 1.38×. The forty cells are policed to the margin at 80% power for one
test each, not at the corrected threshold (a4-01).

The reasoning that made it look prohibitive was half right. The number of
independent samples at a horizon is fixed by simulated _duration_, so 15 minutes
does need roughly a hundred times the history — but the engine produces 730,000
ticks a second, and a simulated year costs about 31 seconds. A hundred times a
cheap thing is still cheap.

The real obstacle was never compute. It was whether the **error bar** survived at
long horizons: PH-10 had just found the lattice tie rate carrying four times its
binomial variance, and applying that lesson uncritically to direction would have
inflated every floor in the project by a factor that is not there. PH-11.1
measured the direction design effect at 1 across all eight horizons, with the tie
rate at 4.62 from the same windows as a control.

The distinction is worth keeping: **a tie's probability tracks the volatility
level, which is autocorrelated over days; a direction's probability is 1/2
regardless of volatility.** One statistic of this market is dependent and the
other is not, and they are computed from the same ticks.

## Cost

A full run — 24 families, 8 horizons, ~800 hypotheses — takes about 11 seconds
on the seven-million-tick calibration control, plus generation. Rolling features are
computed once for the whole dataset and shared by every family and horizon;
recomputing them per family was what previously limited a run to a few hundred
thousand samples, and therefore to a detection floor coarser than the threshold
the battery exists to police.

`runBatteryAsync` yields to the event loop between family-horizon passes, so a
long run does not starve everything else in the process.
