# PH-31 — The Lab's Push, As An Operator Actually Uses It

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-31
Status: APPROVED
Approved: 2026-09-07 — on the integrated phase verification in §9 (`GATE_EXIT=0` on `eb4117c`)
Cycle: 11 (phase 1)
Created: 2026-09-07
Branch: `feature/ph-31-lab-push`

---

## 1. What is actually unknown

Nothing about the engine. Everything about the controls in front of it.

The Lab's push has been built, tested and audited across five phases, and it
had never been used for an afternoon by the person it is for. When it was, four
things were wrong at once, and none of them was a bug in the sense the suites
look for — every one of them was a **default or a scale chosen by whoever built
the control rather than measured against the market it acts on**:

> "por defecto quiero que aparezca la velocidad en normal en los empujes […]
> quiero también agregar un botón de parar el movimiento […] hay que ver
> también porque ahora la escala de empuje está demasiado grande, por ejemplo
> el +10 tiene unas 240 ticks algo fuera de lo normal que hace subir la vela
> demasiado rápido […] otro punto es bloquear los niveles de empuje dependiendo
> de la situación del activo."

The unknown this phase closes is therefore narrow and worth naming: **what a
Lab control should be measured against.** The answer this phase gives is the
market itself — its own candle for distance, its own arrivals for time, its own
regime and its own recent range for what it will accept — rather than a
constant that felt right when it was written.

## 2. Why this phase, and why now

Because it is the first thing the owner of the engine asked for after the
release, and because the Lab is the surface through which every future
judgement about the engine is made. A control that overstates what it does
makes the operator wrong about the market: PH-24.13's `rapido` is not a word,
it is one fifth of the market's own interval, and a default nobody chose meant
every untouched push played at five times the speed the market moves at.

## 3. What this phase may not do

- **Touch the price path.** The Lab chooses signs and arrival slots; the
  magnitudes are the engine's and stay the engine's (INV-001, ADR-0015). No
  change here reaches `packages/engine`.
- **Widen what the Lab can do.** Every change here _narrows_ it: a slower
  default, a smaller unit, a ceiling, and a way to stop. The one addition — the
  stop — removes an act rather than adding one.
- **Ship the Lab into production composition.** `/lab/*` remains absent from
  the production module (ADR-0018), and the guards that hold that are
  untouched.

## 4. Phase invariants

| Invariant | How this phase keeps it                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-001   | The ceiling reads the market's regime and its own record; it decides what an _operator_ may ask for, never what the engine produces. Nothing in the price path is read by anything economic and nothing economic is read by the price path. |
| INV-002   | A stopped push discards the queue _before_ it is drawn; nothing already published is retracted, and the market resumes on its own keystream at the next tick.                                                                               |
| INV-010   | The ceiling is derived from the modulator's regime and the record's own candles — both already published on the Lab surface — and no keystream cursor or drawn tick is exposed by it.                                                       |

## 5. Subphases

| ID      | Title                                                              |
| ------- | ------------------------------------------------------------------ |
| PH-31.1 | The push measured against the market: pace, unit, stop and ceiling |

## 6. The design, in one paragraph

A push is asked for in **units of the market's own candle**, and a unit is a
tenth of the median 1-minute range rather than a quarter — so the strip spans a
tenth of a candle to a whole one, and the largest push takes about a minute of
the market's own arrivals rather than half a minute of compressed ones. The
pace defaults to those arrivals. A push can be **stopped**, and stopping it
stops the push and nothing else — a sustained bias is armed by its own button
and cleared by it. And what the strip may ask for at all is bounded by the
market: the lower of what its volatility regime allows and what its own recent
candle has been doing against its longer record, enforced in the route and
shown, with its reason, in the strip.

## 7. What the phase leaves open, deliberately

The other Lab surfaces — the close control, the scenarios, the positions — were
not reviewed against the same question, and they were built by the same hand
that chose `rapido`. If the answer here is right, the same audit is owed to
them; it is not done in this phase because nobody has used them for an
afternoon yet, and that is the evidence this phase was built on.

## 8. What the phase found

1. **A Lab control is only as good as what it was measured against, and three
   of the four had been measured against nothing.** The pace was a word that
   meant one fifth of the market's interval; the unit was a quarter of a candle
   chosen when a tick was a different size; the levels were four numbers with
   no relation to what the market in front of them was doing. Each of them was
   correct code and a wrong control.
2. **The stop did not exist, and its absence was invisible to the suites**
   because nothing tests what an operator cannot do. The nearest thing —
   the close tab's release — also cleared a sustained bias, which is the
   conflation Cycle Audit 8 (a6) had already found once in the push route.
3. **A `unknown` parameter is a wiring defect waiting to happen** (PH-31.1 §5.3):
   the ceiling was computed from the wrong object and no build, type or test
   could see it, because `unknown` accepts everything and no test asked the
   two paths the same question. The fix removed the parameter rather than
   correcting the call.
4. **The panel had been serving a three-day-old bundle** (§5.4). Four finished
   changes were invisible in the browser while the suites were green, and they
   were reported as undone. The launcher asked whether the bundle _existed_
   where it should have asked whether it was _current_ — the same question the
   project got wrong on 2026-09-02, when the panel served a tree nobody was
   working on.

## 9. Integrated phase verification

| Check                                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The subphase document APPROVED and the roadmap agrees               | `documentation.test.ts`, `stateConsistency.test.ts` green at `state:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| The price path is untouched (INV-001)                               | no diff under `packages/engine`; `guardrails.test.ts`, `dependencies.test.ts` green                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Every control is measured against the market rather than a constant | `distance.test.ts`, `pushCeiling.test.ts`, `pushRoutes.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| The published ceiling is the enforced ceiling                       | `pushRoutes.test.ts`, and the live venue refusing a `+10` with the regime named                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Stopping a push stops the push and nothing else                     | `pushRoutes.test.ts`, and the live venue answering `discarded 8 / pushing null / bias 1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A control that cannot be used says so                               | `panelUx.test.ts` (grey when disabled), `labScreen.test.ts` (PARAR last, full width), measured in a real browser                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Every guard watched failing                                         | PH-31.1 §7 — five plants, five named failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Phase quality gate `npm run gate` with the browser prefix           | `GATE_EXIT=0` on `eb4117c`, 2026-09-07 13:57–15:22Z: format, build, `typecheck:web`, `typecheck:config`, lint, unit (166 files, 3,436 tests, 38 s), the coverage leg (120 s), statistical (47 files, 411 tests, 4,880 s). **The run before it was red and it was my own fault**: I launched it and then went on writing the approval documents, so the two state-consistency guards read a half-edited tree. The repository's own rule — a gate that overlaps an edit is void — cost eighty minutes, and it is recorded here rather than quietly re-run. |
