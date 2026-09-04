# ROADMAP

Type: SUPPORTING DOCUMENTATION (living)
Status: Dynamic — phases may be split, merged, reordered or replaced as
implementation reveals information (`GOVERNANCE.md` §13). Approved phases are
never rewritten as though they had not happened.
Last revised: 2026-09-04 (Cycle 8 closed — PH-22, PH-23, PH-24 and Cycle Audit 8; Cycle 9 opening)

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
first Cycle Audit — at the time the project's first Human gate; the gate was
removed on 2026-08-31 by ADR-0008 and audits now run automatically — lands
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

| Phase | Title                                                             | State                                                 |
| ----- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| PH-7  | Public market distribution and multi-user consistency             | **APPROVED**                                          |
| PH-8  | Observer frontend and trading chart experience                    | **APPROVED**                                          |
| PH-9  | Continuous integrity assurance and independent red-team hardening | **APPROVED**                                          |
| —     | **Cycle Audit 3** — three-phase audit                             | **APPROVED** — [record](../audits/CYCLE-AUDIT-003.md) |

PH-8 is where Next.js and React are first scaffolded. PH-9 converts a one-time
proof into a standing guarantee, including a red-team round using attack families
deliberately withheld from all prior tuning.

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

| Phase | Title                                                    | State                                                 |
| ----- | -------------------------------------------------------- | ----------------------------------------------------- |
| PH-13 | Operator risk: variance, correlated flow and capacity    | **APPROVED WITH OPEN FINDINGS**                       |
| PH-14 | Multi-node consistency and horizontal scale-out          | **APPROVED WITH OPEN FINDINGS**                       |
| PH-15 | Operations: the standing guarantee, running continuously | **APPROVED WITH OPEN FINDINGS**                       |
| —     | **Cycle Audit 5** — seven independent agents (ADR-0011)  | **APPROVED** — [record](../audits/CYCLE-AUDIT-005.md) |

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

---

## Cycle 6 — Make the guarantee true, then make the catalogue

Cycle Audit 5 found roughly seventy material findings against a tree whose gate
was green, and three of them falsify the stated objective of a phase. So Cycle 6
does not start from new product surface: it starts from the fact that the engine
currently _claims_ a standing guarantee it does not compute, and _claims_ a
follower cannot generate when it can.

| Phase | Title                                                | State                                                 |
| ----- | ---------------------------------------------------- | ----------------------------------------------------- |
| PH-16 | Close what the audit falsified                       | **APPROVED**                                          |
| PH-17 | Assets become data: families, sampling, history      | **APPROVED**                                          |
| PH-18 | The admin panel: Preview                             | **APPROVED**                                          |
| —     | **Cycle Audit 6** — one worktree per auditor (B-020) | **APPROVED** — [record](../audits/CYCLE-AUDIT-006.md) |

### PH-16 — Close What the Audit Falsified

The least visible phase of the three, and the one that decides whether the other
two mean anything. A hundred assets built on a broken INV-002 are a hundred
assets with the same broken promise.

| Subphase | Title                                                     | State    |
| -------- | --------------------------------------------------------- | -------- |
| PH-16.1  | The standing verdict runs the battery it names            | APPROVED |
| PH-16.2  | A follower cannot generate, and settlement sees the seam  | APPROVED |
| PH-16.3  | Operator risk, retention, and the guardrails' blind spots | APPROVED |

### PH-17 — Assets Become Data

The catalogue is a compiled constant, so creating an asset means editing
TypeScript. The panel cannot exist until it is data, and asset creation is not an
insert: it is a calibration job — measured at 0.6 s to 20.5 s per asset depending
on the family ([CYCLE-7-CATALOGUE-SCALE.md](../evidence/CYCLE-7-CATALOGUE-SCALE.md))
— safety gate, personality solve, lattice calibration, tie-rate measurement,
INV-007 differentiation.

| Subphase | Title                                                   | State    |
| -------- | ------------------------------------------------------- | -------- |
| PH-17.1  | Runtime asset definitions and the creation pipeline     | APPROVED |
| PH-17.2  | Families, sampled personalities, and dispersion budgets | APPROVED |
| PH-17.3  | Backdated history and continuous persistence at scale   | APPROVED |

Six to eight families, and per-asset personalities **sampled** within a family
rather than copied from it — otherwise a hundred assets are twenty clones of
five, and INV-007 is false as written. Dispersion budgets come from
[`CYCLE-6-DRIFT.md`](../evidence/CYCLE-6-DRIFT.md), which also records why a
price ceiling was refused.

### PH-18 — The Admin Panel: Preview

One submenu. Select among the configured assets, watch them live, change the
displayed timeframe in real time.

| Subphase | Title                                                   | State    |
| -------- | ------------------------------------------------------- | -------- |
| PH-18.1  | The engine's administrative surface                     | APPROVED |
| PH-18.2  | TradingView against PH-8's rendering contract           | APPROVED |
| PH-18.3  | Live preview: selection, streaming, timeframe switching | APPROVED |

INV-004 already guarantees that changing the displayed timeframe never changes
the market, and PH-8 built the rendering contract that invents no price and
hides no extreme. That half is wiring, not design.

**Excluded, deliberately:** the asset-proposal assistant. It is help on top of a
pipeline that has to exist first; once PH-17 lands it is days of work, not a
phase. Deployment remains the Human Owner's (`GOVERNANCE.md` §5.1); the
TradingView question was decided on 2026-09-02 — the free Lightweight Charts
library, never the paid Charting Library, which a guardrail now refuses
([ADR-0014](../decisions/ADR-0014-chart-library-and-repository-licence.md)).

## Cycle 7 — Close what Cycle Audit 6 falsified, then build on it

Six independent auditors returned **46 findings** against a tree whose gate was
green, and the headline one is about the gate itself: `vitest.config.ts` was in
no TypeScript program, and two options that do not exist had been silently
ignored for a cycle. The statistical suite had never run serially despite a
comment saying it did.

So Cycle 7 starts where Cycle 6 did — with the instrument — because every other
finding is verified through it.

| Phase | Title                                               | State                                                 |
| ----- | --------------------------------------------------- | ----------------------------------------------------- |
| PH-19 | Close what Cycle Audit 6 falsified                  | **APPROVED**                                          |
| PH-20 | The operator panel: trusted, and able to administer | **APPROVED**                                          |
| PH-21 | The catalogue at scale                              | **APPROVED**                                          |
| —     | **Cycle Audit 7**                                   | **APPROVED** — [record](../audits/CYCLE-AUDIT-007.md) |

### PH-19 — Close What Cycle Audit 6 Falsified

Ordered by what the other findings are verified _through_: the instrument first,
then the guarantees it is supposed to police, then the measurements, then the
catalogue, then the surface.

| Subphase | Title                                                         | State    |
| -------- | ------------------------------------------------------------- | -------- |
| PH-19.1  | The instrument: the gate, the guards, and what they read      | APPROVED |
| PH-19.2  | The guarantees: the follower, the verdict, the limiter        | APPROVED |
| PH-19.3  | The measurements: turnovers, recorded rates, evidence runners | APPROVED |
| PH-19.4  | The catalogue: feasibility, differentiation, acceptance       | APPROVED |
| PH-19.5  | The surface: the join, the stream, and what an endpoint costs | APPROVED |

**PH-20 and PH-21 were deliberately left undecided** until PH-19 landed: Cycle 6
named all three phases in advance and the third of them (the panel) was built on
an engine whose measurements the audit then falsified. They are chosen now, on
what PH-19 measured.

### PH-20 — The Operator Panel: Trusted, And Able To Administer

Five user-visible defects reached the Human Owner against a green gate, and Cycle
Audit 6 named the mechanism: not one test referenced `apps/web/src`. The panel
cannot be extended before it can be tested, so the instrument comes first here
too.

| Subphase | Title                                                 | State    |
| -------- | ----------------------------------------------------- | -------- |
| PH-20.1  | The panel under a real browser, against a real engine | APPROVED |
| PH-20.2  | Creating an asset from the panel                      | APPROVED |
| PH-20.3  | Editing and retiring, and what may never be edited    | APPROVED |

### PH-21 — The Catalogue At Scale

Five assets is not a catalogue. PH-19.4 measured a registration failing on 36% of
hundred-asset builds before the tail-weight clamp; what a hundred assets cost in
storage, in scheduling and in differentiation headroom is still unmeasured.

| Subphase | Title                                             | State    |
| -------- | ------------------------------------------------- | -------- |
| PH-21.1  | A hundred assets, and what registering them costs | APPROVED |
| PH-21.2  | The venue and the store under a full catalogue    | APPROVED |
| PH-21.3  | A panel that can hold a hundred assets            | APPROVED |

## Cycle 8 — Distribution under thousands of observers

**Chosen by the Human Owner on 2026-09-02, ahead of everything else**, on a
concrete plan: several charts per client and thousands of clients at once. The
question they asked was whether that argues for WebSocket. Measuring the running
engine said the transport is not the lever — a WebSocket frame saves 16 bytes on
a 76-byte event, which at the venue's own rate is 24 bytes per second per
viewer — and looking at the delivery path found something an order of magnitude
larger.

| Phase | Title                                               | State                                                 |
| ----- | --------------------------------------------------- | ----------------------------------------------------- |
| PH-22 | Distribution under thousands of observers           | **APPROVED**                                          |
| PH-23 | The OTC Market Lab                                  | **APPROVED**                                          |
| PH-24 | The Lab's controls: applying a selection            | **APPROVED**                                          |
| —     | **Cycle Audit 8** — eight worktrees, eight auditors | **APPROVED** — [record](../audits/CYCLE-AUDIT-008.md) |

### PH-24 — The Lab's controls: applying a selection

Opened 2026-09-03 from
[LAB-SPECIFICATION-AUDIT-001](../audits/LAB-SPECIFICATION-AUDIT-001.md): a Lab
with a correct mechanism and no controls. Nothing is ever applied to a hosted
market (LA-03). The phase adds a sign source that plays a chosen vector in
lockstep with the keystream, composed only in the Lab, and builds every control
on it — the boundary first, guarded before anything stands on it.

| Subphase | Title                                                                                                                                                                  | State    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| PH-24.1  | The selectable sign source and its hook                                                                                                                                | APPROVED |
| PH-24.2  | Candle Close Control on a real candle, apply, release, session record                                                                                                  | APPROVED |
| PH-24.3  | Presets and simulated positions, settled against the Lab's record                                                                                                      | APPROVED |
| PH-24.4  | Scenarios, the ones sign selection cannot express, and the screen                                                                                                      | APPROVED |
| PH-24.5  | The diagnostics the audit found missing                                                                                                                                | APPROVED |
| PH-24.6  | Rediseño UX del panel y del Lab — en español, con tooltips                                                                                                             | APPROVED |
| PH-24.7  | Los controles que faltan en pantalla: shock, expiración, Target Price                                                                                                  | APPROVED |
| PH-24.8  | Sesión persistente y los diagnósticos que faltan                                                                                                                       | APPROVED |
| PH-24.9  | Varios activos a la vez: tablero, insignias, liberar todo                                                                                                              | APPROVED |
| PH-24.10 | Empujar y cerrar: pushes naturales de N ticks por botón, la pantalla alrededor de los dos controles                                                                    | APPROVED |
| PH-24.11 | El empuje siempre responde: la capa de red no lanza, el empuje libera lo armado, Objetivo de precio a Escenarios                                                       | APPROVED |
| PH-24.12 | Un solo motor: el Lab es el motor en modo simulación; el panel lo declara; el gráfico dentro del Lab                                                                   | APPROVED |
| PH-24.13 | Empujar al instante: el tick pendiente se retira, los N ticks llegan en ráfaga con las llegadas más rápidas del motor                                                  | APPROVED |
| PH-24.14 | El panel se recupera solo: el gráfico reintenta su primera carga; el aviso del Lab dice lo que pasó                                                                    | APPROVED |
| PH-24.15 | El ritmo del empuje: normal, medio, rápido — el paso de la ráfaga como parámetro del empuje                                                                            | APPROVED |
| PH-24.16 | Empujar progresivo y la dirección sostenida: el primer tick anclado en ahora; sube/baja como sesgo de rachas                                                           | APPROVED |
| PH-24.17 | Granularidad del tick: más ticks por vela con pasos menores a igual dispersión; medida en el Lab; gate completo                                                        | APPROVED |
| PH-24.18 | Las distancias del Lab en unidades de vela: una unidad por mercado; empujes, cierres, escenarios en ella; sesgo y ritmos en tiempo de mercado                          | APPROVED |
| PH-24.19 | El panel de control del Lab: gráfico a 3/4, cuatro tarjetas de control a 1/4, solo el activo elegido; el instrumento pasa a /lab/avanzado                              | APPROVED |
| PH-24.20 | El panel, segunda forma: dos tarjetas y solo controles — ritmo, filas verde y roja con sube / baja; vela actual / próxima, precio con = ▲ ▼, fijar / ×                 | APPROVED |
| PH-24.21 | Subiendo / bajando en la tarjeta; los empujes contrarios se restan; la tasa marcada con un clic en el gráfico; la condición de cierre = ▲ ▼ con selección condicionada | APPROVED |
| PH-24.22 | El cronómetro de la vela: cuánto falta para que cierre la vela en curso, en el marco del gráfico                                                                       | APPROVED |
| PH-24.23 | El recorrido: hasta cinco puntos que el precio va a buscar en orden, con la textura de sube / baja al ritmo elegido; marcados en el gráfico; Buscar y ×                | REVERTED |
| PH-24.24 | El recorrido retirado y el sesgo con límite: dos minutos como máximo, en el reloj del mercado, visible en el botón y registrado al expirar                             | APPROVED |

### PH-23 — The OTC Market Lab

Specified by the Human Owner on 2026-09-03 in 81 sections, and authorised in
[ADR-0015](../decisions/ADR-0015-lab-authority-and-isolation.md). It is the
testing, validation and diagnostics environment for the engine: observe,
intervene, force a test condition, measure, reproduce, compare, validate.

**Most of its analytical half already exists, headless.** Fifteen realism
metrics with bands, an adversarial battery of ~800 hypotheses with a stated
minimum detectable effect, horizon coverage across every expiration, and a
24M-tick runner. What §52–§68 of the specification asks for is a laboratory that
has never had a window, not one that has to be built.

**The genuinely new part is Candle Close Control, and it is built by selection
rather than steering.** The engine forks from a snapshot deterministically, so
the Lab runs many natural continuations and keeps one that already closes on the
requested price — every path an unmodified engine path with an untouched sign
coin. Measured against the catalogue's constants: 0.11 s for an exact centre
close on a one-minute candle, under ten seconds out to three sigma, and out of
reach past five. That last is not a limitation to apologise for; §37 of the
specification already required the boundary to exist, and this makes it a
measured probability rather than a heuristic.

| Subphase | Title                                                          | State    |
| -------- | -------------------------------------------------------------- | -------- |
| PH-23.1  | Selection: an exact close, by search, on unmodified paths      | APPROVED |
| PH-23.2  | The Lab surface: isolation, state, and what may never leave it | APPROVED |
| PH-23.3  | The analysis already here, given a window                      | APPROVED |
| PH-23.4  | Interventions, scenarios and the session record                | APPROVED |
| PH-23.5  | The Lab, in the panel                                          | APPROVED |
| PH-23.6  | What the specification audit found                             | APPROVED |

### PH-22 — Distribution Under Thousands Of Observers

| Subphase | Title                                                    | State    |
| -------- | -------------------------------------------------------- | -------- |
| PH-22.1  | An instrument that can hold thousands of connections     | APPROVED |
| PH-22.2  | Many assets, one connection, the same resume contract    | APPROVED |
| PH-22.3  | What happens when ten thousand clients come back at once | APPROVED |

Nobody has ever opened two simultaneous clients against this engine. Everything
below is therefore a hypothesis with a number attached, and the phase exists to
replace the numbers with measurements before changing anything.

What is already known, and where it came from:

- **Every subscriber re-serialises the same tick** (Issue #15). `feed.ts` walks
  the subscriptions and the controller builds the SSE frame inside the
  callback, so one tick delivered to N clients is `JSON.stringify`d N times. At
  ten thousand clients watching eight assets each — 800 subscribers per asset
  against PH-21.2's measured 150 ticks/s — that is ~120,000 serialisations per
  second of an identical string. Transport-independent, and the largest known
  cost.
- **One connection per chart hits the browser's six-per-origin limit** on
  HTTP/1.1 (Issue #16). Multiplexing assets onto one stream fixes it and divides
  open connections by the number of charts; HTTP/2 at the edge removes the limit
  outright and is a deployment decision.
- **Per-connection cost is the same in every transport.** Ten thousand held
  connections are 300–600 MB of socket buffers in Node whether they carry SSE
  frames or WebSocket frames.

So the order is: measure, serialise once, multiplex, put HTTP/2 in front — and
only then ask whether the tick should be binary, which is the one thing that
genuinely needs a transport that carries bytes. A 16-byte binary tick against a
58-byte JSON one is 2.2 MB/s against 9.1 MB/s at that scale, and that is when
WebSocket earns an ADR rather than a preference.

**What the phase may not do:** trade away `Last-Event-ID`. SSE gives exact
resumption and an explicit refusal when the sequence has been evicted, and a gap
served in silence is indistinguishable from the market (INV-002). Any transport
that replaces it has to bring that property with it, tested, before it ships.

**Cycle Audit 7 is done**, closed 2026-09-03: eight independent auditors, one
worktree each, 35 findings surviving adversarial refutation, 34 closed in the
audit itself. It hands this phase two measurements it did not ask for — replay
ignored backpressure entirely (CA7-04) and the feed costs a measured 5.01 MB per
asset, 501 MB at a hundred (CA7-33) — which are the best starting point in the
repository for what follows.

Its depth was chosen by risk (§67): the out-of-band audit of 2026-09-02 had
already swept most of PH-19 and PH-20, so the auditors were told to check that
**those fixes hold** rather than re-derive them, and were pointed at what no
audit had opened — PH-21, the stream work of 2026-09-02, the engine, and the
statistical layers. That aim is what produced CA7-01: a planted directional edge
that every mirror test in the repository passed.

## Major dependencies

```
PH-1 substrate
   ├──> PH-2 falsifier (needs the substrate and the planted-edge corpus)
   │        └──> PH-3 market process (needs a trusted falsifier)
   │                 └──> PH-4 personalities (needs one validated process)
   │                          └──> PH-5 runtime  ──> PH-6 trading
   │                                                    └──> PH-7 distribution ──> PH-8 frontend
   └────────────────────────────────────────────────────────────> PH-9 standing assurance
                                                                       │
        PH-10 rhythm ──> PH-11 detection power ──> PH-12 publication ──┘──> PH-13 operator risk
                                                                             └──> PH-14 multi-node ──> PH-15 operations
                                                                                                          └──> PH-16 (audit fixes)
        PH-17 assets as data ──> PH-18 preview ──> PH-19 (audit fixes) ──> PH-20 panel ──> PH-21 catalogue at scale
                                                                                                    │
        PH-22 distribution at scale ──> PH-23 the OTC Market Lab ──> PH-24 the Lab's controls <──────┘
                │                                                            │
                └────────────> PH-25 the battery against a production venue's own record <───┘
                                     (instrument: packages/lab; subject: apps/api's published
                                      record over the PH-22 distribution path)
```

Every phase from PH-10 on depends on the whole of Cycle 1 through PH-9; the arrows
above show only the direct product dependencies.

The chain ended at PH-21 for a cycle after PH-22, PH-23 and PH-24 were approved,
which mattered more than a stale diagram usually does: PH-25's whole premise is a
dependency claim — the instrument is the Lab's, the subject is the distribution
path — and neither node was on the graph that exists to carry exactly that.

## Cycle 9 — opening

Cycle 8's audit closed with every finding resolved and one thing handed forward,
recorded here so it is not rediscovered:

| Phase | Title                                               | State   |
| ----- | --------------------------------------------------- | ------- |
| PH-25 | The battery against a production venue's own record | PLANNED |

**PH-25 — the battery against a production venue's own record.** Every
adversarial run in this repository builds its own engine, or runs against the
Lab's composition; nothing attacks the feed a real observer actually reads.
Cycle Audit 8 (a1) named the gap and refused to close it with a fix, because it
is not one: the instrument is `packages/lab`, the subject is `apps/api`'s
published record over the distribution path, and the question — _does the market
an observer can see leak anything a market built inside a test does not?_ —
covers publication, retention, reduction to columns and settlement at once. The
mirror family answers the structural half in milliseconds; this is the other
half, and it has never been run where the product lives.

## Known uncertainties

**This table is Cycle 1's, and it is kept as Cycle 1 wrote it.** Every phase in
its right-hand column is approved, so all five were answered; two were answered
somewhere else than the table says, and that is worth recording rather than
editing away.

- **Realism and anti-predictability jointly at 30s** — answered by PH-3 and
  ADR-0003: the sign is an independent fair coin and the magnitude engine cannot
  observe one, so `P(up) = P(down)` exactly under every public conditioning. The
  mirror test checks the precondition; the battery checks the consequence.
- **The detection floor** — PH-2 published it, and **PH-11** is the phase that
  actually policed the other horizons; the table predates that phase and does not
  name it. What the floor still cannot police at the product margin is open as
  Issue #10.
- **Distinct personalities without a leak** — PH-4 for the five hand-authored
  assets, and PH-17 made assets data. At a hundred assets the guarantee rests on
  a proximity check rather than a measurement, which is open as Issue #21.
- **Restart-seam detectability** — PH-5, and the seam is now also a Lab concern:
  Cycle Audit 8 found a Lab market killed mid-script republishing a sequence at
  different prices, which is the same question from the other side.
- **Quote granularity per family** — PH-1.3 set the representation and PH-4 fixed
  the five values. PH-17 made granularity a property of an archetype, PH-21 built
  a hundred assets on that, and **PH-24.17 moved every tempo underneath it**, so
  the answer is now a per-archetype calibration rather than five numbers.

| Uncertainty                                                                                                                                                                                                                                                                  | Where it is resolved                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Whether realism and anti-predictability are jointly achievable at 30s                                                                                                                                                                                                        | PH-3, against the PH-2 battery                                                           |
| The achievable statistical detection floor. Certifying \|edge\| < 0.05pp at 3σ needs on the order of 10⁷ _independent_ samples per horizon per asset — roughly 285 simulated years at the 15m horizon — and overlapping windows invalidate naive i.i.d. confidence intervals | PH-2 publishes the honest floor and the variance estimator; PH-3 and PH-9 live within it |
| Whether personalities can be made genuinely distinct without any of them leaking an edge                                                                                                                                                                                     | PH-4, where every asset must independently pass the battery                              |
| Restart-seam detectability                                                                                                                                                                                                                                                   | PH-5 targeted seam tests                                                                 |
| Quote granularity per asset family: the published quantum must be fine enough relative to the _lowest percentile_ of 30-second volatility, not the average                                                                                                                   | PH-1.3 sets the representation; PH-4 fixes per-asset values with simulation evidence     |

## Decisions once listed here as pending

Two protected decisions were recorded here in Cycle 1 so they would not be
discovered late. Both are settled and the record lives elsewhere:

1. **At-the-money settlement policy** — decided by the Human Owner before
   delegation: a contract expiring exactly at the entry price is refunded
   ([ADR-0007](../decisions/ADR-0007-at-the-money-settlement.md)).
2. **Fairness-proof mechanism** — built in PH-12: signed Merkle commitments over
   the published record with inclusion proofs on demand, never disclosure of
   generator keys ([PUBLICATION.md](../architecture/PUBLICATION.md)).

Nothing protected is pending. Since 2026-08-31 every code and product decision is
the Development Agent's (ADR-0008); only Governance amendments and commitments
that bind the Human Owner outside the repository are escalated
(`GOVERNANCE.md` §5.1).
