# PH-4 — Asset Personality System and Multi-Asset Instantiation

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-4
Status: APPROVED
Cycle: 2 (phase 1 of 3)
Created: 2026-08-31
Branch: `feature/ph-4-asset-personalities`
Depends on: PH-1 (APPROVED), PH-2 (APPROVED), PH-3 (APPROVED)
Decisions applied: [ADR-0004](../decisions/ADR-0004-canonical-price-representation.md), [ADR-0006](../decisions/ADR-0006-layered-market-model.md)

---

## 1. Objective

Turn one validated market process into a catalogue of assets that feel genuinely
different to trade, without any of them becoming predictable.

PH-3 produced a single instrument with a single parameter set. A trading product
needs many: a user switching from a major currency pair to a crypto asset should
immediately feel a different market — faster, wilder, with different quiet
periods — and not merely a relabelled copy of the same series.

This phase discharges **INV-007 (asset differentiation)**, the only invariant
[`docs/architecture/INVARIANTS.md`](../architecture/INVARIANTS.md) still records
as pending.

## 2. Problem

Differentiation and safety pull against each other, and the tension is real.

The safe move is to give every asset the same parameters, because those
parameters are the ones the PH-3 battery cleared. The product move is to spread
them widely, because assets that differ only in name are a worse product than a
single asset honestly presented.

The danger is not that a personality leaks an edge through the sign — it cannot,
since the sign is drawn from a dedicated stream no magnitude input can observe,
and that argument is indifferent to parameters. The danger is in the two places
where parameters meet the _published_ series:

1. **The lattice.** `logQuantum` is fixed per asset. Too coarse relative to that
   asset's quiet state and the quantisation itself becomes a signal — the
   `displayQuantization` fixture exists precisely because that channel is real
   and the battery detects it at z ≈ −85. The quantum must be set against the
   **first percentile** of the asset's own 30-second volatility distribution,
   not its mean, because volatility is publicly forecastable and an adversary
   simply waits for the quiet state.

2. **Degenerate parameter regions.** A cascade with too little dispersion, a
   regime process that dwells too long, or a Hawkes branching ratio near one
   produce markets that are unrealistic, unstable, or both. PH-3 found the last
   of these the hard way: an exposed excitation parameter meant the default
   branching ratio was 21.6, and the process ran permanently pinned to its clamp
   with nothing failing.

So a personality is not a free choice of numbers. It is a point in a parameter
space that must be _shown_ to be safe, per asset, by the same battery that
cleared PH-3 — and the quantum must be _derived_ from that asset's own simulated
behaviour rather than chosen.

## 3. Expected product value

A user sees a credible asset list. A forex major is orderly and mean-reverting
around its sessions; a crypto asset is fast, fat-tailed and prone to bursts; an
index moves in longer structural swings. Each is recognisable, and each is
provably as unpredictable as the one asset PH-3 validated.

## 4. Scope

- A personality model: the parameter space, its safe bounds, and the mapping from
  a personality to a `MarketEngineConfig`.
- Per-asset `logQuantum` calibration derived from simulation evidence against the
  first percentile of that asset's 30-second volatility.
- An asset registry: the catalogue, its registration procedure, and the evidence
  each registration must carry.
- Multi-asset validation: every registered asset independently passes the
  predictability battery and the realism battery.
- A differentiation metric: assets must be _statistically distinguishable_ from
  one another, so that "genuinely distinct" is measured rather than asserted.

## 5. Exclusions

- Runtime hosting of multiple assets concurrently — PH-5.
- Contracts, settlement or anything economic — PH-6.
- Correlation between assets. Real markets co-move; introducing cross-asset
  dependence is a substantial modelling question and a potential information
  channel between markets. Deliberately deferred, and recorded as such.

## 6. Architectural direction

### 6.1 A personality is data, validated at registration

Personalities are declarative parameter sets, not code. Adding an asset must not
mean writing a new model. The registry holds the parameters and the evidence;
the engine is unchanged.

### 6.2 The quantum is derived, never chosen

Registration runs a simulation, measures the first percentile of 30-second
volatility, and computes the quantum from it. A hand-chosen quantum is the
`displayQuantization` defect waiting to be reintroduced.

### 6.3 Differentiation must be measured

INV-007 is the invariant most easily faked. Two assets whose parameters differ on
paper may be statistically indistinguishable in output. The phase needs a test
that would _fail_ if personalities were secretly identical — the same discipline
the restore tests got in Cycle Audit 001.

### 6.4 Every asset is attacked, not just the family

A battery clearing one asset says nothing about another. Acceptance is per-asset.

## 7. Phase invariants

- INV-007 becomes enforced, with evidence recorded in `INVARIANTS.md`.
- INV-006 continues to hold for **every** registered asset, at the materiality
  threshold implied by the promotional payout.
- The sign boundary is untouched. No personality parameter reaches the sign path.

## 8. Dependencies

PH-3's validated engine and PH-2's calibrated batteries. Both approved.

## 9. Initial decomposition strategy

Provisional, and expected to change as evidence arrives:

- **PH-4.1** — personality model, parameter space and safe bounds.
- **PH-4.2** — asset registry, quantum calibration and the registration procedure.
- **PH-4.3** — multi-asset validation, differentiation metric and phase integration.

## 10. Acceptance intent

The phase is complete when a catalogue of assets exists, every one of them has
passed the predictability and realism batteries on its own evidence, the assets
are demonstrably distinguishable from each other, and INV-007 can be promoted
from pending to enforced without the traceability guardrail complaining.

## 11. Risks and unknowns

| Risk                                                                       | Assessment                                                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A personality region that is realistic but subtly exploitable              | Real. Mitigated by per-asset acceptance rather than family-level acceptance.                                                                 |
| Differentiation that is visible in parameters but not in output            | Real, and the reason §6.3 requires a measured metric with teeth.                                                                             |
| Statistical power: validating N assets costs N times the simulation budget | Real. Expect this to constrain how many assets Cycle 2 registers, and to be stated honestly rather than absorbed by weakening the threshold. |

---

## 12. Phase approval record

**APPROVED** from executed evidence, 2026-08-31.

### The result the phase existed to produce

The product has an asset list. Five assets across four families, each with a
lattice derived from its own behaviour, each independently clean under the attack
battery and plausible on all fifteen realism metrics, and each passing the mirror
test with zero divergences.

| Asset  | Family    | Pace    | Excess kurtosis | logQuantum | Display |
| ------ | --------- | ------- | --------------- | ---------- | ------- |
| btcusd | crypto    | 334 ms  | 151.6           | 2.048e-6   | 1 dp    |
| gbpjpy | forex     | 760 ms  | 108.6           | 9.557e-7   | 4 dp    |
| eurusd | forex     | 1295 ms | 63.5            | 2.324e-7   | 7 dp    |
| xauusd | commodity | 1994 ms | 100.5           | 3.876e-7   | 4 dp    |
| spx    | index     | 3187 ms | 44.4            | 1.392e-7   | 4 dp    |

### Subphases

| Subphase | Title                                                 | State    |
| -------- | ----------------------------------------------------- | -------- |
| PH-4.1   | Personality model, parameter space and safe bounds    | APPROVED |
| PH-4.2   | Asset registry, quantum calibration and registration  | APPROVED |
| PH-4.3   | Multi-asset validation and the differentiation metric | APPROVED |

### Phase invariants

INV-007 is **promoted to enforced** in
[`INVARIANTS.md`](../architecture/INVARIANTS.md), on the evidence in PH-4.3 and
with the hedge that evidence actually supports. INV-006 continues to hold for
every registered asset: five mirror tests, zero divergences, and five clean
battery verdicts at a common 0.562pp floor. The sign boundary is untouched — no
personality parameter reaches the sign path, and the guardrail scan enforces it.

### What the phase learned

**Three analytic results replaced three simulations.** The kurtosis of the
increment distribution is exactly `E[m⁴]/E[m²]²` because the sign is an
independent fair coin, and it factorises across the independent multiplier
layers. That turned a ten-minute simulation followed by recalibration into a
microsecond check, and it rejected the first crypto personality at 276.8 against
a ceiling of 200 before anything ran.

**Measured quantities are less trustworthy than they look.** Three separate times
this phase, a number that appeared to be evidence was not:

- excess kurtosis measured on one run varies from 36.6 to 370.3 across seeds on
  the _same_ configuration — either side of the ceiling it is checked against;
- a calibrated quantum reproduces only to within 28% between seeds, while the
  property it exists to deliver reproduces to within 0.25pp;
- a per-asset detection floor budgeted by ticks varies 2x across assets, because
  the floor depends on wall-clock span and the assets tick at different rates.

In each case the fix was the same: assert the property the artefact exists for,
not the intermediate number it happens to be made of.

**The differentiation metric failed the product before the product shipped.** It
scored `gbpjpy` and `xauusd` at 9/40 because they had been given near-identical
pace and scale. That is the whole point of a metric with a reachable null.

### Phase quality gate

| Check                  | Result                                  |
| ---------------------- | --------------------------------------- |
| `npm run format:check` | PASSED                                  |
| `npm run lint`         | PASSED (exit 0, verified)               |
| `npm run build`        | PASSED (exit 0, verified)               |
| `npm test`             | **804 tests across 50 files, 0 failed** |
| `npm run gate` exit    | **1** — see below                       |

The gate exited non-zero while every test passed. The cause is recorded rather
than rounded off: Vitest reported one unhandled error,
`[vitest-worker]: Timeout calling "onTaskUpdate"`. That is the worker's RPC
heartbeat expiring because the statistical suite's longest tests block the event
loop for tens of seconds at a time — the slowest single assertion in this run took
35.8s of uninterrupted CPU. It is an infrastructure timeout, not a test outcome,
and it is load-dependent: the same suite exited 0 earlier in the session at a
smaller size.

It is **not** waved away. A gate that can exit non-zero without a failing test is
a gate that trains its operator to ignore it, which is precisely the habit that
cost this phase its first gate run. Tracked as B-005, and the phase is approved on
the test results with the discrepancy stated rather than on a green summary line.

### A process defect this phase exposed

The PH-4 phase gate failed on its first run: `npm run lint` had been failing since
PH-4.1, and both subphase approval records claimed it passed. The cause was
running the check as `npm run lint 2>&1 | tail -1`, which discards the exit status
and, with two error lines, displayed nothing informative.

Cycle Audit 001 identified exactly this class — a check reported as verified that
was never executed — and added guardrails for the _documentation_ symptom. It did
not address the habit, and the habit reproduced the defect in the next phase.

Two things follow, and only one of them is a fix:

- The subphase records have been corrected in place rather than amended quietly,
  each carrying an explicit note of what was overstated and why.
- The durable fix is not discipline, it is **hosted CI** — which has still never
  executed, because nothing has ever been pushed to the configured remote. A
  green local gate depends on the operator reading it correctly; a CI run does
  not. This is now the strongest argument in `docs/BACKLOG.md` B-001.

### Known limitations carried forward

- Assets differ mostly in pace and scale. Scale-free shape differentiation is
  real but weak — 30.0% against a 20% null — because the MSM cascade dominates
  observable volatility dynamics and every asset shares it. Tracked as B-004.
- Per-asset battery floors (0.562pp) sit above the 0.2513pp product margin.
  PH-3's full-rigor 0.217pp run covers the canonical configuration; the mirror
  test covers each asset exactly and structurally.
- No asset has ever been hosted. Nothing runs continuously, and restart
  continuity is proven in-process only. That is PH-5.
