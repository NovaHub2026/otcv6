# PH-21 — The Catalogue At Scale

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-21
Status: ACTIVE
Cycle: 7 (phase 3 of 3)
Created: 2026-09-02
Branch: `feature/ph-21-catalogue-at-scale`

---

## 1. What is actually unknown

Everything needed to reach a hundred assets exists: eight archetypes, sampled
personalities, dispersion budgets, a registration job, a durable registry, a
venue that hosts a market added at runtime, candle history whose row count is
fixed by the calendar rather than by the tick rate. Each was built and tested
**one asset at a time**, or three.

So the phase is a measurement phase, and the honest list of what nobody knows is
short and specific:

1. **Does a hundred-asset build succeed?** PH-19.4 measured registration failing
   on 36% of hundred-asset builds before the tail-weight clamp. The clamp is in;
   the rate at that scale has never been measured after it.
2. **Do a hundred assets stay distinct?** Differentiation is pairwise, so the
   number of comparisons grows quadratically and the _closest pair_ is what
   INV-007 is about. Three siblings from one archetype separate; ninety-six do
   not obviously follow.
3. **What does the venue cost per tick with a hundred markets?** One advance
   loops every market. The markets share a clock and nothing else, so the cost
   should be linear — should be.
4. **What does it cost on disk?** 131,759 candles per asset per quarter is the
   number that makes this affordable, and it has never been multiplied by a
   hundred and checked against a real store.
5. **Does the panel survive it?** The sidebar is a flat unsorted list of five.

## 2. Subphases

| Subphase | Title                                             | State    |
| -------- | ------------------------------------------------- | -------- |
| PH-21.1  | A hundred assets, and what registering them costs | APPROVED |
| PH-21.2  | The venue and the store under a full catalogue    | APPROVED |
| PH-21.3  | A panel that can hold a hundred assets            | ACTIVE   |

**PH-21.3 is taken before PH-21.2**, which is not the order they were numbered
in. Its implementation landed on 2026-09-02 while a concurrent session held this
branch and an out-of-band audit held another; the panel work was finished and
the venue measurement was not. Numbering records the order they were conceived;
approval records the order they were verified, and pretending otherwise would
mean holding finished, tested work hostage to a benchmark that needs a quiet
machine.

## 3. What this phase may not do

**It may not weaken differentiation to make a hundred assets fit.** If ninety-six
assets cannot be told apart, the answer is fewer assets or better archetypes, not
a lower floor. INV-007 is not a budget.

**It may not measure at ten and report at a hundred.** Where an extrapolation is
unavoidable it states the exponent it assumes and the range it was fitted over.

## 4. Phase invariants

INV-007 (assets have genuinely distinct statistical personalities), INV-002 (one
market per asset per moment, however many there are), INV-003 (one stream per
asset — a hundred assets are a hundred keystreams, never one shared).
