# PH-31 — The Lab's Push, As An Operator Actually Uses It

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-31
Status: ACTIVE
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

_Filled at approval._

## 9. Integrated phase verification

_Filled at approval._
