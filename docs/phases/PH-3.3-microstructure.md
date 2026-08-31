# PH-3.3 — Microstructure: self-exciting arrivals and duration coupling

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-3.3
Parent phase: PH-3 — Core Generative Market Process Under Continuous Falsification
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Make **when** ticks arrive as alive as how big they are: a self-exciting arrival
process whose rate responds to recent activity, and an amplitude–duration
coupling that decides whether volatility arrives as more ticks or as bigger ones.

## 2. Problem, and a scope correction

The original plan for this subphase was "self-exciting arrivals, heavy tails,
jumps". Measurement changed that.

**Heavy tails and jumps are not the gap.** After PH-3.2 the engine measures
excess kurtosis of **164** against a target ceiling of 200, and real markets at
these sampling rates sit at 3–30. The engine's tails are already at the top of
the plausible band; adding a jump process would push it out. The cascade
produces fat tails as a _consequence_ of multiplicative volatility rather than
needing an explicit heavy-tailed shock, which is the more honest mechanism
anyway — real fat tails come from volatility variation, not from a magic
distribution.

**The actual gap is timing.** `PROJECT_INTRODUCTION.md` §13 requires that "tick
distances and tick timing must vary according to market state" and that price be
able to "accelerate, decelerate, pause". Arrivals are currently Poisson at a
fixed rate: activity does not cluster, bursts do not happen, and quiet periods
are quiet only in magnitude, not in tempo.

One measured signal points at the same place. `two-sided-wick-fraction` sat at
0.3232 against a floor of 0.30 — only just inside. With a fixed five-second
interval a one-minute candle holds about a dozen ticks, and thin intra-bar
structure is exactly what that metric detects. Activity that bursts puts more
ticks inside active bars, which is where wicks come from.

So this subphase builds timing, and records that it deliberately did not build
tails.

## 3. Scope

### In scope

- **Self-exciting arrivals.** A Hawkes-style intensity: each tick excites the
  process in proportion to its magnitude, and the excitation decays. Bursts beget
  bursts; quiet begets quiet.
- **Amplitude–duration coupling.** Magnitude scaled by `(interval / mean)^h`. At
  `h = 0.5` volatility comes from elapsed time and the tick rate is irrelevant to
  it; at `h = 0` volatility comes from events, so activity itself creates
  variance. A genuine personality axis for PH-4, and orthogonal to volatility
  level.
- Stability bounds, so a self-exciting process cannot run away.
- Re-running the mirror test and the full validation.

### Out of scope

- Heavy-tailed shock distributions and jump processes, for the reason above. If a
  later measurement shows the tails are too _thin_ for a particular asset family,
  PH-4 can add them per personality with the kurtosis budget in hand.
- Personality parameterisation (PH-4).

## 4. Contracts

```ts
export interface HawkesConfig {
  readonly baseIntervalMs: number;
  /** Excitation added per unit of magnitude, relative to the typical magnitude. */
  readonly excitation: number;
  /** Decay rate of excitation, per millisecond. */
  readonly decayPerMs: number;
  /** Magnitude treated as typical when scaling excitation. */
  readonly referenceMagnitude: number;
  /** Upper bound on the intensity multiplier, for stability. */
  readonly maxIntensityMultiplier: number;
}

export class HawkesArrivalModel implements ArrivalModel { ... }

export class DurationCouplingModulator implements Modulator {
  constructor(exponent: number, referenceIntervalMs: number);
}
```

Both read only `intervalMs` and `previousMagnitude`. Neither can see a price or a
sign.

## 5. Stability

A self-exciting process with a branching ratio at or above one is explosive. Two
guards:

1. the configured excitation and decay must satisfy `excitation / decay < 1`,
   checked at construction;
2. the intensity multiplier is clamped, so even a pathological magnitude sequence
   cannot drive the interval to zero.

The clamp is a backstop rather than the mechanism — a configuration that relies
on it is misconfigured, and the test suite asserts the unclamped process is
stable over long runs.

## 6. Acceptance criteria

| #   | Criterion                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------- |
| K1  | Arrival intervals cluster: the autocorrelation of inter-arrival times is positive and decays                           |
| K2  | Tick rate responds to magnitude — a burst of large magnitudes shortens subsequent intervals                            |
| K3  | The process is stable over long runs: no runaway, no interval collapse                                                 |
| K4  | Duration coupling scales magnitude by `(interval/mean)^h`, and at `h = 0` has no effect                                |
| K5  | Both components snapshot and restore exactly                                                                           |
| K6  | The **mirror test still passes** with arrivals and coupling active                                                     |
| K7  | The attack battery is still clean — including the temporal families, which is where an activity-driven leak would show |
| K8  | Realism still passes, `two-sided-wick-fraction` improves, and excess kurtosis stays inside the band                    |

## 7. Verification requirements

- Unit tests for intensity response, stability, coupling and snapshots.
- The mirror test with the full stack.
- A seeded statistical suite comparing arrivals on and off.
- `npm run build`, `npm run lint`, `npm run format:check`.

## 8. Dependencies

PH-3.1, PH-3.2.

## 9. Expected result

A market that speeds up and slows down, with intra-bar structure that comes from
activity rather than from a fixed cadence.

---

## 10. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

### Result

All three engine levels are clean under attack and plausible on every realism
metric:

|                 | Cascade only | + regime and structure | + arrivals and coupling |
| --------------- | ------------ | ---------------------- | ----------------------- |
| Predictability  | clean        | clean                  | **clean**               |
| Realism         | 15/15        | 15/15                  | **15/15**               |
| Two-sided wicks | —            | 0.3616                 | **0.6134**              |
| Excess kurtosis | 12.3         | 48.9                   | 68.5                    |

**Two-sided wicks rose from 0.362 to 0.613** — the metric that was sitting just
above its floor is now comfortably clear, which is what the arrivals were built
for. Activity that bursts puts more ticks inside active bars, and wicks come from
price moving both ways within a bar.

### Acceptance criteria

| #   | Criterion                                      | Evidence                                                                                                               |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| K1  | Arrivals cluster                               | intervals shorten measurably after large magnitudes and decay back toward the base rate when nothing happens           |
| K2  | Rate responds to magnitude                     | a constant large-magnitude sequence ticks more than 40% faster than a small-magnitude one at the same base rate        |
| K3  | Stable over long runs                          | 200 000 ticks with the returned interval fed straight back; mean interval matches `base · (1 − n)` and never collapses |
| K4  | Duration coupling                              | exact at `h = 0` (no effect) and `h = 0.5` (square root); monotonic in the interval                                    |
| K5  | Snapshot and restore                           | continuations reproduced exactly                                                                                       |
| K6  | **Mirror test passes with the complete stack** | zero divergences at burn-ins of 800, 15 000, 30 000 and 50 000 ticks                                                   |
| K7  | Attack battery clean                           | worst finding unconfirmed at every level                                                                               |
| K8  | Realism holds, wicks improve, kurtosis in band | 15/15; 0.362 → 0.613; 68.5 against a ceiling of 200                                                                    |

### A parameterisation defect

The first version exposed the raw excitation increment, and the default it
shipped with had a **branching ratio of 21.6** — explosively unstable — without
that being visible anywhere in the numbers. Every test failed at construction,
which is the good outcome, but the configuration would have looked reasonable to
a reader.

The config now states the **branching ratio itself**, so the parameter that
decides stability is the parameter that is written down, and the check on it is
a comparison against 1. The realized mean interval is then a stated consequence:
`baseIntervalMs · (1 − branchingRatio)`.

### A calibration finding about the metric

Excess kurtosis had to be recalibrated twice, and the second time revealed
something about the measurement rather than the model: **sample excess kurtosis
of a heavy-tailed process grows with the sample**. The same configuration
measured 127 on 1.5M ticks and 191 on 4M, because a longer run has more
opportunity to observe the tail.

A parameter that merely fits the band at one sample size will breach it at
another. The cascade's `lowMultiplier` therefore carries deliberate margin —
0.78, giving 68.5 against a ceiling of 200 — leaving room both for longer runs
and for PH-4 personalities to vary tails.

Softening the cascade also _improved_ long memory: `|r|` autocorrelation at lag
500 rose from 0.123 to 0.143, because the product is less dominated by its
extreme states.

### Scope correction, recorded

This subphase was planned as "self-exciting arrivals, heavy tails, jumps" and
delivered arrivals and coupling only. Heavy tails and jumps were dropped because
measurement said they were not the gap: the engine already sat at excess kurtosis
of 164 against a ceiling of 200, and real markets at these sampling rates sit at
3–30. Adding an explicit jump process would have pushed a metric that was already
at the top of its band out of it.

The cascade produces fat tails as a consequence of multiplicative volatility
rather than by drawing from a heavy-tailed distribution, which is also the more
honest mechanism — real fat tails come from volatility variation.

### Verification executed

`npm run format:check`, `npm run lint`, `npm run build`, `npx vitest run` — all
passed. Hosted CI has not executed: no remote.
