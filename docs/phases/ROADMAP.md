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

| Phase    | Title                                                         | State              |
| -------- | ------------------------------------------------------------- | ------------------ |
| **PH-1** | Deterministic Market Substrate                                | **ACTIVE**         |
| PH-2     | Calibrated Adversarial Predictability Laboratory              | NOT STARTED        |
| PH-3     | Core Generative Market Process Under Continuous Falsification | NOT STARTED        |
| —        | **Cycle Audit 1** — Human gate, requires `EJECUTA`            | pending after PH-3 |

### PH-1 — Deterministic Market Substrate

The sealed, cryptographically unpredictable, bit-identically replayable substrate
every later capability draws from: entropy, portable numerics, authoritative
time, the tick and price domain, tick-to-OHLC projection, and the planted-edge
fixture corpus that PH-2 calibrates against.

| Subphase | Title                                                                              | State       |
| -------- | ---------------------------------------------------------------------------------- | ----------- |
| PH-1.1   | Canonical time model and deterministic entropy architecture                        | APPROVED    |
| PH-1.2   | Portable numeric foundation and distribution samplers                              | APPROVED    |
| PH-1.3   | Market domain: integer log lattice, ticks, candle aggregation, snapshot and replay | ACTIVE      |
| PH-1.4   | Simulation runner and planted-edge fixture corpus                                  | NOT STARTED |

### PH-2 — Calibrated Adversarial Predictability Laboratory

The instrument that decides project success. A public-observer attack battery
measuring directional edge at the exact eight binary horizons, paired with a
realism battery that stops anti-predictability from being achieved by making the
market meaningless.

Its acceptance is about the _instrument_, not the market: it must detect every
planted edge at or above its declared minimum detectable effect, report no edge
on a driftless control, and publish power curves per horizon. The public-observer
data boundary defined here is reused verbatim as the public API contract in
PH-7, so the shipped surface and the attacked surface are provably identical.

### PH-3 — Core Generative Market Process Under Continuous Falsification

The real generative model — latent state, regime, volatility, emergent structure,
tick microstructure — built inside a tight generate → attack → diagnose → correct
loop against the PH-2 laboratory, until a single asset simultaneously passes the
realism battery and the anti-predictability verdict.

---

## Cycle 2 — Make it a living multi-asset system

| Phase | Title                                                                   |
| ----- | ----------------------------------------------------------------------- |
| PH-4  | Asset personality system and multi-asset instantiation                  |
| PH-5  | Continuous runtime, sealed state persistence and restart continuity     |
| PH-6  | Trading boundary: contracts, settlement and verified economic blindness |

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
