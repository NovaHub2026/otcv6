# The diffusion rate, re-measured

Type: RECORDED EVIDENCE
Produced: 2026-09-01
Runner: `tools/sim/src/dispersionEvidence.ts` — **in the repository**, which the
runners behind the Cycle 6 evidence documents were not (CA6-36)
Command: `node tools/sim/dist/dispersionEvidence.js`
Seed: `dispersion-evidence` (the runner's default; every stream derives from it)

---

## Why this exists

Cycle Audit 6 raised four findings against the number the whole dispersion
budget rests on:

- **CA6-15** — the four-turnover span guard did not bound the fit error to ±30%
  on any asset. The table behind it read a five-seed min–max as a bound.
- **CA6-16** — "the error is variance, not bias" was false at short spans: the
  medians sit below one and climb, so a median asset **overshot its budget by
  about 14%**.
- **CA6-18** — `eurusd`'s recorded rate was measured, independently, as roughly
  29% high, publishing a quarterly spread about 15% wider than the market has.
- **CA6-36** — neither Cycle 6 evidence document's runner exists in the tree, so
  none of their numbers could be re-executed.

## Method

Two measurements per asset, and the difference between them is the whole point.

**Calibrated** — `calibrateAssetAsync` on an unrelated keyring at **5 replicates
of 30 simulated days**, 150 pooled days. Against the longest cascade span in the
catalogue (44 h) that is 82 turnovers, well past the sixteen
`DISPERSION_FIT_TURNOVERS` now requires.

**Realised** — the **real engine**, on its published integer lattice, run 40
times independently for three simulated days after a one-day warm-up, taking the
second moment of the terminal displacement about zero (the process is a
martingale, so the mean _is_ zero) and scaling to a quarter.

## Result

σ of the terminal log return over 90 days.

| Asset  | previously recorded | calibrated (150 d) | realised (40 × 3 d) | cal / recorded | realised / cal |
| ------ | ------------------- | ------------------ | ------------------- | -------------- | -------------- |
| eurusd | 0.04534             | **0.03971**        | 0.03955             | **0.876**      | 0.996          |
| gbpjpy | 0.19317             | **0.19086**        | 0.18324             | 0.988          | 0.960          |
| btcusd | 0.53598             | **0.56001**        | 0.52907             | 1.045          | 0.945          |
| spx    | 0.01460             | **0.01569**        | 0.01833             | 1.075          | 1.168          |
| xauusd | 0.08036             | **0.08518**        | 0.10185             | 1.060          | 1.196          |

The bold column is what the catalogue records now.

## What it says

**CA6-18 is confirmed, and by two independent routes.** `eurusd`'s recorded rate
was 12.4% high in σ. The auditor's own figure, from 4,320 non-overlapping daily
windows of the real engine, was 0.863; this run gives 0.876 from a completely
different estimator. Two measurements that share no code agreeing at 0.87 is not
a coincidence, and the published `dispersion.quarterlyPercent` for EUR/USD was
wrong by that much.

**The single-seed 30-day figures were simply too noisy to record.** Every asset
moved, by −12% to +7.5%. That is the size of error a 30-day pooled span carries,
which is exactly what CA6-15's re-derived table predicts, and it is why the
constant is now sixteen turnovers rather than four.

**Calibration and brute force agree where the brute force has power.** For the
three assets with the most independent volatility epochs in the realised sample —
eurusd, gbpjpy, btcusd — the two estimators agree to within 5.5%. `spx` and
`xauusd` read 17–20% high on the realised side, which is 1.5 standard errors of a
40-sample second moment; nothing here separates that from noise, and it is
reported rather than explained away.

## What this does not settle

Whether a residual per-asset bias exists between the calibration's continuous
proxy and the engine's integer lattice. The auditor computed a genuine
contribution from stochastic rounding — `q²/6` of variance per tick, worth +0.9%
to +2.9% in σ depending on the asset — which is real, small, and in the observed
direction for `btcusd`. Separating it from estimator noise needs more realised
runs than either of us has spent, and no decision currently depends on it.
