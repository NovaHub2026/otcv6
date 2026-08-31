# ROADMAP

Type: SUPPORTING DOCUMENTATION (living)
Status: Dynamic — phases may be split, merged, reordered or replaced as
implementation reveals information (`GOVERNANCE.md` §13). Approved phases are
never rewritten as though they had not happened.
Last revised: 2026-08-31

---

## Ordering principle

**Retire the hypothesis risk first, then build layers on a proven core.**

Streaming ticks over WebSockets, persisting candles and settling contracts are
ordinary engineering with known solutions. What is genuinely unproven is the
premise of the whole product (`PROJECT_INTRODUCTION.md` §3–§4): that one process
can be simultaneously _realistic_ and _free of material directional edge_ at the
30s–15m horizons, and that we can produce executed evidence of it. Every line of
NestJS, persistence, API and React written before that question is settled is
capital at risk.

Cycle 1 therefore exists to settle that question and nothing else, so that the
first Cycle Audit — the project's first and most valuable Human gate — lands
precisely on _"is the core hypothesis proven?"_.

### Why the falsifier is built before the model

Within Cycle 1 the order is forced by a hard dependency: you cannot know whether
the model is unpredictable until you own the instrument that decides, and you
cannot trust that instrument until you have proven it has statistical power.

**An uncalibrated battery reporting "no edge found" is indistinguishable from a
broken one**, and would let the project ship a fatal defect behind a green
report.

This is not a hypothetical. During the design work for PH-1 a quick predictability
probe was written to test the central symmetry claim. It reported an apparently
overwhelming edge — z-scores above 1000 — on a process that is provably
unexploitable. The cause was a look-ahead bug: the forward-return window included
the tick being conditioned on. The instrument was broken, and it was broken in
the direction that produces alarming results rather than reassuring ones, which
is the _lucky_ direction. A battery with the opposite sign of error would have
certified a leaking engine as clean.

So PH-2 builds the falsifier and proves it can fail an engine, by detecting
**deliberately planted edges** of known size, before PH-3 builds the real market
process inside a generate → attack → diagnose → correct loop.

---

## Cycle 1 — Prove the core hypothesis

| Phase | Title                                                         | State                                                 |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------- |
| PH-1  | Deterministic Market Substrate                                | **APPROVED**                                          |
| PH-2  | Calibrated Adversarial Predictability Laboratory              | **APPROVED**                                          |
| PH-3  | Core Generative Market Process Under Continuous Falsification | **APPROVED**                                          |
| —     | **Cycle Audit 1** — Human gate, requires `EJECUTA`            | **APPROVED** — [record](../audits/CYCLE-AUDIT-001.md) |

### PH-1 — Deterministic Market Substrate

The sealed, cryptographically unpredictable, bit-identically replayable substrate
every later capability draws from: entropy, portable numerics, authoritative
time, the tick and price domain, tick-to-OHLC projection, and the planted-edge
fixture corpus that PH-2 calibrates against.

| Subphase | Title                                                                              | State    |
| -------- | ---------------------------------------------------------------------------------- | -------- |
| PH-1.1   | Canonical time model and deterministic entropy architecture                        | APPROVED |
| PH-1.2   | Portable numeric foundation and distribution samplers                              | APPROVED |
| PH-1.3   | Market domain: integer log lattice, ticks, candle aggregation, snapshot and replay | APPROVED |
| PH-1.4   | Simulation runner and planted-edge fixture corpus                                  | APPROVED |

### PH-2 — Calibrated Adversarial Predictability Laboratory

The instrument that decides project success. A public-observer attack battery
measuring directional edge at the exact eight binary horizons, paired with a
realism battery that stops anti-predictability from being achieved by making the
market meaningless.

Its acceptance was about the _instrument_, not the market.

**Approved.** Two results define what the laboratory is worth:

- a **conventional battery** — translation-invariant and temporal families, which
  is everything a normal validation suite contains — returns _clean_ on a
  demonstrably exploitable engine, while the full battery catches it through the
  swept price-cell family at the exact cell width;
- a **memoryless Gaussian random walk** passes every attack and fails realism at
  8/15, so passing the attack battery alone is worthless.

Achieved sensitivity: 0.222pp at the 30-second horizon, finer than the 0.2513pp
threshold implied by the 99% promotional payout. Longer horizons are coarser and
every verdict says so.

The public-observer data boundary defined here is reused verbatim as the public
API contract in PH-7, so the shipped surface and the attacked surface are
provably identical.

| Subphase | Title                                                    | State    |
| -------- | -------------------------------------------------------- | -------- |
| PH-2.1   | Observer dataset, economic edge metric, statistical core | APPROVED |
| PH-2.2   | Attack families and the verdict                          | APPROVED |
| PH-2.3   | Realism battery and the combined report                  | APPROVED |

### PH-3 — Core Generative Market Process Under Continuous Falsification

The real generative model — latent state, regime, volatility, emergent structure,
tick microstructure — built inside a tight generate → attack → diagnose → correct
loop against the PH-2 laboratory, until a single asset simultaneously passes the
realism battery and the anti-predictability verdict.

The architecture is fixed by ADR-0003 and ADR-0004: increments are a sign-blind
magnitude times an independent fair coin drawn from its own cryptographic stream,
accumulated on an integer log lattice. Everything the phase builds lives in the
magnitude and timing process. The **mirror test** — negate the sign stream from a
random interior point and assert every latent variable is bit-identical while
every increment is exactly negated — is the primary structural gate, and it is
cheap, exact, and something no statistical battery can replace.

| Subphase | Title                                                               | State    |
| -------- | ------------------------------------------------------------------- | -------- |
| PH-3.1   | Sign-blind engine skeleton, volatility cascade, and the mirror test | APPROVED |
| PH-3.2   | Regime and structure layers                                         | APPROVED |
| PH-3.3   | Microstructure: self-exciting arrivals and duration coupling        | APPROVED |
| PH-3.4   | Canonical engine, restart continuity, and phase validation          | APPROVED |

**Approved.** Phase acceptance on 24 million ticks spanning 327 simulated days:
verdict **clean** across all four attack feature kinds at a 30-second detection
floor of **0.217pp** — finer than the 0.2513pp margin the promotional payout
implies — with realism at **15/15** and the mirror test showing zero divergences
on that exact configuration.

**The core project hypothesis is settled.** A market can be simultaneously
realistic and provably unexploitable, with executed evidence for both halves on
the same data.

---

## Cycle 2 — Make it a living multi-asset system

| Phase | Title                                                                   | State       |
| ----- | ----------------------------------------------------------------------- | ----------- |
| PH-4  | Asset personality system and multi-asset instantiation                  | **ACTIVE**  |
| PH-5  | Continuous runtime, sealed state persistence and restart continuity     | Not started |
| PH-6  | Trading boundary: contracts, settlement and verified economic blindness | Not started |

PH-4 discharges INV-007, the one invariant `docs/architecture/INVARIANTS.md`
still records as pending, and it is the phase where the tension between a
differentiated product and a provably unpredictable one has to be resolved with
evidence rather than assertion: every asset is attacked on its own.

### PH-4 — Asset Personality System and Multi-Asset Instantiation

One validated market process becomes a catalogue of assets that feel genuinely
different to trade, without any of them becoming predictable. The sign cannot
leak an edge whatever the parameters — that argument is indifferent to them — so
the risk lives in the two places where parameters meet the published series: the
per-asset lattice quantum, and degenerate regions of the parameter space.

| Subphase | Title                                              | State    |
| -------- | -------------------------------------------------- | -------- |
| PH-4.1   | Personality model, parameter space and safe bounds | APPROVED |

Later subphases are provisional and recorded in the phase document: registry and
quantum calibration, then multi-asset validation and the differentiation metric.

PH-5 is where NestJS is first scaffolded, and the engine core stays framework-free
and I/O-free so the batteries can keep driving it directly. PH-6 closes with the
empirical demonstration that economic state cannot influence price generation.

## Cycle 3 — Distribute, present, and make the guarantee standing

| Phase | Title                                                             |
| ----- | ----------------------------------------------------------------- |
| PH-7  | Public market distribution and multi-user consistency             |
| PH-8  | Observer frontend and trading chart experience                    |
| PH-9  | Continuous integrity assurance and independent red-team hardening |

PH-8 is where Next.js and React are first scaffolded. PH-9 converts a one-time
proof into a standing guarantee, including a red-team round using attack families
deliberately withheld from all prior tuning.

---

## Major dependencies

```
PH-1 substrate
   ├──> PH-2 falsifier (needs the substrate and the planted-edge corpus)
   │        └──> PH-3 market process (needs a trusted falsifier)
   │                 └──> PH-4 personalities (needs one validated process)
   │                          └──> PH-5 runtime  ──> PH-6 trading
   │                                                    └──> PH-7 distribution ──> PH-8 frontend
   └────────────────────────────────────────────────────────────> PH-9 standing assurance
```

## Known uncertainties

| Uncertainty                                                                                                                                                                                                                                                                  | Where it is resolved                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Whether realism and anti-predictability are jointly achievable at 30s                                                                                                                                                                                                        | PH-3, against the PH-2 battery                                                           |
| The achievable statistical detection floor. Certifying \|edge\| < 0.05pp at 3σ needs on the order of 10⁷ _independent_ samples per horizon per asset — roughly 285 simulated years at the 15m horizon — and overlapping windows invalidate naive i.i.d. confidence intervals | PH-2 publishes the honest floor and the variance estimator; PH-3 and PH-9 live within it |
| Whether personalities can be made genuinely distinct without any of them leaking an edge                                                                                                                                                                                     | PH-4, where every asset must independently pass the battery                              |
| Restart-seam detectability                                                                                                                                                                                                                                                   | PH-5 targeted seam tests                                                                 |
| Quote granularity per asset family: the published quantum must be fine enough relative to the _lowest percentile_ of 30-second volatility, not the average                                                                                                                   | PH-1.3 sets the representation; PH-4 fixes per-asset values with simulation evidence     |

## Protected Human decisions on the horizon

Recorded so they are not discovered late. Neither blocks current work.

1. **At-the-money settlement policy** — whether a contract expiring exactly at the
   entry price is refunded or lost. A settlement rule with material business
   consequence (`GOVERNANCE.md` §5). Needed by PH-6. Recommendation will be
   _void and refund_, which is both the industry norm and the only policy that
   keeps the contract exactly fair.
2. **Fairness-proof mechanism** — whether the product commits to publishing
   verifiable settlement proofs, and in what form. Relevant to PH-6/PH-9. The
   engineering recommendation is Merkle roots of the tick journal with inclusion
   proofs on demand, **never** disclosure of generator keys: revealing a key
   hands an observer a latent-state snapshot with hours of forward validity.
