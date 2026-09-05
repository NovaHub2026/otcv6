# PH-23 — The OTC Market Lab

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-23
Status: APPROVED
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

**§39 is a verification, and it was not true as written.** "Candle close =
expiration settlement = one canonical price": one canonical price is INV-003
and holds. That the candle's close and the expiry price are the same _tick_ did
not — the chart's bucket is half-open and the settlement lookup is inclusive, so
a tick on the boundary millisecond is the next candle's open and the expiry
price, once in 471–1,163 candles on the shipped engine
(LAB-SPECIFICATION-AUDIT-001, LA-02). ADR-0017 keeps both rules, pins the
relationship in a test, and defines the Lab's exact close against the price
that pays.

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
| PH-23.3  | The analysis already here, given a window                      | APPROVED |
| PH-23.4  | Interventions, scenarios and the session record                | APPROVED |

PH-23.1 is first because it is the only part whose feasibility is not obvious,
and because every later subphase is a view onto it. If the search turns out to
cost minutes rather than seconds on a real engine, the design changes and
everything after it changes with it — so it is measured before anything is built
on top.

## 7. What the phase delivered

**Most of the Lab already existed.** The claim in §1 held: `packages/lab` is the
laboratory §52–§68 describes, and what it lacked was a window. The genuinely new
work was smaller and sharper than the specification's length suggests.

| Delivered                                             | Where                                 |
| ----------------------------------------------------- | ------------------------------------- |
| An exact close by **selection**, 0.2–2.0 ms           | `closeSelection.ts`, PH-23.1          |
| Step independence verified on the shipped engine      | `stepIndependence.test.ts`            |
| A Lab absent from production, not disabled in it      | `lab/`, `labSurface.test.ts`, PH-23.2 |
| Engine state and keystream cursors, served only there | `lab.controller.ts`                   |
| The realism and battery verdicts, with sensitivity    | PH-23.3                               |
| Interventions as criteria over natural futures        | `intervention.ts`, PH-23.4            |
| Two timelines that cannot merge                       | `session.ts`                          |

## 8. The decision the phase rests on

**Selection, not steering.** ADR-0003 makes every sign vector the engine's own
output and makes the magnitudes independent of the signs, so the Lab chooses
among futures the engine produced rather than producing one. That single
decision is why:

- INV-001 needed no exemption, and ADR-0015's authorisation went unused for the
  thing it was granted for;
- §21, §22, §25, §28, §29, §31, §32, §70 and §71 hold by construction rather
  than by care;
- §36's reachability is a measured probability;
- an intervention that asks for something the market does not do reports zero
  instead of a best effort.

The property that makes this product unexploitable is the same property that
makes its laboratory cheap. That is worth stating plainly, because it is not a
coincidence and it will be tempting to break.

## 9. What the specification will need changed

**§10 cannot exist as written.** "UP 51.8% / DOWN 48.2%" with an influence
breakdown describes a probabilistic directional engine, and this is not one. The
Lab reports exactly 0.5 / 0.5 with ADR-0003's reason and no breakdown. That is
the best demonstration of the product the Lab can offer.

**§39 is a verification, and one half of it was wrong.** One canonical price
for chart, close and settlement is INV-003. That the candle's close is the
expiry _tick_ is true except when the engine prints on the boundary
millisecond, and ADR-0017 records which rule pays.

## 10. What the phase leaves open

**~~No UI.~~ Closed by [PH-23.5](PH-23.5-the-lab-in-the-panel.md)**, 2026-09-03.
The screen is in the panel, behind a menu entry marked `SIM`. Building it found
three defects that reading could not: a `clean` verdict resting on two
hypotheses out of eight hundred, a realism verdict that flipped between forks of
the same market, and a lattice index printed under the word `price`.

**Interventions are not wired into the controller.** The mechanism and its
record exist and are guarded; the routes are not (PH-23.4 §8, criterion 5).

**§67's large runs are not jobs.** `/lab/markets/:id/quality` is bounded — at a
million ticks since PH-23.5, which is where the recorded evidence's own floor
sits — and says so. A twenty-four-million-tick battery belongs to a job
with an id and a record, like registration (PH-23.3 §6, criterion 5).

**No replay or snapshot UI** (§74–§77). The determinism it would rest on exists
and is tested; the surface is not built.

> **Re-checked against the tree, 2026-09-05 (PH-27.2).** Interventions not
> wired — **closed by** PH-24 (`POST /lab/markets/:id/push`, `/close`, `/bias`,
> `/release`; `pushRoutes.test.ts`, `closeRoutes.test.ts`, `biasRoutes.test.ts`).
> §67's large runs as jobs — **still open**, `IMPROVEMENT-REPORT-001.md` §3. No
> replay or snapshot UI — **partly**: the screen exists (`Reproducir.tsx`) and
> no `/lab` route serves a replay or a mirror, so it is wired to nothing;
> report §3.
