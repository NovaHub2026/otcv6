# PH-4.2 — Asset registry, quantum calibration and the registration procedure

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-4.2
Parent phase: PH-4 — Asset Personality System and Multi-Asset Instantiation
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Turn the personality model into an actual catalogue: a registry of assets, a
registration procedure that derives each asset's lattice quantum from its own
simulated behaviour, and the recorded evidence that makes each registration
reproducible.

## 2. Problem

`logQuantum` is the one instrument field that cannot be chosen by taste. It is
fixed per asset, it is the resolution at which every contract settles, and
`instrument.ts` has carried a note since PH-1.3 saying it must be derived from
simulation evidence "at registration (PH-4)". That has not happened yet: the
single test instrument uses a placeholder `1e-6`, and at that value the quietest
1% of 30-second windows span **0.3 lattice steps**.

### What the quantum does and does not affect

It would be easy to justify this subphase as an anti-predictability measure. That
would be wrong, and getting it wrong would mean calibrating against the wrong
quantity.

**The theorem is indifferent to the quantum.** Increments are `sign × magnitude`
with the sign drawn from a stream no magnitude input can observe, so `P(up) =
P(down)` exactly at any lattice resolution. A coarse lattice does not create a
directional edge, and the `priceModulo` attack family cannot fire on a series
whose canonical representation _is_ the integer — there is no finer hidden price
for the published one to be a rounded version of. That was the
`displayQuantization` defect, and ADR-0004 closed it structurally by publishing
and settling the same integer.

What a coarse quantum actually produces is:

1. **Ties.** A 30-second window whose move is smaller than one lattice step
   settles at the money. Too many of those is a product problem, and it is
   directly coupled to the at-the-money settlement policy already recorded as a
   Protected Human Decision.
2. **A staircase.** A series that visibly steps between levels is not realistic.

So the calibration target is the **tie rate at the shortest contract horizon**,
which is a stated product property, rather than an abstract step count.

## 3. The rule

```
logQuantum = quantile( |30-second log return|, TARGET_TIE_RATE )
```

By construction, exactly `TARGET_TIE_RATE` of 30-second windows produce no net
lattice movement. `TARGET_TIE_RATE` is 1%.

Calibration runs in **continuous log space with no lattice at all**, because the
quantum is the quantity being chosen and the measurement cannot depend on it.
The magnitude and arrival stack is driven directly; no price path is generated.

Display precision follows from the quantum, so the displayed price is never
coarser than the lattice that settles it:

```
displayPrecision = ceil( log10( 1 / (logQuantum × referencePrice) ) )
```

A trader seeing an unchanged price when the contract settled as a move would be a
fairness problem even though INV-009 still held. Deriving both from one number
prevents it.

### Measured, over twenty simulated days per asset

| Asset       | Predicted excess kurtosis | Mean interval | logQuantum | Tie rate | Median 30s move | Display decimals |
| ----------- | ------------------------- | ------------- | ---------- | -------- | --------------- | ---------------- |
| forex-major | 67                        | 1081 ms       | 2.82e-7    | 1.00%    | 70 steps        | 7                |
| forex-minor | 111                       | 1295 ms       | 3.73e-7    | 1.00%    | 78 steps        | 7                |
| crypto      | 149                       | 332 ms        | 2.29e-6    | 1.00%    | 87 steps        | 6                |
| index       | 45                        | 2456 ms       | 2.28e-7    | 1.00%    | 68 steps        | 7                |
| commodity   | 100                       | 1367 ms       | 4.53e-7    | 1.00%    | 83 steps        | 7                |

Median moves land at 68–87 steps for every asset without that being targeted:
because the quantum is a quantile of each asset's _own_ return distribution, the
lattice resolution scales with the asset rather than being imposed on it.

### The gate earned its place during this subphase

The first crypto personality drafted here — `clustering` 0.27, `regimeSpread`
1.35, `structureSpread` 1.2 — was **rejected** by `assertPersonalitySafe` at a
predicted excess kurtosis of 276.8 against the ceiling of 200. It was retuned to
149 before any simulation ran. Under PH-3's process that would have been a
ten-minute run followed by a recalibration pass.

## 4. Scope

- `AssetDefinition` — identity, family, display name, reference price, traits.
- `calibrateAsset` — the registration procedure: bounds, then the kurtosis gate,
  then quantum and display precision from simulation.
- `CalibrationEvidence` — what each registration records so it can be re-checked.
- `ASSET_CATALOGUE` — five assets across four families.
- A statistical test that recalibrates every catalogue asset and confirms the
  recorded evidence reproduces.

## 5. Exclusions

- Per-asset battery and realism runs, and the measured differentiation metric —
  PH-4.3. An asset in this catalogue is _plausible_, not yet _validated_.
- Promotion of INV-007. PH-4.3 supplies that evidence.

## 6. Acceptance criteria

1. Registration rejects, in order: out-of-bounds traits, then personalities whose
   layers would compound outside the realism band.
2. Every catalogue asset calibrates to its recorded quantum within 15% on
   recalibration, from a different seed.

   **Revised on evidence during the subphase.** This was the wrong test, and it
   failed for the wrong reason — first `gbpjpy` at 18.5%, then `btcusd` at 28%
   even after replicates were added. Measuring what actually matters instead:
   applying each _recorded_ quantum to three fresh realisations gives tie rates of

   ```
   eurusd  0.94  0.88  0.90      gbpjpy  1.07  0.97  1.15
   btcusd  0.82  1.09  1.01      spx     0.99  1.14  1.10
   xauusd  0.78  1.22  1.14                                (%)
   ```

   every one inside 0.25pp of target. Both facts are consistent: the return
   distribution is very flat in its lower tail, so a large move in the quantile
   is a small move in the probability it cuts. The criterion is therefore the
   **delivered tie rate on fresh data**, with a loose band on the quantum kept
   only to catch a calibration that changed meaning rather than merely resampled.

   The general lesson, and the second time in this phase: assert the property the
   artefact exists for, not the intermediate number it happens to be made of.

3. The realised tie rate at 30 seconds is within 0.3pp of the 1% target.
4. Display precision is never coarser than the lattice.
5. Assets are distinguishable on mean tick interval and 30-second volatility.
6. No calibration output reaches the sign path; guardrails and the mirror test
   still pass.

## 7. Approval record

**APPROVED** from executed evidence, 2026-08-31.

### The result the subphase existed to produce

The product has an asset list. Five assets across four families, spanning a
factor of seven in pace and an order of magnitude in scale, each with a lattice
derived from its own behaviour and a record of how that lattice was chosen.

`instrument.ts` has carried a note since PH-1.3 saying `logQuantum` must be fixed
"from simulation evidence at registration (PH-4)". It now is.

### What the subphase learned

Two corrections to my own framing, both caught by measurement:

**The quantum is not a safety parameter.** It was tempting to justify calibration
as anti-predictability work. It is not: the sign is a fair coin at any lattice
resolution, and ADR-0004 already closed the quantisation channel structurally by
publishing and settling the same integer. What a coarse lattice produces is ties
and a staircase. Calibrating against the wrong quantity would have produced a
defensible-sounding rule aimed at nothing.

**Reproducibility of a number is not reproducibility of a property.** The first
acceptance criterion asked the recorded quantum to reproduce within 15%. It did
not — and it did not need to. A 28% difference in the quantum moves the delivered
tie rate by about 0.2pp, because the distribution is flat where the quantile cuts.

### Verification executed

| Check                  | Result                       |
| ---------------------- | ---------------------------- |
| `npm run format:check` | PASSED                       |
| `npm run lint`         | PASSED                       |
| `npm run build`        | PASSED                       |
| `unit` project (full)  | PASSED — 675 tests, 37 files |
| `statistical`, engine  | PASSED — 15 tests            |

### A defect fixed on the way through

`regime.test.ts` had a test making 200,000 `expect()` calls in a loop. The
matcher overhead alone put it at 5.08s against the unit project's 5s timeout, so
it failed whenever the suite ran under load — a latent CI failure that had never
fired because nothing had competed with it before. Counting and asserting once
took the file from 5.08s to 1.06s.

### Known limitations carried forward

- These assets are **plausible, not validated**. None has faced the attack
  battery or the realism battery. PH-4.3 does that, per asset, and only then can
  INV-007 be promoted.
- `TARGET_TIE_RATE` is coupled to the at-the-money settlement policy, which is
  still an open Protected Human Decision. If ATM stops meaning a refund, revisit
  the target rather than the mechanism.
