# PH-13 — Operator Risk: Variance, Correlated Flow and Capacity

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-13
Status: ACTIVE
Cycle: 5 (phase 1 of 3)
Created: 2026-09-01
Branch: `feature/ph-13-operator-risk`
Depends on: PH-1 … PH-12 (all APPROVED)
Decisions applied: [ADR-0003](../decisions/ADR-0003-conditional-sign-symmetry.md),
[ADR-0007](../decisions/ADR-0007-at-the-money-settlement.md)

---

## 1. Objective

Answer the question a real operator asks first and this project has never
answered: **how much capital does running this venue require, and what
concentration of flow makes ruin likely?**

## 2. Problem

Four cycles established that the operator's expected edge is exactly the payout
margin and nothing else. `P(up) = P(down)` holds exactly under every public
conditioning (ADR-0003); the settlement mirror shows the boundary is blind; the
engine cannot see a position.

**The project has never asked what the distribution around that expectation looks
like.**

`packages/lab/src/economics.ts` computes expectation per trade — breakeven win
rate, expected value, profitability ratio — and stops. There is no venue-level
risk model, no notion of exposure, and no answer to "how much can we lose on a
bad day".

### 2.1 Why the theorem gives no comfort here

This is the one phase where anti-predictability is irrelevant.

A fair coin with a 0.2513pp house edge is a _wonderful_ long-run business and
says nothing about survival. The operator's P&L over `N` **independent**
contracts has mean growing like `N` and standard deviation like `√N`, so ruin
becomes negligible with volume — that is the classic argument, and it is the one
that fails here.

**Contracts are not independent.** Two traders buying CALL on `eurusd` expiring at
the same instant are not two bets. They settle against **the same price
comparison**: one Bernoulli outcome, scaled by the sum of their stakes. A
thousand such traders is still one bet.

So the operator's real exposure is not "number of contracts" but the
**concentration of stake across distinct settlement events**, and the engine's
economic blindness guarantees exactly nothing about that. Blindness is what makes
the market fair; it is also what means the market will not protect the operator
from a crowded book.

### 2.2 The thing that must not happen

Exposure is **economic state**. The moment a venue tracks it, there is a quantity
in the system that correlates with the operator's interest — and INV-001 says
price generation must never observe such a quantity.

Every guardrail the project has for this — the vocabulary scan, the dependency
direction, the tick-identity demonstration — was built assuming the venue had no
economic state to leak. This phase introduces some. **It is the most dangerous
change to INV-001 since the trading boundary itself**, and the phase's real
subject is doing it without weakening the invariant.

## 3. Scope

- An **exposure model**: net position per settlement event, and the operator's
  P&L distribution over a book.
- **Risk of ruin and capacity**: given bankroll and a flow profile, the
  probability of ruin, and the limits that follow.
- **Enforcement**, with INV-001 preserved: a venue that can decline a trade on
  exposure grounds while its price path remains provably unable to see why.

## 4. Exclusions

- Pricing. Payout is fixed by ADR-0007 and the product; this phase measures risk
  at the given payout rather than adjusting price to manage it. **Adjusting
  payout in response to exposure would be the same defect as adjusting price**,
  one layer out — the operator's interest reaching the trader's terms.
- Hedging against an external market. There is no external market.
- Real-money custody, which remains the Human Owner's (§5.1).

## 5. Architectural direction

### 5.1 The settlement event is the unit of risk

Not the contract. Two contracts sharing `(asset, entry instant, expiry instant)`
resolve on one comparison and are perfectly correlated; contracts on different
assets are independent because their streams are cryptographically separate
(ADR-0002).

That gives a clean decomposition — group by settlement event, sum signed
exposure within a group, and the groups are independent — and it means the
**effective number of bets** is a computable quantity rather than a guess.

### 5.2 Exposure lives on the far side of the boundary

`@otc/trading` knows about contracts and settlement. `@otc/engine` must not learn
that exposure exists. The exposure model therefore belongs beside settlement, and
the guardrails that keep economic vocabulary out of the price path must be
extended to cover whatever new vocabulary this phase introduces.

### 5.3 A limit is a refusal, never an adjustment

If exposure is too concentrated the venue **declines the trade**. It does not
move the price, shade the payout, or delay the tick. A refusal is visible to the
trader and auditable; an adjustment is neither, and would be an economic input to
something the product promises is blind.

## 6. Phase invariants

- **INV-001** is the invariant under threat and the phase's real subject. It must
  end demonstrably stronger: the existing tick-identity comparison, plus a new
  demonstration that a venue _enforcing exposure limits_ produces identical ticks
  to one that is not.
- **INV-002** — a refusal must not make the market different for the refused
  trader than for anyone else.

## 7. Initial decomposition strategy

- **PH-13.1** — the exposure model and the operator's P&L distribution.
- **PH-13.2** — risk of ruin, capacity, and the limits that follow.
- **PH-13.3** — enforcement in the venue, with INV-001 re-established against it.

## 8. Acceptance intent

A stated capital requirement for running the catalogue at a given flow profile,
derived rather than asserted; limits that follow from it; and a demonstration
that a venue enforcing those limits generates a bit-identical market to one that
is not.

## 9. Risks and unknowns

| Risk                                                  | Assessment                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exposure state leaks into the price path              | The phase's central risk. Cycle Audit 4 showed a neutrally-named channel defeating the vocabulary scan, so the defence must be behavioural, not lexical. |
| The flow model is invented and the numbers inherit it | Real. A capacity figure is only as good as its assumed flow, and the phase must state the assumption at every result rather than burying it.             |
| Correlation structure is subtler than the grouping    | Traders may cluster across assets and expiries in ways the settlement-event grouping does not capture. Measured, not assumed.                            |
| A limit that never binds                              | A limit calibrated so loosely it never refuses anything is theatre. It must be shown refusing.                                                           |
