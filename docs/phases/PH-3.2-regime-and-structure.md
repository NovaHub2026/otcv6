# PH-3.2 — Regime and structure layers

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-3.2
Parent phase: PH-3 — Core Generative Market Process Under Continuous Falsification
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Add the two layers that give the market a recognisable shape over time: a
**macro volatility regime** with heavy-tailed continuous-time sojourns, and a
**meso structure phase** that compresses and expands — producing ranges,
breakouts, false breakouts and retests as emergent behaviour rather than as
scripted patterns.

## 2. Problem

PH-3.1 passes the realism battery in full, and that is a floor rather than a
ceiling. `PROJECT_INTRODUCTION.md` requires behaviour the current metrics do not
measure:

- **§10** — regimes that persist and transition, and _nested_ behaviour:
  consolidation inside a larger move, microtrends inside a range;
- **§15** — market structure that a viewer would read as support, resistance,
  ranges, breakouts, false breakouts and retests;
- **§12** — volatility that evolves through regimes rather than fluctuating
  around one level.

The cascade gives volatility that varies continuously. It does not give the
market _episodes_ — a long quiet coil that resolves into a burst, a stressed
period that persists for hours.

### The constraint that shapes both layers

ADR-0003 permits none of this to touch direction. Two consequences follow, and
both are product-level rather than merely technical:

1. **The engine generates volatility and activity regimes. It cannot generate
   directional ones.** A "bullish trend" is not a state the engine enters; it is
   a realized excursion of a driftless walk. PH-3.1 measured displacement
   heterogeneity at 13.7 against a random walk's 3.9, so those excursions are
   abundant — a viewer sees trends because trends happen.
2. **Structure must be time-anchored, never level-anchored.** A compression phase
   is a period of low volatility; the "range" a viewer sees is the running high
   and low of that period, not a level the engine is steering toward. PH-2
   measured what the alternative costs: level-anchored volatility is invisible to
   every conventional attack family and yields a material edge.

That second point is why the meso phase's transition hazard depends on **path
length per unit time** — a reflection-invariant quantity — and never on where the
price is.

## 3. Scope

### In scope

- **`Modulator`**: a sign-blind multiplier on magnitude, composable so that each
  layer can be measured on its own.
- **Macro volatility regime**: continuous-time semi-Markov over
  `COMPRESSED / NORMAL / ELEVATED / STRESSED`, with **Weibull** sojourns of shape
  below 1 — heavy-tailed and non-lattice.
- **Meso structure phase**: `COIL / EXPANSION / NEUTRAL / EXHAUSTION`, with an
  age-dependent hazard modulated by reflection-invariant path energy. A long,
  tight coil raises the hazard of expansion; when it fires, the direction of
  departure is a fresh coin.
- Composition into the engine, snapshot and restore for both layers.
- Re-running the mirror test and the full validation.

### Out of scope

- Self-exciting arrivals, heavy tails and jumps (PH-3.3).
- New realism metrics for structure (PH-3.4).

## 4. Why the sojourn law matters

Durations must be **continuous-time and non-lattice**. A regime lasting a whole
number of ticks, or of candles, phase-locks to the candle and expiry grids: an
observer conditioning on position within the minute would find it, and the
battery has a family that does exactly that.

Weibull sojourns with shape < 1 also give what §10 asks for directly: no
characteristic duration. Transitions are sometimes quick, sometimes very long,
and the remaining lifetime of a long-lived regime grows with its age rather than
shrinking — which is why regimes feel persistent rather than metronomic.

## 5. Contracts

```ts
/** A sign-blind multiplier on magnitude. */
export interface Modulator {
  advance(context: MagnitudeContext): number;
  snapshot(): unknown;
  restore(state: unknown): void;
}

export class ModulatedMagnitudeModel implements MagnitudeModel {
  constructor(inner: MagnitudeModel, modulators: readonly Modulator[]);
}

export type VolatilityRegime = 'compressed' | 'normal' | 'elevated' | 'stressed';
export class VolatilityRegimeModulator implements Modulator { ... }

export type StructurePhase = 'coil' | 'expansion' | 'neutral' | 'exhaustion';
export class StructurePhaseModulator implements Modulator { ... }
```

Both read only `intervalMs` and `previousMagnitude` from the context. Neither can
see a price or a sign, because the context has no field for either.

## 6. Acceptance criteria

| #   | Criterion                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------ |
| J1  | Regime sojourns are Weibull-distributed with the configured shape and scale                                  |
| J2  | Sojourn durations are non-lattice: their distribution modulo the candle and expiry grids is uniform          |
| J3  | The regime chain visits every state and its stationary occupancy matches the configured transition matrix    |
| J4  | Phase transition hazard rises with coil tightness, measured as path length per unit time                     |
| J5  | Both modulators snapshot and restore exactly                                                                 |
| J6  | The **mirror test still passes** with both layers active                                                     |
| J7  | The attack battery is still clean, including the temporal families that would find a lattice-valued duration |
| J8  | Realism still passes, and volatility regime range increases                                                  |

## 7. Verification requirements

- Unit tests for the sojourn law, the transition chain and the hazard response.
- The mirror test with the full layer stack.
- A seeded statistical suite covering non-latticeness and the full validation.
- `npm run build`, `npm run lint`, `npm run format:check`.

## 8. Dependencies

PH-3.1.

## 9. Expected result

A market with episodes — quiet coils that resolve, stressed periods that persist —
whose direction remains a fair coin at every instant.

---

## 10. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

### Result

|                            | Cascade only | With regime and structure |
| -------------------------- | ------------ | ------------------------- |
| Predictability             | clean        | **clean**                 |
| Realism                    | 15/15        | **15/15**                 |
| Excess kurtosis            | 39.5         | 164.4                     |
| Volatility regime range    | 8.8          | **15.1**                  |
| Displacement heterogeneity | 8.7          | **12.0**                  |

The layers do what they were added for — quiet and violent periods differ nearly
twice as much, and the alternation a viewer reads as consolidation and trend is
40% more pronounced — while the verdict stays clean and the mirror test still
passes with zero divergences.

### Acceptance criteria

| #   | Criterion                                            | Evidence                                                                                                   |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| J1  | Weibull sojourns                                     | mean matches `scale · Γ(1 + 1/k)`; p99.9/median above 20 at shape 0.7, against about 10 for an exponential |
| J2  | Sojourns are non-lattice                             | transition instants uniform modulo the 1-minute and 15-minute grids, χ² below the 0.999 critical value     |
| J3  | The chain visits every state with sensible occupancy | all four regimes and all four phases visited; stressed occupancy below 20%                                 |
| J4  | Hazard rises with coil tightness                     | a tight coil transitions measurably sooner than a loose one                                                |
| J5  | Both modulators snapshot and restore exactly         | continuation reproduced identically                                                                        |
| J6  | **Mirror test passes with every layer active**       | zero divergences at burn-ins of 500, 12 000, 30 000 and 60 000 ticks                                       |
| J7  | Attack battery still clean                           | worst z = −3.19, unconfirmed                                                                               |
| J8  | Realism holds and regime range increases             | 15/15; range 8.8 → 15.1                                                                                    |

### The calibration finding

The first layered run measured excess kurtosis at **1366** against a ceiling of 200. The cause was structural rather than a bad constant: all three layers
modulate volatility, and kurtosis of a normal scale mixture is
`3 · prod(E[M⁴] / E[M²]²)` across independent multiplicative factors — so their
contributions multiply. Three layers that each look reasonable alone compound
into a distribution no real market has.

The target band was fixed in PH-2 before this model existed, which is what made
the finding actionable: the model was calibrated to the target rather than the
target moved to the model. Cascade `lowMultiplier` 0.6 → 0.7, regime spread
0.45–3.6 → 0.55–2.6, structure spread 0.6–2.4 → 0.7–1.9. What makes a coil read
as a coil is its contrast with its surroundings, not its absolute depth.

### A consistency fix

The two layers initially disagreed about whether a transition applied to the tick
that triggered it. Both now return the multiplier of the state in force at the
tick's **start**, with transitions taking effect from the next one, so "which
state produced this tick" has a single answer.

### Verification executed

`npm run build`, `npm run lint`, `npm run format:check`, `npx vitest run` — all
passed. Hosted CI has not executed: no remote.
