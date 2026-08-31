# ADR-0006 — A layered sign-blind market model

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-08-31
Deciders: Autonomous Development Agent (delegated authority, `GOVERNANCE.md` §41, §65)
Phase: PH-3
Depends on: [ADR-0003](ADR-0003-conditional-sign-symmetry.md), [ADR-0004](ADR-0004-canonical-price-representation.md), [ADR-0005](ADR-0005-volatility-cascade.md)

---

## Context

ADR-0003 puts the entire realism budget in the magnitude and timing process. The
question this decision answers is how to spend it: what mechanisms produce a
market that a chartist would recognise, given that none of them may touch
direction.

`PROJECT_INTRODUCTION.md` asks for regimes that persist and transition (§10),
market structure that reads as ranges and breakouts (§15), volatility that
evolves rather than fluctuating around a level (§12), and tick behaviour that
varies with market state (§13).

## Decision

Four layers, composed as **multipliers on magnitude**, plus a self-exciting
arrival process.

| Layer             | Mechanism                                                 | Timescale                 | What it produces                                         |
| ----------------- | --------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| Cascade           | Markov-switching multifractal, 10 components              | hours → seconds           | volatility clustering, long memory, fat tails            |
| Volatility regime | continuous-time semi-Markov, Weibull sojourns (shape < 1) | tens of minutes → hours   | episodes: compressed, normal, elevated, stressed         |
| Structure phase   | age- and compression-dependent hazard                     | minutes → tens of minutes | coils that resolve, expansions that fade                 |
| Duration coupling | `(interval / reference)^h`                                | per tick                  | whether volatility arrives as more ticks or bigger ticks |
| Arrivals          | Hawkes-style self-excitation, adaptive reference          | seconds → minutes         | activity clustering, bursts, pauses                      |

### Why multiplicative composition

Each layer can be switched off in configuration, so a realism movement is
attributable to the mechanism that caused it rather than to the ensemble. That
mattered in practice: the regime and structure layers were measured on their own
before arrivals were added, and each addition's effect on every metric is
recorded.

It also has a cost that had to be discovered and managed — see below.

### Why the structure layer is time-anchored

The transition hazard out of a compression phase depends on **path length per
unit time** and on the phase's age. Both are reflection-invariant, so negating
every sign leaves them bit-identical.

The tempting alternative — a volatility field keyed to price levels, giving
literal support and resistance — was measured in PH-2 to be invisible to every
conventional attack family while yielding a material directional edge. It is the
mechanism a designer reaches for when asked to make support and resistance feel
real, and it is the one that must not be built.

### Why arrivals normalise against a running average

Excitation is proportional to the magnitude of the tick that caused it, divided
by a running average of magnitude. The branching ratio is then what the
configuration says, whatever volatility scale the layers above happen to produce.

A fixed reference was tried first. Set to ten lattice steps while the layered
engine produced magnitudes several times larger, the effective branching ratio
exceeded one, the process ran **permanently pinned to its safety clamp**, and the
realized tick rate was three times the configured one. Nothing failed: the
backstop silently became the mechanism.

### Why the configuration states the branching ratio

The parameter that decides whether a self-exciting process is stable is the
parameter the configuration writes down, and the check on it is a comparison
against 1. An earlier version exposed the raw excitation increment, and its
default had a branching ratio of 21.6 — explosively unstable — without that being
visible anywhere in the numbers.

## Consequences

**Positive**

- Measured clean under the full attack battery at a 30-second detection floor of
  0.217pp, finer than the 0.2513pp margin the promotional payout implies.
- Measured 15/15 on the realism battery, whose targets were fixed in PH-2 before
  this model existed.
- The mirror test passes with every layer active, so the anti-predictability
  theorem's precondition is verified in the code and not only argued.
- One factory produces the whole stack, and one configuration object carries
  every parameter PH-4 will vary per personality.

**Negative / accepted costs**

- **Kurtosis multiplies across layers.** Excess kurtosis of a normal scale
  mixture is `3 · prod(E[M⁴] / E[M²]²)` over independent multiplicative factors.
  Three layers that each looked reasonable alone compounded to 1366 against a
  ceiling of 200. Every layer's spread is consequently gentler than it would be
  in isolation, and adding a fifth will require re-checking the product rather
  than only the new layer.
- **Sample kurtosis is sample-size dependent** for heavy tails, so parameters
  carry margin rather than fitting the band at one run length.
- The state is larger than a single-mechanism model's — cascade multipliers, two
  chain states with ages, an excitation and a running average — though still a
  few dozen numbers, so snapshots stay small.
- Five interacting layers make calibration a global problem. The layer-by-layer
  validation harness exists because of that.

## Alternatives considered

| Alternative                                              | Why not                                                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A single richer volatility process                       | Cannot produce episodes with heavy-tailed durations, and cannot separate "volatility level" from "structure phase" — which PH-4 needs as independent personality axes.       |
| Additive composition of layers                           | Layers would not be independently switchable, and a layer could drive volatility to zero or negative.                                                                        |
| Directional regimes                                      | Forbidden by ADR-0003. A generated bullish state that a viewer can see is a state an adversary can infer.                                                                    |
| Level-anchored support and resistance                    | Measured in PH-2 to be invisible to conventional attack batteries and materially exploitable.                                                                                |
| Explicit heavy-tailed shock distribution or jump process | Not needed: the cascade already produces excess kurtosis at the top of the plausible band, and real fat tails come from volatility variation rather than a fat-tailed shock. |
