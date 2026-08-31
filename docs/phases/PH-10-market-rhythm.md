# PH-10 — Per-Asset Market Rhythm

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-10
Status: APPROVED
Cycle: 4 (phase 1 of 3)
Created: 2026-08-31
Branch: `feature/ph-10-market-rhythm`
Depends on: PH-1 … PH-9 (all APPROVED)
Decisions applied: [ADR-0003](../decisions/ADR-0003-conditional-sign-symmetry.md),
[ADR-0005](../decisions/ADR-0005-volatility-cascade.md),
[ADR-0006](../decisions/ADR-0006-layered-market-model.md)

---

## 1. Objective

Make the five assets differ in **rhythm** — the shape of their volatility
dynamics over time — and not merely in how fast and how far they move.

## 2. Problem

### 2.1 The measurement that has been true since PH-4.3

INV-007 says assets have genuinely distinct statistical personalities. The
catalogue's five assets classify at **30.0% on scale-free shape features against
a 20% null** (PH-4.3 measured 26%; the recalibrated catalogue reads 30.0%). On
the full signature, including pace and scale, classification is near perfect —
and that result is worth nothing, because pace and scale are literally two of the
seven traits. Anyone can tell BTC from an index fund by looking at the y-axis.

The interesting claim, the one a trader would recognise as personality, is what
survives dividing both out.

### 2.2 The cause is structural, not a tuning failure

`personalityConfig` expands seven traits into an engine configuration. Look at
what it actually varies:

```ts
const cascade = { ...DEFAULT_CASCADE, lowMultiplier: 1 - traits.clustering };
const arrival = { ...DEFAULT_HAWKES, baseIntervalMs, branchingRatio };
// regimes and structure: multipliers spread, everything else inherited
```

Every asset shares `components: 10`, `slowestHazardPerMs: 1/6h`,
`hazardRatio: 2.6`, every regime sojourn scale and shape, every transition
weight, the Hawkes decay constant, and every structural hazard. The **entire
time structure of the market is one configuration**, common to the catalogue.

Now line that up against the shape features the differentiation metric uses:

| Shape feature           | What determines it                        | Per-asset today |
| ----------------------- | ----------------------------------------- | --------------- |
| `clusteringLag1/5/20`   | cascade hazards, regime sojourns          | **no**          |
| `varianceRatio`         | cascade + regime time structure           | **no**          |
| `arrivalDispersion`     | Hawkes decay, branching ratio             | partly          |
| `kurtosis`, `tailRatio` | clustering, regimeSpread, structureSpread | yes             |

Five of seven shape features are driven by configuration no asset can vary. PH-4.3
tried three levers — trait spread, regime tempo, cascade memory span — and found
all three moved differentiation by less than realisation noise. Of course they
did: two of the three were not wired to anything, and the third was one scalar.

This is not a calibration problem. The personality vector cannot express rhythm.

### 2.3 Why this is the dangerous kind of change

The cascade's contribution to kurtosis is `inflation(m₀) ^ K`. It is raised to
the power of the component count. PH-3 already paid for this once: `lowMultiplier`
0.6 with all three layers active produced an excess kurtosis of 1366 against a
ceiling of 200.

Making `K` a per-asset trait therefore puts an **exponent** in the personality
vector. An asset authored with a deeper cascade and an unchanged `clustering`
does not get slightly fatter tails; it gets exponentially fatter ones. The
analytic gate already computes `cascadeInflation` from `config.components`, so it
will catch this — but "the gate throws" is a poor authoring experience and would
push every asset toward whatever depth happens to fit, undoing the
differentiation the phase exists to create.

Depth and clustering have to be **co-varied on purpose**, so that assets differ
in the _number and spacing of their timescales_ while landing where they are
meant to in tail weight.

### 2.4 What must not move

PH-3's validation, PH-4's per-asset battery verdicts and PH-9's withheld-family
verdicts were all obtained on the current configuration. Changing the cascade
changes the return distribution, which changes:

- every asset's calibrated `logQuantum` (derived from its own 30-second returns);
- every recorded tie rate;
- every realism-band measurement;
- the input to every attack family.

So PH-10 is not a three-line change with a test. It is a change to the market
process, and it carries the full revalidation cost — per-asset battery, realism
band, mirror test, withheld families.

## 3. Scope

- Cascade time structure — component count, slowest hazard, hazard ratio — becomes
  part of the personality, with the analytic gate extended to the new space.
- Regime tempo and Hawkes excitation memory become per-asset.
- A kurtosis-neutral authoring aid, so depth can be varied without every asset
  drifting in tail weight.
- A catalogue re-authored so the five assets differ in rhythm, with recalibrated
  lattices.
- Full revalidation: mirror test, per-asset battery, realism band, withheld
  families, differentiation on shape features against the permutation null.

## 4. Exclusions

- **No new layer.** The model gains no mechanism; existing mechanisms become
  addressable per asset. A new layer would need its own ADR and its own
  sign-blindness argument.
- **No new assets.** Five is enough to measure differentiation; adding a sixth
  would inflate the number without testing the mechanism.
- **No tuning against the withheld families.** PH-9 §5 stands. If a withheld
  family reacts to the new configuration, that is a finding, not a target.

## 5. Architectural direction

### 5.1 Rhythm is time structure, and time structure is sign-blind

Every quantity this phase makes per-asset is a function of elapsed time and the
layer's own randomness. None of them can observe a sign, a price, or anything
derived from one. That is what keeps ADR-0003's involution argument intact, and
the mirror test is the check that it stayed intact rather than the argument for
why it should.

### 5.2 The gate stays analytic

`cascadeInflation` is exact and already parameterised by component count.
Extending the trait space must not degrade the gate to sampling — PH-4 recorded
why: a sampled fourth moment of a heavy-tailed variable converges from below, so
a sampling gate passes exactly the configurations that stay quiet in a short test.

### 5.3 Depth and clustering are co-varied, not independently authored

The personality declares a cascade depth and a target tail weight; the clustering
that achieves that target at that depth is solved for. Assets then differ in how
many timescales they have and how those timescales are spaced, while remaining
comparable in tail weight — which is precisely "differs in rhythm, not in scale".

The solve is deterministic and analytic, so it is reproducible and costs
microseconds.

## 6. Phase invariants

- **INV-007** is the invariant this phase exists to strengthen, and the
  measurement must be the _shape_ one against the permutation null, never the
  full-signature one.
- **INV-006** must survive per asset, including against the withheld families.
- **INV-003, INV-008, INV-009** — recalibrated lattices change published prices,
  so snapshot/restore, seam continuity and settlement reproducibility are all
  re-checked rather than assumed.

## 7. Dependencies

PH-4's personality system and calibration machinery; PH-2's battery; PH-9's
withheld families. All approved.

## 8. Initial decomposition strategy

- **PH-10.1** — the cascade's time structure becomes personality: new traits,
  extended gate, the kurtosis-neutral solve.
- **PH-10.2** — a catalogue authored to differ in rhythm, with recalibrated
  lattices and the differentiation measurement.
- **PH-10.3** — revalidation: every asset, every guarantee, again.

## 9. Acceptance intent

Shape-feature differentiation materially above the 20% null with a permutation
p-value that means something, five assets each independently clean under the
battery and the withheld families, the mirror test exact, and every asset inside
the realism band — with the lattices recalibrated to the new process.

## 10. Risks and unknowns

| Risk                                               | Assessment                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deeper cascades push kurtosis out of band          | Expected, and the reason for the co-varied solve. The analytic gate is the backstop.                                                                                        |
| Rhythm differences leak a directional edge         | Structurally impossible under ADR-0003 — but that is exactly what was said about the leverage effect. The mirror test runs first and the battery runs per asset.            |
| Differentiation still lands near the null          | Possible. Then the phase reports the measurement honestly and records which features remain common. A number that did not move is a result, not a failure to be tuned away. |
| Revalidation cost                                  | Real: five assets through the battery is the expensive part of the statistical suite. Budgeted as its own subphase rather than smuggled into PH-10.2's gate.                |
| Recalibrated lattices invalidate recorded evidence | Certain. Every recorded tie rate and quantum is re-derived and re-recorded; the old figures stay in the phase records that produced them, per `GOVERNANCE.md` §47.          |

---

## 12. Phase approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check          | Result                                             |
| -------------- | -------------------------------------------------- |
| `npm run gate` | **exit 0** — 1108 passed, 71 files, 0 errors, 198s |

### The result the phase existed to produce

**Assets that differ in rhythm, not only in pace and scale.**

| Measurement                                 | PH-4  | PH-10     |
| ------------------------------------------- | ----- | --------- |
| Full-signature differentiation              | 53.0% | 59.5%     |
| **Shape-only** (pace and scale divided out) | 30.0% | **40.5%** |
| Identical-personality control               | 21.0% | 23.5%     |

Permutation p = 0.005 — the floor at 199 shuffles — and no relabelling of the
same windows reached 28.0%.

| Subphase | Title                                             | State    |
| -------- | ------------------------------------------------- | -------- |
| PH-10.1  | The cascade's time structure becomes personality  | APPROVED |
| PH-10.2  | A catalogue authored to differ in rhythm          | APPROVED |
| PH-10.3  | Revalidation: every asset, every guarantee, again | APPROVED |

### Phase invariants

- **INV-007** strengthened from "the assets differ in size" to "the assets differ
  in character", with the difference measured against a reachable null and the
  gain attributed to the mechanism that caused it.
- **INV-006** re-established per asset against the main battery _and_ against the
  withheld families, on a changed market process. 90 hypotheses clean, 106 across
  a real seam.
- **INV-003, INV-008, INV-009** re-checked rather than assumed: the lattices moved,
  so snapshot/restore, seam continuity and settlement reproducibility were all
  re-run.

### What the phase learned

**B-004 was never a tuning problem, and three phases of tuning could not have
fixed it.** PH-4.3 tried trait spread, regime tempo and cascade memory span, and
reported that all three moved differentiation by less than realisation noise. The
reason was not that the levers were weak. Two of the three **were not wired to
anything** — `personalityConfig` inherited every cascade hazard, every regime
sojourn scale and the Hawkes decay from shared defaults, so the entire time
structure of the market was one configuration common to the catalogue. Five of
the seven scale-free shape features an observer can measure were therefore
identical across all five assets by construction.

A measurement that will not move under three different levers is evidence about
the _model_, not about the calibration. It took a cycle to read it that way.

**The hardest part of raising a number is making it mean something.** Shape
differentiation is trivially purchasable: spread the assets further apart in tail
weight and it rises without any of them becoming a more distinct market. So the
phase pinned every asset's realised tick amplitude to its PH-4 value to fifteen
decimal places and its tail weight to within 6%, and then split the measurement
by feature group — rhythm features alone score 39.5%, the frozen tail features
28.0%, inside the control's own noise. The constraint and the split are worth
more than the headline, because without them the headline is unfalsifiable.

**Depth is an exponent, and that shaped the whole design.** Making cascade
component count per-asset puts an exponent in the personality vector: an asset
authored with a deeper cascade and unchanged clustering does not get slightly
fatter tails, it gets exponentially fatter ones. What made this tractable was
discovering that the _other four_ rhythm traits are exactly kurtosis-neutral —
three by absence, one by a cancellation between a stationary weight and its own
normalising total. Rhythm can therefore be varied freely, and only depth needs to
be co-varied, which `solveClustering` does analytically in microseconds.

**A recorded measurement that nothing reads is a comment.**
`MEASURED_LATTICE_TIE_RATES` records the rate at which stakes are refunded under
ADR-0007. It was measured by Cycle Audit 2, exported, documented as evidence, and
read by no code and no test. Re-authoring the cascade moved every value in it and
nothing failed. Giving it a test then found a second defect underneath: the rates
did not reproduce across seeds, because a binomial standard error is wrong for
20,000 consecutive horizons of one realisation.

**Every statistic of this market is limited by simulated duration, not by sample
count.** The volatility process has memory measured in days, so consecutive
observations are not independent draws no matter how many are taken. This is the
third face of one fact: Cycle Audit 2 found it behind INV-007's p-value, B-002
records it for the long-horizon detection floor, and PH-10.2 met it again in the
tie rates. Naming it as a property of the engine — rather than as three separate
statistical mistakes — is what PH-11 should start from.

### Known limitations carried forward

- Assets remain much easier to tell apart by size than by character: 40.5% on
  shape against a near-perfect full-signature figure. True of real markets too,
  and stated at the strength the measurement supports.
- Realised mean tick interval moved up to 5.2% despite `tempoMs` being unchanged,
  because excitation memory interacts with the Hawkes intensity ceiling. "Only
  rhythm changed" is true of the traits, not of realised pace.
- The trait space is geometrically constrained in a way no single bound
  expresses: `(depth − 1) · ln(spacing) ≤ ln(span / (tempo/2))`. The error message
  names the three traits; an author still solves it by hand.
- **B-010** — the gate's event-loop starvation failure is standing, not closed,
  and no static guard can see it.
