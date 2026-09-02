# Fix report — `packages/engine` (audit a3)

Worktree `/home/alejo/.otc-audit7/fix`, branch `feature/out-of-band-audit`. Every change is under `packages/engine/src/`; `packages/core/src/entropy/label.ts` was **not** touched (a3-04 was closed without it — the label limit is shared as a number and pinned by a test, the way the id pattern already is). No `git` command that changes the tree was run. No `npm run build|lint|gate|test`, no coverage, no `*.stat.test.ts`. Every throwaway test was deleted; `ls packages/engine/src/zz_*` prints nothing.

## Files changed (19, all `packages/engine/src/`)

`mirror.ts`, `mirror.test.ts`, `productionComposition.test.ts`, `engine.ts` (planted and restored only — identical to HEAD), `cascade.ts`, `cascade.test.ts`, `personality.ts`, `personality.test.ts`, `registration.ts`, `registration.test.ts`, `brief.ts`, `brief.test.ts`, `families.ts`, `families.test.ts`, `catalogue.ts`, `asset.ts`, `hawkes.ts`, `structure.ts`, `regime.ts`, `index.ts`.

`git status --short -- packages/engine/src` lists exactly those 19 modified files (`engine.ts` is not among them: `git diff --quiet -- packages/engine/src/engine.ts` after every plant). No files were added.

---

## a3-01 (critical) — the mirror harness reflected through the origin

**Changed:** `mirror.ts` (`runMirrorTest` rewritten to ADR-0003 §6; `MirrorOptions.burnInTicks: number | InteriorRange` with an optional `interior: RandomSource` to draw `N` from; `MirrorResult.snapshotAt`; `MAX_REPORTED_DIVERGENCES`; docstring rewritten), `mirror.test.ts` (randomised `N` in `[1_000, 30_000]` from `derive('interior')`; a test that the snapshot price is non-zero and the harness reports the index; option validation for the range form and its determinism), `productionComposition.test.ts` (`N` drawn per asset in `[2_000, 8_000]` from a fixed test keyring — the production keyring is a random secret by design, so the reflection point is drawn from a seed of its own and stays reproducible), `index.ts` (exports `InteriorRange`, `MAX_REPORTED_DIVERGENCES`).

**How it works now:** one engine is built and run to `N`, `snapshot()` is taken, and two fresh engines are `restore()`d from it — the second built on a `SignInvertingStream`. `restore` seeks every stream to the snapshot cursors through the wrapper, so the two continuations differ only in the sign of every draw after `N`. The from-origin variant was dropped rather than renamed: the interior harness catches every class the old one caught (all leverage plants) plus the origin-symmetric level class, so it was redundant.

**Watched failing.** Plant 20 (the report's round-number support/resistance field, `srFactor = 1.5 − |(#price mod 1000) − 500|/500` on the magnitude before quantisation in `engine.ts`, reading the engine's own `#price`):

```
# plant in place, OLD harness
$ npx vitest run --project unit packages/engine/src/mirror.test.ts packages/engine/src/productionComposition.test.ts
 Test Files  2 passed (2)   Tests  19 passed (19)   EXIT=0          -> SURVIVED
# plant still in place, NEW harness (mirror.ts rewritten, tests unchanged)
   × eurusd mirrors exactly under environment: production  → expected [ { kind: 'increment', …
   × gbpjpy / btcusd / spx / xauusd  (same)
   × negating the sign source negates every increment ...  → "increment -19 is not the negation of 20"
   × holds from many different interior points  → burn-in 1: expected [ { kind: 'increment', …
   × (regimes+structure, complete stack, and their interior-point variants)
      Tests  11 failed | 8 passed (19)   EXIT=1                     -> CAUGHT
# plant reversed by exact-string replacement; git diff --quiet -- engine.ts => "engine.ts identical to HEAD"
      Tests  19 passed (19)   EXIT=0
# after the test updates
 ✓ productionComposition.test.ts (7 tests)   ✓ mirror.test.ts (14 tests)   Tests 21 passed (21)   EXIT=0
```

**Plant table (new harness; each plant reversed and `engine.ts` verified identical to HEAD afterwards):**

| #   | layer                                     | leak                                                                | via                   | old harness         | new harness                                                                                                    |
| --- | ----------------------------------------- | ------------------------------------------------------------------- | --------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| 20  | `engine.ts` magnitude before quantisation | round-number S/R field on `price mod 1000` (origin-symmetric level) | own `#price`          | SURVIVED 19/19      | **CAUGHT** 11/19 fail, first kind `increment` on every catalogue asset under `production`                      |
| 15  | `engine.ts`                               | leverage `×(1 + 0.1·lastSign)`                                      | own `#lastSign` field | (caught before too) | **CAUGHT** 12/21 fail                                                                                          |
| 16  | `engine.ts`                               | parity of the lattice price `×(1 + 0.1·parity)`                     | own `#price`          | survived            | survived 21/21 — expected: parity is a function of magnitudes alone (a3-09), no harness can or should catch it |

**Doc lines elsewhere:** none required for correctness — ADR-0003 §6 now describes the implementation. Optional: `docs/architecture/MARKET_MODEL.md` "Mirror test | zero divergences" could read "zero divergences from a random interior snapshot, the sign negated only after it (a3-01)"; `docs/architecture/INVARIANTS.md:44` INV-006 row could add "interior-snapshot harness since Cycle Audit 7". Every "mirror test: zero divergences" line in PH-3.x records remains true of the origin reflection only; the audit record should say so once.

## a3-02 (material) — the level self-check was vacuous

**Changed:** `mirror.test.ts` — the `LevelAnchoredModel` plant is now the plant-20 mechanism itself (`1.5 − |(p mod 1000) − 500|/500`), its `snapshot()` returns only `{ inner }`, and the test asserts `divergences[0].kind === 'increment'` and `divergences.some(d => d.kind === 'increment')`.

**Watched failing** (throwaway `zz_fix_a302.test.ts`, the de-vacuated plant through an inline copy of the old from-origin harness and through the new one):

```
[a3-02] from-origin harness: mirrored=true kinds=
[a3-02] interior harness:    mirrored=false first=increment kinds=increment,increment,increment,increment,increment snapshotAt=2000
```

## a3-03 (material) — `clustering: 0` inside the fence, unbuildable

**Decision:** admit `lowMultiplier === 1` in `assertCascadeConfig` (`(0, 1]`) as the degenerate constant cascade. **Alternative rejected:** a strictly positive `TRAIT_BOUNDS.clustering.min`, which would re-normalise every trait distance in `differentiation.ts` and shift the basis of the measured `MINIMUM_TRAIT_DISTANCE`; the chosen option leaves every registered asset's traits and every distance exactly as measured. The constant cascade still draws from its stream on every switch, so cursors advance identically.

**Changed:** `cascade.ts` (guard + docstring, `MAX_CASCADE_COMPONENTS`), `cascade.test.ts` (`'multiplier at one'` → `'multiplier above one'` (1.000001) plus a test that `lowMultiplier: 1` builds a cascade that multiplies by exactly 1 over 5,000 ticks), `personality.ts` (`TRAIT_BOUNDS` docstring), `personality.test.ts` (new `describe`: every trait at both bounds builds a `createMarketEngine` engine and runs 2,000 ticks with safe-integer prices and increasing instants; a corner that breaks the joint ladder bound is taken on the shallowest ladder, the deepest on the narrowest spacing — 24 cases).

**Watched failing:**

```
# corner test added, cascade.ts untouched
   × every corner of the trait bounds builds a running engine > clustering at its minimum
     → lowMultiplier must lie in (0, 1), received 1.
      Tests  1 failed | 55 passed (56)   EXIT=1
# after the guard change: personality.test.ts 56 passed (in the whole-engine run below)
```

## a3-04 (material) — ids of 52–64 refused at `safety` with a label error; the brief threw

**Changed:** `registration.ts` (`MAX_LABEL_COMPONENT_LENGTH = 64`, `MAX_ASSET_ID_LENGTH = 64 − 'registration-'.length = 51`, new `checkAssetId(id)` used by `checkIdentity`, message in characters: _"Asset id "…" is 52 characters; the maximum is 51. Registration derives its streams under the label "registration-…", and a key label holds 64."_), `brief.ts` (`requestFromBrief` calls `checkAssetId` before any `derive` and throws `RangeError` with that message), `registration.test.ts` (pins `MAX_ASSET_ID_LENGTH` = 51 against `assertValidStreamLabel(registrationKeyLabel(...))` at 51 ok / 52 throws; pins `MAX_LABEL_COMPONENT_LENGTH` at 64 ok / 65 throws), `brief.test.ts` (a 52-char id throws `/maximum is 51/` against a keyring whose `derive` throws — proving nothing was derived; a 51-char id passes).

**Before → after** (throwaway `zz_fix_registration.test.ts`):

```
[probe] checkIdentity len 52: null
[probe] registerAsset id len 52 -> refused @safety: Stream label component "asset" is invalid: "registration-aaaa…"
[probe] requestFromBrief len 52: InvalidStreamLabelError: Stream label component "asset" is invalid …
---
[probe] checkIdentity len 52: Asset id "aaaa…" is 52 characters; the maximum is 51. Registration derives its streams under the label "registration-aaaa…", and a key label holds 64.
[probe] registerAsset id len 52 -> refused @identity: Asset id "…" is 52 characters; the maximum is 51. …
[probe] requestFromBrief len 52: RangeError: Asset id "…" is 52 characters; the maximum is 51 …
[probe] registerAsset id len 51 -> registered precision=5
```

**Doc/code lines elsewhere:** `apps/api/src/registration.service.ts:141` calls `requestFromBrief` inside the `try` and records a throw as job state `failed`; it should call `checkIdentity(job.brief, this.venue.catalogue)` first and record a non-null result as `refused` at `identity`, so an over-long id is a refusal rather than a failure (the throw now at least carries the operator's words). `docs/architecture/CATALOGUE_AND_PANEL.md` §1 `identity` row: add "an id longer than 51 characters (the key label holds 64 and `registration-` takes 13)".

## a3-05 (material) — the clamp and the retreat authored below the band, silently

**Changed:**

- `families.ts`: `ArchetypeSample.clampedFrom?: number` — the archetype's floor, present only when `reachableExcessKurtosis × KURTOSIS_HEADROOM` is below it (the draw is then exactly the ceiling). `alt-crypto.cascadeDepth` `{min: 5, max: 9}` → `{min: 7, max: 9}` with the measurement table in the archetype's comment.
- `catalogue.ts`: `AuthoringTargets` gains optional `drawnExcessKurtosis`, `retreats`, `clampedFrom` (used by both `RegistrationRequest.targets` and `RegisteredAsset.authored`).
- `brief.ts`: `request.targets` carries `drawnExcessKurtosis: sample.excessKurtosis`, `retreats`, and `clampedFrom` when present (the top-level `retreats` return is kept — `catalogueScale.stat.test.ts` reads it).
- `registration.ts`: `authored` copies those three fields from `request.targets` when present; a hand-authored request records none.
- Tests: `families.test.ts` (every archetype's 8 draws now must be ≥ band floor with `clampedFrom` undefined; an unreachable band `[5000, 6000]` clamps every draw with `clampedFrom: 5000`; 300 alt-crypto draws with 0 below band, async-yielding), `brief.test.ts` (targets carry draw/retreats/clampedFrom), `registration.test.ts` (`authored` carries them; hand-authored `authored` has exactly `['excessKurtosis', 'tickRms']`).

**Measurement** (throwaway `zz_fix_a305.test.ts`, 2,000 `sampleArchetype` draws per candidate, seed `a305-measure`):

```
baseline (depth floor 5)     below=  97/2000 k=[93.5, 165.0]  d5:95/435(min 93.5) d6:2/377(min 128.2) d7:0/390 d8:0/401 d9:0/397
depth min 6                  below=   0/2000                   d6:0/517(min 130.1) d7:0/510 d8:0/500 d9:0/473
depth min 7                  below=   0/2000                   d7:0/665(min 130.0) d8:0/686 d9:0/649
band min 120                 below=  56/2000 k=[89.6, …]       d5:56/409
band min 100                 below=   9/2000 k=[86.2, …]       d5:9/395
band min 95                  below=   2/2000 k=[84.7, …]       d5:2/407
band min 90                  below=   0/2000 k=[90.0, …]       (d5 ceilings of 84.7 seen in the run above — not robust)
regimeSpread min 1.3         below=  38/2000                   d5:38/358(min 103.5)
regimeSpread min 1.35        below=  17/2000                   d5:17/368(min 114.6)
depth min 6 + regimeSpread 1.3  below=0/2000 ;  depth min 6 + band min 125  below=0/2000
```

**Decision:** depth floor 5 → 7. Below-band draws come only from depths 5 and 6; depth 6 alone shows 2/377 in the baseline sample (~0.2%, so a "0 of 2,000" claim for `depth min 6` would fail in roughly half of runs), and a band floor would have to fall to about 84 to hold — inside `metal`'s band, which is no longer "extreme". Seven keeps the band and the character: still the shallowest ladder beside `cross-fx` and `energy`. **Alternatives:** band floor ≤ 84 (rejected: dilutes the archetype), depth 6 plus a band floor of 125 (rejected: two edits, marginal).

**Watched failing:** the 300-draw test on the old box: `expected 18 to be +0` (18/300 below band); after the depth change 0/300 and `families.test.ts` 40/40. The `authored` record test with the spread reverted: `expected { …(2) } to match object { drawnExcessKurtosis: 72, … }`; restored, passes.

**What the runner should print** (`tools/sim/src/catalogueScale.ts`, outside my set): per registered asset, `asset.authored.drawnExcessKurtosis`, `asset.authored.excessKurtosis`, `asset.authored.retreats` and `asset.authored.clampedFrom`; a "Retreats and clamps" section listing every asset with `retreats > 0` or `clampedFrom !== undefined` (id, archetype, drawn → achieved, retreats, floor fallen below), and a per-archetype count of each in the "By archetype" table. The existing `retreats` read from `requestFromBrief` can stay.

**Doc lines elsewhere:** `docs/architecture/CATALOGUE_AND_PANEL.md` §2 third bullet — after "clamped to what that rhythm can supply" add "and when that clamp falls below the family's own band the sample, the request and the registered record say so (`clampedFrom`); `alt-crypto`'s depth floor is 7 so that it never does (Cycle Audit 7, a3-05)". `docs/phases/PH-21.1-a-hundred-assets.md:58` "`retreats` is returned so a caller can see how often the estimate was wrong" → "…and carried on `request.targets` and `RegisteredAsset.authored` beside the drawn target, so the record says when the family asked for more". `docs/evidence/CYCLE-7-CATALOGUE-SCALE.md`: note that the recorded run predates the `alt-crypto` depth floor moving from 5 to 7, so its alt-crypto draws are from the old box.

## a3-06 (material) — three refusals at the wrong stage

**Changed:** `registration.ts` — (1) with a `dispersion` supplied, before the safety gate: finite/positive check moved up, and `request.traits.volatility` outside `TRAIT_BOUNDS.volatility` refused at `dispersion` in budget terms (_"A quarterly dispersion of 50 puts this personality's base volatility at 0.0185, outside [1e-7, 0.001]. Amplitude scales with the budget, so the budgets this personality can carry lie in [2.70e-4, 2.70]."_ — the homogeneity of degree one is what makes the band a rescaling); (2) `targets.excessKurtosis` outside `EXCESS_KURTOSIS_BAND` refused at `safety` before `assertPersonalitySafe`; (3) `displayPrecision > MAX_DISPLAY_PRECISION (18)` refused in `checkIdentity`, with the constant pinned against `assertValidInstrument` (18 ok / 19 throws) in `registration.test.ts`. The CA6-20 test now expects `identity`; `assertValidInstrument` on the returned instrument stays as the backstop.

**Before → after:**

```
[probe] brief dispersion 50           -> refused @safety: Personality trait volatility must be in [1e-7, 0.001], received 0.01849…
[probe] targets.excessKurtosis 250    -> refused @calibration: Personality would compound to an excess kurtosis of 247.8 … (896ms)
[probe] displayPrecision 30 (891ms)   -> refused @calibration: displayPrecision must be an integer in [0, 18], received 30.
---
[probe] brief dispersion 50           -> refused @dispersion: A quarterly dispersion of 50 puts this personality's base volatility at 0.01849…, outside [1e-7, 0.001]. …
[probe] targets.excessKurtosis 250    -> refused @safety: A target excess kurtosis of 250 lies outside the realism band [1.5, 200]. … (0ms)
[probe] targets.excessKurtosis 1      -> refused @safety: … outside the realism band [1.5, 200] …
[probe] displayPrecision 30 (0ms)     -> refused @identity: Display precision must be an integer in [0, 18], got 30.
```

**Doc lines elsewhere:** `CATALOGUE_AND_PANEL.md` §1 stage table — `identity`: add "a display precision above 18; a reference price outside [1e-15, 1e15]"; `safety`: add "a target tail weight outside the realism band"; `dispersion`: add "a budget that scales the base volatility out of its bounds — checked ahead of the safety gate, since the gate reads the scaled traits"; `calibration`: drop "an instrument the core rejects" as the _first_ line of defence (it remains the backstop). The sentence "six stages … in order" should note that the budget's own bounds are checked before `safety`.

## a3-07 (minor) — `displayPrecisionFor` negative or infinite

**Changed:** `asset.ts` (`Math.max(0, …)`), `registration.ts` (`REFERENCE_PRICE_BOUNDS = { min: 1e-15, max: 1e15 }` in `checkIdentity`). **Bound justification:** a double carries 15–16 significant digits; below 1e-15 an 18-decimal display shows fewer than three of them, above 1e15 the integer part alone exhausts them, so outside the range the screen would print digits the price does not have. Tests: 5e-324, 1e-16, 1e300, +∞ refused at identity; 1e-15, 0.5, 68000, 1e15 accepted; a registration at `referencePrice: 1e12` registers at `displayPrecision: 0`.

**Before → after:** `ref 5e-324 -> refused @calibration: displayPrecision … received Infinity` / `ref 1e300 -> … received -292` → both `refused @identity: Reference price … is outside [1e-15, 1e+15], the range a display can render …`.

## a3-12 (minor) — the retreat retried every error

**Changed:** `personality.ts` — `export class TailWeightUnreachableError extends RangeError` thrown by `solveClustering` for the "needs more cascade inflation than clustering 0.4 can provide" case only; `brief.ts` — `reachableTarget` retreats on that type and rethrows everything else; `index.ts` exports it; `brief.test.ts` stages the solve through a `vi.mock` switch (real solve unless overridden): two typed refusals → `retreats: 2`, three calls, target × 0.81; a plain `RangeError` → rethrown after **one** call; six typed refusals → `retreats: 6`, six calls.

**Watched failing** (guard line replaced by `void error`, test run, guard restored and grepped back):

```
   × rethrows a refusal a lower target cannot fix, after one solve  → expected [Function] to throw an error
```

(the "retreats while…" case failed in that run too, for a mock-recursion bug in my test that was then fixed; the discriminating case is the rethrow.) After restoring: `brief.test.ts` 13 passed.

**Doc lines elsewhere:** `PH-21.1-a-hundred-assets.md:55-58` "steps the drawn target down by a tenth until it succeeds, at most six times" → "…only when the solve says the tail weight is beyond the cascade's reach (`TailWeightUnreachableError`); a refusal a lower target cannot fix is rethrown after one solve (a3-12)".

## a3-13 (minor) — trailing `.`, inner `..`

**Changed:** `registration.ts` — `ASSET_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/` (last character anchored, 64 max preserved) and an explicit `..` refusal in `checkAssetId` with its own message; documented as stricter than the persistence shape and never looser. `registration.test.ts` — the pattern pin updated, `eurusd.`, `eurusd-`, `eur..usd` refused, `a`, `eur.usd`, `eur-usd_1`, 51×`x` accepted, and every id the pattern admits checked against the persistence pattern. **Before:** `checkIdentity "eurusd." / "eur..usd" / "eurusd-": null (accepted)`; **after:** each returns its refusal.

**Doc lines elsewhere:** none required; `packages/runtime/src/registry.ts`, `fileStore.ts`, `packages/distribution/src/commitment.ts`, `packages/core/src/market/instrument.ts` keep the wider `{0,63}` shape, which is fine (everything registration admits, they admit). `PH-20.3-editing-and-retiring.md:44` and `PUBLICATION.md:67` describe those layers and stay true.

## a3-10 (minor) — load-bearing literals named

No numeric value changed and no expression was re-associated, so floating-point results are bit-identical; `catalogue.test.ts` ("re-authors to exactly its recorded traits", `toEqual` on traits and `toBe` on the achieved kurtosis for all five assets) passed in the whole-engine run, which is the exact check for the `personality.ts` renames.

| file             | literal                                                                      | now                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `personality.ts` | `intervalMs = 1_000`, `previousMagnitude: 10`, `instant = 1_776_000_000_000` | `STRUCTURE_PROBE_INTERVAL_MS`, `STRUCTURE_PROBE_MAGNITUDE`, `STRUCTURE_PROBE_EPOCH_MS`, with the note that the magnitude is load-bearing because a constant path rate pins tightness to 1                                  |
| `personality.ts` | `7.5`                                                                        | `LANCZOS_SHIFT` (kept as one literal: `shifted + 7.5` ≠ `shifted + 7 + 0.5` in floating point)                                                                                                                             |
| `personality.ts` | `2_000`, `100`                                                               | `STATIONARY_POWER_ITERATIONS`, `CLUSTERING_BISECTION_STEPS`                                                                                                                                                                |
| `asset.ts`       | `previousMagnitude = 10`, `100`                                              | `CALIBRATION_INITIAL_MAGNITUDE`, `MIN_HORIZONS_PER_REPLICATE`                                                                                                                                                              |
| `hawkes.ts`      | `0.693_147_180_559_945_3`, `1e-9`                                            | `LN2` (same literal — `LN2_HI` in `portable.ts` is the _high half_ of a split ln 2, a different double, and is not exported; `Math.LN2` is specified only as approximate, so the literal stays), `MIN_REFERENCE_MAGNITUDE` |
| `structure.ts`   | `Math.min(3, tightness)`                                                     | `MAX_TIGHTNESS`                                                                                                                                                                                                            |
| `cascade.ts`     | `24`                                                                         | `MAX_CASCADE_COMPONENTS` (exported)                                                                                                                                                                                        |
| `regime.ts`      | `1_000`                                                                      | `MAX_TRANSITIONS_PER_TICK` (exported)                                                                                                                                                                                      |
| `mirror.ts`      | `5`                                                                          | `MAX_REPORTED_DIVERGENCES` (exported)                                                                                                                                                                                      |

Left as is: `factory.ts:47` `baseVolatility: 1e-5` — it is a documented field of a named config object already.

## a3-08 (minor) — the gate's resolution

Stated in `mirror.ts`'s docstring ("Resolution"): the gate compares `floor(m/q + u)`, a relative perturbation `ε` flips it with probability ≈ `ε·m/q` per tick, so the smallest visible leverage over `T` compared ticks is ≈ `1/(steps per tick × T)` ≈ 1e-5 at ten-step magnitudes and 7,000 ticks; a 1e-9 leverage and deterministic signed rounding (half-integer `m/q` only) pass; the battery's 0.217pp floor is the instrument for that class.

Skipped as instructed: a3-09, a3-11, a3-14.

---

## Final verification (worktree root)

```
$ npx vitest run --project unit packages/engine/src/families.test.ts      Tests 40 passed (40)   exit 0
$ npx vitest run --project unit packages/engine                            Test Files 17 passed (17)  Tests 385 passed (385)  exit 0
   (then one type-only import fix in brief.test.ts for the lint error below; brief.test.ts re-run: 13 passed, exit 0;
    the whole set re-run after that edit is appended at the end of this file)
$ npx tsc -p packages/engine/tsconfig.json --noEmit                        exit 0
$ npx eslint packages/engine/src                                           exit 0  (after fixing one consistent-type-imports error in brief.test.ts)
$ npx prettier --check packages/engine/src                                 "All matched files use Prettier code style!"  exit 0
$ git -C /home/alejo/.otc-audit7/fix status --short -- packages/engine/src packages/core/src/entropy/label.ts
 M packages/engine/src/asset.ts        M brief.test.ts   M brief.ts        M cascade.test.ts   M cascade.ts
 M catalogue.ts   M families.test.ts   M families.ts     M hawkes.ts       M index.ts          M mirror.test.ts
 M mirror.ts      M personality.test.ts  M personality.ts  M productionComposition.test.ts  M regime.ts
 M registration.test.ts   M registration.ts   M structure.ts
 (19 files changed, 1099 insertions(+), 136 deletions(-); nothing added; label.ts untouched)
```

Note for the orchestrator: `tools/sim/src/sampledCatalogue.stat.test.ts`, `catalogueScale.stat.test.ts` and any evidence drawn from `alt-crypto` will draw different personalities now that its depth floor is 7 — these were not run here (statistical suite excluded by the brief).

```
$ npx vitest run --project unit packages/engine   (final, after the last edit)
 Test Files  17 passed (17)
      Tests  385 passed (385)
exit 0
```
