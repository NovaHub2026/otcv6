# Fix report — `packages/lab`, `packages/fixtures`, `tools/sim` (a4-01…a4-12, a1-01)

Worktree `/home/alejo/.otc-audit7/fix`, branch `feature/out-of-band-audit`, 2026-09-02. Every number below is from a command whose exit code was seen; commands are quoted beside them.

## Files changed or added (exactly)

Modified:

```
packages/fixtures/src/fixtures.test.ts
packages/fixtures/src/fixtures.ts
packages/lab/src/attacks/battery.test.ts
packages/lab/src/attacks/battery.ts
packages/lab/src/attacks/index.ts
packages/lab/src/attacks/registry.ts
packages/lab/src/differentiation.test.ts
packages/lab/src/differentiation.ts
packages/lab/src/horizonTally.test.ts
packages/lab/src/horizonTally.ts
packages/lab/src/index.ts
packages/lab/src/observer.ts
packages/lab/src/outcomes.test.ts
packages/lab/src/outcomes.ts
packages/lab/src/realism.test.ts
packages/lab/src/realism.ts
packages/lab/src/standing.test.ts
packages/lab/src/standing.ts
tools/sim/src/assetLifecycle.stat.test.ts
tools/sim/src/detectionPower.stat.test.ts
tools/sim/src/dispersionEvidence.ts
tools/sim/src/edge.ts
tools/sim/src/horizonCoverage.stat.test.ts
tools/sim/src/horizonCoverage.ts
tools/sim/src/operations.stat.test.ts
tools/sim/src/phaseAcceptance.stat.test.ts
tools/sim/src/runner.ts
tools/sim/src/sampledCatalogue.stat.test.ts
docs/architecture/VALIDATION.md
```

Added:

```
packages/lab/src/attacks/gateSensitivity.stat.test.ts
```

Untouched, by the rules: `guardrailMetaAudit.stat.test.ts`, `catalogueScale.ts`, `catalogueScale.stat.test.ts`, `venueScale.ts`, everything outside the set. A throwaway probe (`packages/lab/src/attacks/zzProbeGate.stat.test.ts`) was created for a4-01 and deleted; `git status` shows no trace. One scoped `npx tsc -b packages/lab` was run so `tools/sim` could typecheck against fresh lab declarations (`tools/sim` resolves `@otc/lab` through `packages/lab/dist`, which is gitignored). No `npm run build/lint/gate/test`, no coverage, no whole statistical suite.

---

## a4-03 (material) — the PH-1 look-ahead bug class now has a unit guard

**What changed.** `packages/lab/src/outcomes.test.ts`, two new `describe`s, no production change:

- _Hand-built ticks_: 13 ticks at 10 s spacing, prices `[100,101,99,100,102,98,100,100,103,97,100,101,99]`, 30 s contracts on the clock with `strideMs: 30_000` passed explicitly (the default stride is now `H + 1 s`, a4-02, which would drop the fourth contract off the end of the data). Asserts entry indices `[0,3,6,9]` and outcomes `[0,0,-1,1]`; a perturbation of the entry tick (index 6 → 96) gives `[0,-1,1,1]`; a perturbation of its predecessor (index 5 → 90) changes nothing; tick 9 moved −1 ms gives the same outcomes, +1 ms gives entries `[0,3,6,8]` and outcomes `[0,0,1,-1]`.
- _Linear scan_: a 40,000-tick seeded walk with flats (a third of ticks flat, intervals 1–3000 ms), all eight horizons × both entry modes (16 cases): entry index equals a forward scan's last-at-or-before, outcome equals `sign(prices[scan(t+H)] − prices[entry])`, every decided outcome has expiry index > entry index and expiry instant in `(t, t+H]`. Counted inside the loop, asserted once (the `testCost` guard's rule).

**Decision.** `OutcomeSampling` does not gain an `entryPrices` field: the outcome-equals-scan assertion is what catches the plant, and a stored price would be memory for no extra guard. The auditor's "recorded entry price" assertion is therefore expressed through the outcome.

**Plant, watched failing.** `outcomes.ts:128` `compare(expiry.price, entry.price)` → `compare(expiry.price, logPrice(dataset.prices[Math.max(0, entry.index - 1)]!))`.

```
npx vitest run --project unit packages/lab/src/outcomes.test.ts packages/lab/src/observer.test.ts \
  packages/lab/src/attacks/battery.test.ts packages/lab/src/horizonTally.test.ts
  Tests  19 failed | 59 passed     — all 19 failures are the new tests; the 13 pre-existing
                                     outcomes tests, observer (15), battery (18), horizonTally (10) pass
restored from a snapshot; git diff -- packages/lab/src/outcomes.ts → 0 lines
npx vitest run --project unit packages/lab/src/outcomes.test.ts → 32 passed
```

---

## a1-01 (critical) — hosted CI red: `sampledCatalogue` ran 92 s without a loop turn

**What changed.**

1. `packages/lab/src/observer.ts` exports `yieldToLoop()` — two chained `setImmediate`s, docstring citing a1-01 (R3 failed with one immediate between two 35 s blocks, R7 passed with two; the second immediate cannot run before a poll phase, where the IPC reply is read). Exported from `packages/lab/src/index.ts`.
2. `buildObserverDataset` yields **once per call before the loop, whatever the size**, and every `chunkTicks` — the old single yield never fired below 250,000 ticks, which is why 24 × 80,010-tick builds were one stretch.
3. Every yield in `packages/lab` uses it: `observer.ts` (both), `runBatteryAsync`. Every yield in my `tools/sim` files uses it: `runner.ts`, `edge.ts`, `horizonCoverage.ts` (`breathe` removed), `dispersionEvidence.ts`, `detectionPower.stat.test.ts` (`breathe` removed), `assetLifecycle.stat.test.ts`, `operations.stat.test.ts`, `sampledCatalogue.stat.test.ts`.
4. `sampledCatalogue.stat.test.ts`: `signaturesFor` passes `chunkTicks: 10_000`; `await yieldToLoop()` after every asset in the catalogue loop, after every clone, and after every archetype; the existing yield at line 239 converted. Comment names a1-01 and the mechanism.

**Before** (auditor a1, from the CI logs and local sweeps): last test 94,027 / 92,660 / 91,824 ms on CI, 55,477 ms locally; `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` with every test passing; `main` red on four consecutive pushes.

**After.**

```
npx vitest run --project statistical tools/sim/src/sampledCatalogue.stat.test.ts
 ✓ tools/sim/src/sampledCatalogue.stat.test.ts (4 tests) 538903ms
   ✓ registers three assets from every archetype              140803ms
   ✓ is structurally sign-blind, asset by asset                33795ms
   ✓ lands on the dispersion budget its family declared       290948ms
   ✓ separates its own siblings, not merely its families       73354ms
 [rpc-probe] worst block 16.6s, worst round trip 3.7s (onTaskUpdate) in this file.
 EXIT=0   — no onTaskUpdate error
```

The run was deliberately concurrent with the calibration run, the phase-acceptance run and the a4-01 probe on the shared machine (the "dispersion budget" test took 291 s against a1's 191–323 s), so the 73 s of the last test is a loaded figure: the point is that it now contains loop turns, and the watchdog's worst round trip was 3.7 s against a 60 s timer. The 16.6 s worst block is inside one of the earlier tests (the watchdog does not say which); it is under the 30 s round-trip failure threshold and it is not in the code I changed.

**Yields outside my set still on the single-immediate form** (to convert to `yieldToLoop()`; `packages/engine` cannot import `@otc/lab` without a new dependency edge, so either move the helper to `@otc/core` or keep a local two-immediate helper there): `packages/engine/src/asset.ts:527` (`calibrateAssetAsync`), `rhythm.stat.test.ts:40`, `personality.stat.test.ts:82`, `structure.test.ts:133`, `dispersion.stat.test.ts:85`, `latticeTies.stat.test.ts:69`, `families.test.ts:321` (`families.stat.test.ts:26` already chains two); `packages/runtime/src/backfill.ts:242`, `cluster.test.ts:286`, `multiNode.test.ts:154`; `tools/sim/src/catalogueScale.stat.test.ts:76,82,106,115,163` (excluded from my set). `CLAUDE.md` §5's convention paragraph must change to `yieldToLoop()` (outside my set; text below).

---

## a4-04 (material) — the standing verdict now runs the learned family

**What changed.** `standing.ts` `composeFamilies` returns `[...defaultFamilies(), ...withheld]`; the `ATTACK_FAMILIES` import is gone; module and function docstrings say what was wrong (26 families ran, `learned-logistic` absent, `featureKinds` could never contain `'learned'`). `standing.test.ts` asserts `verdict.families` contains `'learned-logistic'` in "reports the families it built…" and that `composeFamilies` carries it.

**Watched failing.** Assertions added before the fix:

```
npx vitest run --project unit packages/lab/src/standing.test.ts …
 × reports the families it built and the withheld ones it could not
   AssertionError: expected [ 'absolute-price-level', …(23) ] to include 'learned-logistic'
 × composing the family set carries every family it was given
   AssertionError: expected [ 'previous-move', …(25) ] to include 'learned-logistic'
after the fix: standing.test.ts 33 passed
```

Consequence to note: a standing run now composes 28 families (22 registry + `unconditional` (a4-01) + `learned-logistic` + 4 withheld) instead of 26. No consumer in `apps/*`, `packages/runtime`, `trading` or `distribution` counts them (grepped).

---

## a4-02 (material) — the clock grid sweeps every phase

**What changed.**

- `outcomes.ts`: `PHASE_SWEEP_OFFSET_MS = 1_000`, `defaultStrideMs(H) = H + 1_000`, used as the default stride; both exported from `@otc/lab`. Docstring gives the argument: every product horizon is a multiple of 30 s and every temporal grid (15 s, 60 s, 225 s, 300 s, 600 s, 900 s, 3600 s) factors into 2, 3, 5 only, so `H + 1 s ≡ 1 (mod 2, 3, 5)` is coprime to every grid on the one-second lattice and the phase `k·(H+1 s)` visits every residue; windows stay non-overlapping.
- `battery.ts`: `VerdictCoverage.bucketsNeverVisited` (buckets with no entry at all), disjoint from `bucketsSkippedForOccupancy` (entries, but fewer decided than the floor); two distinct notes ("received no entry at all … a gap in what was sampled, not a shortage of samples").
- Tests: `outcomes.test.ts` asserts `gcd(H + 1 s, grid) = 1 s` for all 8 × 7 pairs; on a 45-day dataset (ticks every 30 s) every bucket of every temporal family receives entries at every horizon and the sixths of the minute are within 20% of equal; and the control — `strideMs: horizonMs` at 1 m visits exactly one sixth. `battery.test.ts` exercises the split with a family that never produces its third bucket, and shows `second-of-minute` at 1 m with `bucketsNeverVisited` 0 under the default and 5 under the old stride.

**Decision: 1 s, not the 7 s the audit suggested.** Both sweep the same residues (any offset coprime to 60/900/3600 does); 7 s costs 19% of the 30-second sample and would take the calibration control's floor to ≈0.246 pp against its 0.2513 pp assertion, 1 s costs 3.2% (0.1% at 15 m). The 1 s sweep is slower per entry — the 3600 s grid at 15 m needs 3600 entries ≈ 37.5 days — which is inside every evaluation span in use and shorter than the history any 15 m bucket needs to reach the occupancy floor. A per-window offset drawn from the stream was the other option; it either costs as much as a wide offset or sweeps as slowly as a narrow one, and adds a stream dependency for no gain.

**Numbers** (`npx vitest run --project statistical packages/lab/src/attacks/calibration.stat.test.ts`, 12/12, 174.8 s, EXIT 0):

| run                         | before (auditor, same file)                                                      | after                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| control                     | 760 hypotheses, 23 families, worst z +3.68, **48 occupancy skips (46 aliasing)** | **814** hypotheses, 24 families, worst z **−3.08** (`learned-logistic` @4m), **2 under-occupied, 0 never visited** |
| drift                       | caught                                                                           | caught, worst z 113.33 (`unconditional`)                                                                           |
| leverageEffect              | caught                                                                           | caught, worst z 15.44 (`unconditional`)                                                                            |
| signAutocorrelation         | caught                                                                           | caught, worst z 91.65 (`previous-move`)                                                                            |
| displayQuantization         | caught                                                                           | caught, worst z −83.50 (`position-in-range`)                                                                       |
| boundaryTiming              | caught                                                                           | caught, worst z 158.02, 319 temporal findings, `second-of-minute` among them (asserted)                            |
| levelAnchored, conventional | 541 hyp, clean, z −3.36                                                          | **595** hyp, **clean**, z −3.36 (`run-length`)                                                                     |
| levelAnchored, full         | 754 hyp, EXPLOITABLE, z −6.09                                                    | **808** hyp, **EXPLOITABLE**, z **−5.36** (`price-modulo-4000`), 37 level-anchored + 5 learned                     |

Sample at 30 s: 385,699 (was 398,764; −3.3%, as the stride predicts). Phase acceptance (`tools/sim/src/phaseAcceptance.stat.test.ts`, 2/2, EXIT 0): 797 hypotheses across 24 families, worst z +3.53 (`position-in-range` @15m), 3 under-occupied, **16 never visited** (now reported as such), 30 s floor 0.2207 pp (was 0.217). No exact-count assertion in `tools/sim` needed changing; `calibration.stat.test.ts` (tools/sim) uses its own tick-index estimator and was not affected.

---

## a4-01 (material) — the gate's own sensitivity is computed, printed, and measured against the leak it is quoted for

**What changed.**

- (a) `registry.ts`: `UNCONDITIONAL_FAMILY` — one bucket, `bucket() => 0`, first in `ATTACK_FAMILIES`, classed `translation-invariant` (a constant is invariant to every translation, and a conventional battery contains this test). Exported. `battery.test.ts`'s "every family has ≥ 2 buckets" relaxed for it by name; new test asserts its finding's `samples === sensitivity.samples` at every horizon.
- (b) `battery.ts`: `HorizonSensitivity` gains `gateMinimumDetectableEffectPoints`, `gateSufficientForPayout`, `largestBucketSamples`, `largestBucketConfirmationSamples`. Gate figure = `max(z_BH·√(0.25/n_bucket), 1.96·√(0.25/n_conf))·100` with `z_BH = Φ⁻¹(1 − q/2m)`, `m` the hypotheses tested (so computed after every horizon has run), `n_bucket` the largest tested occupancy at the horizon and `n_conf` that bucket's confirmation occupancy; `Infinity` when the largest bucket could not be confirmed. `CONFIRMATION_Z = 1.96` named. A note lists horizons where the gate figure is coarser than the threshold. `formatVerdict` prints both figures with the n's. A unit test re-derives the gate figure from the verdict's own counts to 10 decimals.
- (c) `docs/architecture/VALIDATION.md` — see a4-09 below: states that the 0.2513 pp claim refers to the single-test figure and gives the gate figures.
- Fixture: `biasedCoin` in `packages/fixtures` (`P(up) = 0.5 + strength × 0.02`, strength 1 ≈ 3.2 pp at 30 s on the calibration configuration); `fixtures.test.ts` now expects 9 fixtures and names it.
- Permanent test `packages/lab/src/attacks/gateSensitivity.stat.test.ts` (41 s): at strength 0.154 (realised 0.5012 pp at 30 s) the `unconditional` family catches it at 30 s at the full sample and the gate figure is below the realised edge; at strength 0.077 (realised 0.2508 pp) the single-test figure is below the margin and the gate figure above it (a tripwire: when it fails, the battery has become able to police the margin at the gate and `VALIDATION.md` must be rewritten), and the gate figure re-derives from the finding's counts and surface size.

**Decision.** The gate figure is the 50%-power point exactly as specified (`z_BH·σ`), not an 80%-power one; the docstring says so, because at small `m` (`z_BH ≈ 2.8`) it crosses the 80%-power single-test figure and a reader must not conclude the gate is finer than one test. `classifyStanding` still reads the single-test figure for `sufficientForProductMargin`; switching the standing verdict to the gate figure would make every venue `undecided` and is a policy change I did not make — flagged for the orchestrator. `HorizonStanding` does not carry the gate figure yet (same reason; one-line addition if wanted).

**Plant, before and after** — `biasedCoin` at the calibration configuration (7 M ticks, 5 s), keyring `gate-sensitivity`; "before" = default families minus `unconditional`, "after" = default. (Throwaway `zzProbeGate.stat.test.ts`, EXIT 0, deleted.)

| strength | realised 30 s edge, whole record                              | battery | hyp | significant | material | confirmed | exploitable | 30 s                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------- | ------- | --- | ----------- | -------- | --------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.077    | **0.2508 pp** (n 1,102,648); 1 m 0.470, 3 m 0.768, 15 m 1.488 | before  | 774 | 103         | 622      | 210       | 31          | best `volatility-state#4` z 3.90 (n 80,467, not confirmed); `price-modulo-4000#0` z 3.68 exploitable                                                                                                                                                           |
|          |                                                               | after   | 782 | 110         | 629      | 218       | 37          | `unconditional`: edge **0.2337** on the evaluation split, z **2.90**, n 386,008, confirmation 0.371 pp on 275,399 — **significant, confirmed, not material** (0.2337 < 0.2513), not exploitable; exploitable at 1 m–5 m (0.355, 0.558, 0.774, 0.824, 0.886 pp) |
| 0.154    | **0.5012 pp** (n 1,102,661)                                   | before  | 774 | 523         | 748      | 523       | 383         | best `absolute-price-level#4` z 6.04 — a drift artefact: the price left the training range, so one quintile held the whole sample                                                                                                                              |
|          |                                                               | after   | 782 | 531         | 756      | 531       | 391         | `unconditional`: edge **0.4861**, z **6.04**, n 386,027, confirmed (0.618 pp on 275,405), **exploitable**                                                                                                                                                      |

Honest reading: at the margin the verdict is EXPLOITABLE before and after, because a per-tick bias grows with the horizon and the longer horizons carry 0.35–1.5 pp; the 30-second hypothesis itself is significant under BH (the surface's other true effects relax the adaptive threshold) but below the materiality line on the evaluation split. **A leak confined to 30 s at the margin would not be found by the gate on this configuration** — its 50%-power point is 0.32 pp. The unconditional family raised the largest 30 s bucket from ~200 k (a 2-bucket family) to the full 386 k, which is what moved the gate figure from the auditor's ≈0.45–0.5 pp to 0.32 pp. Neither number is the 0.2513 pp the single-test figure suggests, and no threshold was touched.

**Gate MDE per horizon, calibration configuration** (control, `calibration.stat.test.ts`, 2026-09-02; 40/35/25 split):

| horizon | n       | single-test MDE | largest bucket (eval / conf) | gate MDE     |
| ------- | ------- | --------------- | ---------------------------- | ------------ |
| 30s     | 385,699 | 0.226 pp        | 385,699 / 275,718            | **0.323 pp** |
| 1m      | 198,039 | 0.315           | 198,039 / 141,516            | 0.450        |
| 2m      | 100,373 | 0.442           | 100,373 / 71,643             | 0.632        |
| 3m      | 67,158  | 0.541           | 67,158 / 47,991              | 0.773        |
| 4m      | 50,500  | 0.623           | 50,500 / 36,083              | 0.892        |
| 5m      | 40,478  | 0.696           | 40,478 / 28,915              | 0.996        |
| 10m     | 20,299  | 0.983           | 20,299 / 14,491              | 1.406        |
| 15m     | 13,563  | 1.203           | 13,563 / 9,672               | 1.720        |

Phase acceptance (24 M ticks, 327.1 days, 30/45/25): 30 s single-test **0.2207 pp**, gate **0.3153 pp** (n 402,832 / 223,706); 1 m 0.309 / 0.441; 15 m 1.180 / 1.686.

---

## a4-07 / a4-08 (minor) — realism ratios gated on their own precondition; integrity bands labelled

**What changed.** `realism.ts`: `ratioMetric()` evaluates a ratio only when its guard quantity clears its own band — `volatility-clustering-dominance` and `absolute-return-decay-is-slow` need `absAcf1 ≥ 0.05`, `aggregational-gaussianity` needs tick kurtosis ≥ 1.5; otherwise `value: NaN`, `pass: false`, `notEvaluated: "<guard> is x, below the y its own band requires, so this ratio would be noise over noise"`. `RealismMetric.notEvaluated?` added; `formatRealismReport` prints `n/a … not evaluated: …` and never `NaN`. `return-autocorrelation-lag1` and `mean-run-length` rationales now open with "ADR-0003 integrity requirement at tick scale, not a description of real markets" and end "Do not widen this band toward realism." Header comment explains both (and a4-06, below). `realism.test.ts`: five new tests (the three ratios not evaluated on the memoryless walk; evaluated on the clustered walk; printed as not evaluated; the two rationales name ADR-0003).

**Runs.** `npx vitest run --project unit packages/lab/src/realism.test.ts` — in the 301-test unit pass. `npx vitest run --project statistical packages/lab/src/report.stat.test.ts` → 4/4, 42.8 s, EXIT 0: Gaussian walk `IMPLAUSIBLE (7/15)` with the three ratios printed `n/a … not evaluated`, `symmetricControl` realism **15/15**, `leverageEffect` 13/15 and EXPLOITABLE. Note for PH-2.3's record: the memoryless walk now fails eight metrics (three of them by precondition), not "exactly seven".

---

## a4-11 (minor) — an exact tie is confused, not correct

`differentiation.ts`: on `distance === bestDistance` when the current best is the true asset, the window is handed to the tying candidate. Test (watched failing first: `expected 0.5 to be +0`): two identical two-asset signatures × 3 windows → accuracy 0, `perfectlySeparated []`, confusion `[[0,3],[3,0]]`. Real signatures have no exact ties (the auditor measured 0 of 384), so `sampledCatalogue` and `multiAsset` are unaffected — `sampledCatalogue` ran after the change (above).

## a4-12 (minor) — the accumulator agrees with settlement on shared boundary instants

`horizonTally.ts`: a boundary closes only once the clock has moved strictly past it (`while (state.boundary < instant)`), on `#last` — which is then the last tick at or before the boundary, whichever of several at that instant it was, matching `priceAtOrBefore`. The window whose boundary equals the last observed instant is scored provisionally by `outcomes()` / `slowestHorizonWindows` (a pure computation, revised by a later same-instant tick), so a stream ending on a boundary still reports the window settlement would settle. For strictly increasing instants — the engine's guarantee — every count is identical to before (all 10 existing tests unchanged and passing; `detectionPower`/`horizonCoverage` consume it through the same two methods). Tests watched failing first (`expected +0 to be 1`, `expected 1 to be +0`): `[0,9,10,10]` / `[100,100,500,90]` settles 90 → down, and a boundary window is revised by a same-instant tick.

---

## a4-09 / a4-10 (minor) — living documents and the record's guards

- `docs/architecture/VALIDATION.md` refreshed from the runs above, with the command and date beside each table: blind-spot table (15 / 595 clean z −3.36; 24 / 808 EXPLOITABLE z −5.36), the two-figure sensitivity section with the full calibration table and the phase-acceptance figures, the `biasedCoin` measurement, the discipline list (never-visited buckets, the sweeping grid, the unconditional family), the PH-11 paragraph (its forty floors are single-test 80%-power figures; over its own forty-cell BH correction each cell's 50%-power point is 1.08× the floor — 0.265 pp for eurusd 15 m — and its 80%-power point 1.38×), and the cost line (24 families, ~800 hypotheses, ~11 s on the 7 M-tick control).
- `tools/sim/src/horizonCoverage.stat.test.ts`: parses the run headers' tick counts and days and the summary/interpretation lines (whitespace-tolerant — the family-wise line is wrapped mid-sentence), and re-derives: total 3.12 billion ticks and 63.9 asset-years, policed 2.0 billion and 52.0 asset-years (within 0.1), the worst cell (2.64, btcusd, 10m) from the rows, and the family-wise error rate 0.194 from `1 − (1 − p(2.64))^26` (= 0.1946). `npx vitest run --project statistical tools/sim/src/horizonCoverage.stat.test.ts -t "recorded evidence"` → 11 passed, 2 skipped (the method tests, deselected).
- `tools/sim/src/phaseAcceptance.stat.test.ts`: `toBeLessThan(0.2513)` stays; adds `toBeCloseTo(0.221, 3)` for the single-test floor (exact value 0.220705, arithmetic on the integer count 402,832 — deterministic across machines), `toBeCloseTo(0.315, 3)` for the gate figure (exact 0.315294) and `gateSufficientForPayout === false`. Header comment updated.
- **Recommendation for `catalogueScale.stat.test.ts` (outside my set):** its lines ~289–296 assert the _drawn_ closest pair; add an assertion on the _registered_ closest pair the document quotes (`CYCLE-7-CATALOGUE-SCALE.md`: 0.0282, 2.8× headroom over the 0.01 floor) — at the reduced scale the auditor measured 0.0378 (`gbpjpy / scale-cross-fx-0`), so assert `registeredClosest ≥ 0.01 × headroom` and print the pair, and have the full-scale runner's recorded figure re-derived the way `horizonCoverage.stat.test.ts` now re-derives its summary.

---

## a4-05 / a4-06 (material, documentation)

**`realism.ts` header** now reads (a4-06): the bands "have not moved since the commit that introduced them — `906e398`, 2026-08-31, which is also the commit that introduced `packages/engine` — so what the record supports is that no band has been tuned to the engine _since_, not that the bands were set before a candidate market existed. An earlier version of this comment claimed the latter; the out-of-band audit (a4-06) found the repository unable to show it."

**Paragraph for `docs/BACKLOG.md` B-029** (replace the section body's "Two independent measurements agree…" framing; keep the table but add the third row and the reading):

> **Status: unresolved — within estimator noise at 40 runs; the cold-start candidate is bounded at ≤ 5%.** The out-of-band audit (a4-05) extended the recorded procedure with the identical seeds: runs 0–39 reproduce the recorded 0.10185 bit-exactly (1.196 of calibrated), runs 40–79 read **0.711**, all 80 read **0.984**; three independent 40-run draws of the same quantity read 1.196, 0.711 and 0.773. The 3-day displacement has sample kurtosis 4.22, so the relative standard error of σ at N = 40 is about ±14% by the heavy-tail formula and ±25–30% empirically (sample kurtosis of a heavy tail is biased low) — not the ±11% Gaussian `1/√(2N)` the document used, and its "1.5 standard errors" is therefore under one. The 40 × 3 d measurement cannot distinguish a 20% gap from noise; B-029's direction rests on the 120 × 2 d reading (1.33) alone, which must be re-examined with the heavy-tail SE before anything is tuned. The cold start is not the explanation: fresh calibrations at 1 d, 4 d and 16 d spans read 0.932, 0.936 and 0.949 of the recorded value, so the state the calibration shares with the realised measurement is worth at most a few per cent; the 4 h block profile cannot resolve it at 80 runs (xauusd's first day 0.83 of later blocks, eurusd the opposite). Next step: re-measure the realised side from hundreds of non-overlapping 3 d windows of a few long warmed-up paths (minutes of compute), report the SE from the empirical kurtosis, and only then decide whether there is a gap.

**`CURRENT_STATE.md` wording** (lines 44–45, 131):

- line 44, current: `| At a resolution that matters | 30-second detection floor 0.217pp, finer than the 0.2513pp margin the 99% payout implies |` → new: `| At a resolution that matters | 30-second single-test detection floor 0.221pp, finer than the 0.2513pp margin the 99% payout implies; the gate's own 50%-power figure at 30s is 0.315pp, and VALIDATION.md says which claim is which (a4-01) |`
- line 45, current: `| Plausible | 15/15 realism metrics, targets fixed before the model existed |` → new: `| Plausible | 15/15 realism metrics, bands unchanged since the commit that introduced the engine (906e398) |`
- line 131, current: `PH-3's full-rigor run covers the canonical configuration at 0.217pp.` → new: `PH-3's full-rigor run covers the canonical configuration at 0.221pp single-test (0.315pp at the gate).`

## Every other doc line elsewhere that must change (outside my set)

| path                                                                                                                                                                                                    | current                                                                                 | new                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture/MARKET_MODEL.md:157`                                                                                                                                                                 | `Attack battery \| **clean** — all four feature kinds, ~570 hypotheses`                 | `… ~800 hypotheses (797 on the 2026-09-02 run)`                                                                                                                                                                                                                  |
| `docs/architecture/MARKET_MODEL.md:159`                                                                                                                                                                 | `Detection floor at 30s \| **0.217pp**, finer than the 0.2513pp the 99% payout implies` | `Detection floor at 30s \| **0.221pp** single-test, finer than the 0.2513pp the 99% payout implies; **0.315pp** at the gate (a4-01)`                                                                                                                             |
| `CLAUDE.md` §5, the bullet "A test body that drives the engine for more than a few seconds must yield to the event loop … `await new Promise((r) => setImmediate(r))` every few hundred thousand ticks" | as quoted                                                                               | "… `await yieldToLoop()` from `@otc/lab` — two chained immediates; one is not a guarantee (a1-01, R3 vs R7) — every few hundred thousand ticks **and before a test's first long synchronous stretch**; `buildObserverDataset` now yields at least once per call" |
| `docs/BACKLOG.md` B-002 row                                                                                                                                                                             | `All forty asset/horizon cells are policed below the 0.2513pp`                          | append `(single-test, 80%-power floors; under the record's own forty-cell correction the 15-minute cells sit at 0.265pp at 50% power — VALIDATION.md, a4-01)`                                                                                                    |
| `docs/BACKLOG.md` B-029 row                                                                                                                                                                             | `Open. Detail in the section below this table`                                          | `Open — unresolved within estimator noise at 40 runs; cold start bounded ≤ 5% (a4-05). Detail below.`                                                                                                                                                            |
| `docs/phases/PH-2.3-…` "fails exactly the seven metrics"                                                                                                                                                | as quoted                                                                               | note that after a4-07 the memoryless walk fails eight, three of them by precondition, and the count is seed-dependent                                                                                                                                            |
| `docs/phases/PH-16.1-…` §2–3 "the full battery"                                                                                                                                                         | as quoted                                                                               | add: "the learned family was missing until a4-04; the standing run composes from `defaultFamilies()` now"                                                                                                                                                        |
| `vitest.setup.statistical.ts`                                                                                                                                                                           | already references `yieldToLoop()` from `@otc/lab` (orchestrator's edit)                | now true                                                                                                                                                                                                                                                         |

## Final commands, exit codes

```
npx vitest run --project unit packages/lab packages/fixtures tools/sim   → Test Files 15 passed, Tests 301 passed, EXIT 0
npx tsc -p packages/lab/tsconfig.json --noEmit                            → EXIT 0
npx tsc -p tools/sim/tsconfig.json --noEmit                               → EXIT 0 (after `npx tsc -b packages/lab`)
npx eslint <all 29 changed/added .ts files>                                → EXIT 0
npx prettier --check <the 29 files> docs/architecture/VALIDATION.md       → "All matched files use Prettier code style!"
npx vitest run --project statistical packages/lab/src/attacks/calibration.stat.test.ts        → 12 passed, 174.8 s, EXIT 0
npx vitest run --project statistical packages/lab/src/attacks/gateSensitivity.stat.test.ts    → 2 passed, 41.5 s, EXIT 0
npx vitest run --project statistical packages/lab/src/report.stat.test.ts                     → 4 passed, 42.8 s, EXIT 0
npx vitest run --project statistical tools/sim/src/phaseAcceptance.stat.test.ts (run 1)       → 2 passed, 86.4 s, EXIT 0
npx vitest run --project statistical tools/sim/src/phaseAcceptance.stat.test.ts (run 2, pinned floors) → 2 passed, 77.3 s, EXIT 0
npx vitest run --project statistical tools/sim/src/horizonCoverage.stat.test.ts -t "recorded evidence" → 11 passed, 2 skipped, EXIT 0
npx vitest run --project statistical tools/sim/src/sampledCatalogue.stat.test.ts              → 4 passed, 538.9 s, EXIT 0, no onTaskUpdate error
git -C /home/alejo/.otc-audit7/fix status --short                          → the 29 files above plus the other agents' files
```
