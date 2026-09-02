# PH-17 — Assets Become Data

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-17
Status: APPROVED
Cycle: 6 (phase 2 of 3)
Created: 2026-09-01
Branch: `feature/ph-17-assets-as-data`

---

## 1. Objective

Let an asset be created without editing TypeScript, and let a hundred of them be
created without INV-007 becoming false.

## 2. The catalogue was a compiled constant

`ASSET_CATALOGUE` is a `readonly` array of five hand-authored assets. Adding one
means editing source and recompiling, which is why no admin panel can exist yet:
there is nothing to administer.

The important part is not that the definition becomes data. It is that
**everything the compiled catalogue did by hand has to happen before an asset
exists** — the safety gate, the personality solve, the lattice calibration, the
tie-rate measurement, and the differentiation check — with any of them able to
refuse. Two of those are simulation, so registration is a job of order a minute
and anything driving it must treat it as one.

## 3. Why 6–8 families and not 5, and not 100

The goal is 50–100 synthetic assets. The id enters the key derivation
(ADR-0002), so a hundred assets can share a personality and share no prices —
which is exactly the property that makes a catalogue possible from a handful of
characters.

But INV-007 says assets have **genuinely distinct statistical personalities**,
and twenty assets sharing one personality are statistically identical. Measured
shape differentiation across the current five is 40.5% against a 20% null: real,
and modest.

So families are anchors, not templates. Each asset's personality is **sampled**
around its family and checked against the catalogue, which is why the
differentiation check is a required stage of registration rather than a review
step.

## 4. Dispersion budgets, not price ceilings

[`CYCLE-6-DRIFT.md`](../evidence/CYCLE-6-DRIFT.md) measured what a price does over
90 days: every median is a small fraction of that asset's own spread — four of
the five within half a percent of zero and btcusd at +1.5% against a 75.6%
dispersion, which is 0.02σ (corrected by Cycle Audit 6, CA6-38) — and the
dispersion runs from 1.7% (spx) to 75.6% (btcusd).

A price ceiling was considered and refused — near a boundary `P(down) > P(up)`,
which is the easiest exploit this system could contain. Families carry a
dispersion budget instead, chosen at authoring time, blind to price and outcome.

## 5. Subphases

| Subphase | Title                                                   | State    |
| -------- | ------------------------------------------------------- | -------- |
| PH-17.1  | Runtime asset definitions and the creation pipeline     | APPROVED |
| PH-17.2  | Families, sampled personalities, and dispersion budgets | APPROVED |
| PH-17.3  | Backdated history and continuous persistence at scale   | APPROVED |

## 6. Phase invariants

- **INV-007** — the reason differentiation is a registration stage and not a review.
- **INV-003** — two assets with one id derive one keystream, refused at identity.
- **INV-009** — a calibrated quantum decides every settlement for its asset, so
  the registration records what it was derived from.

## 7. Integrated phase verification

`tools/sim/src/assetLifecycle.stat.test.ts` runs the whole chain once, on an
asset that exists nowhere in source, in a fixture, or in the test file:

1. a personality **drawn** from the `metal` archetype;
2. **registered** — safety gate, personality solve, lattice calibration,
   dispersion fit against the family band, INV-007 differentiation;
3. **backfilled** seven days, 356,471 ticks into 10,079 minute bars and 167
   hourly ones;
4. **served** at every timeframe the product offers, each contiguous and of the
   expected length, from storage rather than from the ticks;
5. **carried forward** live from the checkpoint, with every sequence consecutive
   and every instant increasing across the join.

Its dispersion, measured from the published prices as realised quadratic
variation, was 5.51% a quarter against a budget of 6.32% on the run that produced
this document.

**That figure is `console.info`, not an assertion** (CA6-37). What the test
enforces is a band, and the band was −28% / +38% — two to three times wider than
the agreement quoted. The honest reading is that the chain holds to within the
band; the 13% is one observation, and Cycle Audit 6 found the same shape of claim
in three other places in this cycle.

## 8. Approval

**APPROVED** 2026-09-01, from executed evidence.

`npm run gate` — **exit 0**, 113 test files, 1,963 tests, 361 seconds.

| Check                       | Command                | Exit |
| --------------------------- | ---------------------- | ---- |
| Formatting                  | `npm run format:check` | 0    |
| Build and typecheck         | `npm run build`        | 0    |
| Lint (type-aware)           | `npm run lint`         | 0    |
| Unit and statistical suites | `npm test`             | 0    |

The gate's first run exited 1 with every test passing, on
`Timeout calling "onTaskUpdate"` — a synchronous block long enough to starve the
worker's own progress channel. Twenty-four mirror tests of 120,000 ticks in one
test body, and a two-hour live continuation in another. It cost PH-4 a phase gate
as B-005, recurred in PH-10.3, and has now recurred in PH-17: the hazard is
standing and returns with every new long test, so both bodies now yield.

## 9. What the phase leaves for PH-18

The catalogue is now data, so an admin panel has something to administer:
registration is a job with named stages that each refuse for their own reason,
archetypes are the vocabulary an operator picks from, and a new asset arrives
with ninety days of chart. What does not exist yet is the surface.
