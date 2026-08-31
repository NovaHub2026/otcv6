# ADR-0005 — A multifractal cascade as the volatility process

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-08-31
Deciders: Autonomous Development Agent (delegated authority, `GOVERNANCE.md` §41, §65)
Phase: PH-3.1
Depends on: [ADR-0003](ADR-0003-conditional-sign-symmetry.md), [ADR-0004](ADR-0004-canonical-price-representation.md)

---

## Context

ADR-0003 puts the entire realism budget in the magnitude and timing process: the
sign is a fair coin, so everything that makes the market look alive has to come
from how large the moves are and when they arrive.

The single most recognisable property of a real market is **volatility clustering
with slow decay** — large moves follow large moves, and the dependence in `|r|`
falls off hyperbolically rather than exponentially, remaining measurable hundreds
of steps out. The realism battery measures exactly that, at lags 1, 50 and 500.

Three further constraints narrow the choice:

1. **Snapshots must stay small.** INV-008 requires the market to survive restarts,
   and the runtime will persist state frequently. A volatility process whose
   state is a long history is a persistence problem.
2. **Any interval length must be handled exactly.** Ticks arrive irregularly, so
   a process that advances by a fixed step would either need sub-stepping or
   would couple volatility to the tick rate — and the tick rate is publicly
   observable.
3. **No component may resample on tick counts.** A component that switched every
   N ticks would phase-lock to activity, which an observer can see.

## Decision

Volatility is a **Markov-switching multifractal**: a product of `K` components,
each resampling at its own rate.

```
volatility(t) = base * prod_{k=1..K} M_k(t)
M_k switches with hazard  gamma_1 * b^(k-1)  per unit time
M_k is drawn from {m0, 2 - m0}, mean 1
```

Defaults: `K = 10`, slowest hazard one per six hours, ratio 2.6 between
successive components, `m0 = 0.6`. That spans roughly six hours down to a few
seconds.

### Why this rather than a sum of OU factors

- **Long memory from a tiny state.** Components switching at geometrically spaced
  rates give `|r|` dependence that decays slowly rather than exponentially — the
  measured values are 0.464 at lag 1 and still 0.066 at lag 500. The entire
  latent state is `K` numbers, so a snapshot is a short array.
- **Genuine multifractality.** Volatility scales differently at different
  horizons, which is what makes a chart look the same kind of alive zoomed in and
  zoomed out. A superposition of a few OU factors approximates this; a cascade
  produces it.
- **Exact discretisation.** A component switches with probability
  `1 - exp(-hazard × interval)`, which is exact for an interval of any length.
  No integration step, no coupling to the tick rate, and irregular arrivals are
  handled without special cases.
- **Unit mean by construction.** Each component has mean 1, so the product does
  too, and base volatility can be calibrated independently of cascade depth. That
  matters for PH-4, where personalities vary depth and level separately.

### Sign-blindness

Every input is `intervalMs` and the component's own randomness. The cascade never
receives a price or a sign — it cannot, because `MagnitudeContext` has no field
for either. The mirror test confirms the consequence: negating the sign stream
leaves every multiplier bit-identical.

## Consequences

**Positive**

- Measured at 15/15 on the realism battery with the cascade as the _only_ source
  of structure — no regimes, no self-exciting arrivals, no jumps yet.
- Excess kurtosis of 145 arises without an explicit fat-tailed distribution: a
  normal variance mixture over a multiplicative cascade is already strongly
  leptokurtic.
- Displacement heterogeneity of 13.7 against a random walk's 3.9, which is what a
  viewer reads as alternating trend and consolidation.

**Negative / accepted costs**

- Two-point multipliers make volatility piecewise constant between switches. At
  the fastest timescale this is invisible; it is a simplification rather than a
  fidelity claim, and a continuous multiplier distribution is available if a
  later measurement demands it.
- The slowest component's timescale bounds how long an asset's apparent character
  persists. Six hours is deliberate: much slower and an asset's volatility level
  would wander over its operational life, which PH-4 will need to control per
  personality.
- `K` components mean `K` random draws per tick for switching. Measured at 0.55M
  ticks per second including dataset construction, which is far above any
  realistic tick rate.

## Alternatives considered

| Alternative                                                  | Why not                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sum of 2–5 Ornstein–Uhlenbeck log-volatility factors         | Approximates long memory rather than producing it, and needs more factors — hence more state — for the same decay profile. Was measured in PH-1 design and worked; the cascade is stronger on the same state budget.                            |
| GARCH-family recursion                                       | The natural formulation updates on _returns_, which is one step from updating on _signed_ returns — and that step is the leverage effect, worth 2.9pp of edge. A formulation whose obvious extension is the defect is the wrong starting point. |
| Constant volatility                                          | Fails realism at 8/15; it is the anti-goal the random-walk control exists to represent.                                                                                                                                                         |
| Continuous multiplier distribution (lognormal per component) | More parameters, no measured benefit yet. Revisit if a realism metric demands it.                                                                                                                                                               |
