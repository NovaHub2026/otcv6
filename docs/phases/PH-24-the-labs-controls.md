# PH-24 — The Lab's Controls: Applying A Selection

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-24
Status: APPROVED
Created: 2026-09-03
Approved: 2026-09-04
Cycle: 8 (third phase — its approval opens Cycle Audit 8)

---

## 1. What this phase is, and what it is not

[LAB-SPECIFICATION-AUDIT-001](../audits/LAB-SPECIFICATION-AUDIT-001.md) found
a Lab with a correct mechanism and no controls. An exact close and every
intervention are implemented as selection among the engine's own futures, and
that is why sections J, K and L of the specification hold by construction —
but **nothing is ever applied to a hosted market** (LA-03). No route commits a
selection; close control is addressed in lattice steps over sixty seconds from
now rather than to a candle (LA-04); there are no presets, no simulated
positions, seven scenarios of sixteen, no release action, and the session
record is never fed (LA-07, LA-08).

This phase turns the mechanism into controls. It is **not** a phase that adds
a steering mechanism: the selection stays a selection, the engine still decides
every path, and the only new thing that touches a price stream is a sign
source that plays a vector the fair coin could have produced.

## 2. The central design decision — a sign source that plays a chosen vector, in lockstep

The engine draws its sign from `streams.sign`, fixed at construction
(`createMarketEngine({streams})`). `stepIndependence.test.ts` already
substitutes it with a `ScriptedSigns` that returns scripted bits **while
consuming the inner keystream in lockstep**, so every cursor advances exactly
as it would have. That is the whole mechanism, and it is already verified on
the shipped engine.

`SelectableSigns` wraps the keystream sign stream: transparent by default;
`arm(signs)` plays them for the next `signs.length` draws, consuming the inner
stream for each; `release()` clears whatever remains. Applying a selection is
`arm` on the hosted engine, between advances — the same discipline `host` and
`retire` use (ADR-0012, one writer). `position()` and `seek()` delegate to the
inner stream, so a snapshot taken mid-script restores to the same cursor, and a
market that resumes from that snapshot continues on the keystream — a
scripted span is not persisted, by design: a restart is a release.

Every tick still passes through the engine's own magnitude, arrival and
rounding. The record is the engine's record; INV-003 and INV-009 hold inside
the Lab as they do outside it.

**Where the hook lives, and where it does not.** Engines are constructed in
`packages/runtime/src/resume.ts` (three sites: fresh, restored, seam) through
`createMarketEngine`, which already takes `streams`. `ResumeOptions` gains
`signSource?: (keystream: RandomSource) => RandomSource`, **default identity**.
The production composition never supplies one: `AppModule` becomes a dynamic
module whose default registration passes nothing, and `lab.main.ts` registers
it with the Lab's factory. Nest's scoping is the reason it must be a dynamic
module rather than an overriding provider — `VenueService` is instantiated in
`AppModule`'s scope and a provider declared in `LabModule` does not reach it.

Three guards make that a property rather than a promise:

1. an architecture test reads `main.ts` and `app.module.ts` and asserts the
   registration carries no sign source, and reads `resume.ts` and asserts the
   default is identity;
2. `SelectableSigns` lives under `apps/api/src/lab/`, which `labSurface.test.ts`
   already forbids `app.module.ts` from reaching;
3. a runtime test snapshots mid-script, restores into a fresh engine, and
   asserts the continuation is the keystream's — the cursors never learned a
   script existed.

## 3. What the specification will need changed

- **A shock is located and directed, not ordered** (LA-01, PH-23.6): the engine
  places the step, the coin picks its sign.
- **"Close" means the price in force at the expiry instant, inclusive**
  (ADR-0017). The chart's previous candle shows it too, except when the engine
  prints on the boundary millisecond.
- **A decimal target maps to the nearest lattice level.** The lattice is the
  canonical tick (ADR-0004, a log quantum); a typed price that is not a level is
  answered with its two neighbours, never rounded silently.
- **Target strength is the acceptance rate**, not a mode.
- **Trend strength is net displacement over a window**; the engine has no trend
  mechanism to expose.

## 4. What this phase may not do

- Put a selection where positions are: every route in this phase exists only in
  `LabModule` (ADR-0015 §3).
- Persist a scripted span: a snapshot records keystream cursors only.
- Let a non-natural tick into a measurement or a record without `NON-NATURAL
TEST` on it (ADR-0015 §3, §37).
- Print a verdict without its resolution (PH-23.5 §4–§5).
- Ship the battery to the browser (ADR-0015 §1).

## 5. Phase invariants

INV-001 (the production composition cannot be given a sign source; the Lab's
wrapper plays vectors the fair coin could produce and reads nothing economic),
INV-002 (within the Lab, one market, one price for every observer of it),
INV-003, INV-008 (arming and releasing happen between advances and never reset
state), INV-009 (a Lab settlement recomputes from the Lab's record), INV-010.

## 6. Subphases

| Subphase | Title                                                                                                                                                                  | Answers                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| PH-24.1  | The selectable sign source and its hook — the boundary, guarded first                                                                                                  | LA-03, I8, H5                                           |
| PH-24.2  | Candle Close Control on a real candle: current/next, expiry instant, decimal price, apply, release, session record                                                     | I1–I7, H1–H4, M1–M2, K8, §78                            |
| PH-24.3  | Presets and simulated positions, settled by `packages/trading` against the Lab's record                                                                                | N1–N4, O1–O10, L5 as a verification                     |
| PH-24.4  | Scenarios: the nine missing criteria, the three that sign selection cannot express — said so — and the screen for every control                                        | P1–P17, F1–F3 (located + directed), G1                  |
| PH-24.5  | The diagnostics the audit found missing: §70 over controlled candles, §37 fenced, the engine-event timeline fed                                                        | K11, M7–M8, §72–§73                                     |
| PH-24.6  | Rediseño UX del panel y del Lab — en español, con tooltips (directed by the Human Owner before closing)                                                                | the visible half, made usable                           |
| PH-24.7  | Los controles que faltan en pantalla: shock, expiración, Target Price                                                                                                  | F1–F3, I7, G1–G8 on the screen                          |
| PH-24.8  | Sesión persistente y los diagnósticos que faltan                                                                                                                       | §78 persistence, §70 over positions, ADR-0017 on screen |
| PH-24.9  | Varios activos a la vez: tablero, insignias, liberar todo                                                                                                              | the session across markets, as one thing                |
| PH-24.10 | Empujar y cerrar: pushes naturales de N ticks por botón, la pantalla alrededor de los dos controles                                                                    | APPROVED                                                | [PH-24.10](PH-24.10-empujar-y-cerrar.md)                                   |
| PH-24.11 | El empuje siempre responde: la capa de red no lanza, el empuje libera lo armado, Objetivo de precio a Escenarios                                                       | APPROVED                                                | [PH-24.11](PH-24.11-el-empuje-siempre-responde.md)                         |
| PH-24.12 | Un solo motor: el Lab es el motor en modo simulación; el panel lo declara; el gráfico dentro del Lab                                                                   | APPROVED                                                | [PH-24.12](PH-24.12-un-solo-motor.md)                                      |
| PH-24.13 | Empujar al instante: el tick pendiente se retira, los N ticks llegan en ráfaga con las llegadas más rápidas del motor                                                  | APPROVED                                                | [PH-24.13](PH-24.13-empujar-al-instante.md)                                |
| PH-24.14 | El panel se recupera solo: el gráfico reintenta su primera carga; el aviso del Lab dice lo que pasó                                                                    | APPROVED                                                | [PH-24.14](PH-24.14-el-panel-se-recupera-solo.md)                          |
| PH-24.15 | El ritmo del empuje: normal, medio, rápido — el paso de la ráfaga como parámetro del empuje                                                                            | APPROVED                                                | [PH-24.15](PH-24.15-el-ritmo-del-empuje.md)                                |
| PH-24.16 | Empujar progresivo y la dirección sostenida: el primer tick anclado en ahora; sube/baja como sesgo de rachas                                                           | APPROVED                                                | [PH-24.16](PH-24.16-empujar-progresivo-y-la-direccion-sostenida.md)        |
| PH-24.17 | Granularidad del tick: más ticks por vela con pasos menores a igual dispersión; medida en el Lab; gate completo                                                        | APPROVED                                                | [PH-24.17](PH-24.17-granularidad-del-tick.md)                              |
| PH-24.18 | Las distancias del Lab en unidades de vela: una unidad por mercado; empujes, cierres, escenarios en ella; sesgo y ritmos en tiempo de mercado                          | APPROVED                                                | [PH-24.18](PH-24.18-las-distancias-del-lab.md)                             |
| PH-24.19 | El panel de control del Lab: gráfico a 3/4, cuatro tarjetas de control a 1/4, solo el activo elegido; el instrumento pasa a /lab/avanzado                              | APPROVED                                                | [PH-24.19](PH-24.19-el-panel-de-control-del-lab.md)                        |
| PH-24.20 | El panel, segunda forma: dos tarjetas y solo controles — ritmo, filas verde y roja con sube / baja; vela actual / próxima, precio con = ▲ ▼, fijar / ×                 | APPROVED                                                | [PH-24.20](PH-24.20-el-panel-segunda-forma.md)                             |
| PH-24.21 | Subiendo / bajando en la tarjeta; los empujes contrarios se restan; la tasa marcada con un clic en el gráfico; la condición de cierre = ▲ ▼ con selección condicionada | APPROVED                                                | [PH-24.21](PH-24.21-subiendo-bajando-la-resta-y-la-condicion-de-cierre.md) |
| PH-24.22 | El cronómetro de la vela: cuánto falta para que cierre la vela en curso, en el marco del gráfico                                                                       | APPROVED                                                | [PH-24.22](PH-24.22-el-cronometro-de-la-vela.md)                           |
| PH-24.23 | El recorrido: hasta cinco puntos que el precio va a buscar en orden, con la textura de sube / baja al ritmo elegido; marcados en el gráfico; Buscar y ×                | REVERTED                                                | [PH-24.23](PH-24.23-el-recorrido.md)                                       |
| PH-24.24 | El recorrido retirado y el sesgo con límite: dos minutos como máximo, en el reloj del mercado, visible en el botón y registrado al expirar                             | APPROVED                                                | [PH-24.24](PH-24.24-el-recorrido-retirado-y-el-sesgo-con-limite.md)        |

Each subphase owes its plants. PH-24.1 owes one that arms in the production
composition and is caught.

## 7. Risks named before the work

- **The dynamic-module shape.** If `AppModule.register()` proves awkward for
  the existing `main.ts`, the fallback is a second `VenueService` provider in
  `LabModule` constructed with the factory — acceptable only with the same
  three guards.
- **Restore mid-script.** The design says a restart releases; a test must show
  the restored engine's next tick equals the unscripted continuation.
- **The boundary tick in the selection window** (ADR-0017): `labStepsAhead`
  keeps a tick at the window's end; the applied vector must cover it.
- **Scope of the screen.** PH-23.5's lesson: the visible half is part of done,
  and building it finds defects the API hides. Every control lands with its
  panel in the same subphase.

## 8. What the phase delivered

Twenty-four subphases, of which twenty-three stand (PH-24.23 was approved and
then reverted at the Human Owner's request, and its document says so).

**The mechanism became controls.** A close on a real candle, exact or on a side
of a mark; presets and simulated positions settled against the Lab's own record;
sixteen scenarios; a push that is N natural ticks at a chosen pace and in the
market's own distance unit; a sustained direction with a two-minute cap; a
board, a session record and the diagnostics the specification audit found
missing. Nothing steers: every act is a **selection among the engine's own
futures**, played by a sign source that consumes the keystream in lockstep, and
every price is the engine's own.

**The Lab got a screen an operator can hold.** `/lab` is a control panel — the
chart at three quarters with a countdown to the candle's end, and at one quarter
two cards of controls and no data. The instrument it grew from lives on
`/lab/avanzado`. Both are in Spanish, every explanation behind ⓘ.

**One engine per deployment** (ADR-0018): the Lab-composed process _is_ the
engine in simulation mode, so what the Lab does is what the panel's chart shows.

**The engine itself was recalibrated** (PH-24.17): three to four times as many
ticks per candle at the same dispersion, because the Human Owner could see the
gaps between candles. The catalogue's traits were re-authored, the lattice tie
rates re-measured, and every sample defined in time rather than in ticks.

## 9. What the phase leaves open

- **`assessRealism` blocks the process** for seconds while a quality run
  aggregates millions of ticks, which closes an idle keep-alive socket and cost
  the gate a 502 (PH-24.19). The panel's proxy retries a read once; the real fix
  is a yield between metrics.
- **`aggregational-gaussianity` aggregates in ticks, not in time.** After
  PH-24.17 that is a different question from the one the metric's name asks
  (PH-24.17 §6).
- **Replay and the mirror screen** (§74–§77) are still not built; the
  groundwork sits parked on `2ff8559`.
- **A bias does not survive a restart**, by design, and nothing in the persisted
  record closes it — the `bias` action's diagnostics say when it could not have
  outlived, and that is all (PH-24.24).

## 10. Integration verification (2026-09-04)

Beyond the subphase gates, run on the phase as a whole:

| Check                                                                                                                                                                                                                                | Result                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every subphase document APPROVED or REVERTED, and the roadmap agrees                                                                                                                                                                 | `documentation.test.ts` and `stateConsistency.test.ts` green                                                                                                                                                                                         |
| The three guards §2 names — no Lab route in a production composition, no sign source without the Lab's factory, a Lab-composed process declared as one                                                                               | `composition.test.ts`, `labProviders.test.ts`, `productionComposition.test.ts` green                                                                                                                                                                 |
| Integrated behaviour across subphases: a push over an armed close releases it; a close is refused while a push runs; a bias survives a push and still expires on its own deadline; release-all returns every market, biased or armed | `pushRoutes.test.ts`, `closeRoutes.test.ts`, `biasRoutes.test.ts`                                                                                                                                                                                    |
| The screen an operator actually uses, in a browser, against a live Lab-composed engine                                                                                                                                               | `lab.stat.test.ts` 9 flows, `panel.stat.test.ts` 8 flows                                                                                                                                                                                             |
| Anti-predictability after every change to the magnitude and timing path                                                                                                                                                              | the mirror tests and the full statistical battery, in the phase gate below                                                                                                                                                                           |
| Phase quality gate `npm run gate`                                                                                                                                                                                                    | `PHASE_GATE_EXIT=0` — format, build, `typecheck:web`, `typecheck:config`, lint, unit 126 files / 2,555 tests, statistical 42 files / 285 tests (the mirror tests, the adversarial battery over 803 hypotheses, both browser suites), `GATE COMPLETE` |
