# PH-27 — Review And Improvement Of The Whole Project

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-27
Status: APPROVED
Approved: 2026-09-05 — from the integrated phase verification in §7
Cycle: 9 (phase 3 of 3)
Created: 2026-09-05
Branch: `feature/ph-27-review`

---

## 1. What this phase is

_"La PH-27 debe ser una fase de revisión y mejora de todo el proyecto."_

Not an audit. The Cycle Audit that follows this phase is adversarial by
construction — independent agents, one worktree each, every finding refuted
before it is believed — and this phase must not pre-empt it by doing a weaker
version of the same thing. What a review phase can do that an audit cannot is
**act on what the project already knows about itself**: the roadmap's
"what the phase leaves open" sections, the Issues, the architecture documents'
own admissions, and the eighty-six candidate items the closing of Cycle Audit 8
mapped across all of them. An audit finds; this phase finishes.

## 2. What is actually unknown

Which of the known debts are load-bearing. The map that opened Cycle 9 listed
eighty-six items from eight sources, and a critic verified the three most
load-bearing. They fall into four kinds, and the phase treats them differently:

1. **Guards that cannot fail** — a test that passes by having nothing to say,
   a scan anchored on a spelling, a threshold written against a constant.
   Cycle Audit 7 §5 named the shape; Cycle Audit 8 found it four more times;
   PH-26.1 found it in its own first plant. These are closed one by one, each
   watched failing.
2. **Records that are stale** — a phase document that still says "leaves open"
   about something a later phase closed, a dependency graph that stops early,
   a number quoted from a catalogue that no longer exists. These are corrected
   against the tree, and a guard is left where one can be anchored to a
   behaviour rather than a constant.
3. **Debts that are phases** — the trading boundary (no contract route on the
   venue, no persisted settlement, payout as a Lab default), the multi-node
   composition the shipped service does not host, ten thousand observers never
   held. These are **not** done here. They go into PH-27.5's report with what
   each would take, so Cycle 10 is chosen from a page rather than from memory.
4. **Small improvements with no owner** — `assessRealism` blocking the Lab's
   event loop, replay screens on `main` wired to nothing, the panel opening one
   connection per asset while the multiplexed endpoint exists. Closed here when
   they are a subphase or less; otherwise listed under 3.

## 3. What this phase may not do

- **It may not touch the price path.** A review that "improved" the engine
  would be a change to the one thing the audits exist to protect; anything
  found there is an Issue for the audit, not a fix here.
- **It may not close a finding by narrative.** Every closure is a guard watched
  failing, or a document corrected against the tree with the correction
  named.
- **It may not start a phase-sized debt.** Kind 3 is recorded, not begun.

## 4. Subphases

| Subphase | Title                                                                      |
| -------- | -------------------------------------------------------------------------- |
| PH-27.1  | The guards that cannot fail: found by planting, fixed by anchoring         |
| PH-27.2  | The records that are stale: every "leaves open" checked against the tree   |
| PH-27.3  | The small improvements with no owner, closed                               |
| PH-27.4  | The footprint of a Lab intervention, measured on the record it wrote       |
| PH-27.5  | The improvement report: the engine's realism, the trader's screen, the Lab |

## 4.1 PH-27.4 — the footprint of a Lab intervention

_"¿Has realizado tests para definir el impacto que tiene el Lab en un activo
cuando lo ejecuta?"_ — the Human Owner, 2026-09-05.

What is proven today is what the Lab **cannot** touch: `stepIndependence.test.ts`
shows the magnitudes and intervals bit-identical under every sign assignment,
and `selectableSigns.test.ts` shows the keystream cursor advancing as if nothing
were armed, so a restart is a release and the personality, lattice and
calibration are unreachable. What is **not** measured is what the Lab did to
the segment it controlled. `GET /markets/:id/quality` forks the future from a
snapshot and grades that; it never grades the record the operator just wrote.

The subphase measures the footprint on the record itself, and it can, because
the cursor did not move: the continuation the keystream **would** have produced
is reconstructible from the same snapshot. For an intervention — a push, a
close, a sustained direction to its two-minute ceiling — it records:

1. **Displacement**: the price at release against the price the keystream would
   have reached, in lattice steps and in candles moved.
2. **Detectability**: the realism metrics and the battery over the controlled
   segment against the same window uncontrolled — does an observer's instrument
   see the intervention, and at what sample size.
3. **Decay**: how many ticks after release until the controlled path and the
   uncontrolled path are statistically indistinguishable again — which, for a
   sign-only substitution on a magnitude engine that cannot see signs, should be
   zero, and the measurement says whether it is.

Recorded as evidence with the runs that produced it, and exposed on the Lab's
session record so an operator sees the cost of what they pressed.

## 4.2 PH-27.5 — the improvement report

_"Quiero que la última subfase de PH-27 sea un relatorio detallado de cómo
podemos mejorar el motor para hacerlo más realista, mejor de cara al usuario,
y el Lab, cómo mejorarlo también."_ — the Human Owner, 2026-09-05.

The phase's closing document, and the one thing in it that is written to be
read rather than to be executed: `docs/reports/IMPROVEMENT-REPORT-001.md`. It
absorbs what was to be PH-27.5 — the debts that are phases — because an
improvement report is where those belong: not as a list of what is owed, but
as the case for what to build and in what order.

Three parts, each grounded in a measurement the repository already holds or
this phase takes, never in taste:

**1. The engine, toward realism.** What the fifteen realism metrics and the
battery say a real market has that this one does not, stylised fact by
stylised fact — and, for each candidate mechanism, **whether it survives the
mirror test**. That is the constraint that makes this report different from a
wish list: the leverage effect is the most robust stylised fact in finance,
arrives as a three-line change, and is worth 2.9 percentage points of
directional edge (ADR-0003). Every proposal is classed as _sign-blind by
construction_, _sign-blind if done this way_, or _not sign-blind, and
therefore not for this engine_. Candidates the record already names: intraday
seasonality of activity, cross-asset volatility co-movement inside a family,
jumps with a sign-blind size distribution, the `metal` and `energy`
archetypes that no shipped asset uses, and the five fifteen-minute cells the
horizon record could not police.

**2. The trader's screen.** What an observer of `apps/web` sees that a real
venue's client would not, and the reverse: the countdown, the timeframe fold,
the reduction to columns, what a resume looks like, what a retired market
looks like, what a thirty-asset catalogue does to the list and the filter.
Measured against the PH-22 observer-load figures and the browser suites,
proposed as screens and behaviours with the invariant each must keep
(INV-002, INV-004 above all).

**3. The Lab.** Starting from PH-27.4's footprint measurements: what an
operator can do today, what each act costs the record, what they cannot yet
do — a replay, a footprint on screen, a job for a full battery (§67), an
intervention that survives a restart — and what the specification's open
sections still ask for. Each proposal classed by what it touches: the Lab's
own surface, the runtime, or the guarantees ADR-0015 forbids it to amend.

**4. The order.** The debts that are phases (the trading boundary, the
multi-node composition the service does not host, ten thousand observers never
held) and the proposals above, ranked into a proposed Cycle 10 with what each
would take, so the next cycle is chosen from a page rather than from memory.

The report proposes; it changes nothing. Anything in it that is a fix rather
than a proposal was done in PH-27.1–27.4, and anything that touches the price
path is an ADR to write, not a change to make.

## 5. Acceptance

1. Every guard PH-27.1 touches is watched failing against a planted defect.
2. Every "what the phase leaves open" section from PH-10 onward either still
   holds, is marked closed with the closing phase named, or is carried to the
   report.
3. The footprint of each kind of Lab intervention is measured on the record it
   wrote, recorded as evidence, and shown on the session record.
4. The improvement report exists, every proposal in it names its measurement
   and its invariant, every engine proposal is classed against the mirror
   test, and it ends in a ranked Cycle 10.
5. The full gate, hosted CI green on the merge commit — the first phase
   approval CI will have corroborated since PH-23.

## 6. What the phase found

1. **One guard that could not fail, out of fourteen re-planted** (PH-27.1):
   the minute-bucket statistics dropped quiet minutes on both sites; anchored,
   counted, shown on the quality screen. The other thirteen failed their
   plants by name, and the record now says which plant.
2. **Twenty open items, six sections, sixteen Issues** (PH-27.2): six Issues
   closed on evidence in the tree, ten kept and referenced from the report,
   every "leaves open" section annotated with a dated verdict, CLAUDE.md
   re-measured.
3. **Two small improvements closed, three measured and carried** (PH-27.3):
   the Lab's quality route no longer holds the process for seconds; the
   preview chart bounds a told hole exactly.
4. **What an intervention costs, in the record's own numbers** (PH-27.4): the
   level, by the sum of the changed signs times the engine's own magnitudes
   — 30, 2 and 252 steps for a push, a close and a bias — and nothing else,
   measured against the keystream's own continuation, with the decay figure
   shown non-zero on a leverage walker so it is known to measure. Recorded
   with every push.
5. **The report** (PH-27.5): every engine proposal classed against the mirror
   test, and a Cycle 10 proposed from a page.
6. **Hosted CI was red on both of this cycle's merges, and nobody had read
   it.** The Quality Gate failed on `c4757c5` (PH-26) and `f2bab68` (PH-25)
   on one test — `seats.test.ts`, "no two seats can draw personalities the
   differentiation check would refuse" — which takes 26.7 s on the hosted
   runner against the unit project's 20 s and 3.3 s here. The Statistical
   Gate was green on both (88 minutes hosted). Found while this phase's gate
   ran; fixed in this phase's merge (ten draws per seat, its own ceiling), and
   recorded here rather than folded into a subphase: an approval CI did not
   corroborate is the finding Cycle Audit 8 asked the next audit to look for,
   and this cycle produced two of them before anyone looked.

## 7. Integrated phase verification

| Check                                                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every subphase document APPROVED and the roadmap agrees                                       | `documentation.test.ts`, `stateConsistency.test.ts` green                                                                                                                                                                                                                                                                                                                                 |
| The price path untouched by the whole phase                                                   | `git diff --stat main -- packages/engine` empty at every subphase commit; the mirror tests in the gate below                                                                                                                                                                                                                                                                              |
| The browser suites, with the quality screen's new row and the session screen's footprint line | `lab.stat.test.ts` 9 flows, `panel.stat.test.ts` 8 flows, each run on its subphase's tree state                                                                                                                                                                                                                                                                                           |
| Anti-predictability after the phase                                                           | the mirror tests and the full battery in the gate below                                                                                                                                                                                                                                                                                                                                   |
| Phase quality gate `npm run gate` with the browser prefix                                     | `GATE_EXIT=0` on the first attempt — format, build, `typecheck:web`, `typecheck:config`, lint, unit 142 files / 2,995 tests in 111 s, statistical 45 files / 396 tests in 4,472 s (74.5 min, the browser suites included), `GATE COMPLETE`; started 08:29:27Z, finished 09:46:53Z, on `fe1550f`. The `seats.test.ts` fix landed after the gate and re-ran its own file (127 tests, 3.3 s) |
| Hosted CI on the merge commit                                                                 | recorded in `CURRENT_STATE.md` when the run lands                                                                                                                                                                                                                                                                                                                                         |
