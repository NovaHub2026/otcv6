# PH-6.1 — Contract model and deterministic settlement

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-6.1
Parent phase: PH-6 — Trading Boundary
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Define what a contract is and settle it from the published record alone.

## 2. Settlement reads the record, never the engine

Given a tick history and a contract, settlement is a **pure function**. No keys,
no latent state, no engine. That is what makes INV-009 mean something: anyone
holding the published ticks can recompute any outcome and get the same answer.

A settlement that recomputed by re-running the engine would need the master
secret, which nobody outside the runtime has, and every dispute would become a
matter of trust rather than arithmetic.

## 3. One rule, everywhere

Both entry and expiry use `priceAtOrBefore` — the price in force at an instant is
the last tick at or before it. That is the rule the charts draw, the rule the
attack battery samples, and the rule `query.ts` reserved for this phase back in
PH-1.3, with the comment that the laboratory uses it "so that what is attacked
and what will settle are the same quantity".

Using a different rule here would have been the quietest possible way to
invalidate three phases of validation: the battery would have been clearing a
market nobody trades.

## 4. What a settlement records

Not just the outcome. INV-009 asks for a historical outcome to be _explainable_,
and "you lost" is not an explanation. A settlement carries both prices, both tick
indices and the expiry instant, so the result is checkable by anyone with the
published series.

## 5. It refuses rather than guesses

A contract whose expiry is past the end of the record has not expired yet.
Settling it would invent an outcome, so `settle` throws. Same for an entry that
precedes the record.

## 6. At-the-money — ADR-0007

A tie is **refunded**, by decision of the Human Owner. The alternatives remain
implemented and tested behind one configuration value, because a venue operating
under different rules is a configuration change rather than a fork.

## 7. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                         | Result            |
| ----------------------------- | ----------------- |
| `npm run format:check`        | PASSED (exit 0)   |
| `npm run lint`                | PASSED (exit 0)   |
| `npm run build`               | PASSED (exit 0)   |
| `packages/trading` unit tests | PASSED — 14 tests |

A fair-coin ledger at an 85% payout reports an operator margin of exactly 7.5%,
which is the advertised edge and — under ADR-0007 — the whole of it.
