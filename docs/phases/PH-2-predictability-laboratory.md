# PH-2 — Calibrated Adversarial Predictability Laboratory

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-2
Status: ACTIVE
Cycle: 1 (phase 2 of 3)
Created: 2026-08-31
Branch: `feature/ph-2-predictability-laboratory`
Depends on: PH-1 (APPROVED)

---

## 1. Objective

Build and **calibrate** the instrument that decides whether this project
succeeds: an offline attack battery that measures whether a public observer can
obtain a material, reproducible directional edge at the eight binary horizons,
paired with a realism battery that prevents anti-predictability from being
achieved by making the market meaningless.

The phase's acceptance is about the **instrument**, not about any market. It
passes when the battery detects every planted edge at or above a declared
minimum detectable effect, reports nothing on the symmetric control, and
publishes the sensitivity it actually achieved.

## 2. Problem

An attack battery that reports "no edge found" is worthless until it has been
shown capable of reporting the opposite.

PH-1 produced two pieces of evidence that make this concrete rather than
cautionary:

1. A predictability probe written during PH-1 design reported z-scores above
   1000 on a process that is provably unexploitable. The cause was a look-ahead
   bug — the forward-return window included the tick being conditioned on. It
   was broken in the direction that produces alarming results. **A battery with
   the opposite sign of error would have certified a leaking engine as clean**,
   and nothing downstream would have caught it.
2. Calibrating the planted-edge corpus showed that **three of six planted defects
   are invisible to an unconditional estimator**. Sign autocorrelation, display
   quantisation and level-anchored volatility all sit at P(up) = 0.500 overall
   while leaking at z = 239, z = 9.2 and z = −7.6 under the right conditioning.

The second finding generalises into the design constraint for this phase. Every
conventional attack battery for a synthetic market conditions on
**translation-invariant** features — multi-lag returns, realized volatility,
ranges, candle shapes, run lengths, distance from a moving average, time of day.
Not one of those is a proxy for _absolute price modulo a cell width_. A
level-anchored leak passes such a battery untouched, and level-anchored
mechanisms are exactly what a designer reaches for when asked to make support and
resistance "feel real".

## 3. Expected product value

- A verdict on the core product hypothesis that rests on measured sensitivity
  rather than on the absence of a finding.
- A published minimum detectable effect per horizon, so "no edge" has a number
  attached to it.
- A regression gate: every future change to the market model is re-attacked
  automatically, so a leak introduced in year two fails a build rather than
  reaching customers.
- The public-observer boundary defined here becomes the public API contract in
  PH-7, so the surface that ships and the surface that was attacked are provably
  the same one.

## 4. Scope

1. **Observer dataset** — the exact boundary of what an attacker may see: ticks,
   authoritative timestamps, OHLC on every timeframe, long history. Nothing
   private, enforced structurally.
2. **Economic edge metric** — win rate expressed against the payout breakeven
   (0.5405 at 85%, 0.5025 at 99%), so a result is reported in the units the
   business cares about rather than as an abstract z-score.
3. **Statistical core** — non-overlapping sampling and block bootstrap,
   Benjamini–Hochberg FDR control, and a power calculation giving the minimum
   detectable effect for a given sample count.
4. **Attack families**, including the level-anchored axes that conventional
   batteries omit:
   - unconditional edge per horizon;
   - conditional-direction tables on past-return features, run lengths,
     volatility state, candle morphology, efficiency;
   - timing attacks: second of minute, phase within candle, phase within horizon;
   - **level attacks**: absolute price, price modulo a swept grid of candidate
     cell widths, price modulo the quote quantum, distance to the nearest minimum
     of the level-conditioned volatility curve;
   - restart-seam attacks;
   - a learned out-of-sample predictor as a catch-all.
5. **Realism battery** — stylized facts with published target ranges: return
   autocorrelation, absolute-return long memory, kurtosis, volatility clustering,
   run-length distribution, displacement heterogeneity, candle morphology
   diversity, tick microstructure.
6. **Verdict and report** — a single machine-readable artefact carrying both
   batteries, the FDR-corrected worst finding, and the achieved power.
7. **Calibration** — power curves against the PH-1 corpus, per fixture, per
   horizon, per strength.

## 5. Exclusions

- The real generative market model (PH-3). This phase attacks fixtures.
- Asset personalities and multi-asset attacks (PH-4).
- Runtime, persistence, transport, UI (PH-5 onward).
- Continuous scheduled integrity runs against production history, and the
  independent red-team round using withheld attack families (PH-9). Withholding
  attack families from PH-3's tuning is only meaningful if some are genuinely
  reserved, so PH-9 designs its own.

## 6. Architectural direction

A new package, `@otc/lab`, depending on `@otc/core` and nothing else. In
particular it must **not** depend on `@otc/engine` or `@otc/fixtures`: the
battery has to be able to attack any tick source without knowing what produced
it, and a battery that can see the generator is not an observer.

`@otc/fixtures` is used only by the lab's own tests, which is where calibration
happens.

### The observer boundary is structural

The dataset is built once, from public data, and every attack takes the dataset
rather than a source. An attack therefore cannot reach private state, because it
never receives anything that holds it.

### Every attack declares its features

An attack family declares the features it conditions on and the horizon it
targets. That declaration is what makes coverage auditable — the question "what
does this battery _not_ condition on?" must have an answer that can be read off
the code rather than inferred from it.

### No silent caps

If the battery bounds its own work — sampling, top-N reporting, a swept
parameter grid — it reports what it dropped. A truncated sweep that presents as
complete coverage is the same failure mode as a look-ahead bug, one level up.

## 7. Phase invariants

| ID     | Invariant                                                                                       | Enforced by                                                     |
| ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| PH2-I1 | No attack may use information at or after the entry index                                       | look-ahead tests per attack family, plus a shared harness check |
| PH2-I2 | The battery reports nothing on the symmetric control, at every horizon, after FDR correction    | calibration suite                                               |
| PH2-I3 | The battery detects every planted fixture at strength 1                                         | calibration suite                                               |
| PH2-I4 | Every reported significance uses non-overlapping windows or a block-bootstrap variance estimate | statistical core tests                                          |
| PH2-I5 | The gate is the worst surviving finding after FDR control, never a pooled mean                  | verdict tests                                                   |
| PH2-I6 | The battery conditions on level-anchored features, not only translation-invariant ones          | attack registry test asserting the feature taxonomy is covered  |
| PH2-I7 | The observer dataset exposes only public information                                            | type-level and structural tests                                 |
| PH2-I8 | Reported minimum detectable effect is computed, not asserted                                    | power tests against known effect sizes                          |

## 8. Dependencies

PH-1 (APPROVED) for the substrate and the calibration corpus.

## 9. Initial decomposition strategy

| Subphase   | Objective                                                                                |
| ---------- | ---------------------------------------------------------------------------------------- |
| **PH-2.1** | Observer dataset, economic edge metric, and the statistical core (bootstrap, FDR, power) |
| **PH-2.2** | Attack families and the verdict                                                          |
| **PH-2.3** | Realism battery, combined report, and calibration power curves                           |

Adaptive: subphases may be added if implementation reveals the need.

## 10. Acceptance intent

PH-2 is complete when, from the repository alone:

1. an observer dataset can be built from any tick source, exposing only public
   information;
2. the full battery runs against the symmetric control and returns a clean
   verdict, with a stated minimum detectable effect per horizon;
3. the battery runs against each planted fixture at strength 1 and detects every
   one, naming the attack family that caught it;
4. each fixture's detection threshold in strength is measured, producing a power
   curve;
5. every attack is demonstrated free of look-ahead;
6. the realism battery distinguishes a plain random walk from a stochastic-
   volatility process, and reports which stylized facts each satisfies;
7. the verdict is a single artefact that a later phase can gate a build on.

## 11. Success criteria

- Phase invariants PH2-I1 … PH2-I8 covered by executed, passing tests.
- Calibration power curves recorded as evidence.
- `docs/architecture/VALIDATION.md` describes what was built.
- Full quality gate green.

## 12. Risks and unknowns

| Risk                                                           | Assessment                                                                                                                                                                    | Mitigation                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The battery is too weak to certify the 99%-payout budget       | **High and partly unavoidable.** Certifying \|edge\| < 0.05pp at 3σ needs ~10⁷ independent samples per horizon per asset — about 285 simulated years at the 15-minute horizon | Do not pretend otherwise. Publish the achieved minimum detectable effect per horizon and let the roadmap decide how much simulation to buy. A gate that reports its own sensitivity is honest; one that reports "no edge" is not            |
| Multiple testing produces false alarms across hundreds of bins | Medium                                                                                                                                                                        | Benjamini–Hochberg FDR control, and a control-fixture false-positive rate measured rather than assumed                                                                                                                                      |
| Attack families are tuned until the control passes             | **Real and insidious**                                                                                                                                                        | The control's clean verdict must hold with attack parameters fixed _before_ they are pointed at any candidate model, and the corpus provides the opposing constraint: weakening an attack to clear the control also loses a planted fixture |
| A learned predictor overfits and reports phantom edges         | Medium                                                                                                                                                                        | Strict out-of-sample split with a temporal boundary; report out-of-sample only                                                                                                                                                              |
| Battery runtime makes it unusable as a gate                    | Medium                                                                                                                                                                        | Separate a fast gate subset from the full run; measure and record both                                                                                                                                                                      |
