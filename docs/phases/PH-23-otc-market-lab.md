# PH-23 — The OTC Market Lab

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-23
Status: ACTIVE
Cycle: 8 (phase 2 of 3)
Created: 2026-09-03
Branch: `feature/ph-23-otc-market-lab`
Specification: the Human Owner's _OTC Market Lab — Updated Product & UX
Specification_, 2026-09-03, 81 sections
Authority: [ADR-0015](../decisions/ADR-0015-lab-authority-and-isolation.md)

---

## 1. What this phase is, and what it is not

The specification calls the Lab "the validation center of the OTC Engine", and
its own §81 says the objective is an engine "whose behavior can be
systematically inspected, stress-tested, reproduced, statistically analyzed, and
validated before it is considered production-ready".

**Most of that already exists, headless.** `packages/lab` holds fifteen realism
metrics with bands, an adversarial battery of roughly eight hundred hypotheses
with Benjamini–Hochberg correction and held-out confirmation, horizon coverage
across every expiration the product offers, and a documented minimum detectable
effect. `tools/sim` runs it over twenty-four million ticks. What the
specification asks for in §52–§68 is not a laboratory that has to be built; it
is a laboratory that has never had a window.

So the phase is mostly **surfacing**, and the genuinely new work is small and
sharp:

| Specification                                                            | State                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------ |
| §52–§59 statistics, streaks, candle structure, autocorrelation, regimes  | `realism.ts` — 15 metrics with bands                   |
| §60–§66 predictability, baseline strategies, edge detection, expirations | the attack battery, ~800 hypotheses, with a stated MDE |
| §67 large simulations                                                    | `tools/sim`, 24M-tick runs                             |
| §68 market quality dashboard                                             | the realism verdict plus the battery verdict           |
| §74–§77 replay, seed, snapshot, engine comparison                        | determinism, snapshots, `mirror.ts`, drift evidence    |
| §6–§10 market view, overlays, internal state                             | **new**                                                |
| §11–§18, §48 intervention and scenarios                                  | **new**                                                |
| §19–§47 candle close control                                             | **new**                                                |
| §38–§45 test positions and settlement                                    | mostly a _verification_ — see §3                       |
| §72–§78 timeline, intervention log, replay UI                            | **new**                                                |

The specification's own strategy list in §61 — `Always CALL`, `3 Green → PUT` —
is a subset of what the battery already tests, with one difference that matters:
the battery states the resolution at which it found nothing. "Clean" and "clean
at an MDE of 0.22pp" are different claims, and only the second is worth acting
on.

## 2. The central design decision

**Candle Close Control is built by selection, not by steering** — ADR-0015, and
it is what makes the whole Lab possible without touching the guarantee it exists
to validate.

The engine can be forked from a snapshot and run deterministically (INV-008). So
the Lab does not push price toward a target: it runs many natural continuations
and keeps one that **already** closes on the requested price. Every path shown
is an unmodified engine path with an untouched sign coin.

Measured against the catalogue's own constants, for a one-minute candle:

| distance from the open | search | verdict               |
| ---------------------- | ------ | --------------------- |
| exact centre           | 0.11 s | Easy                  |
| ±1 sigma               | 0.17 s | Easy                  |
| ±2 sigma               | 0.78 s | Easy                  |
| ±3 sigma               | 9.5 s  | Normal                |
| ±4 sigma               | 5 min  | Critical              |
| ±5 sigma               | 8 h    | Outside natural range |

What this buys, by construction rather than by effort: §22's prohibition on
straight-line interpolation, §25's natural microstructure, §31's OHLC validity,
§32's free wicks, §29's overshoots, §28's absence of a fixed last-seconds
pattern, and §70's terminal-convergence diagnostics finding nothing — because
there is no convergence mechanism whose signature could be found.

And §36's reachability, which the specification asks for as an estimate, is the
sampler's own acceptance rate: a measured probability rather than a heuristic.

## 3. What the specification will have to change

**§10's directional probabilities cannot exist.** The specification asks the Lab
to display "UP 51.8% / DOWN 48.2%" with an influence breakdown. ADR-0003 makes
the sign an independent fair coin at every tick, and the magnitude engine is
structurally unable to observe one — so the value is exactly 50/50, always, and
no influence can move it. What is real and worth watching is the latent
_magnitude and rhythm_ state: regime and its age, the cascade, arrival rate,
keystream cursors. §10 becomes that, and a panel that says plainly why direction
is 50/50 is the best demonstration of the product the Lab can offer.

**§39 is a verification, not a feature.** "Candle close = expiration settlement =
one canonical price" is already INV-003 and already true. The Lab's job is to
make it _checkable_, and if it ever fails that is a finding about the engine.

**§41's settlement presets are the sharpest thing in the specification**, and
they are fine: `WIN by Minimum Distance` asks for a close one tick above entry,
which is a target like any other and reaches it by selection. What it must never
become is a control that exists on a market carrying real positions.

## 4. What this phase may not do

**It may not put a Lab mechanism in the production composition.** ADR-0015 §3:
the boundary is composition, not configuration. A flag is a thing that can be
wrong; a missing module is not. An architecture test asserts it.

**It may not expose private generator state outside the Lab.** Keystream cursors
are exactly what INV-010 forbids publishing, and the Lab shows them.

**It may not let a non-natural stress path contaminate a measurement.** §37's
synthetic terminal tick is permitted only where it cannot reach a published
record, is labelled `NON-NATURAL TEST` everywhere it appears, and is excluded
from every realism and quality figure.

**It may not ship the battery to a browser.** `@otc/web` may never depend on
`@otc/lab` or `@otc/fixtures`; the analysis runs on the server and the browser
receives results (ADR-0015 §1).

## 5. Phase invariants

INV-001 (the Lab observes and selects; it never steers generation), INV-002 (a
Lab market is one market — every observer of it sees the same prices), INV-003
(one canonical price resolves chart, close and settlement), INV-010 (private
state is exposed in the Lab and nowhere else).

## 6. Subphases

| Subphase | Title                                                          | State    |
| -------- | -------------------------------------------------------------- | -------- |
| PH-23.1  | Selection: an exact close, by search, on unmodified paths      | APPROVED |
| PH-23.2  | The Lab surface: isolation, state, and what may never leave it | APPROVED |
| PH-23.3  | The analysis already here, given a window                      | ACTIVE   |
| PH-23.4  | Interventions, scenarios and the session record                | PLANNED  |

PH-23.1 is first because it is the only part whose feasibility is not obvious,
and because every later subphase is a view onto it. If the search turns out to
cost minutes rather than seconds on a real engine, the design changes and
everything after it changes with it — so it is measured before anything is built
on top.
