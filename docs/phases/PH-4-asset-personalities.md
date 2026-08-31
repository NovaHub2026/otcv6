# PH-4 — Asset Personality System and Multi-Asset Instantiation

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-4
Status: ACTIVE
Cycle: 2 (phase 1 of 3)
Created: 2026-08-31
Branch: `feature/ph-4-asset-personalities`
Depends on: PH-1 (APPROVED), PH-2 (APPROVED), PH-3 (APPROVED)
Decisions applied: [ADR-0004](../decisions/ADR-0004-canonical-price-representation.md), [ADR-0006](../decisions/ADR-0006-layered-market-model.md)

---

## 1. Objective

Turn one validated market process into a catalogue of assets that feel genuinely
different to trade, without any of them becoming predictable.

PH-3 produced a single instrument with a single parameter set. A trading product
needs many: a user switching from a major currency pair to a crypto asset should
immediately feel a different market — faster, wilder, with different quiet
periods — and not merely a relabelled copy of the same series.

This phase discharges **INV-007 (asset differentiation)**, the only invariant
[`docs/architecture/INVARIANTS.md`](../architecture/INVARIANTS.md) still records
as pending.

## 2. Problem

Differentiation and safety pull against each other, and the tension is real.

The safe move is to give every asset the same parameters, because those
parameters are the ones the PH-3 battery cleared. The product move is to spread
them widely, because assets that differ only in name are a worse product than a
single asset honestly presented.

The danger is not that a personality leaks an edge through the sign — it cannot,
since the sign is drawn from a dedicated stream no magnitude input can observe,
and that argument is indifferent to parameters. The danger is in the two places
where parameters meet the _published_ series:

1. **The lattice.** `logQuantum` is fixed per asset. Too coarse relative to that
   asset's quiet state and the quantisation itself becomes a signal — the
   `displayQuantization` fixture exists precisely because that channel is real
   and the battery detects it at z ≈ −85. The quantum must be set against the
   **first percentile** of the asset's own 30-second volatility distribution,
   not its mean, because volatility is publicly forecastable and an adversary
   simply waits for the quiet state.

2. **Degenerate parameter regions.** A cascade with too little dispersion, a
   regime process that dwells too long, or a Hawkes branching ratio near one
   produce markets that are unrealistic, unstable, or both. PH-3 found the last
   of these the hard way: an exposed excitation parameter meant the default
   branching ratio was 21.6, and the process ran permanently pinned to its clamp
   with nothing failing.

So a personality is not a free choice of numbers. It is a point in a parameter
space that must be _shown_ to be safe, per asset, by the same battery that
cleared PH-3 — and the quantum must be _derived_ from that asset's own simulated
behaviour rather than chosen.

## 3. Expected product value

A user sees a credible asset list. A forex major is orderly and mean-reverting
around its sessions; a crypto asset is fast, fat-tailed and prone to bursts; an
index moves in longer structural swings. Each is recognisable, and each is
provably as unpredictable as the one asset PH-3 validated.

## 4. Scope

- A personality model: the parameter space, its safe bounds, and the mapping from
  a personality to a `MarketEngineConfig`.
- Per-asset `logQuantum` calibration derived from simulation evidence against the
  first percentile of that asset's 30-second volatility.
- An asset registry: the catalogue, its registration procedure, and the evidence
  each registration must carry.
- Multi-asset validation: every registered asset independently passes the
  predictability battery and the realism battery.
- A differentiation metric: assets must be _statistically distinguishable_ from
  one another, so that "genuinely distinct" is measured rather than asserted.

## 5. Exclusions

- Runtime hosting of multiple assets concurrently — PH-5.
- Contracts, settlement or anything economic — PH-6.
- Correlation between assets. Real markets co-move; introducing cross-asset
  dependence is a substantial modelling question and a potential information
  channel between markets. Deliberately deferred, and recorded as such.

## 6. Architectural direction

### 6.1 A personality is data, validated at registration

Personalities are declarative parameter sets, not code. Adding an asset must not
mean writing a new model. The registry holds the parameters and the evidence;
the engine is unchanged.

### 6.2 The quantum is derived, never chosen

Registration runs a simulation, measures the first percentile of 30-second
volatility, and computes the quantum from it. A hand-chosen quantum is the
`displayQuantization` defect waiting to be reintroduced.

### 6.3 Differentiation must be measured

INV-007 is the invariant most easily faked. Two assets whose parameters differ on
paper may be statistically indistinguishable in output. The phase needs a test
that would _fail_ if personalities were secretly identical — the same discipline
the restore tests got in Cycle Audit 001.

### 6.4 Every asset is attacked, not just the family

A battery clearing one asset says nothing about another. Acceptance is per-asset.

## 7. Phase invariants

- INV-007 becomes enforced, with evidence recorded in `INVARIANTS.md`.
- INV-006 continues to hold for **every** registered asset, at the materiality
  threshold implied by the promotional payout.
- The sign boundary is untouched. No personality parameter reaches the sign path.

## 8. Dependencies

PH-3's validated engine and PH-2's calibrated batteries. Both approved.

## 9. Initial decomposition strategy

Provisional, and expected to change as evidence arrives:

- **PH-4.1** — personality model, parameter space and safe bounds.
- **PH-4.2** — asset registry, quantum calibration and the registration procedure.
- **PH-4.3** — multi-asset validation, differentiation metric and phase integration.

## 10. Acceptance intent

The phase is complete when a catalogue of assets exists, every one of them has
passed the predictability and realism batteries on its own evidence, the assets
are demonstrably distinguishable from each other, and INV-007 can be promoted
from pending to enforced without the traceability guardrail complaining.

## 11. Risks and unknowns

| Risk                                                                       | Assessment                                                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A personality region that is realistic but subtly exploitable              | Real. Mitigated by per-asset acceptance rather than family-level acceptance.                                                                 |
| Differentiation that is visible in parameters but not in output            | Real, and the reason §6.3 requires a measured metric with teeth.                                                                             |
| Statistical power: validating N assets costs N times the simulation budget | Real. Expect this to constrain how many assets Cycle 2 registers, and to be stated honestly rather than absorbed by weakening the threshold. |
