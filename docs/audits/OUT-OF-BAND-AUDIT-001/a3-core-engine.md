# Auditor a3 — core and engine

Worktree `/home/alejo/.otc-audit7/a3`, detached at `36bbf89`. Subject: `packages/core`, `packages/engine` — determinism, sign-blindness, portability, the registration pipeline, the PH-21.1 brief retreat. Every number below was produced by a command run in this worktree; `git status --short` prints only `?? node_modules` at the end.

## Method (what you ran, what you planted, what you could not do)

**Read first:** `CLAUDE.md`, `MARKET_MODEL.md`, `ENTROPY.md`, `TIME_AND_TICKS.md`, `INVARIANTS.md`, `CATALOGUE_AND_PANEL.md` §1–§3, ADR-0002…0006, PH-19.4, PH-21.1, `CYCLE-AUDIT-006.md` §4, and all non-test sources of `packages/core/src` and `packages/engine/src`, plus `mirror.test.ts`, `productionComposition.test.ts`, `factory.test.ts`, `seamReplay.test.ts`, `registration.test.ts`, `brief.test.ts`, `catalogue.test.ts`, `families.test.ts`, `tools/sim/src/catalogueScale{.ts,.stat.test.ts}`, `venueScale.ts`, `packages/runtime/src/resume.ts` (the cursor protocol), `packages/lab/src/attacks/registry.ts` (level-anchored families).

**Throwaway tests written, run with `npx vitest run --project unit <file>`, then deleted** (`packages/engine/src/zz_audit_*.test.ts`, `tools/sim/src/zz_audit_runner.test.ts`):

| file                       | what it exercised                                                                                                                                                                                                                                                                                                                                                                                                      | result                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `zz_audit_determinism`     | 5 catalogue assets: 3,000 ticks → snapshot → 2,000 more; snapshot JSON-round-tripped and restored into a fresh engine built from a _fresh_ `MasterKeyring` object; bit-identical (price, instant, sequence) and idempotent re-snapshot; interleaved engines vs isolated; INV-010 grep of the serialised snapshot; malformed/foreign cursor refusal; two independent resumes from the same leased cursors across a seam | 9/9 pass                                                  |
| `zz_audit_market`          | identical instants, non-monotonic instants, tick exactly on a bucket boundary, epoch alignment and nesting of all 11 timeframes over 20,000 instants in a 5-week range, `foldCandles(1s→every tf) == foldTicks` over 3 weeks with multi-hour gaps (300k ticks), `priceAtOrBefore`/`indexAtOrAfter` inclusivity with duplicate instants                                                                                 | 8/8 pass                                                  |
| `zz_audit_numerical`       | 25 personalities (each trait at both `TRAIT_BOUNDS` limits + 3 pathological combinations) × 2 quanta (1e-6, 1e-7), 200,000 ticks each, asserting finite safe-integer prices, integer intervals ≥ 1, monotone sequence, no NaN/Infinity in latent state                                                                                                                                                                 | 25/27 pass; **2 fail** (a3-03)                            |
| `zz_audit_families`        | `sampleArchetype` 2,000 × 8 archetypes: every sampled trait inside its box and `TRAIT_BOUNDS`, fastest cascade rung ≥ 0.5 tick, spacing ≤ ceiling, target ≤ band max, dispersion in band, volatility in bounds; clamp engagement counted                                                                                                                                                                               | 10/10 pass (a3-05 measured)                               |
| `zz_audit_brief`           | `vi.mock` wrapper on `authorPersonality`: label recording via a proxied keyring in both `requestFromBrief` and `registerAsset`; clustering bit-equality of the two solves for all 8 archetypes; cost (8 × 10 seeds); forced retreats k=1,3,5; forced exhaustion → `registerAsset`; supplied out-of-band `dispersion`                                                                                                   | 5/5 pass (a3-05, a3-06 measured)                          |
| `zz_audit_registration`    | id lengths 51/52/64; duplicate-id variants; referencePrice 0/−1/NaN/∞/5e-324/1e7/1e300; displayPrecision 30; target kurtosis 250 with a safe starting clustering; CA6-21, CA6-25 (copy at 1.05×, 100×), CA6-27 slow corner                                                                                                                                                                                             | 7/7 pass (a3-04, a3-06, a3-07 measured)                   |
| `zz_audit_interior_mirror` | ADR-0003 §6 _as specified_: one engine to an interior N, snapshot, restore into two engines, negate the sign stream only for k > N; run against the shipped composition on all 5 assets at N = 2,000 / 9,001 / 20,000; plus a vacuity probe of `mirror.test.ts`'s own level-anchored self-check                                                                                                                        | clean tree 6/6 pass; against the S/R plant 5 fail (a3-01) |
| `zz_audit_runner`          | `tools/sim/src/catalogueScale.ts` with `OTC_SCALE_COUNT=8`, imported through vitest so the worktree's sources are what runs                                                                                                                                                                                                                                                                                            | 1/1 pass, tables printed                                  |

**Plants (GOVERNANCE §28.1).** 20 defects planted one at a time into the engine sources, each followed by `npx vitest run --project unit packages/engine/src/mirror.test.ts packages/engine/src/productionComposition.test.ts` and `git checkout -- packages/engine/src`. Nineteen through a shared side-channel (`export const leak = {sign, price}` in `magnitude.ts`, written by `engine.ts` after each tick, read by the planted layer — the "keeps its own copy" pattern `mirror.test.ts` itself uses); one (`engine-support-resistance`) reading the engine's own `#price` with no channel. Log: `scratchpad/audit/plants/plants.log`, `sr.log`.

**Not done / could not do:** no `npm run build|lint|gate|test`, no statistical suite (shared machine, per the brief). The battery's response to a3-01's plant is therefore _inferred_ from the registry (`price-modulo-{500,1000,2000,4000,8000,16000}` exists and `calibration.stat.test.ts` asserts it catches the 4,000-cell fixture), not re-executed. `magnitude.ts` contains only types, so no plant is possible there; the "magnitude" plants went into `CascadeMagnitudeModel.advance` in `cascade.ts`. `venueScale.ts` was reviewed by reading only.

## Plant table (layer, leak kind, caught by mirror/composition test? yes/no)

| #   | layer (file)                                             | leak                                                      | via                     | caught?                                                                                                     | tests failing |
| --- | -------------------------------------------------------- | --------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | regime.ts `advance` multiplier                           | leverage `×(1+0.1·sign)`                                  | channel                 | **yes**                                                                                                     | 9/19          |
| 2   | regime.ts                                                | level (price parity)                                      | channel                 | yes*                                                                                                        | 9/19          |
| 3   | structure.ts multiplier                                  | leverage                                                  | channel                 | **yes**                                                                                                     | 9/19          |
| 4   | structure.ts path-length (hazard)                        | level (`price mod 1000`)                                  | channel                 | yes*                                                                                                        | 9/19          |
| 5   | modulator.ts                                             | leverage                                                  | channel                 | **yes**                                                                                                     | 9/19          |
| 6   | modulator.ts                                             | level (`                                                  | price mod 100           | `)                                                                                                          | channel       | yes*                            | 9/19 |
| 7   | hawkes.ts excitation                                     | leverage (timing)                                         | channel                 | **yes**                                                                                                     | 7/19          |
| 8   | hawkes.ts mean interval                                  | level (parity)                                            | channel                 | yes*                                                                                                        | 7/19          |
| 9   | arrival.ts (Poisson)                                     | leverage                                                  | channel                 | yes (mirror.test only — Poisson is not in the shipped composition)                                          | 4/19          |
| 10  | arrival.ts                                               | level                                                     | channel                 | yes* (mirror.test only)                                                                                     | 4/19          |
| 11  | cascade.ts switch probability                            | leverage                                                  | channel                 | **yes**                                                                                                     | 11/19         |
| 12  | cascade.ts switch probability                            | level (parity)                                            | channel                 | yes*                                                                                                        | 11/19         |
| 13  | cascade.ts `CascadeMagnitudeModel.advance` ("magnitude") | leverage                                                  | channel                 | **yes**                                                                                                     | 11/19         |
| 14  | cascade.ts magnitude                                     | level (parity)                                            | channel                 | yes*                                                                                                        | 11/19         |
| 15  | engine.ts magnitude before quantisation                  | leverage                                                  | channel                 | **yes**                                                                                                     | 11/19         |
| 16  | engine.ts                                                | level: `×(1+0.1·parity(#price))`                          | own `#price`            | **NO** (19/19 pass) — see a3-09: parity is a function of magnitudes only, so this is not a directional leak | 0             |
| 17  | engine.ts                                                | signed rounding `floor(sign·m/q + 0.5)` (ADR-0004 class)  | —                       | **NO** (19/19) — see a3-08                                                                                  | 0             |
| 18  | engine.ts                                                | leverage gated on `sign.label.includes('env=production')` | channel                 | **yes** — by `productionComposition.test.ts` only (CA4 M-1 closure holds)                                   | 5/19          |
| 19  | engine.ts                                                | leverage `×(1+1e-9·sign)`                                 | channel                 | **NO** (19/19) — see a3-08                                                                                  | 0             |
| 20  | engine.ts                                                | **round-number support/resistance**: `srFactor = 1.5 −    | (#price mod 1000) − 500 | /500` (volatility halves at every multiple of 1,000 steps, 1.5× halfway)                                    | own `#price`  | **NO** (19/19 pass) — **a3-01** | 0    |

`*` The level plants that were caught were caught _because of the shared channel_: the straight and mirrored engines alternately overwrite `leak.price` with `p` and `−p`, so each engine read the other's price and the runs were asymmetric. That is an artefact of the plant, not evidence about level leaks; plants 16 and 20, which read the engine's own price, are the honest level tests, and both survived. Plant 20 was then run against the interior-snapshot harness: **caught on all five assets** (increment divergences 684–1,837 of 2,000; latent-state 1,934–1,998; interval 1,934–1,997). The same harness on the clean tree: 0 divergences in 15 runs.

## Findings

### a3-01 — The shipped mirror test negates the sign from tick 1, not from an interior snapshot, so a round-number support/resistance field passes it unchanged

**Severity:** critical (the primary structural gate for INV-006 does not do what ADR-0003 §6, `INVARIANTS.md` and `mirror.ts` say it does; the defect class it misses is the one ADR-0003 §4 bans by name and PH-2 measured as exploitable).

**Where:** `packages/engine/src/mirror.ts:110-117` (`straight = build(signSource()); mirrored = build(new SignInvertingStream(signSource()))`, then `burnInTicks` of `next()` on _both_); consumers `mirror.test.ts`, `productionComposition.test.ts:81-84`; claims in `docs/decisions/ADR-0003-conditional-sign-symmetry.md` §6 steps 2–3 ("snapshot at a random interior index N; continue two runs from that snapshot, one with the sign stream negated for all k > N … Any mechanism that reads a sign, a price level, or anything derived from them fails this test immediately and unambiguously"), `docs/architecture/INVARIANTS.md` INV-006 row, `mirror.ts:24-26`.

**Claim:** Because both engines start at price 0 and the mirrored engine's sign is inverted from its very first tick, the mirrored price path is exactly `−p(t)` throughout, including the burn-in. Any level dependence `f(price)` with `f(−p) = f(p)` — parity, `|p|`, distance to the nearest multiple of a cell width (i.e. support/resistance at round numbers) — produces bit-identical latent state and exactly negated increments, and the gate reports `mirrored: true`. ADR-0003's involution is about reflection through an _interior_ price `p_N` (`p' = 2p_N − p`), under which such an `f` is not invariant; the implementation only ever tests reflection through 0. The burn-in makes the _volatility_ history asymmetric, which is enough for sign-reading (leverage) leaks, and is why every leverage plant was caught; it does nothing for origin-symmetric level leaks.

**Evidence** (`scratchpad/audit/plants/sr.log`):

```
### PLANT engine-support-resistance (round-number volatility field)
+    const distanceToRound = Math.abs((((this.#price % 1_000) + 1_000) % 1_000) - 500);
+    const srFactor = 1.5 - distanceToRound / 500;
+      (magnitude * srFactor) / this.instrument.logQuantum + this.options.streams.rounding.nextFloat64(),
 Test Files  2 passed (2)
      Tests  19 passed (19)
RESULT engine-support-resistance (shipped mirror tests): exit=0 SURVIVED
--- interior-snapshot harness against the SAME plant ---
[a3-interior] eurusd   burnIn=2000 snapshotPrice=78    inc=1438 latent=1934 interval=1934
[a3-interior] gbpjpy   burnIn=2000 snapshotPrice=746   inc=1837 latent=1997 interval=1995
[a3-interior] btcusd   burnIn=2000 snapshotPrice=29    inc=1359 latent=1996 interval=1994
[a3-interior] spx      burnIn=2000 snapshotPrice=-1151 inc=1540 latent=1998 interval=1997
[a3-interior] xauusd   burnIn=2000 snapshotPrice=3051  inc=684  latent=1998 interval=1997
RESULT engine-support-resistance (interior harness): exit=1 CAUGHT
--- interior-snapshot harness on the CLEAN tree (sanity) ---
[a3-interior] eurusd..xauusd × burnIn 2000/9001/20000: inc=0 latent=0 interval=0   (15 runs)
      Tests  6 passed (6)
```

The plant is a 3× volatility contrast keyed to the public price level — the "trade toward the nearest low-volatility node" mechanism of ADR-0003 §4 — placed in the one file the composition test drives directly, under `environment: 'production'`, for all five catalogue assets.

**Impact:** The structural gate that `INVARIANTS.md` names first for INV-006 and calls "the gate a statistical battery cannot replace" is blind to the exact class PH-2 found a conventional battery blind to. Defence in depth still exists — `packages/lab/src/attacks/registry.ts` has `absolute-price-level`, `price-modulo-{500,1000,2000,4000,8000,16000}` and `price-modulo-quantum`, and `calibration.stat.test.ts` asserts they catch the 4,000-step fixture — but that is the slow statistical layer with sampling error, a swept (not exhaustive) set of cell widths, and no guarantee for a cell width outside the sweep or a non-periodic level field. Every "mirror test: zero divergences" line in the phase records (PH-3 onward) is true of reflection through the origin only.

**Recommended fix:** Implement ADR-0003 §6 as written in `runMirrorTest`: build one engine, run `burnInTicks`, `snapshot()`, `restore()` into two engines from the snapshot, and give the second a `SignInvertingStream` seeked to the snapshot's `sign` cursor (the throwaway `interiorMirror` above is a working shape: 40 lines, `restore` already seeks through the wrapper). Randomise `N` per run as the ADR asks. Keep the current from-the-origin variant only if it is renamed to what it is. Re-run `productionComposition.test.ts` under the new harness for every asset and re-plant plant 20 before recording it as closed (memory: a guard is not finished until watched failing).

### a3-02 — `mirror.test.ts`'s own "catches a magnitude model that reads the price level" is vacuous: it detects the plant's bookkeeping, not the mechanism

**Severity:** material.

**Where:** `packages/engine/src/mirror.test.ts:279-328` (`LevelAnchoredModel.snapshot()` returns `{ inner, price: this.#price }`).

**Claim:** The self-check passes only because the plant stores the _price itself_ in its latent snapshot, and the price is `p` vs `−p`. The magnitude modulation it applies — `1 − 2|2·phase − 1|` with `phase = ((p mod 4000)+4000) mod 4000 / 4000` — satisfies `f(−p) = f(p)`, so with the price removed from the snapshot the identical mechanism is reported as mirrored.

**Evidence** (same throwaway file, run on the clean tree):

```
[a3-vacuity] withPrice:    mirrored=false kinds=latent-state first=latent state diverged during burn-in: {"inner":{...},"price":...
[a3-vacuity] withoutPrice: mirrored=true  kinds=            first=undefined
```

The divergence kind is `latent-state`, never `increment`: the test never observed a single mis-negated increment from a level-anchored mechanism.

**Impact:** The "test with teeth" that was meant to prove the gate is not vacuous for level leaks is itself vacuous; combined with a3-01 the level half of the mirror gate has never been exercised against the thing it names.

**Recommended fix:** After a3-01, make the self-check plant snapshot only `inner`, and assert `divergences.some(d => d.kind === 'increment')`.

### a3-03 — `clustering = 0` is inside `TRAIT_BOUNDS` but no engine can be built from it

**Severity:** material (contract inconsistency between two guards on the same value).

**Where:** `packages/engine/src/personality.ts:142` (`clustering: { min: 0, max: 0.4 }`), `personality.ts:269` (`lowMultiplier: 1 - traits.clustering`), `packages/engine/src/cascade.ts:79-81` (`lowMultiplier` must lie in `(0, 1)`).

**Claim:** `assertPersonalityTraits` accepts `clustering: 0`; `personalityConfig` then emits `lowMultiplier: 1`; `VolatilityCascade`'s constructor throws. `traitDistance` also normalises clustering on `[0, 0.4]`, so the guard's notion of "the whole trait space" includes an unbuildable edge.

**Evidence** (`zz_audit_numerical`):

```
× clustering=min: 200k ticks ...          RangeError: lowMultiplier must lie in (0, 1), received 1.
× all-narrow (clustering 0, ...)          RangeError: lowMultiplier must lie in (0, 1), received 1.
```

Not reachable through the archetypes (a solved clustering is strictly positive), but reachable through `RegistrationRequest.traits` as a starting point (`assertPersonalitySafe(personalityConfig(request.traits))` would throw at stage `safety` with a cascade message about a trait the caller set legally).

**Recommended fix:** Either `TRAIT_BOUNDS.clustering.min` strictly positive (and `differentiation.ts` normalisation follows automatically), or let `assertCascadeConfig` accept `lowMultiplier === 1` as the degenerate constant cascade. Add the bounds corners to `personality.test.ts` as buildable engines.

### a3-04 — `ASSET_ID_PATTERN` admits ids that cannot be a key label once `registration-` is prefixed; the refusal lands at the wrong stage and the brief throws

**Severity:** material.

**Where:** `packages/engine/src/registration.ts:148` (`/^[a-z0-9][a-z0-9._-]{0,63}$/`, 64 chars), `packages/engine/src/catalogue.ts:47-49` (`registration-${id}`, +13 chars), `packages/core/src/entropy/label.ts:30` (component ≤ 64 chars), `registration.ts:200-205` (the first `derive` sits inside the `safety` try/catch), `brief.ts:91-98` (derives before anything can refuse).

**Evidence** (`zz_audit_registration`):

```
[a3-reg] id len 51  -> registered precision=7 q=1.445e-7
[a3-reg] id len 52  -> refused @safety: Stream label component "asset" is invalid: "registration-aaaa…". Expected to match ^[a-z0-9][a-z0-9._-]{0,63}$.
[a3-reg] id len 64  -> refused @safety: Stream label component "asset" is invalid: …
[a3-reg] requestFromBrief id len 52: InvalidStreamLabelError: Stream label component "asset" is invalid …
```

`checkIdentity` returned `null` for all three. `apps/api/src/registration.service.ts:181` catches the brief's throw as job state `failed`, not `refused`, so the operator sees an internal error about a stream label rather than "id too long".

**Impact:** The documented identity contract (`registration.test.ts:87-91` pins the 64-char pattern as "the shape the persistence layer already imposes") is 13 characters wider than what the key derivation accepts; the stage that names itself names the wrong one.

**Recommended fix:** In `checkIdentity`, validate `registrationKeyLabel(request.id)` against the label component pattern (or cap the id at 51), and give `requestFromBrief` the same check before deriving.

### a3-05 — The clamp and the retreat author a tail weight below the family's own band, and nothing records that it happened

**Severity:** material.

**Where:** `packages/engine/src/families.ts:240-243` (`min(band.min, ceiling·0.95)`), `packages/engine/src/brief.ts:144-160` (`target *= 0.9` up to six times), `brief.ts:120-132` (`retreats` returned beside the request, not on it), `registration.ts:319-335` (`RegisteredAsset.authored` records only the achieved kurtosis).

**Claim:** When `reachableExcessKurtosis × 0.95` is below `archetype.excessKurtosis.min`, `sampleArchetype` draws the target _at_ the clamp, i.e. outside the band the family declares; each retreat multiplies by 0.9 regardless of the band. The sample, the request and the registered asset all carry the resulting number with no flag that the family's character was not met. `CATALOGUE_AND_PANEL.md` §2 says the target "is clamped to what that rhythm can supply"; it does not say the family band is thereby abandoned, and PH-21.1 §3 calls the retreat "a safety net, not a second sampler".

**Evidence:**

```
[a3-fam] alt-crypto  spacingClamped=635/2000 kurtosisBelowBand=102/2000 k=[95.1,165.0] band=[130,165]
[a3-fam] alt-crypto corner: ceiling=135.76 clamp=128.98 band.min=130
[a3-brief-retreat] k=1 drawn=154.10 target=138.69 band=[130,165] belowBand=false
[a3-brief-retreat] k=3 drawn=154.10 target=112.34 band=[130,165] belowBand=true
[a3-brief-retreat] k=5 drawn=154.10 target=91.00  band=[130,165] belowBand=true
```

5.1% of `alt-crypto` draws (2,000 sampled) land below the band by up to 27% (95.1 against a floor of 130); at 95 an "alt-crypto" sits inside `metal` [80, 115] and `cross-fx` [85, 130] on tail weight. `Object.keys(request)` does not contain `retreats`; `grep -rn retreats packages apps tools` finds one reader, `catalogueScale.stat.test.ts`, which prints it. The other seven archetypes: 0/2,000 below band. In the runs actually executed here, no real retreat occurred (0 of 80 timed briefs, 0 of 8 label-recorded briefs); the retreat arithmetic was exercised by forcing `authorPersonality` to throw.

**Impact:** "Weakening differentiation to make an asset fit" happens silently for one archetype in twenty draws; the recorded `authored.excessKurtosis` is honest about what was achieved but nothing says the family asked for more.

**Recommended fix:** Carry `clampedFrom`/`retreats` on `ArchetypeSample`, `RegistrationRequest.targets` and `RegisteredAsset.authored`; have `catalogueScale.ts` report them; and either raise `alt-crypto`'s depth floor (the depth-5/6 rungs are what cannot reach 130) or lower its band floor to what the box can supply, so the band means what it says.

### a3-06 — Three refusals name the wrong stage, one of them after paying for the whole calibration

**Severity:** material in aggregate (the §1 contract "each stage names itself" is the panel's only diagnostic).

**Where / evidence:**

1. Supplied `dispersion` that scales `volatility` outside `TRAIT_BOUNDS` — `registration.ts:200-205`:
   ```
   [a3-brief-disp] dispersion=50     -> refused safety: Personality trait volatility must be in [1e-7, 0.001], received 0.0195…
   [a3-brief-disp] dispersion=0.0001 -> refused safety: Personality trait volatility must be in [1e-7, 0.001], received 3.9e-8.
   ```
   The operator supplied a budget, not a volatility; `CATALOGUE_AND_PANEL.md` §1 assigns "a budget the personality cannot reach" to `dispersion`, and `registration.ts:224-231` already has a pre-simulation dispersion check that could hold this.
2. `targets.excessKurtosis` above `EXCESS_KURTOSIS_BAND.max` with a safe starting clustering — the safety gate runs on the _pre-solve_ traits only (`registration.ts:202`), the solve reaches 250, and the ceiling is enforced by `calibrateAssetCore` (`asset.ts:332`):
   ```
   [a3-reg] target kurtosis 250 -> refused @calibration: Personality would compound to an excess kurtosis of 245.1, above the realism ceiling of 200 …
   ```
3. `displayPrecision: 30` — CA6-20 is closed (it is refused) but only at `registration.ts:313-317`, after the full calibration; here 670 ms at a 2-hour span, minutes at the production span:
   ```
   [a3-reg] displayPrecision 30 (670ms) -> refused @calibration: displayPrecision must be an integer in [0, 18], received 30.
   ```

**Recommended fix:** (1) check `request.traits.volatility` against `TRAIT_BOUNDS` at the `dispersion` stage with a message in budget terms; (2) validate `targets.excessKurtosis` against the band before the solve at `safety`; (3) bound `displayPrecision ≤ 18` in `checkIdentity`.

### a3-07 — `displayPrecisionFor` can be negative or infinite, so a legal `referencePrice` is refused after the simulation with a message about display precision

**Severity:** minor.

**Where:** `packages/engine/src/asset.ts:221-223` (`ceil(ln(1/(q·ref))/ln 10)`), `registration.ts:163-165` (accepts any finite positive reference).

**Evidence:**

```
[a3-reg] referencePrice 5e-324 -> refused @calibration: displayPrecision must be an integer in [0, 18], received Infinity.
[a3-reg] referencePrice 1e7    -> refused @calibration: displayPrecision must be an integer in [0, 18], received -1.
[a3-reg] referencePrice 1e300  -> refused @calibration: displayPrecision must be an integer in [0, 18], received -294.
```

Any asset whose lattice step is ≥ 10 display units (`q·ref ≥ 10`) is refused; at a crypto-like quantum that is a reference above ~5×10⁶ — not a real instrument today, but a `Math.max(0, …)` clamp would make it a valid 0-decimal asset, and a reference-price bound in `checkIdentity` would refuse `5e-324`/`1e300` for free.

### a3-08 — Limits of the mirror gate's sensitivity: a 1e-9 leverage and deterministic signed rounding both pass

**Severity:** minor (neither survivor is economically exploitable; recorded so the gate's resolution is written down).

**Evidence:** plants 17 and 19, 19/19 pass each. The gate compares quantised steps, so a relative magnitude change smaller than about `1/(steps × ticks compared)` (here ~10⁻⁵ per tick over 7,000 compared ticks) is invisible; `floor(sign·m/q + 0.5)` differs from its negation only when `m/q` is exactly a half-integer, a measure-zero event on doubles.

**Recommended fix:** State the resolution in `mirror.ts`; the economic guard for small leverage is the battery's detection floor (0.217pp), which is the right instrument for it.

### a3-09 — Reading the price is not structurally prevented inside `engine.ts`; parity-keyed volatility passes every mirror test by construction

**Severity:** minor (not a directional leak).

**Where:** plant 16, `engine.ts` (`#price` is in scope where the magnitude is quantised).

**Claim:** `parity(p_N + Σ s_j m_j) = parity(p_N + Σ m_j)` — parity of the lattice price is a function of magnitudes alone, so a parity-keyed magnitude leaves ADR-0003's involution measure-preserving. Surviving is correct; it is recorded because it shows the "no field for a price" type boundary (`MagnitudeContext`) does not extend to `engine.ts` itself, and the interior harness of a3-01 does not catch it either (it cannot; nothing can, because there is nothing to catch). Nothing to fix beyond a3-01.

### a3-10 — Numeric literals in the market model that are neither named nor documented (CLAUDE.md §6.4)

**Severity:** minor.

| file:line                    | literal                                                                      | note                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `hawkes.ts:155`              | `0.693_147_180_559_945_3`                                                    | ln 2, inline; `LN2_HI` exists in `portable.ts`                                                                                    |
| `hawkes.ts:160`              | `Math.max(1e-9, …)`                                                          | floor on the running average, undocumented                                                                                        |
| `structure.ts:200`           | `Math.min(3, tightness)`                                                     | compression clamp, undocumented                                                                                                   |
| `personality.ts:462-470`     | `intervalMs = 1_000`, `previousMagnitude: 10`, `instant = 1_776_000_000_000` | the structure-inflation estimator's fixed inputs; `previousMagnitude` is _load-bearing_ for the compression term and is a bare 10 |
| `asset.ts:268`               | `previousMagnitude = 10`                                                     | same, in the calibration walk                                                                                                     |
| `asset.ts:351`               | `100`                                                                        | minimum horizons per replicate                                                                                                    |
| `personality.ts:401`         | `7.5`                                                                        | Lanczos shift, undocumented (coefficients are documented)                                                                         |
| `personality.ts:422`, `:579` | `2_000`, `100`                                                               | iteration counts                                                                                                                  |
| `regime.ts:168`              | `1_000`                                                                      | degenerate-sojourn guard                                                                                                          |
| `cascade.ts:64`              | `24`                                                                         | component ceiling; `TRAIT_BOUNDS.cascadeDepth.max` is 18                                                                          |
| `mirror.ts:171`              | `5`                                                                          | divergence cap                                                                                                                    |
| `factory.ts:47`              | `1e-5`                                                                       | documented in prose only                                                                                                          |

### a3-11 — Exports nothing outside their own file uses

**Severity:** minor (surface, not behaviour).

`packages/engine/src/index.ts`, zero non-test uses anywhere (packages, apps, tools) and zero test uses either: `AuthoredPersonality`, `CALIBRATION_STREAM_PURPOSES`, `CascadeSnapshot`, `CreateEngineOptions`, `EngineStreams`, `HawkesSnapshot`, `MarketEngineOptions`, `MirrorDivergence`, `MirrorOptions`, `MirrorResult`, `PhaseSpec`, `RegimeSnapshot`, `RegimeSpec`, `RegistrationOptions`, `RegistrationOutcome`, `SPACING_FEASIBILITY_MARGIN`, `STRUCTURE_INFLATION_STEPS`, `SampledTraitRanges`, `StructurePhase`, `StructureSnapshot`, `TraitDistanceOptions`, `VolatilityRegime`, `provisionalTickRms`. Used only by tests: `assertArchetypeFeasible`, `assertCascadeConfig`, `assertHawkesConfig`, `assertRegimeConfig`, `assertStructureConfig`, `assetById`, `cascadeInflationOfClustering`, `cascadeTimescalesMs`, `defaultConfigFor`, `expandPersonality`, `logUnitsPerRelativeMove`, `runMirrorTest`, `SignInvertingStream`, `sampleTraits`, `spacingCeiling`, `startingClustering`, `weibullSample`, `DEFAULT_TRAITS`, `EXCESS_KURTOSIS_BAND`, `KURTOSIS_HEADROOM`, `STARTING_CASCADE_INFLATION`, `STRUCTURE_PHASES`, `TARGET_TIE_RATE`, `VolatilityCascade`, `AssetArchetype`, `CALIBRATION_CHUNK_TICKS`.

`packages/core` (via `index.ts` barrels), zero uses outside the defining file including tests: `ASSET_FAMILIES`, `CHACHA20_NONCE_BYTES`, `CHACHA20_ROUNDS`, `CursorAdvanceReason`, `DAY_MS`, `HOUR_MS`, `ENVIRONMENTS`, `EntropyError`, `LeaseState`. Test-only: `FixedClock`, `MAX_EPOCH_MILLIS`, `MINUTE_MS`, `SECOND_MS`, `TIMEFRAME_IDS`, `addMillis`, `assertReplaySegment`, `assertValidStreamLabel`, `bernoulli`, `bucketEnd`, `bucketIndex`, `categorical`, `chiSquared`, `cursorsAt`, `differenceMillis`, `expandNonce`, `fromDisplayPrice`, `fromWords`, `isValidDurationMillis`, `isValidEpochMillis`, `logNormal`, `relativeMove`, `stepsBetween`, `studentT`, `toDisplayPrice`, `uniformSymmetric`, `CursorAdvance`, `ReplaySegment`, `StreamSnapshot`. Notably `cursorsAt`/`ReplaySegment` (the INV-009 replay artefact of ADR-0002 §4) has no runtime consumer. No internal (non-exported) function in either package is unreferenced.

### a3-12 — `reachableTarget` retries on every error, including ones a lower target cannot fix

**Severity:** minor.

**Where:** `packages/engine/src/brief.ts:149-156` (`catch {}` with no discrimination).

**Claim:** `authorPersonality` throws for three unrelated reasons — target unreachable at max clustering (retreat helps), "regime and structure layers alone predict … already above the target" (retreat makes it _worse_), and `assertPersonalityTraits` on the solved volatility (retreat is irrelevant). All three are retried six times, each retry costing a fresh 400k-step structure simulation (measured 300–360 ms per brief in the normal case, so ~2 s before the honest refusal). Forced exhaustion measured exactly `AUTHORING_ATTEMPTS` (6) calls and a correct `authoring` refusal carrying the solve's message.

**Recommended fix:** Retreat only on the "needs more cascade inflation than clustering 0.4 can provide" error; rethrow the rest immediately.

### a3-13 — The id pattern admits a trailing `.` and inner `..`, which are distinct labels but not distinct filenames on every filesystem

**Severity:** minor.

**Evidence:** `checkIdentity` accepted `eurusd.`, `eur..usd`, `eurusd-` (`zz_audit_registration`). On NTFS/Windows a trailing dot is stripped, so `eurusd` and `eurusd.` would share a `FileStateStore` file while deriving different keystreams. Linux-hosted today; a `[a-z0-9]$` anchor closes it.

### a3-14 — The unit project has no event-loop watchdog

**Severity:** minor (project instrument, observed incidentally).

**Evidence:** my `zz_audit_families` test blocked its worker for ~13 s per archetype and the run ended `Tests 10 passed (10) / Errors 1 error: Timeout calling "onTaskUpdate"` — the CLAUDE.md §5 failure, with every test green. `vitest.config.ts` installs `vitest.setup.statistical.ts` only for the statistical project, so a long synchronous unit test still fails the run without naming itself.

## What survived

- **Determinism / INV-008 / INV-009.** All five catalogue assets continue bit-identically (price, instant, sequence) after `snapshot → JSON.stringify → JSON.parse → restore` into an engine built from fresh objects and a fresh keyring instance; re-snapshot after continuation restores identically again; two independent resumes from the same leased cursors across a seam are bit-identical, start at `sequence + 1`, and every stream stands beyond its consumed block; interleaving two engines changes neither. No module-level mutable state besides `bits.ts`'s synchronous scratch buffer (`grep` of `packages/{core,engine}/src` for module-level `let`/`Map`/`cache`), and interleaving proved it inert. `restore` refuses a foreign stream name, a missing cursor and a malformed cursor.
- **INV-010.** The serialised snapshot contains no hex/base64 run ≥ 32 characters and no `key`/`secret` token; the keyring redacts under `JSON.stringify`.
- **Sign-blindness of every shipped layer against sign leaks.** All leverage plants (regime, structure, modulator, Hawkes excitation, cascade switching, magnitude, engine) were caught, including the one gated on `env=production` (caught by `productionComposition.test.ts` alone — CA4 M-1's closure holds). The sign is drawn once, in `engine.ts:154`, from the `sign` stream, _after_ the magnitude has been computed and quantised; no magnitude-path input (`MagnitudeContext`, `ArrivalContext`) carries a sign or a price, and `previousMagnitude` is `steps`, an absolute integer. `productionComposition.test.ts` does drive the real factory, under a real `fromSecret` keyring, for every catalogue asset, at 8,000 + 2,000 ticks.
- **The brief retreat (PH-21.1).** `requestFromBrief` and `registerAsset` derive the `kurtosis` stream under identical labels (`simulation|registration-<id>|kurtosis|0`, recorded through a proxied keyring for all 8 archetypes) and the solved `clustering` is bit-identical between the two paths; forced exhaustion is refused at `authoring` with the solve's own message; measured cost 303–364 ms median, 390–435 ms max per brief; 0 retreats in 88 real briefs.
- **Registration re-checks.** CA6-20 (precision > 18 refused), CA6-21 (`0`, `-5`, `NaN`, `±Infinity` all throw), CA6-25 (an exact copy at 1.05× and at 100× amplitude refused, distance 0; a clustering nudge of +0.02 is the first to pass at 0.015), CA6-27 (`blue-chip-index` at tempo 6,000 / burstiness 0.42 registers: mean interval 4,470 ms, tie rate 0.97%). Duplicate ids differing by case, whitespace or a zero-width character are refused by the pattern.
- **`sampleArchetype` at 2,000 × 8.** Every sampled trait inside its box and `TRAIT_BOUNDS`; fastest rung ≥ 0.5 tick in all 16,000; spacing ≤ ceiling; target ≤ band max; dispersion in band; volatility in bounds; spacing clamp engages 32–81% of draws depending on archetype (major-fx 81%, alt-crypto 32%). Kurtosis clamp: 0/2,000 for seven archetypes (see a3-05 for the eighth).
- **Numerical stability.** 25 legal personalities × 2 quanta × 200,000 ticks: no NaN/Infinity, no zero or non-integer interval, all prices safe integers; the largest single tick was 443,745 steps (volatility 1e-3 at quantum 1e-7), four orders of magnitude below the safe-integer range even over years; `assertPersonalitySafe` correctly flags the pathological combinations (excess kurtosis 240–406,000) that the engine nevertheless runs without fault.
- **Portability.** The only `Math.*` calls on the price path are `floor`, `max`, `min`, `abs`, `sqrt`, `trunc`, `round`, `ceil` and `Math.PI` — all exactly specified; `pow`/`exp`/`ln` are the fdlibm ports; no `toFixed`/`parseFloat`/`Date`/`Intl` on the path (`toFixed` only in messages and `formatDisplayPrice`); every `.sort` carries a numeric comparator; `Object.entries(streams.models)` iterates non-integer string keys in insertion order; `%` is applied to non-negative instants only; `BigInt` is confined to cursors and split into 32-bit halves before ChaCha20; float accumulations (`horizonReturnsCore`, `regimeInflation`, `structureInflation`) are in fixed loop order. The JSON round-trip test confirms doubles in `remainingMs`/`averagePathRate`/`excitation` survive serialisation exactly.
- **`packages/core/src/market`.** Two ticks in one millisecond are accepted, ordered by sequence, and land in one candle; a backwards instant or a non-increasing sequence throws; a tick exactly on a bucket boundary opens the new bucket (start inclusive, end exclusive, as documented); all 11 timeframes are epoch-aligned and nest exactly over 20,000 instants in a 5-week range (1d at UTC midnight, 4h at 00/04/…); `foldCandles(1s → tf)` equals `foldTicks(tf)` for every coarser timeframe over 300,000 irregular ticks with multi-hour gaps; `priceAtOrBefore` is inclusive and takes the last of equal instants, `indexAtOrAfter` inclusive and takes the first.
- **The runners.** `catalogueScale.ts` at `OTC_SCALE_COUNT=8` registered 8/8, printed the registration, per-archetype and differentiation tables as claimed (closest pair `eurusd / scale-major-fx-0` at 0.0319, 3.2× the floor; `major-crypto` 59.6 s, the rest 2–14 s); `quantile()` is nearest-rank with clamped index (no off-by-one; `q=1` yields the max). `venueScale.ts` measures what its header says (advance cost per market at 5/25/50/100 markets from one build; storage extrapolated from 8 assets × 2 days, labelled as such). `Date.now()` in both is tooling-only.

## Limits of this audit

- The statistical suite was not run, so a3-01's plant was not put through the lab battery; its level-anchored families exist and are calibrated against the 4,000-step fixture, and my plant's 1,000-step cell is in the swept set, so the battery _should_ catch this particular plant — but a cell width off the sweep, or an aperiodic level field, has no such guarantee, and that is inference from the registry, not a measurement.
- Build/lint were not run in the worktree (unreliable there by the brief); the runner was executed through vitest against worktree sources rather than `tools/sim/dist`.
- The retreat mechanism was exercised by forcing `authorPersonality` to throw; no naturally unauthorable brief was found in the 288 real briefs drawn here, consistent with PH-21.1's "one retreat in 200".
- Plants 2, 4, 6, 8, 10, 12, 14 (level leaks via the shared channel) are recorded as caught, but the catch is an artefact of the channel (see the table footnote); only plants 16 and 20 test level leaks honestly, and both survive the shipped gate.
- `venueScale.ts` was read, not run.
- Time on a shared machine: `zz_audit_families` tripped the worker RPC timeout (a3-14) but all its assertions completed and are reported from its stdout.
