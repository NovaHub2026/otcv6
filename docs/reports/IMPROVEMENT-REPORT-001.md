# Improvement Report 001 — The Engine's Realism, The Trader's Screen, The Lab

Type: REPORT (PH-27.5)
Status: FINAL — written 2026-09-05, from measurements the repository holds and PH-27 took
Audience: the Human Owner and the agent that opens Cycle 10

_"Quiero que la última subfase de PH-27 sea un relatorio detallado de cómo
podemos mejorar el motor para hacerlo más realista, mejor de cara al usuario,
y el Lab, cómo mejorarlo también."_

This report proposes; it changes nothing. Every proposal names the
measurement it rests on and the invariant it must keep, and every proposal
that touches the engine is classed against the mirror test (ADR-0003) before
anything else is said about it, because the one thing Cycle 1 established is
that **the most dangerous change to this engine is the one that looks like an
improvement**: the leverage effect is the most robust stylised fact in
finance, arrives as a three-line change, and is worth 2.9 percentage points
of directional edge.

Three classes are used throughout:

- **A — sign-blind by construction.** The mechanism cannot observe a sign, a
  price, or anything derived from them; the involution argument of ADR-0003
  goes through unchanged.
- **B — sign-blind if done this way.** The mechanism is safe only under a
  named construction, and the mirror test is the check that it was.
- **C — not sign-blind, and therefore not for this engine.** Realistic, and
  a leak.

---

## 1. The engine, toward realism

### 1.1 What is measured today

Fifteen realism metrics (`assessRealism`, `packages/lab/src/realism.ts`),
each with a target band — fifteen of fifteen inside their bands where they
were last recorded: on the live engine (PH-23.3, `CYCLE-8-LAB-SURFACE.md`)
and on EUR/USD and GBP/JPY after the tick recalibration (PH-24.17); the
thirty of PH-26 are asserted six at a time — one per archetype since Cycle
Audit 9, a different six per gate — and no asset has been asserted twice nor
tabled, which is the first measurement §1.2
asks for. And the adversarial battery: 803 hypotheses at the PH-24 phase
gate, the horizon record policing 235 of 240 asset×expiration cells below
the promotional-payout threshold (`PH-11-HORIZON-COVERAGE.md`), and since
PH-25 the same battery on the record a venue actually serves
(`PH-25-SERVED-VERDICT.md`: undecided at an hour of record, floors named).

The metrics, by the stylised fact each stands for:

| Stylised fact                      | Metric(s)                                                             |
| ---------------------------------- | --------------------------------------------------------------------- |
| No linear predictability           | `return-autocorrelation-lag1`, `return-autocorrelation-lag10`         |
| Volatility clustering, long memory | `absolute-return-autocorrelation-lag1`, `absolute-return-long-memory` |
| Heavy tails                        | `excess-kurtosis`, `tick excess kurtosis`                             |
| Regimes                            | `displacement-heterogeneity`, `volatility-regime-range`               |
| Trends and pullbacks               | `mean-run-length`                                                     |
| Candle microstructure              | `candle-shape-diversity`, `two-sided-wick-fraction`                   |
| Lattice / tick microstructure      | `tick-size-dispersion`, `unchanged-tick-fraction`                     |
| Aggregation toward Gaussian        | `aggregational-gaussianity` (PH-24 §9: aggregates in ticks, not time) |

### 1.2 What a real market has that this one does not — and the class of each remedy

What the engine models today is a driftless walk whose _magnitude_ carries
all the structure: a four-level semi-Markov volatility regime with Weibull
sojourns (`regime.ts`), a Markov-switching multifractal cascade for long
memory and multifractality (`cascade.ts`), a Hawkes-type arrival process for
clustered ticks (`hawkes.ts`, `arrival.ts`), an intraday structure term
(`structure.ts`), a lattice with a calibrated quantum and tie rate, and
per-asset personalities drawn from archetype regions (`seats.ts`). Every
input to every one of those is elapsed time or the component's own
randomness: class A, and the mirror test says so at every gate.

What a real market has that this one does not, and what each would cost:

| Stylised fact                                | Today                                                                                                                                                                                                           | Remedy                                                                                                                                                                                                                                                                                   | Class | Measurement to take first                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Intraday seasonality of activity (sessions)  | None: no session or clock-phase term exists (`structure.ts` is the coil/expansion modulator of _magnitude_, not a clock); the battery's temporal families condition on clock phase and the engine produces none | A per-asset activity profile keyed on the injected clock's hour and weekday (forex quiet on Sunday, equities dead outside the cash session, crypto flat). Time in, never price: class A. The battery already has clock-phase families and will police it.                                | A     | The engine's activity by hour of the injected clock (flat by construction) vs a public intraday curve, per family |
| Cross-asset volatility co-movement           | None. Thirty independent markets; `wh-cross-asset` never fires because nothing is shared                                                                                                                        | A shared _magnitude_ factor per family (one extra cascade component drawn from a family-level stream) so EUR/USD and GBP/USD get loud together. Magnitude only, signs stay independent per asset: class A. Adds a hypothesis family worth watching: correlated _signs_ would be class C. | A     | Realised correlation of absolute returns across a family, engine vs public data                                   |
| Jumps                                        | Tails come from the cascade and the calibrated kurtosis; no discrete jump component                                                                                                                             | A compound-Poisson jump in _size_ with a symmetric sign from the same fair coin: class B — safe only if the jump's sign is drawn from the sign stream and its size from the magnitude stream, never from the price. The mirror test is the check.                                        | B     | Excess kurtosis at 1m vs 1h on the shipped thirty against equities/crypto references                              |
| Leverage effect (vol rises after down moves) | Absent, deliberately                                                                                                                                                                                            | None. Volatility reading the _signed_ return is the 2.9pp leak ADR-0003 measured.                                                                                                                                                                                                        | C     | —                                                                                                                 |
| Volume                                       | Not modelled; the screen has no volume                                                                                                                                                                          | A volume series derived from the arrival intensity and the magnitude (both sign-blind), published beside the tick as a display quantity, never settled on: class A. Gives the chart a volume pane that co-moves with volatility as real volume does.                                     | A     | Whether operators want it: no venue requirement names volume today                                                |
| Bid/ask spread and a two-sided quote         | One canonical price                                                                                                                                                                                             | A spread derived from volatility and the lattice quantum, rendered as a band; settlement stays on the single canonical price (INV-003). Class A as a display; class C if entries were ever priced on a side the generator could see.                                                     | A/C   | The product's payout rule: a spread that changes what settles is a product change, not an engine change           |
| Aggregation toward Gaussian in _time_        | `aggregational-gaussianity` aggregates in ticks (PH-24 §9)                                                                                                                                                      | Re-express the metric over time windows; no engine change.                                                                                                                                                                                                                               | A     | The metric at 1m/5m/1h on the thirty                                                                              |
| Slow drift of the level (multi-week trends)  | Driftless by theorem; excursions supply "trends"                                                                                                                                                                | None that keeps INV-006: any drift is a direction. Displacement heterogeneity 13.7 against a plain walk's 3.9 (3.5×, PH-3.1) is the honest substitute.                                                                                                                                   | C     | —                                                                                                                 |

### 1.3 The archetypes no asset uses

`metal` and `energy` exist in `ASSET_ARCHETYPES` and no seat draws from them
(the thirty use six archetypes: sector-etf 11, major-fx 6, alt-crypto 4,
major-crypto 4, blue-chip-index 3, cross-fx 2). Either two seats are added
for them — a gold and an oil contract, in the `commodity` family, class A
because a seat is a region of the same trait space — or they are retired
from the vocabulary so the panel's archetype picker does not offer a region
nothing has ever been drawn from and calibrated.

### 1.4 The five cells the record cannot police

Five fifteen-minute cells sit above the promotional threshold by at most
0.0242pp because their design effect (1.14–1.35) lifts the floor at 350,000
windows. The remedy is a longer run, not an engine change: the run is the
horizon evidence at 2–3× the windows for those five assets. Class A (no
change).

---

## 2. The trader's screen

What the observer of `apps/web` sees today: one chart per asset drawn from
extreme-preserving columns (`reduceToColumns`), eight timeframes folded from
the same ticks (INV-004), a countdown to the next expiry above the canvases
(PH-24 fix), a status line that says when the stream reconnected or started
over after a refused resume, a flat list of thirty-one assets, the Lab behind
a `SIM` entry, and the preview chart with its seeded live bar. What was
measured: 2,000 observers on one harness process at p99 25 ms with zero gaps
(`CYCLE-8-OBSERVER-LOAD.md`); ten thousand never held; the panel opens one
connection per chart (Issue #16) against a six-per-origin browser limit.

| Proposal                                                                                                                                             | Rests on                                                                     | Keeps                                   | Size            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------- | --------------- |
| Bound the hole after a restart exactly: read `resumesAt` from the gap frame and draw the gap as a labelled span rather than starting the window over | PH-25.1 finding b; `marketStream.ts` and `PreviewChart.tsx` ignore the field | INV-002 (a told hole is not the market) | days            |
| Multiplex the panel's charts on `GET /markets/stream` (Issue #16)                                                                                    | PH-22.2 built the endpoint; the panel never adopted it                       | INV-002, INV-004                        | days            |
| A list that scales: family groups, a filter, the seat's archetype and character on the row (`/catalogue` already returns `seat`)                     | PH-26.4                                                                      | —                                       | days            |
| A retired market's screen: what it shows after retirement, with its last record readable                                                             | PH-20 §5 (retirement is one-way); no screen exists for it                    | INV-009                                 | days            |
| A volume pane and a spread band, if §1.2's class-A quantities are adopted                                                                            | §1.2                                                                         | INV-003 (settles on one price)          | a subphase each |
| Ten thousand observers held, from several harness processes                                                                                          | PH-22 §8: two thousand is where one harness becomes the busier process       | —                                       | a subphase      |
| The candle of the minute a kill fell in (PH-25.1 finding c) — the chart shows a hole; the fix is the venue's (§3)                                    | PH-25.1                                                                      | INV-009                                 | see §4          |

---

## 3. The Lab

What an operator can do today, all on a Lab-composed engine and never in
production (ADR-0018): push the price to a mark, close a candle where they
ask, hold a bias to a deadline, run scenarios and presets, hold simulated
positions and see them settle, read the session record and export it, run a
bounded quality battery on a fork, replay a kept snapshot tick by tick and
run the mirror on it — no: `Reproducir` is on `main` and no route feeds it
(PH-27.2, carried), so replay and the mirror are among what an operator
**cannot** yet do. What each act costs the
record is measured in PH-27.4: a push of ten ticks moved the level 30 lattice
steps (a sixth of a one-minute candle) against where the keystream would have
taken it, a selected forty-tick close 2 steps, a two-hundred-tick bias 252
steps (a candle and a half); in every case not one instant moved, not one
increment after release differed, and the offset never decays because nothing
pulls a driftless price back (`PH-27-INTERVENTION-FOOTPRINT.md`).

| Proposal                                                                                                                                                                                              | Touches                          | Rests on                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| Show the footprint on the session record and beside each control (displacement, detectability, decay)                                                                                                 | Lab surface                      | PH-27.4                                                  |
| §67's large runs as jobs with an id and a record, like registration (a 24-million-tick battery)                                                                                                       | Lab surface + runtime            | PH-23 §10                                                |
| `assessRealism` yielding between metrics so a quality run does not stall the process (PH-24.19)                                                                                                       | Lab                              | PH-27.3 closes it if it is a subphase or less            |
| An intervention that survives a restart — by design it does not; the honest option is to _record_ that it ended, on the session record, so a bias that was cut short is not mistaken for one that ran | Lab surface                      | PH-24 §9                                                 |
| The standing job (`npm run assurance:served`) run by the Lab itself against its own venue, with the verdict on the Tablero                                                                            | Lab surface                      | PH-25.3                                                  |
| A persisted tick record the shipped service can replay from across a restart — the fix for PH-25.1 findings a and c, and the precondition for a Lab replay against a _production_ record              | runtime (the venue, not the Lab) | PH-25.1 §5; `SqliteStateStore.readRecord` already exists |
| Anything that lets the Lab reach a production composition                                                                                                                                             | forbidden                        | ADR-0015, ADR-0018                                       |

---

## 4. The order: a proposed Cycle 10

The debts that are phases, and the proposals above, ranked by what they
unblock and what they cost. Sizes are this report's estimates against the
phases that resemble them; nothing here is committed.

| Rank | Phase proposal                                                                                                                                                                                                                               | Why here                                                                                                                                                          | Resembles      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1    | **The persisted record**: the shipped service keeps a bounded per-tick record (the sqlite store's `record` table, already written by the multi-node layer), primes the feed from it at boot, refolds the candle of the minute a kill fell in | Closes PH-25.1 findings a and c and Issue #22 for good; precondition for a Lab replay of production and for the standing job to see more than the hour since boot | PH-14, PH-19   |
| 2    | **The trading boundary**: a contract route on the venue, persisted settlement against the published record, payout as a venue parameter rather than a Lab default                                                                            | The product has no venue-side trade; `packages/trading` settles in tests only. Every economic invariant is asserted on a boundary that does not ship              | PH-12, PH-16   |
| 3    | **The engine's next stylised facts, class A only**: session seasonality and family co-movement of magnitude (§1.2), with the mirror test and the full battery before either is believed                                                      | The two largest realism gaps that are sign-blind by construction; both add hypothesis families the battery must run                                               | PH-3, PH-24.17 |
| 4    | **The screen at scale**: multiplexed charts, the grouped list, `resumesAt` holes, a retired market's screen (§2)                                                                                                                             | Thirty-one assets on a five-asset screen; the endpoint exists and is unused                                                                                       | PH-20, PH-21.3 |
| 5    | **Ten thousand observers, held**, from several harness processes, with socket memory measured at the target                                                                                                                                  | PH-22 §8 stopped at two thousand honestly                                                                                                                         | PH-22          |
| 6    | **The multi-node composition hosted**: the service composes the lease, the follower and the failover it already contains (Issue #9)                                                                                                          | Nothing runs it; the code exists and is tested in isolation                                                                                                       | PH-14, PH-15   |
| 7    | **Jumps and volume** (§1.2 class B/A), after 3 and only with the mirror test on every commit                                                                                                                                                 | Realism gains with a named risk (jumps) or a product decision (volume)                                                                                            | PH-24.17       |

A Cycle 10 of three phases would take 1, 2 and 3 in that order: the record
first because two later items stand on it, the trading boundary second
because it is the product, the engine third because it is the one place a
mistake is silent.
