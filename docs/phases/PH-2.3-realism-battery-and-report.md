# PH-2.3 — Realism battery and the combined report

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-2.3
Parent phase: PH-2 — Calibrated Adversarial Predictability Laboratory
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Add the other half of the instrument: a realism battery measuring whether the
market behaves like a market at all, and a combined report carrying both
verdicts.

## 2. Problem

The attack battery has a trivial solution. **A market that never moves passes
every attack.** So does a memoryless white-noise walk with constant volatility:
it has no directional edge at any horizon, under any conditioning, and it would
sail through PH-2.2 with a clean verdict.

`PROJECT_INTRODUCTION.md` names both as anti-goals — 31.1 "a simple random walk
with cosmetic candles" and 31.7 "a perfectly memoryless noise generator" — and
§24 states the point directly: the objective is not to force every metric toward
perfect randomness, because some structured dependence is _necessary_ for
plausible behaviour.

Without a realism gate, the cheapest way to pass PH-2 is to build something
worthless. The two batteries are opposing constraints, and only together do they
say anything.

## 3. Scope

### In scope

- **Stylized-fact metrics** over an observer dataset, each with a published
  target range and a rationale:
  - return autocorrelation (near zero);
  - absolute-return autocorrelation and its decay (slow — the signature of
    volatility clustering and long memory);
  - excess kurtosis (fat tails);
  - aggregational gaussianity (kurtosis falls as returns are aggregated);
  - volatility dispersion across windows (regimes exist);
  - displacement heterogeneity (quiet stretches alternate with violent ones);
  - candle morphology diversity (dojis through full bodies, wicks on both sides);
  - tick microstructure (non-degenerate tick sizes, both directions within a bar);
  - same-sign run length (a fair-coin baseline, which real markets also show).
- A `gaussianRandomWalk` fixture added to the PH-1 corpus: the realism **negative
  control**. It has no directional edge whatsoever and must fail realism, which
  is what demonstrates the two batteries are independent.
- `runValidation`: both batteries, one report, one overall verdict.

### Out of scope

- Tuning any target range to a candidate market. The ranges are set from the
  stylized facts of real markets and from the anti-goals, before PH-3 exists.
- Cross-asset differentiation (PH-4).

## 4. Contracts

```ts
export interface RealismMetric {
  readonly name: string;
  readonly description: string;
  /** Why the target range is what it is. */
  readonly rationale: string;
  readonly value: number;
  readonly targetMin: number;
  readonly targetMax: number;
  readonly pass: boolean;
}

export interface RealismReport {
  readonly metrics: readonly RealismMetric[];
  readonly passed: number;
  readonly failed: readonly string[];
  readonly plausible: boolean;
}

export function assessRealism(dataset: ObserverDataset, options?: RealismOptions): RealismReport;

export interface ValidationReport {
  readonly instrument: string;
  readonly ticks: number;
  readonly simulatedDays: number;
  readonly predictability: Verdict;
  readonly realism: RealismReport;
  /** Clean under attack AND plausible as a market. Both are required. */
  readonly acceptable: boolean;
}

export function runValidation(dataset, options?): Promise<ValidationReport>;
```

## 5. Acceptance criteria

| #   | Criterion                                                                           |
| --- | ----------------------------------------------------------------------------------- |
| G1  | Every metric declares a target range and a rationale                                |
| G2  | A Gaussian random walk **fails** realism while passing the attack battery           |
| G3  | A stochastic-volatility process **passes** realism                                  |
| G4  | Metrics are computed from public data only, and are look-ahead free by construction |
| G5  | The combined report requires both verdicts; failing either makes it unacceptable    |
| G6  | The report is machine-readable and a later phase can gate on it                     |
| G7  | Runtime measured                                                                    |

## 6. Verification requirements

- Unit tests for each metric against synthetic series with known properties.
- A seeded statistical suite comparing the random walk against the control.
- `npm run build`, `npm run lint`, `npm run format:check`.

## 7. Dependencies

PH-2.1, PH-2.2.

## 8. Expected result

PH-3 gets a single call that answers both halves of the product question, and
cannot satisfy one by sacrificing the other.

---

## 9. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

### The two batteries are independent constraints

Measured on three million ticks each:

| Engine                         | Attack battery  | Realism                | Acceptable |
| ------------------------------ | --------------- | ---------------------- | ---------- |
| `gaussianRandomWalk`           | **clean**       | **8/15 — implausible** | no         |
| `symmetricControl`             | clean           | **15/15 — plausible**  | **yes**    |
| `leverageEffect` at strength 1 | **exploitable** | 13/15                  | no         |

The random walk passes every attack and fails to be a market. It fails exactly
the seven metrics that separate a market from noise — volatility clustering, long
memory, clustering dominance, decay slowness, kurtosis, displacement
heterogeneity and volatility regime range — while passing the ones that are
integrity requirements, such as return autocorrelation and mean run length.

Without this gate it would be the cheapest way to satisfy PH-2 while building
precisely anti-goal 31.1.

The leverage fixture demonstrates the converse: realism alone is no defence
either. It scores 13/15 on plausibility — the leverage effect is a genuine
stylized fact — and is still worth percentage points of directional edge.

### Acceptance criteria

| #   | Criterion                                     | Evidence                                                                                                                                |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Every metric declares a range and a rationale | asserted for all 15                                                                                                                     |
| G2  | Random walk fails realism, passes attacks     | table above                                                                                                                             |
| G3  | Stochastic volatility passes realism          | 15/15                                                                                                                                   |
| G4  | Metrics use public data only                  | computed from the observer dataset; no look-ahead is possible because every metric is a whole-sample statistic, not a per-entry feature |
| G5  | Combined report requires both                 | `acceptable` asserted equal to the conjunction                                                                                          |
| G6  | Machine-readable                              | `ValidationReport` carries both verdicts, metadata and per-metric values                                                                |
| G7  | Runtime measured                              | ~6s for a full validation of 3M ticks                                                                                                   |

Metrics were additionally shown to respond to injected structure: persistent
signs trip both `return-autocorrelation-lag1` and `mean-run-length`; a fixed tick
size trips `tick-size-dispersion`; a market that barely moves trips
`unchanged-tick-fraction`.

### Verification executed

`npm run format:check`, `npm run lint`, `npm run build`, `npx vitest run` — all
passed. Hosted CI has not executed: no remote.

### A correction made during this subphase

The Gaussian random walk initially returned an **exploitable** verdict: one
finding out of 564, at p = 6.7e-5, from a provably symmetric process. That is not
a bug in the battery — Benjamini–Hochberg controls the false discovery rate at q,
so a clean market yields a spurious finding on roughly one run in twenty.

But a gate that fires on one healthy run in twenty is a gate the project learns
to ignore. A **held-out confirmation split** was added: a finding is exploitable
only if it also reproduces, with the same sign and its own significance, on a
later quarter of the data that took no part in fitting or in the correction. A
real leak reproduces; a false discovery does not.

The false positive disappeared and every planted fixture remained caught. The
cost is that a quarter of the data no longer contributes to the primary estimate,
which pushed the 30-second detection floor from 0.224pp back to 0.293pp — so the
calibration run was enlarged from four million ticks to seven, restoring it to
0.222pp. Sensitivity is part of the answer, and it was not going to be traded
away to keep a test convenient.
