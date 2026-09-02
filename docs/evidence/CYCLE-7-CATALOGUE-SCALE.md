# A hundred assets, registered

Type: RECORDED EVIDENCE
Produced: 2026-09-02
Runner: `tools/sim/src/catalogueScale.ts` — in the repository, and reproducible
Command: `node tools/sim/dist/catalogueScale.js`
Seed: `catalogue-scale` (`OTC_SCALE_SEED`; every stream derives from it)
Note: recorded before the out-of-band audit of 2026-09-02 raised `alt-crypto`'s
cascade depth floor from 5 to 7 (a3-05); the twelve `alt-crypto` rows above were
drawn from the earlier box and the run must be repeated to describe the current
catalogue.

---

## Why this exists

Everything needed to reach a hundred assets was built one asset at a time. Five
questions had never been answered at that scale, and two of them decide whether
the product's central claim survives it: that a catalogue can be large **and**
that its assets are genuinely different markets (INV-007).

## Result

A hundred assets, drawn from the eight archetypes in rotation, each registered
through the whole six-stage pipeline against everything already registered.

| attempted | registered | refused | total | median | p90   | max   |
| --------- | ---------- | ------- | ----- | ------ | ----- | ----- |
| 100       | **100**    | **0**   | 327s  | 1.8s   | 11.1s | 20.5s |

### By archetype

| archetype       | attempted | refused | median | max   |
| --------------- | --------- | ------- | ------ | ----- |
| major-fx        | 13        | 0       | 3.2s   | 4.8s  |
| cross-fx        | 13        | 0       | 1.4s   | 1.9s  |
| blue-chip-index | 13        | 0       | 2.1s   | 2.5s  |
| sector-etf      | 13        | 0       | 1.9s   | 3.0s  |
| metal           | 12        | 0       | 0.6s   | 0.8s  |
| energy          | 12        | 0       | 0.7s   | 1.0s  |
| major-crypto    | 12        | 0       | 14.9s  | 20.5s |
| alt-crypto      | 12        | 0       | 1.0s   | 2.8s  |

**Cost is a property of the family, not of the catalogue.** The spread across
archetypes is 25× — `major-crypto` at a 14.9s median against `metal` at 0.6s —
and the driver is the fit span the asset's own cascade memory demands multiplied
by its tick rate. Nothing in the table grows with how many assets already exist,
which is the answer to "does registration get slower as the catalogue fills":
the only stage that touches the existing set is the differentiation check, and it
is a trait distance per pair.

**A hundred-asset build is a five-and-a-half-minute job**, single-threaded, and
it is dominated by twelve `major-crypto` assets.

## Differentiation

105 assets — the five compiled plus the hundred registered — and every pair.

| pairs | closest pair                      | min        | p1     | p10    | median |
| ----- | --------------------------------- | ---------- | ------ | ------ | ------ |
| 5,460 | `btcusd` / `scale-major-crypto-8` | **0.0282** | 0.0468 | 0.0918 | 0.2561 |

On a scale where 1 is the whole trait space and the floor is 0.01. **The closest
pair sits at 2.8× the minimum**, so INV-007 holds at a hundred assets with
headroom rather than by a hair — and the closest pair is exactly where one would
expect it, between a registered `major-crypto` and the hand-authored `btcusd`.

That is a measurement of _this_ draw. It is not a proof that the 5,461st asset
will clear the floor: the closest-pair distance falls as the catalogue grows,
and the registration pipeline is what enforces it — a candidate that does not
clear the floor is refused at `differentiation` and never registered.

## What it found

**One brief in 400 was still unauthorable**, after the clamp Cycle Audit 6 added
for exactly this (CA6-24). All of them `alt-crypto`, all at the clamped ceiling:

```
guard-alt-crypto-20 authoring: An excess kurtosis of 141.19 needs more cascade
inflation than clustering 0.4 can provide at depth 5.
```

0.25% per draw is a **22% chance that a hundred-asset build stops on one** — and
the operator would see a refusal about a personality they never chose.

The clamp could not have prevented it. `reachableExcessKurtosis` has no closed
form and is estimated by simulation (PH-10.1 §5.1), so 95% of a noisy estimate is
sometimes still too high. The only exact oracle is the solve, so
`requestFromBrief` now runs it and steps the drawn target down by a tenth until
it authors — using the identical derivation `registerAsset` will use, so a target
that authors in the brief authors in the registration.

Measured after the change: **200 of 200 briefs authorable, one retreat, of one
step.** The retreat is a safety net, not a second sampler.

## What this does not settle

The **storage and scheduling** cost of a hundred hosted markets, which is
PH-21.2's subject. This run registers assets; it does not host them.
