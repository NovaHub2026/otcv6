# ADR-0004 — Canonical price representation: an integer log lattice

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-08-31
Deciders: Autonomous Development Agent (delegated authority, `GOVERNANCE.md` §41, §65)
Depends on: [ADR-0003](ADR-0003-conditional-sign-symmetry.md)
Informs: PH-1.3, PH-3, PH-6, PH-7
Supersedes: —

---

## Context

ADR-0003 establishes that `P(up) = P(down)` exactly, provided the magnitude
engine never observes a sign or a price level. Two representation choices can
break that guarantee after the fact, and both are easy to make without noticing.

### Problem 1 — publishing a rounded price re-introduces an edge

The natural implementation carries price internally at high precision and
publishes it rounded to the asset's quote unit. This leaks, badly.

Symmetry holds about the _unrounded_ internal price `P = (n + u)·q`. Rounding to
the nearest quantum makes the published value step up when the displacement
exceeds `(0.5 − u)q` and down when it falls below `−(0.5 + u)q`. For a symmetric
displacement these thresholds are unequal whenever `u ≠ 0`, so
`P(display up) ≠ P(display down)`.

The adversary needs no private state: immediately after the published price steps
up, the internal price sits near the bottom edge of its new cell, so the next
published step is biased downward. _Fade the last displayed quantum._

Simulation of this attack against a symmetric generator, as a function of
`s = σ_horizon / quantum`:

| `σ_h / q` | 1            | 2       | 3       | 5       | 8–10    | ≥15 |
| --------- | ------------ | ------- | ------- | ------- | ------- | --- |
| Edge      | **+22.6 pp** | +8.1 pp | +4.0 pp | +1.3 pp | +0.4 pp | ~0  |

Twenty-two percentage points, from a rounding decision. And it bites hardest at
the **30-second** horizon, where `σ_h` is smallest — the shortest, most-traded
contract.

This is the classic Roll bid-ask-bounce effect arriving through the back door of
a display convention.

### Problem 2 — proportional volatility on a price lattice needs a price-dependent scale

Volatility should be proportional: a 1% move must mean the same thing at 1.05 and
at 1.35. On a lattice of absolute price units that requires multiplying the
magnitude by a function of the current price — and _any_ function of the price
level is a sign-dependent quantity, because the price is the accumulation of
signs.

Attempts to hide this behind a piecewise-constant, privately-jittered "staircase"
in price do not work. The staircase is a fixed function of absolute price that
never moves, so an adversary bins historical ticks by price level and estimates
`E[|Δp| | price bin]`; the profile is piecewise constant with steps of 3–8%, and a
few months of ticks resolve the boundaries at high significance. Worse, it
silently invalidates the mirror test, which can then only pass with an exemption
for the very mechanism that leaks.

## Decision

**The canonical price is an integer count of logarithmic units.**

```
X ∈ ℤ                      canonical state
publishedPrice = exp(δ · X)  δ = the asset's log quantum
```

- Magnitudes are generated **in log units** and **quantised to whole integers
  before the sign is applied**, by unbiased symmetric stochastic rounding.
- `X` is the value the generator accumulates, the value that is published, and
  the value that settles. Settlement compares integers exactly:
  `outcome = sign(X_expiry − X_entry)`.
- Display formatting to a decimal price is a **pure client concern that never
  reaches settlement**.

### Why this resolves both problems at once

**Proportional volatility becomes free.** In log space a fixed step is a fixed
_ratio_, so the same integer magnitude means the same percentage move at every
price. The generator never needs to consult the price level, so the entire
level-dependence attack surface disappears — along with the staircase, its
jitter, and its hysteresis.

**The engine becomes exactly translation-invariant in log-price.** This is the
representational statement of ADR-0003's involution, and it is what makes the
mirror test pass _unconditionally_ rather than with an exemption.

**The rounding channel closes.** Generated, published and settled values are the
same integer, so there is no sub-grid remainder `u` for an adversary to exploit.
Quantising before applying the sign is what makes this exact: rounding a
_magnitude_ is a symmetric operation, whereas rounding a _signed price_ is not.

### The residual constraint: quote granularity

Ties now have positive probability, and their frequency is set by `δ` relative to
volatility. Two obligations follow:

1. **Tie policy.** Per ADR-0003 §3, ties must be void and refunded; awarding them
   to the house is the only way this architecture can leak. Escalated as a
   Protected Human Decision at PH-6.
2. **Granularity gate.** `δ` must be fine enough that ties stay rare and the
   lattice does not itself become a coarse-quantum channel. The constraint must
   be stated at the **first percentile of the asset's simulated volatility
   distribution, not its mean** — volatility in this design varies by five to ten
   times across regimes and is _publicly forecastable_, so an adversary simply
   waits for the quiet state and attacks there. A ratio gate calibrated on
   average volatility is calibrated on a state the attacker will never trade.

   Per-asset `δ` is therefore fixed in PH-4 from simulation evidence at
   registration, not chosen by hand.

## Consequences

**Positive**

- Proportional volatility with zero price-level dependence anywhere.
- The display-rounding edge is structurally impossible, not merely bounded.
- The mirror test becomes exact and total.
- Settlement is exact integer comparison: no floating-point tolerance, no
  ambiguity, trivially reproducible from records (INV-009).
- A contract can never settle "up" while every price the user saw went down,
  because there is only one value.

**Negative / accepted costs**

- Every consumer that wants a decimal price pays an `exp` — which must be the
  portable `exp` from PH-1.2, since a platform `exp` would make the published
  price platform-dependent.
- Ties exist and must be handled as a product rule rather than ignored.
- `δ` becomes a per-asset registration parameter requiring simulation evidence,
  not a constant.
- Very long-lived assets drift `X` away from zero; the range must be checked. At
  `δ = 10⁻⁶` a 64-bit integer covers a price ratio far beyond any realistic
  lifetime, but the bound is explicit rather than assumed.

## Alternatives considered

| Alternative                                                      | Why not                                                                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Float price, published rounded                                   | The 22.6pp rounding attack. Disqualifying.                                                                                                                            |
| Integer lattice in **price** units                               | Forces a price-dependent scale factor for proportional volatility, which is level-anchored and reconstructable, and breaks the mirror test.                           |
| Float price, published at full precision                         | Removes the rounding channel but leaves floating-point accumulation, which is order-dependent and awkward to replay exactly, and still needs a price-dependent scale. |
| Integer price lattice with a fine quantum and no proportionality | Proportional volatility is a realism requirement; a fixed absolute step means a 1% move at one price and 0.3% at another.                                             |
