# PH-3 — Core Generative Market Process Under Continuous Falsification

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-3
Status: ACTIVE
Cycle: 1 (phase 3 of 3)
Created: 2026-08-31
Branch: `feature/ph-3-generative-market-process`
Depends on: PH-1 (APPROVED), PH-2 (APPROVED)
Decisions applied: [ADR-0003](../decisions/ADR-0003-conditional-sign-symmetry.md), [ADR-0004](../decisions/ADR-0004-canonical-price-representation.md)

---

## 1. Objective

Build the market.

Everything before this phase was substrate and instrumentation. PH-3 produces the
generative model itself — latent state, volatility cascade, regimes, emergent
structure, tick microstructure — and drives it inside a generate → attack →
diagnose → correct loop against the PH-2 laboratory until one asset
**simultaneously** passes the realism battery and the anti-predictability
verdict.

That conjunction is the core project hypothesis. This phase settles it, and Cycle
Audit 1 lands on the answer.

## 2. Problem

The two requirements look like they contradict each other, and the whole
difficulty of the project is that they nearly do.

A market must show trends, ranges, breakouts, volatility regimes and rich
microstructure. Every one of those is a _dependency through time_, and any
dependency that reaches the sign of a future move is directly tradeable at the
horizons the product sells.

PH-1 and PH-2 established how the tension is resolved rather than negotiated:

- **ADR-0003** — increments are `x_k = s_k · m_k`, with `s_k` a fair coin from its
  own cryptographic stream and `m_k` a magnitude that is _structurally forbidden_
  from observing any sign. Flipping every future sign is then a measure-preserving
  involution, so `P(up) = P(down)` exactly, at every horizon, under every public
  conditioning. Anti-predictability becomes a theorem about the architecture.
- **ADR-0004** — the canonical price is an integer count of log units, so
  proportional volatility is free and the generator never consults the price
  level. The price level is a sign-dependent quantity; consulting it would break
  the theorem.

So the phase has an unusual shape. Anti-predictability is not something to be
tuned toward — it is guaranteed by construction, and the job is to _not lose it_
while building everything else. The realism side is where the actual modelling
work is, and the constraint is severe: **all of it must live in the magnitude and
timing process**.

## 3. Expected product value

- A single asset whose public behaviour is plausible to a chartist and
  unexploitable to an adversary, with executed evidence for both.
- A generative core that PH-4 can give personalities to, and PH-5 can host.
- A settled answer to the question the whole project rests on, arriving exactly
  at the first Human gate.

## 4. Scope

1. **Sign-blind engine core.** `x_k = s_k · m_k` on the integer log lattice, with
   the magnitude and timing engine structurally unable to read a sign or a price.
2. **Volatility cascade.** A multiplicative cascade over geometrically spaced
   timescales, producing volatility clustering and slowly-decaying dependence in
   `|r|` — the signature the realism battery measures at lags 1, 50 and 500.
3. **Macro regime layer.** A continuous-time semi-Markov process over volatility
   levels with heavy-tailed, non-lattice sojourns. Regimes set the _level_ of the
   cascade, never a direction. Non-lattice durations matter: a duration drawn in
   ticks or candles phase-locks to the candle and expiry grids.
4. **Meso structure layer.** Compression and expansion phases whose transition
   hazard depends on elapsed time and on **reflection-invariant** path features —
   path length per unit time, not position. This is what produces ranges,
   breakouts, false breakouts and retests without anchoring anything to a price.
5. **Tick arrival.** A self-exciting arrival process driven by `|x|`, giving
   activity clustering and bursts, with an amplitude–duration coupling that
   decides whether volatility arrives as more ticks or bigger ticks.
6. **Tails.** Heavy-tailed magnitudes with a slowly varying tail index, plus rare
   symmetric jumps.
7. **State, snapshot and replay.** Engine state is small and serialisable;
   replay from a snapshot is exact.
8. **The mirror test**, as the phase's primary structural gate.
9. **Continuous falsification.** Every subphase ends by running the full PH-2
   validation and recording the result.

## 5. Exclusions

- Asset personalities and multiple assets (PH-4). This phase builds one asset and
  one parameter set.
- Runtime, persistence, transport, UI (PH-5 onward).
- Any trading, payout, position or expiration concept. `@otc/engine` may depend
  only on `@otc/core`, and the guardrail suite enforces it.

## 6. Architectural direction

### 6.1 The sign boundary is a type boundary

The magnitude engine must not merely _happen_ not to read signs; it must be
unable to. The engine is therefore split so that the component computing
magnitudes and intervals never receives the price, the increment sign, or
anything derived from them — it receives only its own latent state, magnitude
history, elapsed time and independent randomness.

That makes the theorem's precondition a property of the code's shape rather than
of its author's memory.

### 6.2 The mirror test

The direct structural test of ADR-0003:

1. run the engine long enough for the latent state to be genuinely asymmetric —
   a test starting from a symmetric initial state passes vacuously;
2. snapshot at a **random interior point**;
3. continue two runs from that snapshot, one with the sign stream negated;
4. assert every latent state variable is **bit-identical** between the runs, and
   every increment **exactly negated**;
5. randomise the point over many seeds per run.

Any mechanism that reads a sign, a price level, or anything derived from them
fails this immediately and unambiguously. It is cheap, exact, and it is the gate
a statistical battery cannot replace — the level-anchored fixture in PH-2 showed
that a conventional battery misses precisely this class of defect.

### 6.3 Everything else is the magnitude process

The realism budget is spent entirely on `m_k` and on the timing:
multi-timescale volatility, regimes, compression and expansion phases,
self-exciting arrivals, heavy tails, jumps. PH-1 measured that this is enough: a
sign-blind two-timescale process already reproduces near-zero return
autocorrelation with slowly-decaying `|r|` autocorrelation, excess kurtosis
around 50, and more than double a random walk's displacement heterogeneity.

### 6.4 Structure is time-anchored, never level-anchored

Support, resistance, ranges and breakouts must emerge from volatility compression
and expansion in _time_, and from the recurrence of a random walk — never from a
mechanism keyed to a price level. PH-2 measured what the alternative costs: a
level-anchored volatility field is invisible to every conventional attack family
and yields a material edge.

## 7. Phase invariants

| ID     | Invariant                                                                                       | Enforced by                                                            |
| ------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| PH3-I1 | The magnitude and timing engine never reads a sign, a price, or anything derived from them      | the mirror test, plus the type boundary                                |
| PH3-I2 | Negating the sign stream leaves every latent variable bit-identical and negates every increment | the mirror test                                                        |
| PH3-I3 | Engine state serialises, and replay from a snapshot is exact                                    | replay tests                                                           |
| PH3-I4 | Regime and phase durations are continuous-time and non-lattice                                  | duration tests; a temporal attack family would otherwise find the grid |
| PH3-I5 | `@otc/engine` depends only on `@otc/core`                                                       | guardrail suite                                                        |
| PH3-I6 | No ambient time, no ambient randomness, no non-portable maths                                   | guardrail suite                                                        |
| PH3-I7 | The full PH-2 validation is clean and plausible                                                 | the phase's acceptance                                                 |

## 8. Dependencies

PH-1 for the substrate, PH-2 for the instrument that decides the phase.

## 9. Initial decomposition strategy

| Subphase   | Objective                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| **PH-3.1** | Sign-blind engine skeleton, volatility cascade, snapshot/replay, and the mirror test                    |
| **PH-3.2** | Regime and structure layers: macro semi-Markov volatility regimes and meso compression/expansion phases |
| **PH-3.3** | Microstructure: self-exciting arrivals, heavy tails, jumps, amplitude–duration coupling                 |
| **PH-3.4** | Full validation, calibration to the realism targets, and phase integration                              |

Adaptive. Each subphase ends by running the PH-2 validation and recording the
result, so a regression in either battery is caught by the subphase that caused
it rather than at the end.

## 10. Acceptance intent

PH-3 is complete when, from the repository alone:

1. an engine instance generates a continuous tick stream on the canonical log
   lattice;
2. the **mirror test** passes from randomised interior snapshots, with latent
   state bit-identical and increments exactly negated;
3. engine state snapshots and replays exactly, including across a simulated
   restart seam;
4. the full PH-2 attack battery returns a **clean** verdict, with the achieved
   sensitivity recorded;
5. the realism battery returns **plausible**, with every metric inside its target
   range;
6. the combined validation report says `acceptable: true`;
7. regime and phase duration distributions are shown to be non-lattice;
8. generation throughput is measured and recorded.

## 11. Success criteria

- Phase invariants PH3-I1 … PH3-I7 covered by executed, passing tests.
- `docs/architecture/MARKET_MODEL.md` describes what was built.
- An ADR records the generative model's structure and the reasoning behind each
  mechanism's placement in the magnitude process.
- Full quality gate green.

## 12. Risks and unknowns

| Risk                                                                                        | Assessment                                                                                        | Mitigation                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realism cannot be reached inside the sign-blind constraint                                  | **The central risk.** PH-1's measurements say it can, but on a two-factor model, not the full one | The realism targets were fixed in PH-2 before this phase existed, so they cannot be quietly relaxed. If a metric proves unreachable, that is a finding to escalate with evidence, not a threshold to move |
| A mechanism added for realism quietly reads a sign                                          | High likelihood over the phase's life; that is what the leverage effect _is_                      | The mirror test runs in CI on every change, and fails unambiguously                                                                                                                                       |
| Calibration overfits to the battery                                                         | Real                                                                                              | The realism targets and attack families were fixed beforehand; PH-9 holds back further families for an independent round                                                                                  |
| Long-horizon sensitivity is too coarse to certify                                           | Known and quantified in PH-2                                                                      | Report the achieved floor; do not claim more                                                                                                                                                              |
| The cascade's mixing time exceeds an asset's useful life, so its apparent character wanders | Medium                                                                                            | Bound the slowest timescale and measure stationarity over long runs                                                                                                                                       |
