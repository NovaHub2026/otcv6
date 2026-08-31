# PH-2.1 — Observer dataset, economic edge metric, and statistical core

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-2.1
Parent phase: PH-2 — Calibrated Adversarial Predictability Laboratory
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Build the three foundations every attack in PH-2.2 will stand on:

1. the **observer dataset** — the exact boundary of what an attacker may see;
2. the **economic edge metric** — results expressed against the payout
   breakeven, in the units the business decides on;
3. the **statistical core** — dependence-aware significance, multiple-testing
   control, and a computed minimum detectable effect.

## 2. Problem

### Horizons are wall-clock, not tick counts

The PH-1 estimator measured edge over a fixed number of _ticks_. The product does
not sell that. A contract opened at instant `t` expires at `t + 30s`, and the
number of ticks in between is itself random — it is a function of the arrival
process, which is part of what the market model varies.

Measuring in ticks would therefore condition on something the product never
fixes, and would miss any leak that lives in the relationship between activity
and elapsed time. Every horizon in this phase is a duration in milliseconds:
30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m.

That requires a rule for the price at an instant when no tick falls exactly on
it. The rule used here is **the last tick at or before the instant**:
deterministic, identical for every observer, and reproducible from the record.
PH-6 makes it the canonical settlement policy; the lab adopts it now so that what
is attacked and what will settle are the same quantity.

### Significance under dependence

Overlapping windows are strongly dependent. Treating them as independent inflates
significance and is the easiest way to produce a green gate that means nothing.
Every reported result must come either from non-overlapping windows or from a
block-bootstrap variance estimate that accounts for the dependence.

### "No edge" is not a result

A verdict of "no edge found" is only meaningful with a sensitivity attached.
Certifying `|edge| < 0.05pp` at 3σ needs on the order of 10⁷ independent samples
per horizon; at the 15-minute horizon that is roughly 285 simulated years. The
battery must therefore report the **minimum detectable effect it actually
achieved**, and the achieved value must be computed from the sample count rather
than asserted.

## 3. Scope

New package `@otc/lab`, plus one addition to `@otc/core`.

### In scope

- `priceAtOrBefore` in `@otc/core` — the price in force at an instant. A pure
  query over the canonical stream, needed by the lab now and by settlement later.
- `ObserverDataset` and its builder: ticks, instants, canonical prices and OHLC
  on every timeframe, and nothing else.
- Binary horizons as durations, and outcome sampling at those horizons with a
  configurable, honestly-reported stride.
- Payout economics: breakeven win rate, expected value per trade, and edge
  expressed in percentage points.
- Statistics: normal CDF and quantile, two-sided binomial test, Benjamini–Hochberg
  FDR control, moving-block bootstrap, and minimum detectable effect.

### Out of scope

- Attack families and the verdict (PH-2.2).
- Realism metrics (PH-2.3).

## 4. Contracts

```ts
// @otc/core
export function priceAtOrBefore(
  instants: Float64Array,
  prices: Int32Array,
  instant: EpochMillis,
): { price: LogPrice; index: number } | null;
```

```ts
// @otc/lab
export interface PublicInstrument {
  readonly id: string;
  readonly family: AssetFamily;
  readonly logQuantum: number; // the quote grid is public
  readonly displayPrecision: number;
  readonly referencePrice: number;
}

export interface ObserverDataset {
  readonly instrument: PublicInstrument;
  readonly tickCount: number;
  readonly prices: Int32Array;
  readonly instants: Float64Array;
  readonly firstInstant: EpochMillis;
  readonly lastInstant: EpochMillis;
  candles(timeframe: TimeframeId): readonly Candle[];
  priceAt(instant: EpochMillis): { price: LogPrice; index: number } | null;
}

export const BINARY_HORIZONS: readonly HorizonSpec[]; // 30s .. 15m

export interface OutcomeSample {
  readonly entryIndex: number;
  readonly entryInstant: EpochMillis;
  readonly entryPrice: LogPrice;
  readonly expiryPrice: LogPrice;
  readonly outcome: -1 | 0 | 1; // 0 is a tie
}

export function sampleOutcomes(
  dataset: ObserverDataset,
  horizonMs: DurationMillis,
  options?: SamplingOptions,
): OutcomeSampling;
```

The dataset holds arrays and candles. It holds no source, no keyring and no
cursor, so an attack cannot reach private state — it never receives anything that
carries it.

```ts
export function breakevenWinRate(payout: number): number; // 1 / (1 + payout)
export function expectedValuePerTrade(winRate: number, payout: number): number;
export const PAYOUT_TYPICAL = 0.85; // breakeven 0.540540...
export const PAYOUT_PROMOTIONAL = 0.99; // breakeven 0.502512...
```

```ts
export function normalCdf(z: number): number;
export function normalQuantile(p: number): number;
export function binomialProportionTest(successes: number, trials: number, p0?: number): TestResult;
export function benjaminiHochberg(pValues: readonly number[], falseDiscoveryRate: number): BhResult;
export function movingBlockBootstrap(
  values: Float64Array,
  blockSize: number,
  replicates: number,
  stream: RandomStream,
): BootstrapResult;
export function minimumDetectableEffect(trials: number, alpha: number, power: number): number;
```

The bootstrap takes a `RandomStream` rather than using ambient randomness, so a
reported confidence interval is reproducible from the record like everything else.

## 5. Sampling and honesty rules

1. **Default stride is non-overlapping**: consecutive entries are at least one
   horizon apart in time.
2. `SamplingOptions` may request overlap, and the result then carries
   `overlapping: true` and the effective stride. Any consumer computing a naive
   interval on overlapping samples must be able to see that it did.
3. The sampling result always reports how many candidate entries were skipped and
   why — insufficient forward history, or a gap with no tick before the expiry.
   A silent drop is indistinguishable from a clean run.

## 6. Failure behaviour

| Condition                                            | Behaviour             |
| ---------------------------------------------------- | --------------------- |
| Empty dataset, or fewer than two ticks               | `RangeError` at build |
| Instants not strictly increasing                     | `RangeError` at build |
| `horizonMs` not positive                             | `RangeError`          |
| `payout` not in `(0, 100]`                           | `RangeError`          |
| `benjaminiHochberg` given a p-value outside `[0, 1]` | `RangeError`          |
| Bootstrap block size larger than the sample          | `RangeError`          |

## 7. Acceptance criteria

| #   | Criterion                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | `priceAtOrBefore` returns the last tick at or before an instant, and `null` before the first tick; verified against linear search on random datasets         |
| E2  | The observer dataset exposes only public fields, and candles agree with `@otc/core` aggregation                                                              |
| E3  | Outcome sampling uses wall-clock horizons, and entries are non-overlapping by default                                                                        |
| E4  | Sampling reports skipped candidates and the effective stride                                                                                                 |
| E5  | No sample uses information at or after its entry instant                                                                                                     |
| E6  | Breakeven win rates match `1/(1+payout)`: 0.540540… at 85%, 0.502512… at 99%                                                                                 |
| E7  | `normalCdf` and `normalQuantile` agree with published values and invert one another                                                                          |
| E8  | The binomial test recovers known z-scores and p-values                                                                                                       |
| E9  | Benjamini–Hochberg controls the false discovery rate: on pure-noise p-values it rejects at approximately the nominal rate, and it rejects known-true effects |
| E10 | The moving-block bootstrap widens intervals for dependent data relative to the i.i.d. formula, and is reproducible from a stream                             |
| E11 | Minimum detectable effect matches the analytic formula and scales as `1/√n`                                                                                  |

## 8. Verification requirements

- Unit tests for every function, including failure behaviour.
- A property test for `priceAtOrBefore` against a naive implementation.
- A seeded statistical suite for the FDR and bootstrap behaviour.
- `npm run build`, `npm run lint`, `npm run format:check`.

## 9. Dependencies

PH-1 (APPROVED).

## 10. Expected result

PH-2.2 can express an attack as "a feature computed from the past, a horizon, and
a conditioning grid", and get correct, dependence-aware, multiplicity-controlled
significance without restating any of it.

---

## 11. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

| #   | Criterion                               | Evidence                                                                                                                                                       |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | `priceAtOrBefore` correct               | verified against a naive linear search across 5,000 random instants, plus boundaries: before the first tick, exactly on a tick, between ticks, beyond the last |
| E2  | Dataset exposes only public information | candles agree with substrate aggregation on all eleven timeframes; the object carries no source, keyring, cursor or model state                                |
| E3  | Wall-clock horizons                     | two datasets with the same price path at 1s and 100ms tick rates give identical 60-second outcomes — a tick-count horizon would not                            |
| E4  | Skips and caps reported                 | skip counters and `overCap` asserted; `overlapping` flag asserted                                                                                              |
| E5  | No look-ahead                           | the entry index is proven to be the last tick at or before the entry instant, and the expiry index strictly later                                              |
| E6  | Breakeven win rates                     | 0.5405405… at 85%, 0.5025125… at 99%; thresholds 4.05pp and 0.25pp                                                                                             |
| E7  | Normal CDF and quantile                 | seven published values each; monotonicity, symmetry, mutual inversion                                                                                          |
| E8  | Binomial test                           | known z-scores recovered; √n scaling verified                                                                                                                  |
| E9  | FDR control                             | **measured**: 5.27% family rejection rate under the global null against a nominal 5%; 4.51% false discovery proportion with real effects present, at 88% power |
| E10 | Block bootstrap                         | standard error more than 3× the i.i.d. formula on dependent data; reproducible from a stream                                                                   |
| E11 | Minimum detectable effect               | matches the analytic formula exactly; **measured power 79.7% against a nominal 80%**                                                                           |

### Verification executed

`npm run format:check`, `npm run lint`, `npm run build`, `npx vitest run` — all
passed. **465 tests across 27 files.** Hosted CI has not executed: no remote.

### Note on a correction made during implementation

`normalQuantile` originally applied a Halley refinement step on top of Acklam's
approximation. The refinement polishes against `normalCdf`, whose own accuracy is
about 1.2e-7, so it made the result an order of magnitude _worse_ than Acklam's
native 1.15e-9 and pushed `normalQuantile(0.5)` off exact zero. It was removed.
A refinement cannot be more accurate than the function it refines against.
