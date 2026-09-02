# Auditor a4 — lab, fixtures, sim and the evidence

Worktree `/home/alejo/.otc-audit7/a4`, detached at `36bbf89`. Subject: `packages/lab`, `packages/fixtures`, `tools/sim`, `docs/evidence/`.

## Method (what you ran, what you planted, what you could not do)

Read first: `CLAUDE.md` §9, `VALIDATION.md`, `INVARIANTS.md`, ADR-0003, ADR-0007, PH-2.x, PH-9.x, PH-11.x, PH-13.x, PH-16.1, PH-19.3, every file in `docs/evidence/`, B-029/B-030, CA6 §4. Then every source file in scope (`observer.ts`, `outcomes.ts`, `horizons.ts`, `horizonTally.ts`, `statistics.ts`, `dependence.ts`, `attacks/*`, `realism.ts`, `report.ts`, `differentiation.ts` at both `ac4c3cf` and `36bbf89`, `economics.ts`, `ruin.ts`, `standing.ts`, `assurance.ts`, `fixtures/*`, `tools/sim/src/{cli,runner,edge,horizonCoverage,horizonEvidence,dispersionEvidence,catalogueScale,phaseAcceptance.stat.test,horizonCoverage.stat.test,calibration.stat.test,detectionPower.stat.test,catalogueScale.stat.test,multiAsset.stat.test}.ts`).

Executed (all with exit codes seen; every number below is from these runs):

| What                                                                              | Command / file                                                                                                                                                                                                                                                                                                                                    | Result                                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Build the worktree                                                                | `npm run build`                                                                                                                                                                                                                                                                                                                                   | exit 0, 5.7 s                                                                                  |
| Lab calibration suite                                                             | `npx vitest run --project statistical packages/lab/src/attacks/calibration.stat.test.ts`                                                                                                                                                                                                                                                          | 12/12 passed, 174 s, exit 0                                                                    |
| CLI smoke                                                                         | `node tools/sim/dist/cli.js --help`, `--list`, `--fixture symmetricControl --ticks 200000 --edge --timeframes 1m,5m`, `--bogus`                                                                                                                                                                                                                   | exit 0, 0, 0, 1                                                                                |
| Catalogue-scale runner, reduced                                                   | `OTC_SCALE_COUNT=8 node tools/sim/dist/catalogueScale.js`                                                                                                                                                                                                                                                                                         | exit 0, 31 s; 8/8 registered, closest pair 0.0378 (`gbpjpy / scale-cross-fx-0`), 3.8× headroom |
| Horizon runner, reduced                                                           | `node tools/sim/dist/horizonEvidence.js --assets eurusd --windows 300 --segments 3 --label a4-audit`                                                                                                                                                                                                                                              | exit 0, 0.4 s; table format identical to the record's columns                                  |
| Dispersion runner, reduced                                                        | `node tools/sim/dist/dispersionEvidence.js --assets xauusd,spx --replicates 2 --days 4 --runs 6 --run-days 1 --seed a4-audit`                                                                                                                                                                                                                     | exit 0, 2.2 s; xauusd real/cal 1.394, spx 1.228 (noise at this size)                           |
| Throughput floors (guarded)                                                       | `distributions.stat.test.ts`, `entropy.stat.test.ts`, `market.stat.test.ts` (core, single files)                                                                                                                                                                                                                                                  | 2.51 M/s, 9.00 M/s, 13.09 M/s                                                                  |
| Ruin guard                                                                        | `ruin.test.ts`, `ruinSimulation.stat.test.ts` with and without plants                                                                                                                                                                                                                                                                             | see a4-… and "What survived"                                                                   |
| Nine throwaway tests in `packages/lab/src/a4audit-*.test.ts` (deleted afterwards) | look-ahead/tie proof on hand-built ticks; differentiation old-vs-new bit identity; realism on a Gaussian walk × 40 seeds; MDE re-derivation and design effect under overlap; fixture mirror (global and interior); direct-vs-battery edge; planted 0.25/0.5/1 pp power; standing verdict on a leverage record; B-029 cold-start and heavy-tail SE | all exit 0 except where a failure was the finding (recorded below)                             |

Plants (each edited, run, restored with `git checkout --`, and confirmed at 0 diff lines):

1. `attacks/frame.ts:104` — rolling delta reads the _next_ tick. Caught: 7 failures across `frame.test.ts`, `battery.test.ts` and my hand-built test.
2. `outcomes.ts:108` — entry price taken from the tick _before_ the conditioning tick (the forward window includes the conditioning move: the exact PH-1 z > 1000 bug shape). **Not caught** by `outcomes.test.ts`, `observer.test.ts`, `battery.test.ts`, `horizonTally.test.ts` (59/59 passed). Caught by my hand-built test (11 failures) and by a 1 M-tick battery on the control (EXPLOITABLE, 52 findings, `previous-move` z = −47.1).
3. `ruin.ts:117` — Lundberg coefficient ×2 and ×4. `ruin.test.ts` passes both (13/13); `ruinSimulation.stat.test.ts` fails both (0.5935 > 0.4657; 0.5935 > 0.2187).

Not done, by the rules: no full gate, no whole statistical suite, no `test:cov`; `apps/*` untouched. `git status --short` at the end prints only `?? node_modules` (the expected symlink).

## Findings

### a4-01 — The quoted minimum detectable effect is not the gate's sensitivity; a 0.25 pp edge at 30 s is not detected at 30 s

**Severity** material

**Where** `packages/lab/src/attacks/battery.ts:423-429` (MDE from `sampling.decided`, single-hypothesis, α = 0.05, 80 % power) versus `:489-493` (confirmation) and `:520-528` (BH over the whole surface, gate = significant ∧ material ∧ confirmed); `docs/architecture/VALIDATION.md:111-123` ("Every horizon the product sells is now policed to the payout threshold"); `CURRENT_STATE.md:44` ("30-second detection floor 0.217pp, finer than the 0.2513pp margin").

**Claim** `minimumDetectableEffectPoints` is the effect the _battery_ can detect; a clean verdict with MDE < 0.2513 pp means a 0.25 pp edge would have been found.

**Evidence** Re-signed the symmetric control's sign-blind magnitudes with an independent coin at P(up) = 0.5 + ε (a legitimate plant: the magnitudes never read a sign), 7 M ticks at 5 s, the calibration configuration.

```
a4 eps=0.02 -> 30s edge 3.243pp (n=162837)
a4 null expectation: 2.02 of 750 tests with |z|>3; BH first-rejection needs p<=6.67e-5 i.e. |z|>=3.99
a4 PLANT target 0.25pp: realised unconditional 30s edge 0.231pp (n=1140105); battery MDE@30s 0.222pp (n=398764);
   hypotheses 728; significant 3, material 529, confirmed 51, sig&mat 3, EXPLOITABLE 2; worst z 3.77 position-in-range@3m
   top 30s findings: price-modulo-2000#1 z=3.23 sig=false | run-length#5 z=3.23 sig=false | block-index-digest-60s#7 z=2.77 | position-in-range#0 z=2.74 | block-index-digest-15s#3 z=2.74
a4 PLANT target 0.5pp:  realised 0.472pp; significant 460, EXPLOITABLE 254; 30s: absolute-price-level#4 z=5.61 sig=true conf=true ...
a4 PLANT target 1pp:    realised 0.953pp; significant 714, EXPLOITABLE 654
```

At a realised 0.231 pp (MDE says 0.222 pp is detectable) **no 30-second hypothesis is significant**; the verdict flipped to EXPLOITABLE only because the per-tick plant grows to ~1.6 pp at 3 m. The control's own run in the same suite: `760 hypotheses … worst z: +3.68` — exactly the null expectation (E[max|z|] ≈ 3.4–3.6 over 760). Arithmetic: BH's first rejection over ~730 hypotheses needs p ≤ 6.7e-5, |z| ≥ 3.99; the largest-n 30 s bucket is ~200 k (a 2-bucket family), so z = 2δ√n reaches 3.99 at δ ≈ 0.45 pp, and confirmation on ~140 k needs δ > 0.26 pp. The gate's 50 %-power point for a 30 s-only edge is therefore ≈ 0.45–0.5 pp, about twice the quoted MDE.

**Impact** Every "policed at 0.25 pp" statement (VALIDATION.md, CURRENT_STATE.md, PH-3/PH-11 approvals, `phaseAcceptance.stat.test.ts:82`, `calibration.stat.test.ts:96`) rests on a number computed for a test the battery does not run (an unconditional single hypothesis at α = 0.05). A 30 s-specific leak of the product-relevant size would pass. PH2-I8 ("MDE computed, not asserted") is satisfied literally and misleading in effect.

**Recommended fix** Report two numbers per horizon: the single-test MDE as now, and the _gate_ MDE — the edge at which a bucket of the largest available occupancy reaches the BH threshold `z_BH = Φ⁻¹(1 − q/(2m))` and the confirmation threshold, i.e. `max(z_BH·√(0.25/n_bucket), 1.96·√(0.25/n_conf))`. Add an unconditional family (one bucket) so that a uniform edge is tested at full n rather than only through split buckets. Change the wording in VALIDATION.md/CURRENT_STATE.md to state which of the two the 0.2513 pp claim refers to.

### a4-02 — Temporal families alias against the clock grid: at every horizon ≥ 1 m, `second-of-minute` tests one phase in six

**Severity** material

**Where** `packages/lab/src/outcomes.ts:343-346` (clock entries at `first + warmup + k·stride`, stride = horizon); `packages/lab/src/attacks/registry.ts:333-357` (phase families); `battery.ts:541-545` (skips attributed to occupancy).

**Claim** `second-of-minute` "catches anything phase-locked to the clock"; the notes say "N buckets held fewer than 500 decided outcomes".

**Evidence** Census on a 1.5 M-tick control, default sampling, which buckets produce a finding:

```
a4 census second-of-minute:  30s:[1,4]/6 1m:[1]/6 2m:[1]/6 3m:[1]/6 4m:[1]/6 5m:[1]/6 10m:[1]/6 15m:[1]/6
a4 census minute-of-hour:    30s..10m:[0..5]/6 15m:[0,2,3,5]/6
a4 census horizon-grid-phase: 30s..4m:[0,1,2,3]/4 5m:[0,1,3]/4 10m:[0,1,3]/4 15m:[1]/4
a4 census: 138 tested, 54 skipped for occupancy      (tick mode: 177 tested, 15 skipped)
```

Because entries sit at `t0 + k·H`, the second-of-minute phase is constant for every H that divides 60 s, and the same aliasing gives 46 of the 48 "occupancy" skips reported on the calibration control (`760 + 48 = 808 = 101 buckets × 8 horizons`). My first direct comparison failed for this reason: `second-of-minute` bucket 0 at 30 s had no finding at all (`TypeError: Cannot read properties of undefined (reading 'upRate')`); with `entryMode: 'tick'` the same bucket appears (battery 0.6951 vs my estimate 0.6955, n = 16 309 / 46 675).

**Impact** Every recorded verdict (calibration, `phaseAcceptance`, `multiAsset`, `redTeam`, `standing`) uses default sampling, so a leak keyed to any of the five untested sixths of the minute at 1 m–15 m is invisible to the family that exists to catch it, and the verdict's notes describe the gap as sample scarcity. `boundaryTiming` is still caught because its bias spans a third of the minute and leaks into the one tested phase.

**Recommended fix** Make the clock stride `H + δ` with δ coprime to 60 s/900 s (e.g. 7 000 ms — windows stay non-overlapping and sweep every phase), or draw a per-window phase offset from the injected stream; run temporal families in tick mode as well; and separate "skipped: never visited by the grid" from "skipped: under-occupied" in `VerdictCoverage`.

### a4-03 — The PH-1 look-ahead bug class is not guarded by any unit test

**Severity** material

**Where** `packages/lab/src/outcomes.test.ts:136-160` ("the look-ahead rule"); `packages/lab/src/outcomes.ts:313-333`.

**Claim** PH-2.1 E5: "No sample uses information at or after its entry instant … the entry index is proven to be the last tick at or before the entry instant, and the expiry index strictly later."

**Evidence** Plant: entry price taken from `prices[entryIndex − 1]` while `entryIndex` is left correct (the forward window then includes the conditioning tick's own move — the ROADMAP's z > 1000 bug).

```
npx vitest run --project unit outcomes.test.ts observer.test.ts battery.test.ts horizonTally.test.ts a4audit-lookahead.test.ts
  Tests  11 failed | 59 passed (70)      — all 11 failures are in my throwaway file
a4 plantB/control 1M ticks (baseline): CLEAN, 618 hypotheses, worst z -3.4
a4 plantB/control 1M ticks (planted):  EXPLOITABLE, 618 hypotheses, exploitable 52, worst z -47.1 previous-move@30s edge -14.29pp
```

`outcomes.test.ts:142-147` checks that `instants[entryIndex] ≤ entryInstant < instants[entryIndex+1]` and `:151-158` that the expiry _index_ exceeds the entry index; nothing checks that the recorded entry _price_ is `prices[entryIndex]` or that the outcome equals `compare(priceAt(t+H), prices[entryIndex])`. `battery.test.ts`'s 80 k-tick control has no power against it. The only guards are the 3–4 minute statistical files.

**Impact** The bug the project cites as its founding cautionary tale can be reintroduced and survive the unit project (the layer that runs on every subphase); it would be found at the next phase gate, or not at all if the shift were in the "clean" direction (the ROADMAP's own point).

**Recommended fix** Adopt a hand-built-tick test (the one I ran: 13 ticks at 10 s spacing, prices `[100,101,99,100,102,98,100,100,103,97,100,101,99]`, assert entry indices `[0,3,6,9]`, outcomes `[0,0,-1,1]`, and perturbations at the entry tick and at ±1 ms of the expiry instant), plus the linear-scan invariant over all eight horizons in both entry modes.

### a4-04 — The standing verdict never runs the learned family

**Severity** material

**Where** `packages/lab/src/standing.ts:561-563` (`composeFamilies = [...ATTACK_FAMILIES, ...withheld]`) versus `attacks/battery.ts:334-336` (`defaultFamilies = [...ATTACK_FAMILIES, new LogisticAttackFamily()]`); `docs/phases/PH-16.1-…md` §2-3 ("It runs the battery … The full battery, not only the withheld families").

**Claim** The standing verdict runs the registry _and_ the withheld families, i.e. the full battery.

**Evidence** Leverage-effect record, 600 k ticks, all withheld inputs supplied:

```
a4 standing/leverage: outcome exploitable, 634 hypotheses, exploitable 80, worst z 4.62, withheldUnavailable [], families(26) has learned-logistic: false
a4 standing/control:  outcome undecided, 637 hypotheses, worst z 2.81, coarse horizons: 30s,1m,2m,3m,4m,5m,10m,15m
```

26 families = 22 registry + 4 withheld; `learned-logistic` — the "catch-all for combinations no hand-written family enumerates" and the family that PH-2 records as also seeing the level-anchored leak — is absent, and `coverage.featureKinds` for a standing run cannot contain `'learned'`.

**Impact** The live venue's daily assurance has one feature kind fewer than every offline verdict, and the documents describe it as the full battery.

**Recommended fix** `composeFamilies(withheld) => [...defaultFamilies(), ...withheld]`, and assert in `standing.test.ts` that `verdict.families` contains `learned-logistic`.

### a4-05 — B-029's evidence is inside the realised estimator's own noise; the cold-start candidate is worth ≤ 5 %

**Severity** material (it changes what B-029 says, and the ±11 % the documents assume is wrong)

**Where** `docs/evidence/CYCLE-7-DISPERSION.md` (xauusd realised 0.10185, "1.5 standard errors of a 40-sample second moment"); `docs/BACKLOG.md` B-029; `tools/sim/src/dispersionEvidence.ts:500-536`; `packages/engine/src/asset.ts:237-300` (`horizonReturnsCore` starts cold).

**Claim** Two measurements agree on a 20–33 % realised/calibrated gap for xauusd; candidates include no warm-up in the calibration.

**Evidence** Same procedure and seeds as the runner (`dispersion-evidence-run-${run}`), extended to 80 runs:

```
a4 B-029 xauusd realised sigma90: runs 0-39 0.10185 (1.196 of recorded), runs 40-79 0.06052 (0.711), all 80 0.08378 (0.984);
   kurtosis of the 3d displacement 4.22; implied RSE of sigma at N=40: ±14% (Gaussian formula ±11%), at N=80: ±10%
a4 B-029 xauusd calibration 1d x3: 0.932 of recorded; 4d x3: 0.936; 16d x3: 0.949
a4 B-029 xauusd realised 40 x 3d (other seeds): cold-start 0.982 of recorded, after 1d warm-up 0.773
a4 B-029 xauusd RMS 4h displacement per block / later blocks (80 runs): 0.720 0.671 0.950 0.944 0.628 1.057 | 0.708 0.950 1.100 1.069 1.151 0.957
a4 B-029 eurusd same:                                                  1.059 1.129 1.334 1.214 1.021 1.139 | 1.117 0.974 1.059 1.040 0.922 0.866
```

The record's 0.10185 reproduces bit-exactly from its seed (determinism holds). The next forty seeds of the identical procedure read 0.711 of recorded; three independent 40-run draws of the same quantity read 1.196, 0.711 and 0.773 — an empirical spread of ±25–30 %, larger than the heavy-tail SE suggests because sample kurtosis of a heavy tail is biased low. Fresh calibrations at 1/4/16 d move only from 0.932 to 0.949 of recorded: the cold start, which the calibration shares, is at most a few per cent. The 4 h block profile cannot resolve it at 80 runs (xauusd's first day averages 0.83 of later blocks; eurusd shows the opposite).

**Impact** The 40 × 3 d realised measurement cannot distinguish a 20 % gap from noise; the doc's "1.5 standard errors" used the Gaussian 1/√(2N). B-029's direction rests on the 120 × 2 d reading (1.33) alone, which should be re-examined with the heavy-tail SE before anything is tuned.

**Recommended fix** Re-measure the realised side from many non-overlapping 3 d windows of a few long warmed-up paths (hundreds of windows for minutes of compute), report the SE from the empirical kurtosis, and re-state B-029 as "unresolved: within estimator noise at 40 runs"; remove the cold-start candidate or size it from the calibration-span sweep above.

### a4-06 — "Targets fixed before the model existed" is not supported by the record

**Severity** material (it is a headline claim in CURRENT_STATE.md and INV-… realism narrative)

**Where** `CURRENT_STATE.md:45`; `packages/lab/src/realism.ts:14-17` ("fixed here — before any candidate market exists"); `docs/phases/PH-2.3-…md` §3.

**Evidence**

```
git log --follow --format='%h %ad %s' -- packages/lab/src/realism.ts
906e398 2026-08-31 feat(engine): sign-blind engine, volatility cascade and the mirror test
git show --stat 906e398 | grep -E "realism.ts|engine.ts"
 packages/engine/src/engine.ts    | 212 +++++++++++
 packages/lab/src/realism.ts      | 393 +++++++++++++++++++++
```

`realism.ts` with all fifteen bands first enters history in the same commit as `packages/engine/src/engine.ts`; the PH-2.3 approval's commit (`3e7093d` is PH-2.2) does not contain it. No band has moved since (one commit in the file's history — the good half of the claim holds).

**Impact** The property that makes the realism battery an independent constraint — that its bands could not have been tuned to the engine — cannot be verified from the repository. It may well be true; it is asserted, not evidenced.

**Recommended fix** Rephrase to what the record supports ("unchanged since the commit that introduced the engine"), or record the pre-engine provenance (the PH-2.3 branch/notes) as an ADR/decision-log entry with the band values.

### a4-07 — Three realism ratios are ill-posed near zero and pass a memoryless walk by accident

**Severity** minor

**Where** `packages/lab/src/realism.ts:181` (`absAcf1 / max(1e-6, |acf1|)`), `:192` (`absAcf50 / max(1e-6, absAcf1)`), `:226` (`kurt(agg) / max(0.1, kurt)`).

**Evidence** `gaussianRandomWalk` × 40 seeds × 200 k ticks:

```
  volatility-clustering-dominance   passes 3/40      values: 4.4 1.9 -0.4 -4.0 935.2 -4.9 ...
  absolute-return-decay-is-slow     passes 9/40      values: -1.9 0.6 1240.1 -3571.0 0.2 -1242.3 ... (the −152.9 in the record is this)
  aggregational-gaussianity         passes 11/40     values: 1.02 -0.01 -0.85 -1.11 1.50 ...
  plausible 0/40
```

The ratio of two noise terms is Cauchy; P(ratio ∈ [0.15, 1.2]) = (atan 1.2 − atan 0.15)/π = 0.23, observed 9/40. The overall gate is unaffected (0/40 plausible; a walk fails 5–8 metrics depending on seed), but PH-2.3's "fails exactly the seven metrics" is a property of one seed, and the metric values are meaningless whenever the denominator is not itself significantly positive.

**Recommended fix** Evaluate the ratio metrics only when the denominator clears its own band (absAcf1 ≥ 0.05; tick kurtosis ≥ 1.5), otherwise report the metric as failed-by-precondition with a NaN value; or replace `decay-is-slow` with the lag-50 autocorrelation itself against an absolute floor.

### a4-08 — Two "realism" bands are integrity constraints that real tick data would fail

**Severity** minor (documentation)

**Where** `realism.ts:128-135` (`|ACF(1)| ≤ 0.02`, rationale "Real returns are close to serially uncorrelated"), `:286-294` (`mean-run-length ∈ [1.85, 2.15]`).

**Evidence** Real tick-level returns carry bid-ask bounce (ACF(1) of −0.1 to −0.3, mean same-sign run length well under 2); ADR-0003 §4 bans bounce because it is tradeable. The bands are correct for this product and wrong as a description of markets.

**Recommended fix** Label these two as ADR-0003 integrity requirements at tick scale in `rationale`, so a future reader does not "fix" them toward realism.

### a4-09 — Living documents and a recorded evidence file are behind the tools they describe

**Severity** minor

**Where** `docs/architecture/VALIDATION.md:64-65, 148`; `docs/evidence/PH-11-HORIZON-COVERAGE.md`; `tools/sim/src/horizonEvidence.ts:381-385`.

**Evidence** VALIDATION.md still says "11 / 354 clean; 20 / 570 exploitable" and "20 families, 8 horizons, ~550 hypotheses"; the calibration run today prints `541 hypotheses … clean, worst z −3.36` and `754 … EXPLOITABLE, worst z −6.09`, and the control `760 hypotheses across 23 families`. The horizon tool emits, per asset, a `Run label: … (regenerate with …)` line (added in `eff14b2`); the recorded document contains zero such lines (`grep -c 'Run label'` = 0), so it was not produced by the tool as it stands.

**Recommended fix** Refresh the two tables and the count in VALIDATION.md; regenerate or annotate the horizon record.

### a4-10 — Evidence numbers no test asserts (CA6-37 class), and one CURRENT_STATE figure that is printed rather than asserted

**Severity** minor

**Where** `docs/evidence/CYCLE-7-CATALOGUE-SCALE.md` (100/0, closest registered pair 0.0282, 2.8×, timings); `docs/evidence/CYCLE-7-DISPERSION.md` (every figure — `dispersion.stat.test.ts` asserts only ±25–55 % bands on fresh runs; `catalogue.stat.test.ts:69-71` asserts 0.7–1.4 on recorded vs fresh); `docs/evidence/PH-11-HORIZON-COVERAGE.md` summary and interpretation lines (3.12 billion ticks, 63.9 asset-years, FWER 0.194, ρ ≈ 0.66, "≈ 26 of 40", 36 %) — the test parses run headers and table rows only; `CURRENT_STATE.md:44` ("0.217pp") — `phaseAcceptance.stat.test.ts:82` asserts `< 0.2513` and prints the value.

**Evidence** Hand recomputation: ticks 225 106 647 + 432 936 201 + 93 219 558 + 157 667 862 + 1 106 265 172 + 1 106 270 394 = 3.121 × 10⁹ ✓; runs 1+2 = 2.015 × 10⁹ ✓; asset-years 4 × 9.99 + 2 × 11.99 = 63.94 ✓; 1 − (1 − 0.0083)²⁶ = 0.195 ✓; pairs 105·104/2 = 5460 ✓; 0.0282/0.01 = 2.8 ✓; archetype counts 13·4 + 12·4 = 100 ✓; 1 − 0.9975¹⁰⁰ = 0.221 ✓; all five dispersion ratios ✓; 150 d / 44 h = 81.8 ✓. Everything checked is internally consistent; none of it is executed by a test. `catalogueScale.stat.test.ts:289-296` explicitly asserts the _drawn_ closest pair, not the registered one the document quotes.

**Recommended fix** Have `horizonCoverage.stat.test.ts` also parse and re-derive the summary line (it was the CA5 finding and is still unparsed); assert the registered closest pair in the reduced-scale run; make `phaseAcceptance` assert the floor it prints to two decimals if CURRENT_STATE is going to quote it.

### a4-11 — `measureDifferentiation` counts an exact tie as a perfect separation

**Severity** minor

**Where** `packages/lab/src/differentiation.ts:287-290` (strict `<`), `:298-300` (`perfectlySeparated`).

**Evidence** Two assets with identical signatures, 3 windows each:

```
a4 all-tie matrix: accuracy 0.5, confusion [[3,0],[3,0]], perfectlySeparated ["a"]
```

Ties resolve to candidate 0, so asset `a` is reported "never confused with any other" while being identical to `b`. Unreachable on real signatures (no exact ties among 384 distances measured) but wrong as a definition.

**Recommended fix** Treat a tie as unassigned (count as incorrect for both) or break ties by declaring the window confused.

### a4-12 — `HorizonAccumulator` and settlement disagree when two ticks share a boundary instant

**Severity** minor (unreachable from the engine)

**Where** `packages/lab/src/horizonTally.ts:627-651` (first tick at the boundary closes the window) versus `packages/core/src/market/query.ts:28-36` (`priceAtOrBefore` returns the _last_ tick at that instant). The engine floors intervals at 1 ms (`packages/engine/src/arrival.ts:31`), so instants are strictly increasing there; `datasetFromTicks`/`buildObserverDataset` accept equal instants, so an external record can reach it.

**Recommended fix** Either refuse equal instants at the dataset boundary (matching the engine's guarantee) or make the accumulator defer the close until the instant advances.

## What survived

- **Look-ahead (1a).** On hand-built ticks (every 10 s, prices `[100,101,99,100,102,98,100,100,103,97,100,101,99]`): 30 s clock entries → indices `[0,3,6,9]`, outcomes `[0,0,-1,1]`; entries between ticks → last tick at-or-before; a tick exactly at the expiry instant counts, one 1 ms later does not; the tick at the entry instant is the entry price. On a 40 k-tick walk with flats, for all eight horizons in both entry modes: `entryIndex === lastAtOrBefore(t)`, `outcome === sign(prices[lastAtOrBefore(t+H)] − prices[entryIndex])`, and every decided outcome has expiry index > entry index and expiry instant > t. `auditLookAhead` at 60 sampled 30 s entries over all registry + learned + four withheld families: no offender. The frame plant was caught by seven tests.
- **Ties (1b).** `sampleOutcomes` counts ties apart, `decided = up + down`, `upRate` and `binomialProportionTest` use `decided`; battery tallies carry `ties` separately and `samples` is decided only (`|upRate − 0.5|·100 === |edgePoints|` on every finding of a 1/3-flat dataset); `HorizonAccumulator` and `edge.ts` do the same. A tie is never a win or a loss anywhere in scope.
- **Multiplicity (1c).** BH over the whole surface, one correction, no per-family pooling; the control's worst z (3.68 over 760; −3.36 over 541) is what the null predicts (2.02 tests beyond |z| = 3 expected). The threshold is honest as a false-positive control; see a4-01 for what it does to power.
- **MDE/design effect (1d).** `minimumDetectableEffect(310 700) = 0.2513 pp`, `samplesForEffect(0.002513) = 310 716`, `MDE(390 812) = 0.2241 pp` — the VALIDATION.md table reproduces. `designEffect` on the symmetric control, 24 replicates: tiled 0.73 (±29 %, within 3 RSE of 1), 4× overlap 3.60, 15× overlap 12.29 — it sees overlap dependence; `minimumDetectableEffectUnderDependence` floors at 1 and divides n by deff exactly.
- **Confirmation split (1e).** Evaluation entries expire at or before `confirmationStartInstant`; confirmation entries start there; fits read `[0, trainingEndIndex]` only, and the learned family's labels are cut at the training end (`learned.ts:119`). No reuse.
- **Calibration (2).** 12/12 in 174 s; every fixture caught by a family whose purpose matches; the conventional battery is clean on the level-anchored fixture and the full one finds `price-modulo-4000` with opposite signs. Direct measurements: `boundaryTiming` per-tick P(up) in the first third 0.7512 (declared 0.75); `signAutocorrelation` per-tick P(repeat) 0.7433 (0.75), 30 s conditional on previous move 0.6068/0.3932 (battery 0.6060/0.3936, z ±46) with unconditional P(up) 0.5004 — invisible unconditionally, as claimed; `tools/sim/calibration.stat.test.ts` asserts |z| < 4 unconditionally for all three. `symmetricControl` passes an exact mirror both from tick 0 (200 000/200 000 negated) and from an interior snapshot (140 000/140 000) — and the interior form is the one that matters: `displayQuantization` and `levelAnchoredVolatility` pass a global flip (60 000/60 000) and fail the interior one (26 504/30 000, 23 216/30 000). The engine's `runMirrorTest` uses a burn-in, which is correct.
- **Realism (3).** Estimators match their definitions (biased ACF with global mean, standard excess kurtosis); no band has moved since the file appeared; a memoryless walk never reaches `plausible` (0/40).
- **Differentiation (4).** Old and new `measureDifferentiation` are bit-identical: 0 of 384 distances differ and every per-window argmin agrees on four catalogue assets × 24 short windows, for both feature sets, and on a synthetic matrix with exact ties; library accuracy equals both. `windowsPerAsset < 3` and unequal window counts are refused with `RangeError`.
- **Ruin (5).** `f(R) = p·e^{−Rg} + q·e^{Rl} − 1` is `E[e^{−RX}] − 1`; ψ(u) ≤ e^{−Ru} is stated as a bound and asserted as one (`simulated ≤ bound + 0.02`). At u = 40 the bound is 0.6676 and the simulation 0.5935, so the test catches a ×2 error in R (bound 0.4457) and would catch about ×1.15.
- **Standing (5).** `runStandingAssurance` composes registry + withheld (26 families, read off the objects), reports `exploitable` on a leverage record (80 findings, worst z 4.62, all withheld families built) and `undecided` on a same-length control for want of power — never `clean`.
- **Evidence runners (6).** All three Cycle-7 runners exist, build, run at reduced scale, and print the formats the documents carry; `CYCLE-7-DISPERSION.md`'s xauusd realised figure reproduces to five decimals from its recorded seed. The Cycle-6 runners are absent, as CA6-36 already recorded and the documents now say.
- **Seeding and wall clock (7).** No `Math.random`/`Date.now` in any lab, fixtures, sim or core statistical test (`Date.now` appears only in `apps/*` polling loops and as a string inside a guardrail plant payload). Guarded throughput floors measured here: `standardNormal` 2.51 M/s vs 200 k floor, entropy 9.00 M/s vs 1 M, candle aggregation 13.09 M/s vs 700 k, simulation 1.04 M/s vs 50 k — 9× to 21× margins, 2.4× to 5.6× on a runner 3.7× slower, all stood down under `OTC_COVERAGE=1`. Unguarded wall-clock assertions: `apps/api/src/registration.stat.test.ts:255` (a 409 must return within 5 s), `frame.test.ts` (200 k-tick frame under 5 s), and browser/HTTP polling deadlines in `apps/*` — none near failing at 3.7×. `tools/sim/distributionConsistency.stat.test.ts:318` and `publication.stat.test.ts:161` are counts, not time.
- **`tools/sim` (8).** CLI `--help`/`--list`/200 k-tick run with `--edge` exit 0, unknown option exit 1; `runSimulationAsync` yields between 250 k-tick chunks; `edge.ts` uses strictly-past features and excludes ties; `phaseAcceptance.stat.test.ts` asserts `clean`, `plausible`, `acceptable`, MDE < 0.2513 at 30 s, all four feature kinds, > 400 hypotheses, and `divergences` equal to `[]` — the "15/15" and "zero divergences" in CURRENT_STATE are asserted; "0.217 pp" is printed (a4-10).

## Limits of this audit

- Single files only, per the rules: no full gate, no whole statistical project, no `npm run test:cov`; the PH-11-COVERAGE and CYCLE-1 figures were not re-executed.
- The planted-edge power result is one realisation per level (0.25/0.5/1 pp) of a per-tick bias whose edge grows with horizon; a horizon-specific 0.25 pp leak would be strictly harder to see, and I did not construct one or estimate a full power curve.
- The B-029 block profile has ±20 % noise at 80 runs and is inconclusive on the cold start; the ≤ 5 % bound comes from the calibration-span sweep.
- The differentiation per-window comparison used instrumented copies of both versions rather than the library's internals (the library exposes only the confusion matrix); the library's accuracy was asserted equal to both copies.
- `apps/*`, `packages/trading` (beyond how lab uses it), and `guardrailMetaAudit.stat.test.ts` were out of scope.
