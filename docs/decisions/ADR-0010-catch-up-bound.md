# ADR-0010 — The catch-up bound: no burst may span a contract

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-09-01
Deciders: Development Agent (`GOVERNANCE.md` §5, delegated by [ADR-0008](ADR-0008-full-delegation.md))
Amends: `DEFAULT_MAX_CATCH_UP_MS` in `packages/runtime/src/hosted.ts`
Informs: PH-12.3, any venue deployment

---

## Context

A hosted market advances with the clock. When it is asked to advance and finds
itself far behind — a suspended VM, a long pause, a descheduled process — it must
decide how much market time to generate at once.

PH-5 declined to decide this, and said so explicitly in the source: _"a venue
policy with business consequences… surfaced in the phase document rather than
chosen quietly here. This default exists so the runtime has defined behaviour,
and it is deliberately generous."_ The default was **one hour**, and it has been
carried as an open item ever since.

`GOVERNANCE.md` §5 now delegates decisions of this kind, so it is decided here.

Two facts shape it.

**The bound does not guard restarts.** `resumeMarket` seams forward to now
(PH-5.2), so a restarted market has no backlog to replay. The bound guards a
_running_ venue that lost the CPU.

**Exceeding it is a per-market failure, not a crash.** `Venue.advanceDetailed`
isolates it (PH-5.1 / Cycle Audit 2), so one stalled market does not take the
others down, and recovery is a restart that seams forward.

## Decision

**The catch-up bound is 15 seconds: half the shortest expiry the product sells.**

The criterion is what matters more than the number: **no catch-up burst may
contain both the entry and the expiry of any contract the product offers.** The
shortest expiry is 30 seconds, so the bound is 15.

## Consequences

### Why an hour was wrong

An hour means a venue starved for 59 minutes silently generates 59 minutes of
market on its next advance. That is precisely the failure the bound exists to
prevent: ticks whose instants are historical but whose _arrival_ is not, produced
in a moment no observer was watching, against which contracts then settle.

A market whose entire product is a record people settle against cannot treat an
unobserved hour as ordinary.

### What refusing costs, and why it is the right cost

A market that breaches the bound stops publishing and fails its advance until an
operator restarts it. That restart seams forward, and the record shows a **gap**.

A gap is honest and visible. The alternative — generating whatever is missing —
hides an outage inside a plausible-looking price series, which is the worse
failure. Refusing makes the operator confront the outage; fast-forwarding lets
them not notice, and lets a trader settle against prices that were invented after
their contract expired.

### It does not eliminate settling against unobserved prices

Nothing short of a zero bound does. A 30-second contract can still have its
expiry inside a 15-second burst.

What the bound guarantees is narrower and worth stating exactly: **a complete
contract lifetime can never be manufactured inside a single unobserved burst.**
An operator or an attacker cannot produce both endpoints of a round trip in one
moment.

### Test impact, and what it revealed

Thirty-one tests failed on the change, all of them advancing the clock by 60 to
600 seconds in a single step to generate market quickly.

That is a catch-up burst — exactly what the bound refuses. The tests were relying
on the production default to permit something production should not permit. They
now pass an explicit wide bound through their shared helpers, so the burst is
**declared** rather than inherited, and the bound's own behaviour is tested with
explicit narrow values.

A test that silently depends on a production default breaks the moment that
default is decided, which is what happened here.

## Alternatives considered

**Keep an hour, treat the bound as a safety net for absurd cases only.** Rejected:
a safety net that permits an unobserved hour of market is not a safety net for
anything this product cares about.

**Thirty seconds, matching the shortest expiry.** Rejected by one step of
reasoning: at exactly 30 seconds a burst could span a complete 30-second
contract, which is the case the criterion is meant to exclude.

**Make it per-asset.** Rejected as unnecessary complexity: the criterion is about
the _product's_ shortest contract, which is the same for every asset.
