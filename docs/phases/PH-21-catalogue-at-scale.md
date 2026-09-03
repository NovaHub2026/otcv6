# PH-21 — The Catalogue At Scale

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-21
Status: APPROVED
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
| PH-21.3  | A panel that can hold a hundred assets            | APPROVED |

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

## 5. What the phase answered

The five questions of §1, with the number that answers each and the record it
came from.

| #   | Question                                                | Answer                                                                                                                              |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Does a hundred-asset build succeed?                     | **100 of 100 registered, 0 refused**, 327 s single-threaded, 1.8 s median and 20.5 s worst ([PH-21.1](PH-21.1-a-hundred-assets.md)) |
| 2   | Do a hundred assets stay distinct?                      | **Closest of 5,460 pairs at 0.0282**, 2.8× the 0.01 floor ([PH-21.1](PH-21.1-a-hundred-assets.md))                                  |
| 3   | What does the venue cost per tick at a hundred markets? | **413,177 ticks/s at a hundred markets**, flat to 7% across a 20× range ([PH-21.2](PH-21.2-the-venue-under-a-full-catalogue.md))    |
| 4   | What does it cost on disk?                              | **52 bytes per minute bar**, 0.67 GB for a hundred assets over a quarter ([PH-21.2](PH-21.2-the-venue-under-a-full-catalogue.md))   |
| 5   | Does the panel survive it?                              | **Yes** — search, grouping, and a virtualisation decision recorded rather than taken ([PH-21.3](PH-21.3-a-panel-at-scale.md))       |

Three of the five were arguments before this phase and are measurements after
it. Question 3's argument — "the markets share a clock and nothing else, so the
cost should be linear" — turned out to be right in substance and wrong in the
form it was first written down: the cost is linear in **ticks published**, not
in markets hosted, and the phase record claimed "twenty times the markets for
twenty times the wall clock" against its own table showing forty. That the
correction came from the closure audit rather than from the author is the
honest summary of what a measurement phase is worth: the measurement was
sound, the sentence about it was not, and only re-derivation caught it.

**What the phase found that nobody asked.** The venue-scale runner's first
execution reported a hundred assets costing **0.00 GB**, from 23,032 bars it had
certainly written — a WAL file measured before its checkpoint. It is recorded in
PH-21.2 §4 rather than quietly fixed, because the wrong number pointed the way
the project already believed. A pleasant wrong number is the one that survives
being read.

## 6. What the Human Owner found, twice, and what it cost to close

PH-21.3 was finished, tested and approved-in-draft when the Human Owner reported
the chart broken. Twice more after that, they reported it still broken. All
three reports were right, and the reasons were different each time:

1. A price label that was not a number — a `minMove` that disagreed with the
   precision it was drawn at.
2. A candle frozen for up to an hour — two correct rules (CA6-30, and a
   one-hour default timeframe) producing a wrong screen.
3. The same candle, still frozen — because the fix rested on a stream resume
   the feed routinely cannot serve, and because the local launcher was serving
   **a different worktree entirely**, so two rounds of reports were about a
   program that had never contained the fix.

The third is the one worth carrying forward. `GOVERNANCE.md` §40.1 exists for
exactly the shape it took: hosted CI was red on a tree whose local gate was
green, and the red was not noise — it was the defect, reproducing. The phase
could have been closed on the local gate alone at any point in that window.

## 7. Phase gate

> **Verification in flight.** The gate and the hosted run for this tree are
> executing as this is written; this block is filled from their exit codes, and
> is not an approval until it is. `GOVERNANCE.md` §68: only executed checks may
> be reported as passing.

## 8. What the phase leaves open

**A hundred registered is not a hundred hosted.** PH-21.2 measured the venue's
scheduling loop and the store's footprint at a hundred markets; the publication
and history paths that consume the loop's output are downstream of it and are
not in those numbers. No deployment has ever run a hundred markets continuously.

**The panel is not virtualised**, by decision (PH-21.3 §6). A hundred rows is a
hundred DOM nodes; the measurement that would justify a windowing library has
not been taken.

**`CYCLE-7-CATALOGUE-SCALE.md` describes a catalogue one parameter behind.** The
out-of-band audit raised `alt-crypto`'s cascade depth floor from 5 to 7 (a3-05)
after that run was recorded. Re-running it is Issue #17: five and a half minutes
of compute, and the twelve `alt-crypto` rows are the only ones affected.

**The 400-brief probe behind "one brief in 400" is not a recorded run.** The
number is real and the retreat mechanism it justified is in the gate, but the
probe itself was never written up as evidence — found by the closure audit,
which could not locate it. Issue #18.

**Fan-out.** The phase proved a hundred assets can exist and be scheduled. It
says nothing about a thousand clients watching them, which is PH-22 and which
the Human Owner has prioritised ahead of everything else.
