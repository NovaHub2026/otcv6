# PH-2.2 — Attack families and the verdict

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-2.2
Parent phase: PH-2 — Calibrated Adversarial Predictability Laboratory
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Turn the PH-2.1 foundations into an actual adversary: a registry of attack
families, a harness that runs them over every horizon with correct out-of-sample
discipline and multiplicity control, and a single verdict that a build can be
gated on.

## 2. Problem

Three failure modes have to be designed out, not tested for afterwards.

### 2.1 The feature blind spot

Every conventional attack battery for a synthetic market conditions on
**translation-invariant** features: multi-lag returns, realized volatility,
ranges, candle shapes, run lengths, distance from a moving average, time of day.
Not one of those is a proxy for _absolute price modulo a cell width_.

PH-1 measured the consequence. The `levelAnchoredVolatility` fixture sits at
P(up) = 0.500 unconditionally and at z = −7.6 once conditioned on which half of
its price cell the market is in. A battery without a level-anchored family
certifies it clean.

The registry therefore classifies every family by **feature kind**, and a test
asserts that all four kinds are represented. "What does this battery not
condition on?" must be answerable by reading the registry.

### 2.2 In-sample fitting

An attack that fits its bucket thresholds — volatility terciles, price deciles, a
swept cell width, a model's coefficients — on the same history it then evaluates
is reporting an in-sample result. With hundreds of bins and a free choice of
threshold, that manufactures findings from noise.

Every family is therefore fitted on a **temporal training split** and evaluated
only on the later portion. Nothing chosen after seeing the evaluation data may
influence a reported number.

### 2.3 Significance is not materiality

A large enough sample makes a 0.02pp bias statistically significant. It is not
exploitable: at the 99% promotional payout an observer needs 0.25pp to break
even, and 4.05pp at the typical 85%.

The verdict must therefore separate **significant** (survives FDR correction)
from **material** (clears the profitability threshold) and gate on the
intersection — while reporting the minimum detectable effect, so a clean verdict
carries the sensitivity that produced it.

## 3. Scope

### In scope

- `AttackFamily` contract, with declared feature kind and conditioning.
- A registry covering four feature kinds:
  - **translation-invariant**: previous move, recent return sign, run length,
    volatility tercile, candle direction, candle morphology, position in the
    trailing range, efficiency ratio;
  - **temporal**: second of minute, phase within the candle, minute of hour;
  - **level-anchored**: absolute price decile, price modulo a swept grid of
    candidate cell widths, price modulo small multiples of the quote quantum;
  - **learned**: a regularised logistic predictor over engineered features,
    trained in-sample and reported out-of-sample only.
- The harness: temporal split, per-family per-horizon per-bucket evaluation,
  FDR correction across the whole family × horizon × bucket surface, and
  economic assessment of every finding.
- `Verdict`: findings, the significant subset, the material subset, the
  exploitable intersection, coverage, achieved sensitivity, and what was skipped.

### Out of scope

- Realism metrics and the combined report (PH-2.3).
- Restart-seam attacks: a seam is a property of a running engine, not of a
  dataset. PH-5 introduces seams and the family that attacks them.
- Cross-asset attacks: PH-4 introduces a second asset.
- Stronger learners. PH-9 runs the independent red-team round with families
  deliberately withheld from all prior tuning, which is only meaningful if some
  are genuinely reserved.

## 4. Contracts

```ts
export type FeatureKind = 'translation-invariant' | 'temporal' | 'level-anchored' | 'learned';

export interface AttackFamily {
  readonly name: string;
  readonly description: string;
  readonly featureKind: FeatureKind;
  /** What the attacker conditions on, in words. Appears in the report. */
  readonly conditioning: string;
  readonly buckets: number;
  /** Fit thresholds or parameters using ONLY prices[0..trainingEndIndex]. */
  fit?(dataset: ObserverDataset, trainingEndIndex: number): void;
  /** Bucket for an entry, reading ONLY prices[0..entryIndex]. -1 skips. */
  bucket(dataset: ObserverDataset, entryIndex: number, entryInstant: EpochMillis): number;
}

export interface AttackFinding {
  readonly family: string;
  readonly featureKind: FeatureKind;
  readonly horizon: string;
  readonly bucket: number;
  readonly samples: number;
  readonly upRate: number;
  readonly edgePoints: number;
  readonly z: number;
  readonly pValue: number;
  readonly significant: boolean; // survives FDR
  readonly material: boolean; // clears the tightest payout threshold
  readonly exploitable: boolean; // both
}

export interface Verdict {
  readonly clean: boolean;
  readonly findings: readonly AttackFinding[];
  readonly exploitable: readonly AttackFinding[];
  readonly worst: AttackFinding | null;
  readonly sensitivity: readonly HorizonSensitivity[];
  readonly coverage: VerdictCoverage;
  readonly skipped: readonly string[];
}

export function runBattery(dataset: ObserverDataset, options?: BatteryOptions): Verdict;
```

## 5. Rules the harness enforces

1. **Out-of-sample only.** `fit` sees `[0, trainingEndIndex]`; evaluation entries
   all fall after it. Default split is 40% training.
2. **No look-ahead.** `bucket` receives the entry index and may read no further.
   A shared test plants a peeking family and asserts the harness's own
   look-ahead check catches it.
3. **Minimum bucket occupancy.** A bucket below the floor is reported as skipped
   rather than tested, so a two-sample bucket cannot become the worst finding.
4. **One correction over the whole surface.** FDR is applied across every
   family × horizon × bucket at once, not per family — correcting per family and
   then taking the worst would reintroduce the multiplicity it removed.
5. **Nothing is dropped silently.** Skipped families, skipped buckets and bound
   caps all appear in the verdict.

## 6. Acceptance criteria

| #   | Criterion                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | The registry covers all four feature kinds, asserted by test                                                                                               |
| F2  | Every family is free of look-ahead, and a deliberately peeking family is caught by the harness                                                             |
| F3  | Every family fits only on the training split; a family that peeks at evaluation data is caught                                                             |
| F4  | The battery returns a clean verdict on the symmetric control                                                                                               |
| F5  | The battery detects every planted fixture at strength 1, naming the family that caught it                                                                  |
| F6  | `levelAnchoredVolatility` is caught by a level-anchored family, and **not** by any translation-invariant one — the blind spot is demonstrated, not assumed |
| F7  | Findings separate significance from materiality, and the gate is their intersection                                                                        |
| F8  | The verdict reports achieved sensitivity per horizon                                                                                                       |
| F9  | Under-occupied buckets are skipped and reported, never tested                                                                                              |
| F10 | Battery runtime is measured and recorded                                                                                                                   |

## 7. Verification requirements

- Unit tests per family for bucket correctness and look-ahead.
- Harness tests for splitting, occupancy, correction and verdict assembly.
- A seeded calibration suite over the PH-1 corpus.
- `npm run build`, `npm run lint`, `npm run format:check`.

## 8. Dependencies

PH-2.1.

## 9. Expected result

PH-2.3 can add realism metrics and a report format without touching how an attack
is defined or scored, and PH-3 can drive its generate → attack → diagnose loop
against `runBattery` from its first commit.

---

## 10. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

### The headline result

**A conventional battery certifies a demonstrably exploitable engine as clean.**

Against PH-1's `levelAnchoredVolatility` fixture at six million ticks:

| Battery                                                | Families | Hypotheses | Verdict         | Worst finding                  |
| ------------------------------------------------------ | -------- | ---------- | --------------- | ------------------------------ |
| Conventional — translation-invariant and temporal only | 11       | 354        | **clean**       | z = −3.14                      |
| Full — with level-anchored families                    | 20       | 570        | **EXPLOITABLE** | z = −6.69, `price-modulo-4000` |

The swept cell family recovers the fixture's actual 4000-step cell width, with
the correct opposite signs either side of the cell centre. This is the blind spot
demonstrated as an executable proof rather than argued.

### Calibration against the corpus

| Engine                    | Verdict     | Worst finding                      | Exploitable findings by feature kind |
| ------------------------- | ----------- | ---------------------------------- | ------------------------------------ |
| `symmetricControl`        | **clean**   | z = 2.90 (`minute-of-hour`)        | none                                 |
| `drift`                   | EXPLOITABLE | z = 99.08 (`absolute-price-level`) | all four kinds                       |
| `leverageEffect`          | EXPLOITABLE | z = 14.06 (`second-of-minute`)     | all four kinds                       |
| `signAutocorrelation`     | EXPLOITABLE | z = 82.33 (`previous-move`)        | all four kinds                       |
| `displayQuantization`     | EXPLOITABLE | z = −73.14 (`learned-logistic`)    | all four kinds                       |
| `boundaryTiming`          | EXPLOITABLE | z = 173.83 (`second-of-minute`)    | all four kinds                       |
| `levelAnchoredVolatility` | EXPLOITABLE | z = −6.69 (`price-modulo-4000`)    | level-anchored, learned              |

Every defect is caught by a family whose stated purpose matches it.

### Acceptance criteria

| #   | Criterion                                   | Evidence                                                                                                                        |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| F1  | All four feature kinds covered              | registry test; the control verdict asserts all four were exercised                                                              |
| F2  | No family looks ahead                       | generic truncation audit over every family including the learned one, plus a deliberately peeking family that the audit catches |
| F3  | Fitting is confined to the training split   | sample counts asserted consistent with the evaluation span alone                                                                |
| F4  | Clean verdict on the control                | 546 hypotheses, worst z = 2.90, nothing exploitable                                                                             |
| F5  | Every planted fixture detected              | table above                                                                                                                     |
| F6  | The blind spot demonstrated                 | conventional battery clean, full battery exploitable, on the same data                                                          |
| F7  | Significance separated from materiality     | asserted per finding; at a payout of 1.0 the gate reduces to significance, confirming the composition                           |
| F8  | Sensitivity reported per horizon            | 0.224pp at 30s, 1.215pp at 15m, computed from sample counts                                                                     |
| F9  | Under-occupied buckets skipped and reported | asserted, including the degenerate case where the floor excludes everything                                                     |
| F10 | Runtime measured                            | ~6s for a full run over 4M ticks                                                                                                |

### Verification executed

`npm run format:check`, `npm run lint`, `npm run build`, `npx vitest run` — all
passed. **502 tests across 30 files.** Hosted CI has not executed: no remote.

### Two engineering findings worth carrying forward

1. **The battery's cost determined its answer.** Recomputing rolling features per
   family capped a run at a few hundred thousand samples, which is a detection
   floor of about 0.26pp — coarser than the 0.25pp threshold the battery exists
   to police. Precomputing the features once in O(n) took the floor to 0.224pp at
   the same wall-clock budget. Performance here is not an optimisation, it is
   part of correctness.
2. **Only the shortest horizon is currently policed to the promotional-payout
   threshold.** Independent samples at a horizon are fixed by simulated
   _duration_, not tick count, so 15m needs roughly a hundred times the history
   of a run that suffices at 30s. The verdict states this rather than hiding it.
