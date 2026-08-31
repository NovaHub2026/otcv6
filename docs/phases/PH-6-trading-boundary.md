# PH-6 — Trading Boundary: Contracts, Settlement and Verified Economic Blindness

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-6
Status: APPROVED
Cycle: 2 (phase 3 of 3)
Created: 2026-08-31
Branch: `feature/ph-6-trading`
Depends on: PH-1 … PH-5 (all APPROVED)
Decisions applied: [ADR-0003](../decisions/ADR-0003-conditional-sign-symmetry.md), [ADR-0004](../decisions/ADR-0004-canonical-price-representation.md)

---

## 1. Objective

Let people trade the market, and prove that the market does not know they are
trading it.

## 2. Problem

INV-001 — economic independence — is the invariant the entire architecture was
built to protect, and it is the only one still established **structurally rather
than empirically**. The guardrail scan proves the price path never _names_ a
payout, an exposure or a position. That is a strong argument, and it is not the
same as a demonstration.

Until now the argument has been easy to make because the two halves have never
existed in the same process. There were no positions to leak. PH-6 puts contracts,
stakes and settlement inside the same runtime as the engine, which is the first
moment the invariant can actually be violated by accident.

So the phase closes with the demonstration the structural argument has been
standing in for: **the published tick stream is bit-identical whether or not
anyone trades.** Same key, same genesis, same clock; one run with no contracts,
one run with heavy and deliberately adversarial trading. If a single tick differs,
INV-001 is false and the product's central claim goes with it.

That test is worth more than any amount of review, because it fails on a
mechanism nobody thought of.

### 2.2 Settlement must be reproducible from the record, not from the engine

INV-009 requires a historical outcome to be explainable from records. A
settlement that recomputes by re-running the engine is not reproducible in any
useful sense — it would require the master secret, which nobody outside the
runtime has, and it would make every dispute a matter of trust.

Settlement therefore resolves against the **published tick stream** using the
same `priceAtOrBefore` rule the batteries and the charts already use: the price
in force at an instant is the last tick at or before it. One rule, everywhere.

### 2.3 The tie is not an edge case

`priceAtOrBefore` on an integer lattice means a contract can expire at exactly
the entry price. PH-4.2 did not leave this to chance: every asset's quantum is
calibrated so that **1% of 30-second contracts land exactly at the money**.

What happens to that 1% is a Protected Human Decision, and it is escalated in §12
rather than chosen here. It is not a detail: it changes the effective payout, and
it changes which direction the lattice calibration should be aimed.

## 3. Expected product value

A market people can actually trade, with settlement anyone can recompute from the
published record, and a fairness claim backed by an executed test rather than an
architectural argument.

## 4. Scope

- A contract model: asset, direction, stake, entry instant, horizon, payout.
- Deterministic settlement against the published tick stream.
- The economics already in `@otc/lab` (breakeven, payout thresholds) applied to
  real contracts rather than to sampled outcomes.
- A trading boundary in the runtime: contracts live beside the venue, never
  inside the engine.
- **The economic blindness demonstration** of §2.
- Both at-the-money policies implemented behind one switch, so the Human decision
  changes a configuration value and nothing else.

## 5. Exclusions

- Accounts, balances, authentication, deposits, withdrawals. A contract here
  carries a stake as a number; who owns it is a distribution concern (PH-7) and a
  product concern beyond it.
- Order books, spreads, slippage. This is a binary options venue quoting a single
  canonical price, not an exchange.
- Any frontend — PH-8.

## 6. Architectural direction

### 6.1 Trading is a new package, above the runtime

`@otc/trading` may depend on `@otc/core` and `@otc/runtime`. Nothing may depend
on it. `dependencies.test.ts` enforces the direction, which is what makes the
blindness demonstration meaningful rather than circular: the engine cannot import
what does not exist in its graph.

### 6.2 Settlement reads the record, never the engine

Given a tick history and a contract, settlement is a pure function. No keys, no
latent state, no engine — so anyone holding the published ticks can recompute an
outcome and get the same answer.

### 6.3 The blindness test must be adversarial, not decorative

A demonstration that places ten contracts and finds the ticks unchanged proves
very little. The trading side must do the things a leak would exploit: heavy
one-sided exposure, positions concentrated in one asset, entries timed to the
tick boundary, and stakes that vary with recent price action.

## 7. Phase invariants

- **INV-001** moves from structurally argued to empirically demonstrated.
- INV-009 extends to settlement: an outcome is recomputable from published ticks
  alone.
- INV-006 is untouched and must stay so: the battery still runs clean.

## 8. Dependencies

PH-5's runtime and PH-4's catalogue, both approved.

## 9. Initial decomposition strategy

Provisional:

- **PH-6.1** — contract model and deterministic settlement against the record.
- **PH-6.2** — the trading boundary, the economic blindness demonstration, and
  phase integration.

## 10. Acceptance intent

Contracts settle reproducibly from the published record, and the tick stream is
bit-identical between a quiet market and one under heavy adversarial trading.

## 11. Risks and unknowns

| Risk                                                                          | Assessment                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A shared object between trading and the venue creating a real leak            | The risk the phase exists to close; §6.1 and the §2 test address it.               |
| Settlement that silently depends on engine state rather than the record       | Real. Settlement is written as a pure function over ticks for this reason.         |
| The blindness test being too weak to fail                                     | Real, and the reason §6.3 specifies adversarial behaviour rather than any trading. |
| The at-the-money decision arriving late and invalidating PH-4.2's calibration | Live. Escalated in §12 now rather than at the end of the phase.                    |

## 12. Protected Human Decision — at-the-money settlement policy — **RESOLVED**

**CONTEXT.** Settlement compares the expiration price to the entry price on an
integer lattice, so exact equality is not merely possible but _deliberately
calibrated_: PH-4.2 set every asset's `logQuantum` to the 1% quantile of its own
30-second return distribution, which means about one in a hundred shortest-horizon
contracts expires exactly at the entry price. `GOVERNANCE.md` §5 makes a
settlement rule with material business consequence a Protected Human Decision.

**OPTIONS.**

1. **Refund (push).** The stake is returned. The contract is void.
2. **Loss.** A tie settles as a loss for the trader.
3. **Win.** A tie settles as a win for the trader.

**CONSEQUENCES.**

- Option 1 is payout-neutral. The operator's margin remains exactly the stated
  payout structure, and the fairness claim stays simple to explain: the house
  edge is the payout, and nothing else.
- Option 2 adds roughly **1 percentage point** of operator margin on 30-second
  contracts, on top of the payout. At an 85% payout the breakeven win rate moves
  from 54.05% to about 54.6%. It is a real edge, and it is invisible in the
  advertised numbers — which is precisely the kind of thing this product's whole
  positioning argues against. It would also mean the lattice calibration is aimed
  the wrong way: with ties costing traders, the correct engineering response is a
  _finer_ quantum to minimise them, reversing PH-4.2's rule.
- Option 3 is a ~1pp gift to traders and correspondingly reduces margin. It has
  the same calibration consequence as option 2, in the opposite direction.
- All three are neutral with respect to INV-001 and INV-006. None creates a
  directional edge or tells the engine anything. This is an economics and
  fairness decision, not a safety one.

**RECOMMENDATION.** **Option 1 — refund.** The product's central claim is a
market that is provably not rigged. A silent 1% edge extracted from ties is small
in revenue and expensive in credibility: it is exactly the sort of undisclosed
term that makes a fairness argument sound like marketing. It also keeps PH-4.2's
calibration correct as built, and leaves the tie rate a harmless quantity rather
than a lever anyone is tempted to tune.

**DECIDED — 2026-08-31, Human Owner: Option 1, refund.** Recorded as
[ADR-0007](../decisions/ADR-0007-at-the-money-settlement.md).

The house edge is the payout and nothing else. PH-4.2's calibration stays correct
as built, and the tie rate stops being a lever anyone has an incentive to tune —
which removes a quiet channel between a technical constant and operator revenue.
That channel would never have violated INV-001, since the engine still could not
see it, but it would have coupled the two.

`refund` is the default and the policy the product claims. The alternatives stay
implemented and tested, because a venue operating under different rules is a
configuration change rather than a fork.

---

## 13. Phase approval record

**APPROVED** from executed evidence, 2026-08-31.

### The result the phase existed to produce

**INV-001 is now demonstrated, not argued.** The same market, from the same key
and the same clock schedule, run twice — once quiet, once under heavy adversarial
trading — produces **identical tick streams** on all five catalogue assets.

That is the last of the ten invariants to move from a structural argument to an
executed check, and it is the one the entire architecture was built to protect.

| Subphase | Title                                                | State    |
| -------- | ---------------------------------------------------- | -------- |
| PH-6.1   | Contract model and deterministic settlement          | APPROVED |
| PH-6.2   | The trading boundary and verified economic blindness | APPROVED |

### Phase invariants

- **INV-001** — demonstrated empirically, per asset.
- **INV-009** — extended to settlement: an outcome is recomputable from the
  published ticks alone, with no key, no engine and no latent state.
- **INV-006** — untouched, and the battery still runs clean.

### The Protected Human Decision

The at-the-money settlement policy was escalated at the _start_ of the phase
rather than discovered at the end of it, and decided by the Human Owner:
**refund**, recorded as
[ADR-0007](../decisions/ADR-0007-at-the-money-settlement.md). The house edge is
the payout and nothing else.

That timing mattered. Had it arrived late, PH-4.2's lattice calibration would
have been aimed in the wrong direction — with ties costing traders, the correct
response is a _finer_ quantum to minimise them, reversing the rule as built.

### What the phase learned

**The right test is the one that could embarrass you.** A blindness
demonstration that placed a few contracts and found the ticks unchanged would
have proven almost nothing. What gives this one force is that it does the things
a leak would exploit — one-sided exposure, concentrated on one asset, entries
pinned to tick instants, and stakes scaled by the market's own recent movement so
the operator's risk tracks the state — and _still_ the streams are identical.

**Two measured numbers needed reading rather than reporting.** The realised tie
rate was 0.38%, not the 1% PH-4.2 targeted, because that calibration measured
wall-clock windows whose boundaries fall between ticks and therefore open at a
slightly stale price; tick-anchored entries see a slightly larger move and tie
less often. And a 46.68% win rate over 4,000 _heavily overlapping_ contracts is
well inside one standard error — the effective sample size is a small fraction of
the count. Reporting either as a finding would have been wrong in both
directions.

### Known limitations carried forward

- The demonstration covers a single process. PH-7 separates trading and price
  generation across a network boundary, and the claim must be re-established
  there.
- No accounts, balances or identity. A contract carries a stake as a number.
- `apps/api` does not expose trading. The boundary exists and is proven; wiring
  it to the service belongs with PH-7's distribution semantics.
