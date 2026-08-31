# ADR-0007 — At-the-money settlement: a tie is refunded

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-08-31
Deciders: **Human Owner** (Protected Human Decision, `GOVERNANCE.md` §5)
Depends on: [ADR-0004](ADR-0004-canonical-price-representation.md)
Informs: PH-4.2, PH-6, PH-7
Supersedes: —

---

## Context

Settlement compares the expiration price to the entry price on an integer log
lattice, so exact equality is not an edge case. It is a calibrated quantity:
PH-4.2 sets each asset's `logQuantum` to the 1% quantile of its own 30-second
return distribution. Cycle Audit 2 later measured the realised rate on the
published lattice at roughly **one in two hundred** rather than one in a hundred:
calibration compares a continuous return against the quantum, while a tie is an
integer-price event. The decision is unaffected — a refunded tie is economically
neutral at any rate, and the error is in the safe direction — but the figure
below should be read as an upper bound.

`GOVERNANCE.md` §5 makes a settlement rule with material business consequence a
Protected Human Decision. It was escalated in the PH-6 phase document with three
options and a recommendation, and decided by the Human Owner on 2026-08-31.

## Decision

**A contract expiring exactly at the entry price is refunded.** The stake is
returned and the contract is void.

## Consequences

**The house edge is the payout, and nothing else.** This is the property that
made the option worth choosing. The alternative — settling ties as losses — would
have added roughly one percentage point of operator margin on 30-second
contracts, moving the breakeven win rate at an 85% payout from 54.05% to about
54.6%. That is real money and it is invisible in the advertised numbers, which is
precisely the kind of undisclosed term this product's positioning argues against.

**PH-4.2's calibration stays correct as built.** The direction of the quantum
rule depends on this decision. With ties refunded they are harmless, and
calibrating to a 1% tie rate is a reasonable target chosen for lattice
resolution. Had ties settled as losses, the correct engineering response would
have been the opposite — a _finer_ quantum to minimise them — and the rule would
have had to be rewritten.

**The tie rate stops being a lever.** Under a refund policy nobody has an
incentive to tune it, which removes a quiet channel between a calibration
constant and operator revenue. That channel would not have violated INV-001 —
the engine still could not see it — but it would have coupled a technical
parameter to margin, and someone would eventually have noticed.

**Neutral to safety.** All three options were neutral with respect to INV-001 and
INV-006. None creates a directional edge and none tells the engine anything. This
was an economics and fairness decision, and it is recorded here because it is
durable and product-defining, not because it was risky.

## Implementation note

Both policies are implemented behind a single configuration value, so this
decision is a setting rather than a code path. The alternative remains reachable
and tested — a venue operating under different rules is a configuration change —
but `refund` is the default and the one the product claims.
