# PH-17 — Assets Become Data

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-17
Status: ACTIVE
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
90 days: the median is within half a percent of zero on all five assets, and the
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
