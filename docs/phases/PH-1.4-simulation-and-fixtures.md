# PH-1.4 — Simulation runner and planted-edge fixture corpus

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-1.4
Parent phase: PH-1 — Deterministic Market Substrate
Status: APPROVED
Created: 2026-08-31
Decisions applied: [ADR-0003](../decisions/ADR-0003-conditional-sign-symmetry.md), [ADR-0004](../decisions/ADR-0004-canonical-price-representation.md)

---

## 1. Objective

Deliver two things PH-2 cannot be built without:

1. an **offline simulation runner** that drives any tick source over a horizon
   and emits ticks and candles reproducibly;
2. a **planted-edge fixture corpus** — a set of generators carrying deliberate,
   tunable directional edges of known character, plus a symmetric control.

## 2. Problem

PH-2 builds the instrument that decides whether the project succeeds. An
instrument that reports "no edge found" is worthless unless it has been shown
capable of reporting the opposite.

This is not a hypothetical concern. While validating the central symmetry claim
during PH-1 design, a quick predictability probe reported an apparently
overwhelming edge — z-scores above 1000 — on a process that is provably
unexploitable. The cause was a look-ahead bug: the forward-return window included
the very tick being conditioned on. The instrument was broken.

It happened to be broken in the direction that produces alarming results. A
battery with the opposite sign of error would have certified a leaking engine as
clean, and nothing downstream would have caught it.

The corpus is the fix: a set of engines whose leaks are known by construction, so
the battery's sensitivity can be measured rather than assumed.

## 3. Scope

New package `@otc/fixtures`, plus `tools/sim`.

### In scope

- `TickSource` — the minimal contract a generator satisfies, added to
  `@otc/core` so the runner, the fixtures and PH-3's real engine all share it.
- **Simulation runner**: drive a `TickSource` for a horizon, fold candles on any
  timeframe, emit NDJSON, and report a summary.
- **Fixture corpus**, each with a strength parameter that scales its edge
  continuously from zero:

  | Fixture                   | Planted defect                                                                               |
  | ------------------------- | -------------------------------------------------------------------------------------------- |
  | `symmetricControl`        | none — the negative control. Sign-blind two-timescale stochastic volatility with heavy tails |
  | `drift`                   | a constant directional drift                                                                 |
  | `leverageEffect`          | volatility responds to the _signed_ return                                                   |
  | `signAutocorrelation`     | signs form a persistent Markov chain                                                         |
  | `displayQuantization`     | fine internal lattice published on a coarse grid                                             |
  | `boundaryTiming`          | direction biased by position within the minute                                               |
  | `levelAnchoredVolatility` | volatility modulated by price modulo a fixed cell                                            |

- A **minimal edge estimator**, used only to demonstrate that each fixture plants
  what it claims and that the control does not.

### Out of scope

- The real attack battery, its power curves, multiple-testing control and
  minimum-detectable-effect analysis. That is PH-2, and this subphase
  deliberately does not attempt it: the point of the corpus is to be the thing
  PH-2 is measured _against_.
- The real market model (PH-3). The control fixture is a stand-in with the right
  symmetry property, not a candidate product.

## 4. Contracts

```ts
// @otc/core
export interface TickSource {
  readonly instrument: InstrumentSpec;
  /** Next tick, or null when the source is exhausted. */
  next(): Tick | null;
}
```

```ts
// @otc/fixtures
export interface FixtureOptions {
  readonly instrument: InstrumentSpec;
  readonly keyring: MasterKeyring;
  readonly env: Environment;
  readonly ticks: number;
  readonly startInstant: EpochMillis;
  readonly meanIntervalMs: number;
  /** 0 plants nothing; larger values plant a larger edge. */
  readonly strength: number;
}

export interface Fixture {
  readonly name: string;
  readonly description: string;
  /** What an attacker would exploit, for reporting. */
  readonly defect: string;
  create(options: FixtureOptions): TickSource;
}

export const FIXTURES: readonly Fixture[];
```

```ts
// tools/sim
runSimulation({ source, timeframes, ticks }): SimulationResult
estimateDirectionalEdge(prices, horizons): EdgeReport
```

### The estimator must not look ahead

The entry at index `i` uses conditioning information from `ticks[0..i-1]` only,
and the outcome is `compare(price[i + H], price[i])`. The tick at the entry index
is part of the outcome, never part of the features. This is the bug that made the
design probe report z > 1000, and it is the one property of the estimator that
is tested directly.

## 5. Fixture requirements

1. **Strength zero must show no edge.** Every fixture at `strength: 0` must be
   free of directional edge, so that the strength parameter isolates the planted
   defect and nothing else. (Originally stated as "statistically
   indistinguishable from `symmetricControl`", which is stronger than necessary
   and false for the leverage fixture: its volatility recursion differs from the
   shared core by design, while remaining exactly symmetric at strength zero.)
2. **Monotonicity.** Measured edge must increase with strength.
3. **Reproducibility.** Same keyring, label and options give an identical stream.
4. **Non-production.** Fixtures are registered under a non-production environment
   and must be structurally unable to contaminate a production stream.

## 6. Acceptance criteria

| #   | Criterion                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `symmetricControl` shows no directional edge at any supported horizon, within the estimator's stated resolution                                                     |
| D2  | Each planted fixture shows a measurable edge at its nominal strength, at the horizon it targets                                                                     |
| D3  | Every fixture at `strength: 0` shows no edge                                                                                                                        |
| D4  | Measured edge increases monotonically with strength for each fixture                                                                                                |
| D5  | The estimator is proven free of look-ahead: on a stream with a known planted edge it recovers it, and on a shuffled-sign version of the same stream it reports none |
| D6  | Every fixture is exactly reproducible from its options                                                                                                              |
| D7  | The runner emits ticks and candles that satisfy the PH-1.3 invariants                                                                                               |
| D8  | Simulation throughput is measured and recorded                                                                                                                      |

## 7. Verification requirements

- Unit tests for the runner, the estimator and fixture reproducibility.
- A seeded statistical suite measuring each fixture's edge at each horizon and at
  several strengths.
- A dedicated look-ahead test for the estimator.
- `npm run build`, `npm run lint`, `npm run format:check`.
- Recorded throughput.

## 8. Dependencies

PH-1.1, PH-1.2, PH-1.3.

## 9. Expected result

PH-2 can begin by pointing its battery at a corpus whose answers are already
known, and publish sensitivity curves instead of assurances.

---

## 10. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

### The headline result

**Three of the six planted defects are invisible to an unconditional estimator.**
Sign autocorrelation, display quantisation and level-anchored volatility all sit
at P(up) = 0.500 overall, and leak heavily under the right conditioning:

| Fixture                   | Unconditional | Conditioned   | Detector                                  |
| ------------------------- | ------------- | ------------- | ----------------------------------------- |
| `signAutocorrelation`     | z = 0.94      | **z = 239.5** | sign of the previous published move       |
| `displayQuantization`     | z = 0.58      | **z = 9.2**   | sign of the previous published move       |
| `levelAnchoredVolatility` | z = 0.96      | **z = −7.6**  | which half of the price cell, at 6M ticks |

A battery built only on unconditional or translation-invariant statistics would
certify all three as clean. This is the calibration result PH-2 must design
against.

### Measured behaviour

| Fixture                   | Silent at strength 0             | Leaks at strength 1                     |
| ------------------------- | -------------------------------- | --------------------------------------- |
| `symmetricControl`        | \|z\| ≤ 1.27 across six horizons | n/a — it is the control                 |
| `drift`                   | \|z\| < 4                        | z = 71.8 at H=300                       |
| `leverageEffect`          | \|z\| < 4                        | z = 15.1 at H=60                        |
| `boundaryTiming`          | \|z\| < 4                        | z = 120.9 at H=60                       |
| `signAutocorrelation`     | \|z\| < 4                        | z = 239.5 at H=1, conditioned           |
| `displayQuantization`     | \|z\| < 4                        | z = 9.2 at H=30, conditioned            |
| `levelAnchoredVolatility` | \|z\| < 4                        | z = −7.6 at H=60, conditioned, 6M ticks |

### Acceptance criteria

| #   | Criterion                          | Evidence                                                                                                                                                                              |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Control shows no edge              | six horizons, \|z\| ≤ 1.27; also clean under both conditioning axes                                                                                                                   |
| D2  | Each fixture leaks at strength 1   | table above                                                                                                                                                                           |
| D3  | Each fixture silent at strength 0  | table above, unconditional and conditioned                                                                                                                                            |
| D4  | Edge increases with strength       | asserted for the three unconditionally-visible fixtures                                                                                                                               |
| D5  | Estimator free of look-ahead       | a strictly-past feature gives \|z\| < 4 on a fair walk; the same estimator with a feature peeking one tick into the outcome window gives \|z\| > 10 and more than 3× the honest value |
| D6  | Fixtures reproducible              | all seven produce identical streams from identical options, and differ across key epochs                                                                                              |
| D7  | Runner satisfies PH-1.3 invariants | candles fold on all eleven timeframes; chunked and synchronous runners produce byte-identical output including candle stitching across chunk boundaries                               |
| D8  | Throughput measured                | 1.19M ticks/s generating; 0.62M ticks/s while folding three timeframes                                                                                                                |

### Verification executed

`npm run format:check`, `npm run lint`, `npm run build`, `npx vitest run` — all
passed. **368 tests across 21 files.** Hosted CI has not executed: no remote.

### Calibration findings recorded for PH-2

1. **Conditioning is not optional.** Half the corpus is undetectable without it.
2. **Level-anchored defects need roughly three times the history** of the others
   to reach the same significance. This is a direct measurement of the data PH-2
   must budget before it may claim such a leak is absent.
3. **A stronger defect is not always easier to detect.** A multiplicative
   level-anchored modulation was measured and was _harder_ to find than an
   additive one: it traps the walk in the low-volatility cells, unbalancing the
   conditioning buckets and collapsing the effective sample size.
4. **Non-overlapping windows.** The estimator defaults to `stride = horizon`.
   Overlapping windows are strongly dependent and inflate significance; a naive
   i.i.d. interval over them is the easiest way to produce a meaningless gate.
