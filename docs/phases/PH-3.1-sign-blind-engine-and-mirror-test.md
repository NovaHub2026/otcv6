# PH-3.1 — Sign-blind engine skeleton, volatility cascade, and the mirror test

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-3.1
Parent phase: PH-3 — Core Generative Market Process Under Continuous Falsification
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Build the engine's spine: the sign boundary as a type boundary, a multiplicative
volatility cascade producing clustering and long memory, snapshot and replay, and
the **mirror test** that proves the anti-predictability theorem holds in the code
rather than only on paper.

## 2. Problem

ADR-0003's guarantee has one precondition: the magnitude and timing engine must
never observe a sign, a price, or anything derived from them. That precondition
is easy to state and easy to lose.

The leverage effect is the archetype. It is one of the most robust stylized facts
in real markets, a competent contributor would add it as an improvement, it
leaves the process an exact martingale — and PH-1 measured it at 2.9 percentage
points of directional edge, which is profitable against the promotional payout.
It would arrive as a three-line change and pass review.

Two mechanisms are therefore built before any market behaviour:

1. **A type boundary.** The magnitude engine receives a state object that does not
   contain the price or the sign, so reading one is a compile error rather than
   an oversight.
2. **The mirror test.** Negate the sign stream from a randomised interior
   snapshot; every latent variable must be bit-identical and every increment
   exactly negated. Any mechanism that reads a sign fails it immediately.

The type boundary catches the honest mistake. The mirror test catches the clever
one — a mechanism that reaches a sign indirectly, through the price, through a
level, through a structure derived from either.

## 3. Scope

`packages/engine/src/`.

### In scope

- **Engine state and the sign boundary.** `MagnitudeContext`, carrying only
  sign-blind quantities, and the composition that turns a magnitude and a coin
  into a lattice increment.
- **Volatility cascade.** A Markov-switching multifractal over geometrically
  spaced timescales: volatility is a product of components, each of which
  resamples at its own rate. Chosen because it produces genuine multifractal
  scaling and slowly-decaying `|r|` dependence from a state of a few numbers,
  which matters when snapshots must stay small.
- **Tick generation.** Inter-arrival times and magnitudes, quantised to the
  lattice by unbiased stochastic rounding **before** the sign is applied.
- **Snapshot and replay.** Serialise the latent state and cursors; restore and
  continue identically.
- **The mirror test** as a reusable harness, not a one-off test.
- A first run through the PH-2 validation, recorded.

### Out of scope

- Regimes and structure phases (PH-3.2).
- Self-exciting arrivals, heavy tails, jumps (PH-3.3).
- Calibration to the realism targets (PH-3.4). This subphase is expected to pass
  anti-predictability and to fail some realism metrics, and recording which is
  the point.

## 4. Contracts

```ts
/** Everything the magnitude engine is allowed to see. */
export interface MagnitudeContext {
  /** Elapsed time since the previous tick. */
  readonly intervalMs: number;
  /** Absolute size of the previous increment, in lattice steps. Never signed. */
  readonly previousMagnitude: number;
  /** Wall-clock instant. Permitted: it is not derived from any sign. */
  readonly instant: EpochMillis;
}

export interface MarketEngineConfig {
  readonly instrument: InstrumentSpec;
  readonly cascade: CascadeConfig;
  readonly baseVolatility: number; // log units per tick at cascade unity
  readonly meanIntervalMs: number;
}

export class MarketEngine implements TickSource {
  constructor(config: MarketEngineConfig, streams: EngineStreams, start: EngineStart);
  next(): Tick | null;
  snapshot(): EngineSnapshot;
  static restore(config, streams, snapshot): MarketEngine;
}
```

The engine holds the price. The magnitude engine holds the cascade. They meet at
exactly one line, where a fair coin turns a non-negative magnitude into a signed
lattice step.

### The cascade

```
volatility(t) = baseVolatility * prod_{k=1..K} M_k(t)
```

Each component `M_k` resamples with hazard `gamma_k = gamma_1 * b^(k-1)` per unit
time, drawing from a fixed two-point distribution with unit mean. Slow components
change over hours, fast ones over seconds. The product of many such components is
what produces volatility clustering that decays slowly rather than exponentially.

Resampling is driven by elapsed **time**, never by tick counts: a component that
resampled every N ticks would phase-lock to activity, and activity is something
an observer can see.

## 5. Failure behaviour

| Condition                                             | Behaviour                               |
| ----------------------------------------------------- | --------------------------------------- |
| `K` outside `[1, 24]`, or a non-positive `gamma1`/`b` | `RangeError`                            |
| `baseVolatility` or `meanIntervalMs` non-positive     | `RangeError`                            |
| Snapshot from a different configuration               | `RangeError` on restore                 |
| Cursor beyond the stream's capacity                   | propagates the substrate's `RangeError` |

## 6. Acceptance criteria

| #   | Criterion                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | The magnitude engine's input type contains no price and no sign, and the engine compiles only because of that                                                |
| H2  | **Mirror test**: from randomised interior snapshots, negating the sign stream leaves every latent variable bit-identical and negates every increment exactly |
| H3  | The mirror harness catches a deliberately sign-reading magnitude function                                                                                    |
| H4  | Snapshot and restore reproduce a continuation exactly                                                                                                        |
| H5  | Cascade components resample at rates matching their configured hazards                                                                                       |
| H6  | Volatility clustering is present: `                                                                                                                          | r   | ` autocorrelation is well above zero at lag 1 and still positive at lag 500 |
| H7  | The PH-2 attack battery returns a clean verdict                                                                                                              |
| H8  | The realism result is recorded, including which metrics do not yet pass                                                                                      |
| H9  | Generation throughput is measured                                                                                                                            |

## 7. Verification requirements

- Unit tests for the cascade, the lattice composition, snapshot and restore.
- The mirror harness, with a planted sign-reading engine proving it works.
- A seeded statistical suite: clustering, long memory, and the PH-2 validation.
- `npm run build`, `npm run lint`, `npm run format:check`.

## 8. Dependencies

PH-1, PH-2.

## 9. Expected result

An engine that is already unexploitable, already replayable, and not yet
realistic enough — with the gap measured rather than guessed, so PH-3.2 and
PH-3.3 know exactly what they are for.

---

## 10. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

### The headline result

**The core project hypothesis is demonstrated.** On four million ticks spanning
231 simulated days, the cascade engine is simultaneously:

|                    | Result                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Predictability** | **clean** — 560 hypotheses across all four feature kinds, worst z = 3.08 and unconfirmed |
| **Realism**        | **15/15 metrics pass**                                                                   |

The realism figures:

| Metric                                   | Value      | Target                          |
| ---------------------------------------- | ---------- | ------------------------------- |
| return autocorrelation, lag 1            | 0.0021     | ≤ 0.02                          |
| absolute-return autocorrelation, lag 1   | 0.4638     | ≥ 0.05                          |
| absolute-return autocorrelation, lag 500 | 0.0662     | ≥ 0.01                          |
| volatility clustering dominance          | 217.6      | ≥ 5                             |
| excess kurtosis                          | 145.4      | 1.5 – 200                       |
| aggregational gaussianity                | 0.228      | ≤ 0.85                          |
| displacement heterogeneity               | **13.71**  | ≥ 4.5 (a random walk gives 3.9) |
| volatility regime range                  | 18.2       | ≥ 2                             |
| mean run length                          | **1.9991** | 1.85 – 2.15                     |
| tick-size dispersion                     | 6.33       | ≥ 1.5                           |

A market with slowly-decaying volatility dependence, heavy tails, and quiet
stretches alternating with violent ones — whose sign process is, to four decimal
places, a fair coin.

### The mirror test

Passes on the engine from five different interior burn-in points, with **zero**
divergences: every latent variable bit-identical, every increment exactly
negated.

It was also shown to catch both classes of defect it exists for:

- **the leverage effect**, smuggled in through a back door that hands the
  magnitude model the sign it cannot read from its own context — the single most
  likely defect to reach this codebase, and worth 2.9pp of edge;
- **level-anchored volatility**, keyed to the absolute price — the class PH-2
  proved a conventional attack battery cannot see at all.

Both are caught in milliseconds, with no sampling error and no multiple-testing
correction.

### Acceptance criteria

| #   | Criterion                                                       | Evidence                                                                                                                             |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | The magnitude engine's input type contains no price and no sign | `MagnitudeContext` carries interval, previous _magnitude_, instant and sequence. Reading a sign is a compile error, not an oversight |
| H2  | Mirror test passes from randomised interior snapshots           | zero divergences at burn-ins of 1, 137, 2 500, 9 001 and 40 000 ticks                                                                |
| H3  | The harness catches sign-reading mechanisms                     | both planted defects detected                                                                                                        |
| H4  | Snapshot and restore reproduce a continuation exactly           | a fresh engine restored purely from a snapshot continues identically, repeatably                                                     |
| H5  | Cascade components resample at their configured hazards         | measured against the derived expectation, within 10%                                                                                 |
| H6  | Volatility clustering present with slow decay                   | 0.4638 at lag 1, still 0.0662 at lag 500                                                                                             |
| H7  | Attack battery clean                                            | 560 hypotheses, all four feature kinds                                                                                               |
| H8  | Realism recorded                                                | 15/15, all passing                                                                                                                   |
| H9  | Throughput measured                                             | 0.55M ticks/s including dataset construction                                                                                         |

### Verification executed

`npm run format:check`, `npm run lint`, `npm run build`, `npx vitest run` — all
passed. Hosted CI has not executed: no remote.

### A defect found by writing a test

`snapshot()` originally recorded the models' latent state but not their stream
**cursors** — only the sign and rounding streams were captured. The result was a
snapshot that looked complete and could not actually be restored: the cascade
would resume from its recorded multipliers but from the wrong position in its
random stream.

Writing the round-trip test exposed it. Snapshots now record the position of
every stream the engine holds, including the ones it never draws from itself, and
`restore` seeks all of them and rejects a snapshot that is missing one or names
one the engine does not hold.

### What this leaves for PH-3.2 and PH-3.3

The realism **battery** passes in full, and that is a floor rather than a
ceiling. `PROJECT_INTRODUCTION.md` requires behaviour the current metrics do not
measure:

- **§10 regimes and nested structure** — compression inside a trend, pullbacks,
  microtrends inside a range;
- **§15 emergent market structure** — ranges, breakouts, false breakouts,
  retests;
- **§13 changing microstructure** — tick velocity and tick-size behaviour that
  vary with market state.

One measured signal already points at the gap: `two-sided-wick-fraction` is
0.3232 against a floor of 0.30 — only just inside. With a five-second mean
interval a one-minute candle holds about a dozen ticks, and thin microstructure
is exactly what that metric detects.

A clarification worth recording, because it constrains what PH-3.2 may build:
under ADR-0003 the engine generates **volatility and activity regimes**;
_directional_ regimes cannot be generated states, and exist only as realized
excursions of the walk. The displacement-heterogeneity figure of 13.7 shows those
excursions are abundant — a viewer sees trends because trends happen, not because
the engine decides on one.
