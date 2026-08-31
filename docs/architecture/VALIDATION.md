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
million ticks:

| Battery                          | Families | Hypotheses | Verdict         | Worst                          |
| -------------------------------- | -------- | ---------- | --------------- | ------------------------------ |
| Conventional (no level-anchored) | 11       | 354        | **clean**       | z = −3.14                      |
| Full                             | 20       | 570        | **EXPLOITABLE** | z = −6.69, `price-modulo-4000` |

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
   tested — a bucket with a handful of samples cannot support a finding.
5. **Nothing is dropped silently.** Skipped families, skipped buckets and bound
   caps all appear in the verdict.

## Significance is not materiality

A large enough sample makes a 0.02pp bias statistically significant. It is not
exploitable. At the 99% promotional payout an observer needs **0.25pp** to break
even; at the typical 85%, **4.05pp**.

The verdict therefore separates:

- **significant** — survives the FDR correction;
- **material** — clears the profitability threshold at the tightest payout;
- **exploitable** — both. This is what the gate turns on.

## Sensitivity is part of the answer

"Clean" without a sensitivity is not a result. Every verdict reports the minimum
detectable effect per horizon, computed from the sample count.

Measured on a four-million-tick control run at a five-second mean tick interval
(about 0.6 simulated years):

| Horizon | Samples | Detection floor | Finer than the 0.25pp threshold? |
| ------- | ------- | --------------- | -------------------------------- |
| 30s     | 390,812 | 0.224pp         | yes                              |
| 1m      | 197,399 | 0.315pp         | no                               |
| 5m      | 39,796  | 0.702pp         | no                               |
| 15m     | 13,300  | 1.215pp         | no                               |

**Only the shortest horizon is currently policed to the promotional-payout
threshold.** The number of independent samples at a horizon is fixed by simulated
_duration_, not by tick count, so the long horizons need proportionally more
simulated time: policing 15m at 0.25pp needs roughly a hundred times the history
of the run above.

This is stated rather than hidden. A clean verdict at 15m today means "no edge
above 1.2 percentage points", which is a real statement and a weak one. Closing
that gap is a matter of buying simulated years, and it is what PH-9's continuous
integrity runs against accumulated production history are for.

## Cost

A full run — 20 families, 8 horizons, ~550 hypotheses — takes about 6 seconds on
4M ticks, plus about 5 seconds to generate the data. Rolling features are
computed once for the whole dataset and shared by every family and horizon;
recomputing them per family was what previously limited a run to a few hundred
thousand samples, and therefore to a detection floor coarser than the threshold
the battery exists to police.

`runBatteryAsync` yields to the event loop between family-horizon passes, so a
long run does not starve everything else in the process.
