# PH-11 — Detection Power Across Every Horizon the Product Sells

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-11
Status: ACTIVE
Cycle: 4 (phase 2 of 3)
Created: 2026-08-31
Branch: `feature/ph-11-detection-power`
Depends on: PH-1 … PH-10 (all APPROVED)
Decisions applied: [ADR-0003](../decisions/ADR-0003-conditional-sign-symmetry.md)

---

## 1. Objective

Police every expiration the product sells to the threshold its payout implies —
or state, per horizon and per asset, exactly what remains unpoliced and why.

## 2. Problem

The product sells 30 seconds to 15 minutes. **Only the 30-second horizon has ever
been policed to the 0.2513 percentage points the 99% promotional payout implies.**
Every other horizon carries a verdict at whatever floor its sample count reached,
which is honest but is not the same as a guarantee.

That is B-002, and it has been open since Cycle Audit 1 with the note that the
15-minute horizon "needs roughly a hundred times the history".

### 2.1 Two facts, measured before planning this phase

**Compute is not the obstacle.** The engine generates **730,638 ticks per second**;
one simulated year of the canonical asset costs about 31 seconds. Reaching
0.2513pp needs ~310,700 decided non-overlapping windows, which at the 15-minute
horizon is 8.9 simulated years — roughly **4.6 minutes of compute**, and one price
path yields non-overlapping windows at every horizon simultaneously.

"A hundred times the history" was true and sounded prohibitive. It is not.

**The i.i.d. floor appears to be the right one for direction.** PH-10 found the
lattice tie rate badly overdispersed relative to a binomial, because a tie's
probability tracks the volatility level and volatility is autocorrelated over
days. It would be natural to assume the same of the direction test, which would
make every detection floor the project quotes optimistic.

Measured over 20 replicates, the design effect — observed variance of the win
rate divided by the binomial prediction — is **1.14 at 30 s** and **1.05 at 5 m**,
against a ±0.32 relative error at that replicate count. Both are consistent
with 1.

That is what ADR-0003 predicts and it is worth stating precisely: `P(up) = 1/2`
**exactly**, under every public conditioning, whatever the volatility. Volatility
clustering changes how _far_ a window moves, never which way. So non-overlapping
direction outcomes are independent fair coins even though almost every other
statistic of this market is not, and `minimumDetectableEffect`'s i.i.d. formula
is sound for the one quantity it is applied to.

This phase must establish that properly rather than on 20 replicates at two
horizons, because every "clean" verdict in the project rests on it.

### 2.2 The obstacle that is real

Memory. A 15-minute horizon at full power needs on the order of 2×10⁸ ticks per
asset, and `ObserverDataset` materialises instants and prices — about 2.4 GB.
The battery cannot be pointed at a run this size.

So the work is not "simulate longer". It is a **streaming** estimator that
accumulates per-horizon tallies as ticks are produced and never holds the path.

## 3. Scope

- A measured design effect, per horizon, at enough replicates to be worth quoting
  — and an honest MDE that carries it.
- A streaming multi-horizon edge estimator that runs to the payout threshold
  without materialising a dataset.
- The long-horizon evidence run, recorded per asset and per horizon.
- **B-003**: `tools/*` brought into coverage measurement.

## 4. Exclusions

- Retuning anything. If a horizon shows an edge, that is the most valuable finding
  the project could produce and it is recorded, not tuned away.
- Replacing the battery. The streaming estimator answers a narrower question at
  far greater sample size; it complements the battery's conditioning power rather
  than superseding it.

## 5. Architectural direction

### 5.1 The estimator streams, and its conditioning is bounded

Anything the estimator conditions on must be computable from a bounded window of
past ticks, because there is no dataset to look back into. That is a real
restriction and it is the price of the sample size.

It is also the honest division of labour: the battery conditions richly on a
tractable amount of history; this conditions cheaply on an intractable amount.
A leak that needs the battery's features to see will not show up here, and the
phase must say so rather than implying the larger number is strictly better
evidence.

### 5.2 The design effect is measured, not assumed, in both directions

A design effect near 1 licenses the i.i.d. floor. The measurement must be capable
of showing otherwise — so it is calibrated against a series that is known to be
overdispersed, exactly as PH-2 calibrated the battery against planted edges. The
lattice tie rate is a ready-made positive control: PH-10 measured it at roughly
four times its binomial variance.

## 6. Phase invariants

- **INV-006** at every horizon the product sells, at a stated floor.
- **INV-005** — expiration selection must not change generation. A phase about
  horizons is exactly where a convenience that conditions generation on the
  horizon would be introduced, so the guardrail matters more here than usual.

## 7. Initial decomposition strategy

- **PH-11.1** — an estimator with valid intervals under dependence: the design
  effect, measured and calibrated against a known-overdispersed control.
- **PH-11.2** — the streaming estimator and the long-horizon evidence run.
- **PH-11.3** — coverage over `tools/`, and phase integration.

## 8. Acceptance intent

A recorded verdict at every horizon from 30 seconds to 15 minutes, for every
asset, each stating the floor it achieved — and, where the payout threshold is
reached, saying so with the sample count that earned it.

## 9. Risks and unknowns

| Risk                                               | Assessment                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The design effect turns out to exceed 1            | Then every floor in the project is optimistic and must be restated. This is the most valuable thing the phase could find, and the reason it goes first. |
| An edge appears at a long horizon                  | Structurally impossible under ADR-0003, which is exactly what was said about the leverage effect. Recorded, not tuned.                                  |
| The streaming estimator's conditioning is too weak | Real. It is a different instrument from the battery, not a better one, and the phase must not let a large clean number imply more than it shows.        |
| Run cost                                           | Measured before planning: ~31 s per simulated year. Five assets to full power at 15 m is around an hour, offline.                                       |
