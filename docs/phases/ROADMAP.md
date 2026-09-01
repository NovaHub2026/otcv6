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
| —     | **Cycle Audit 1** — three-phase audit                         | **APPROVED** — [record](../audits/CYCLE-AUDIT-001.md) |

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

| Phase | Title                                                                   | State                                                 |
| ----- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| PH-4  | Asset personality system and multi-asset instantiation                  | **APPROVED**                                          |
| PH-5  | Continuous runtime, sealed state persistence and restart continuity     | **APPROVED**                                          |
| PH-6  | Trading boundary: contracts, settlement and verified economic blindness | **APPROVED**                                          |
| —     | **Cycle Audit 2** — three-phase audit                                   | **APPROVED** — [record](../audits/CYCLE-AUDIT-002.md) |

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

| Subphase | Title                                                 | State    |
| -------- | ----------------------------------------------------- | -------- |
| PH-4.1   | Personality model, parameter space and safe bounds    | APPROVED |
| PH-4.2   | Asset registry, quantum calibration and registration  | APPROVED |
| PH-4.3   | Multi-asset validation and the differentiation metric | APPROVED |

Later subphases are provisional and recorded in the phase document: registry and
quantum calibration, then multi-asset validation and the differentiation metric.

### PH-5 — Continuous Runtime, Sealed State Persistence and Restart Continuity

The market stops being something only a test can drive. A hosted market advances
because time passed, not because it was polled — which is where INV-002 and
INV-008 are won or lost — and it survives a real process restart without
resetting or redrawing a keystream position it has already spent.

| Subphase | Title                                                    | State    |
| -------- | -------------------------------------------------------- | -------- |
| PH-5.1   | Runtime core: hosted markets, scheduling and supervision | APPROVED |
| PH-5.2   | Sealed state persistence and the recovery policy         | APPROVED |
| PH-5.3   | The NestJS service and a real process-boundary restart   | APPROVED |

Later subphases are provisional: sealed persistence and the recovery policy, then
the NestJS service and a real process-boundary restart.

### PH-9 — Continuous Integrity Assurance and Independent Red-Team Hardening

Every family in the battery was available while PH-3 tuned the engine, so a clean
verdict from them is no longer independent evidence — they are the families the
engine was shaped to survive. PH-9 attacks it with families withheld from all
prior tuning.

| Subphase | Title                                  | State    |
| -------- | -------------------------------------- | -------- |
| PH-9.1   | The withheld red-team families         | APPROVED |
| PH-9.2   | The guardrail meta-audit               | APPROVED |
| PH-9.3   | Assurance a counterparty can recompute | APPROVED |

Later subphases are provisional: the guardrail meta-audit, then re-derivable
assurance and phase integration.

### PH-8 — Observer Frontend and Trading Chart Experience

The first layer that _renders_ the market rather than verifying it. Rendering is
lossy by necessity, and every natural way to discard information invents
something: interpolation invents prices, sampling hides spikes, a flat bar
asserts a trade that did not happen.

| Subphase | Title                                          | State    |
| -------- | ---------------------------------------------- | -------- |
| PH-8.1   | The rendering contract                         | APPROVED |
| PH-8.2   | The streaming client and the frontend scaffold | APPROVED |
| PH-8.3   | The join, and timeframe switching              | APPROVED |

Later subphases are provisional: Next.js scaffolding and the streaming client,
then the chart and phase integration.

### PH-7 — Public Market Distribution and Multi-User Consistency

INV-002 has been true so far for an uninteresting reason: one observer, one
process, one array. This is the first phase where it can fail — in the delivery
path, where breaking it looks like performance work.

| Subphase | Title                                                        | State    |
| -------- | ------------------------------------------------------------ | -------- |
| PH-7.1   | The tick feed: ordering, resumption, backpressure            | APPROVED |
| PH-7.2   | Multi-observer consistency and blindness across the boundary | APPROVED |
| PH-7.3   | The transport, and the consistency contract written down     | APPROVED |

Later subphases are provisional: multi-observer consistency and the blindness
demonstration across the boundary, then service integration.

### PH-6 — Trading Boundary: Contracts, Settlement and Verified Economic Blindness

People can trade the market, and the market is shown not to know it. INV-001 was
the only invariant still established structurally rather than empirically.

| Subphase | Title                                                | State    |
| -------- | ---------------------------------------------------- | -------- |
| PH-6.1   | Contract model and deterministic settlement          | APPROVED |
| PH-6.2   | The trading boundary and verified economic blindness | APPROVED |

PH-5 is where NestJS is first scaffolded, and the engine core stays framework-free
and I/O-free so the batteries can keep driving it directly. PH-6 closes with the
empirical demonstration that economic state cannot influence price generation.

## Cycle 3 — Distribute, present, and make the guarantee standing

| Phase | Title                                                             |
| ----- | ----------------------------------------------------------------- |
| PH-7  | Public market distribution and multi-user consistency             | **APPROVED**                                          |
| PH-8  | Observer frontend and trading chart experience                    | **APPROVED**                                          |
| PH-9  | Continuous integrity assurance and independent red-team hardening | **APPROVED**                                          |
| —     | **Cycle Audit 3** — three-phase audit                             | **APPROVED** — [record](../audits/CYCLE-AUDIT-003.md) |

PH-8 is where Next.js and React are first scaffolded. PH-9 converts a one-time
proof into a standing guarantee, including a red-team round using attack families
deliberately withheld from all prior tuning.

## Cycle 4 — Close the gaps the first three cycles named

Cycles 1–3 each opened with a question. Cycle 4 opens with a **list**: the
limitations the previous cycles recorded rather than resolved. Every phase here
closes an entry that a prior phase or audit wrote down and deferred, so the
cycle's success criterion is unusually concrete — `docs/BACKLOG.md` should end it
holding nothing but the one item that needs the Human Owner.

| Phase | Title                                                         | State                                                 |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------- |
| PH-10 | Per-asset market rhythm                                       | **APPROVED**                                          |
| PH-11 | Detection power across every horizon the product sells        | **APPROVED**                                          |
| PH-12 | Verifiable publication and the journal in the running service | **APPROVED**                                          |
| —     | **Cycle Audit 4** — automatic (ADR-0008)                      | **APPROVED** — [record](../audits/CYCLE-AUDIT-004.md) |

| Phase | Closes                                                                     |
| ----- | -------------------------------------------------------------------------- |
| PH-10 | B-004; the "assets differ mostly in pace and scale" limitation             |
| PH-11 | B-002, B-003; the per-asset floor limitation; PH-9's sensitivity limits    |
| PH-12 | B-009; the journal-not-emitted limitation; the catch-up-bound policy owner |

**Cycle Audit 4 runs automatically** — the three-phase Human gate was removed on
2026-08-31 ([ADR-0008](../decisions/ADR-0008-full-delegation.md)). That makes the
audit's method the only external check left, so **it must be conducted by
independent agents** (B-008): Cycle Audit 2 used ten and found 31 material
findings; Cycle Audit 3 was conducted by the authoring agent and found one. The
method is the variable being controlled, and there is now nothing else
controlling it.

### PH-10 — Per-Asset Market Rhythm

The catalogue's five assets were separable by amplitude and pace, which is true
by construction and means nothing. On scale-free _shape_ features they classified
at 30.0% against a 20% null.

**Result: 40.5%**, permutation p = 0.005, best of 199 label shuffles 28.0% — with
every asset's tail weight and realised amplitude pinned to its PH-4 value, so the
gain came from time structure and nothing else. B-004 closed.

| Subphase | Title                                             | State    |
| -------- | ------------------------------------------------- | -------- |
| PH-10.1  | The cascade's time structure becomes personality  | APPROVED |
| PH-10.2  | A catalogue authored to differ in rhythm          | APPROVED |
| PH-10.3  | Revalidation: every asset, every guarantee, again | APPROVED |

### PH-11 — Detection Power Across Every Horizon the Product Sells

The product sells 30s to 15m. Only 30s has ever been policed to the threshold the
99% payout implies. PH-11 either closes the other horizons or states, per horizon
and per asset, exactly what remains unpoliced.

| Subphase | Title                                                    | State    |
| -------- | -------------------------------------------------------- | -------- |
| PH-11.1  | Is the independent error bar honest?                     | APPROVED |
| PH-11.2  | The long-horizon evidence run                            | APPROVED |
| PH-11.3  | Coverage over `tools/`, and evidence that records itself | APPROVED |

### PH-12 — Verifiable Publication and the Journal in the Running Service

PH-9 produced a verdict a counterparty can recompute, and said plainly that its
fingerprint proves agreement rather than authenticity. PH-12 closes that, and
connects the journal to the service that actually runs.

| Subphase | Title                                                  | State    |
| -------- | ------------------------------------------------------ | -------- |
| PH-12.1  | A commitment over the journal, with inclusion proofs   | APPROVED |
| PH-12.2  | The publishing key, and its separation from generation | APPROVED |
| PH-12.3  | The service emits the journal; the venue gets policy   | APPROVED |

---

## Cycle 5 — Make it a venue someone can operate

Cycles 1–3 proved the engine and made its guarantee standing. Cycle 4 closed
every item the first four cycles had written down and deferred; `docs/BACKLOG.md`
ended it empty for the first time.

So Cycle 5 is derived from what the _product_ needs rather than from what was
left over, and the ordering is deliberate: **can you afford to run it, can you
scale it, can you operate it.**

| Phase | Title                                                        | State                           |
| ----- | ------------------------------------------------------------ | ------------------------------- |
| PH-13 | Operator risk: variance, correlated flow and capacity        | **APPROVED WITH OPEN FINDINGS** |
| PH-14 | Multi-node consistency and horizontal scale-out              | **APPROVED WITH OPEN FINDINGS** |
| PH-15 | Operations: the standing guarantee, running continuously     | **APPROVED WITH OPEN FINDINGS** |
| —     | **Cycle Audit 5** — automatic, independent agents (ADR-0011) | not started                     |

### PH-13 — Operator Risk: Variance, Correlated Flow and Capacity

The project has proved that the operator's expected edge is exactly the payout
margin and nothing else. **It has never asked what the distribution around that
expectation looks like.**

`packages/lab/src/economics.ts` computes expectation per trade — breakeven win
rate, expected value, profitability ratio — and stops there. A venue is not ruined
by a bad expectation; it is ruined by variance on correlated flow. Every trader
taking the same side of the same asset at the same expiry is one bet, not many,
and the engine's economic blindness guarantees nothing about that.

This is the first question a real operator asks and the project cannot currently
answer it: how much capital does running this require, and what concentration of
flow makes ruin likely?

It is also the one phase where the anti-predictability theorem gives no comfort.
`P(up) = P(down)` exactly means the _expectation_ is safe; it says nothing about
the tail.

| Subphase | Title                                            | State    |
| -------- | ------------------------------------------------ | -------- |
| PH-13.1  | The exposure model                               | APPROVED |
| PH-13.2  | Risk of ruin, capacity, and the limits           | APPROVED |
| PH-13.3  | Enforcement in the venue, with INV-001 preserved | APPROVED |

### PH-14 — Multi-Node Consistency and Horizontal Scale-Out

The venue is single-node. PH-7 established INV-002 across concurrent observers, a
real socket and two nodes under clock skew — but those nodes each generated their
own market from the same key. Nothing has been designed or tested for a cluster
sharing state under load, failover, or partition.

The invariant at risk is the product's most visible promise: same asset, same
moment, same price, for everyone.

| Subphase | Title                                                  | State    |
| -------- | ------------------------------------------------------ | -------- |
| PH-14.1  | The leader lease, and why generation is single-writer  | APPROVED |
| PH-14.2  | Followers serve the record; INV-002 across nodes       | APPROVED |
| PH-14.3  | Failover: no fork, no duplicate stream, a visible seam | APPROVED |

### PH-15 — Operations: The Standing Guarantee, Running Continuously

PH-9 made the verdict re-derivable and PH-12 made the record provable. Both are
things an operator _can_ do; neither is something the venue _does_.

Three explicit exclusions are carried from PH-12 and land here: where commitment
roots are published, key rotation procedure, and journal retention. Alongside
them, the assurance battery becomes a scheduled run against accumulated history
rather than a thing invoked by hand — which is what "standing guarantee" has
meant since PH-9 and has never quite been.

PH-14 adds a fourth: its `CoordinatedStore` is proved against an in-memory
reference, so the multi-node design has never met a store two processes can
share.

| Subphase | Title                                                      | State    |
| -------- | ---------------------------------------------------------- | -------- |
| PH-15.1  | A durable coordinated store, and the contract it must pass | APPROVED |
| PH-15.2  | Publication, rotation and retention                        | APPROVED |
| PH-15.3  | The standing guarantee: assurance on a schedule            | APPROVED |

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
