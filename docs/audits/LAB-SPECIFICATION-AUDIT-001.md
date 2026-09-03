# Lab Specification Audit 001 — Sections F to P

Type: SPECIFICATION AUDIT (the Lab, against the updated specification)
Requested: 2026-09-03, by the Human Owner — "OTC MARKET LAB — AUDIT SPECIFICATION UPDATE"
Audited: `feature/ph-23-otc-market-lab` at `f246ede` plus the uncommitted PH-23.5 work (the Lab screen)
Method: read, then re-executed. Every claim marked **executed** below was run on this machine today; everything else is read from the code and says so.
Does not reset the cycle counter; it is not a Cycle Audit.

---

## 0. Scope, as the update fixes it

Directional Pressure Control and Manual Volatility Control are **out of scope**
and are not reported as missing anywhere below. What the update keeps is the
ability to _observe_ volatility, regimes, trend and transitions, and §17 records
what of that exists.

## 1. The one sentence

**The Lab has a correct mechanism and no controls.** An exact close and every
intervention are implemented as _selection among the engine's own futures_ —
PH-23.1's decision, verified on the shipped engine — and that is why sections J,
K and L come out almost entirely "by construction". But **nothing is ever
applied to a hosted market**: there is no route that commits a selection, no
current/next-candle selection, no numeric target price, no presets, no simulated
positions, no scenario routes, no release action, and the session record is
never instantiated. The controller's own words: _"This route reports; it does
not apply."_ PH-23.4 carried that as criterion 5 and PH-23 §10 lists it open.

Two things the reading did not find and execution did: the **shock criterion
does not depend on the signs at all** (LA-01), and **a tick on a candle
boundary is the chart's next open and the settlement's expiry price** (LA-02).

## 2. Findings

| ID    | Finding                                                                                                                                                                                                                                                                                                                                   | Section | How found |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| LA-01 | `INTERVENTIONS.shock(size)` is satisfied by every sign vector or by none: a single-tick displacement is `sign × step` and its absolute value is the step. It cannot cause a shock; it detects whether the engine's own fork contains one.                                                                                                 | F       | executed  |
| LA-02 | A tick at exactly a bucket boundary opens the next candle for the chart (`bucketStart` floors it into the new bucket) and is the expiry price for settlement (`priceAtOrBefore` is inclusive). Chart close and settlement price differ by that tick. Measured on the real engine: one 1m candle in 1,163 (EUR/USD), one in 471 (BTC/USD). | L, I    | executed  |
| LA-03 | No selection is ever committed to a hosted market. `selectClose` and `selectContinuation` run on a **fork** (`labStepsAhead`), the engine's sign stream is fixed at construction (`factory.ts`), and no route, service method or UI applies a chosen vector. `LabSession` is defined and never constructed outside its tests.             | I, H, P | read      |
| LA-04 | Close control is addressed in **lattice steps over a fixed 60 s from the snapshot instant** (`labStepsAhead(id, 60_000)`), not to a candle or expiration timestamp and not as a decimal price. Current/next candle cannot be selected; a typed price has no mapping to the lattice in the Lab.                                            | I, M    | read      |
| LA-05 | §70's terminal-convergence diagnostics are not implemented. The absence of a terminal signature rests on the construction (uniform rejection sampling) and on a plant that replaced the sampler with a constructive solver and was caught — not on a measurement of controlled candles.                                                   | K, J    | read      |
| LA-06 | §37's `NON-NATURAL TEST` mode is not implemented. ADR-0015 §3 permits and fences it; nothing builds it, so M7 and M8 have nothing to exclude.                                                                                                                                                                                             | M       | read      |
| LA-07 | Seven predicates exist against sixteen named scenarios: pressure (both signs), expanded and compressed volatility, shock (see LA-01), touch a level, and rise-then-pullback (bullish only). No bearish pullback, no breakouts, no false breakouts, no reversals, no noise or activity scenarios. None is wired to a route.                | P       | read      |
| LA-08 | Settlement presets (§41) and simulated positions (§38–§45) are not built. `packages/trading` can settle a contract against any tick record, including a Lab market's, and nothing composes it into the Lab.                                                                                                                               | N, O    | read      |

LA-01 and LA-02 are defects. The rest are the distance between a mechanism and
a product, and PH-23 said so about most of them; this audit measures the
distance rather than restating it.

### LA-01, executed

```
steps = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9]      // largest step 9
shock(9)  attempts over five seeds: 1, 1, 1, 1, 1
shock(10) attempts over five seeds: 1000, 1000, 1000, 1000, 1000
touches(30) attempts over five seeds: 2, 8, 1, 9, 1          // a criterion that does depend on the signs
```

`intervention.test.ts` asserts the second line ("a shock larger than the largest
step is unreachable") and calls it the load-bearing property. It is true and it
is half of the picture: the first line says that when the engine's fork does
contain a step of that size, the criterion accepts the **first** vector drawn.
An operator who asks for a shock is told either "the market was about to do that
anyway" or "it cannot" — which is honest, but it is not an intervention, and the
docstring (§15: _"keep one containing a displacement above a threshold"_)
describes a selection that is not happening.

### LA-02, executed

```
timeframe 1m: candle [1776000000000, 1776000060000) closes at 110
settlement priceAtOrBefore(1776000060000) = 120 (tick index 3)
DISAGREE by 10 lattice steps
the boundary tick opened the next candle: true
```

And on the real engine, 500,000 ticks each:

| asset  | span    | ticks on a 1m boundary | one candle in |
| ------ | ------- | ---------------------- | ------------- |
| eurusd | 193.8 h | 10                     | 1,163         |
| btcusd | 47.1 h  | 6                      | 471           |

PH-23 §3 wrote _"§39 is a verification, not a feature — already INV-003 and
already true."_ INV-003 is true: one stream, one record. What is not true is
that "the close of the candle" and "the price in force at the candle's end" name
the same tick; the chart's bucket is half-open on the right and the settlement
lookup is closed. Nothing tested it — no test in `chart`, `trading` or `core`
relates a folded candle's close to `priceAtOrBefore` of its end. A Candle Close
Control that guarantees "Close = 1.085100 at exactly 14:33:00" must decide which
of the two it guarantees, and today the chart and the settlement would answer
differently roughly once a day per fast asset.

## 3. Section F — Shock simulation

| Q   | Answer                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | No. The criterion uses the absolute displacement; sign is not selectable. And it is not wired to a route (LA-03).                                                                                                                                                                                               |
| F2  | No, same.                                                                                                                                                                                                                                                                                                       |
| F3  | The predicate takes a `size` in lattice steps. Given LA-01 it is a threshold on the engine's own steps, not a strength the operator can obtain.                                                                                                                                                                 |
| F4  | No. Nothing is applied to any engine (LA-03).                                                                                                                                                                                                                                                                   |
| F5  | Not applicable as a control. What the engine does on its own after a large step is the magnitude engine's business — volatility cascade, regime, arrival excitation (`magnitudeState`, `arrivalState`) — and it is independent of the signs, so no selection can add or remove "absorption" or "normalization". |

**What the implementation actually does:** `INTERVENTIONS.shock(size)` returns
a predicate over a natural continuation that is true when any single-tick
displacement has absolute value ≥ `size`. `selectContinuation` draws sign
vectors from a Lab stream and returns the first that satisfies it, with the
number of draws as the acceptance rate. Because the displacement's absolute
value is the step, the predicate is constant across draws (LA-01). No route
calls it.

## 4. Section G — Target price

| Q   | Answer                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Not as a control. `INTERVENTIONS.touches(level)` is the design's answer (PH-23.4 §2 maps §16 to it) and is unwired.                                                                                                                                      |
| G2  | No guidance exists, by design: the Lab selects a natural continuation that reaches the region; the engine is never pushed (PH-23.1).                                                                                                                     |
| G3  | Yes by construction — the path is one of the engine's own.                                                                                                                                                                                               |
| G4  | Yes, as often as chance says; `touches` requires only that `high ≥ level` (or `low ≤ level`) somewhere.                                                                                                                                                  |
| G5  | Yes; nothing constrains the path before or after the touch.                                                                                                                                                                                              |
| G6  | No strength modes. Not critical under the current contract; the natural analogue is the measured acceptance rate, which says how rare the request is.                                                                                                    |
| G7  | Yes. `touches` has no terminal condition and no timestamp; it is a region reach.                                                                                                                                                                         |
| G8  | Not mixed. `touches` (reach a region, any time) and `selectClose` (exact sum at the end of the window) are separate functions with separate acceptance criteria, and `closeSelection.test.ts` asserts the close path crosses its target before settling. |

## 5. Section H — Release market

| Q   | Answer                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | No such action.                                                                                                                                                                                                   |
| H2  | Nothing to remove: no intervention is ever active on a hosted market (LA-03).                                                                                                                                     |
| H3  | Same.                                                                                                                                                                                                             |
| H4  | The engine never leaves autonomous behaviour today.                                                                                                                                                               |
| H5  | Not applicable today. In the intended design, release is trivially continuous: every tick is engine-generated, so returning the sign source to the keystream at its cursor produces no jump and no invalid state. |

**Which interventions the current Release Market can cancel:** none, because
none exists to cancel.

## 6. Section I — Candle close control

| Q   | Answer                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | **The mechanism is genuinely implemented and verified; the operator capability is not.** `selectClose` lands exactly on a reachable lattice target using the engine's own steps unchanged, in 0.2–2.0 ms (PH-23.1 §3). No route applies it (LA-03).                                                                                                                                                     |
| I2  | No (LA-04).                                                                                                                                                                                                                                                                                                                                                                                             |
| I3  | No (LA-04).                                                                                                                                                                                                                                                                                                                                                                                             |
| I4  | No. The reachability route takes `delta` in lattice steps. A decimal price would have to be mapped to the log lattice (`fromDisplayPrice`, `instrument.ts:107`), and not every decimal is a lattice level.                                                                                                                                                                                              |
| I5  | Yes, for the mechanism: acceptance is `sum === delta`, an integer equality. It holds on the live engine because the steps do not depend on the signs, verified on 300 ticks of the shipped engine (`stepIndependence.test.ts`).                                                                                                                                                                         |
| I6  | The lattice **is** the canonical tick size (ADR-0004: a log quantum, not a decimal tick); every lattice level renders at the asset's `displayPrecision`. A typed decimal is not guaranteed to be a lattice level — see I4.                                                                                                                                                                              |
| I7  | No. The window is "the next 60 s from the snapshot instant" — not a candle, not an expiration (LA-04). And when it is made one, LA-02 must be decided.                                                                                                                                                                                                                                                  |
| I8  | **External, on a fork.** The hosted engine is snapshotted, a copy is run forward for the steps, and the selection happens beside the engine. The engine's sign source is substitutable at construction (`createMarketEngine({streams: {sign}})` — the test harness does it) and that is the only hook by which a chosen vector could ever be registered inside it. Nothing uses the hook outside tests. |

## 7. Section J — Natural path to exact close

All by construction, and the construction is the point: an accepted vector is
drawn **uniformly from the sign vectors that hit the target**, which is exactly
the natural process conditioned on that close.

| Q   | Answer                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1  | Yes.                                                                                                                                                                                                                                                                                                                         |
| J2  | Yes.                                                                                                                                                                                                                                                                                                                         |
| J3  | Yes; `closeSelection.test.ts` — _"allows the path to cross the target before it closes there"_.                                                                                                                                                                                                                              |
| J4  | Yes; overshoot is just a crossing.                                                                                                                                                                                                                                                                                           |
| J5  | Yes.                                                                                                                                                                                                                                                                                                                         |
| J6  | Yes.                                                                                                                                                                                                                                                                                                                         |
| J7  | Yes — the only constraint is the sum.                                                                                                                                                                                                                                                                                        |
| J8  | Yes — there is no interpolation; a constructive solver was planted and caught by four guards (PH-23.1 §7).                                                                                                                                                                                                                   |
| J9  | Yes — the magnitudes, intervals and rounding are the engine's, unchanged (`"uses the engine steps unchanged, in order"`).                                                                                                                                                                                                    |
| J10 | Yes — regime and cascade live in the magnitude engine, which the selection never touches.                                                                                                                                                                                                                                    |
| J11 | **From one candle, no**: its path is distributed exactly as a natural candle that happened to close there. **Across many, only through the operator's choices** — a run of closes that always sit one tick past entry is a pattern in the _closes_, not in the paths. Nothing in the repository measures that today (LA-05). |

## 8. Section K — Dynamic convergence

There is no convergence mechanism, so K1–K7 have nothing to adapt. This is not
an omission; it is the design (PH-23.1 §4: _"there is no convergence mechanism
to time"_).

| Q    | Answer                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1–7 | No influence exists to adapt. What does adapt is the **feasible set**: fewer remaining ticks, a larger distance or a quieter regime shrink it, and the acceptance rate reports that directly.                    |
| K8   | Yes. Reachability is the measured acceptance rate; parity and range impossibilities are named without sampling (`impossibilityOf`).                                                                              |
| K9   | Yes, vacuously.                                                                                                                                                                                                  |
| K10  | No fixed rule of any kind. Exact behaviour: draw a whole sign vector for the window; accept iff the sum equals the target; otherwise draw another.                                                               |
| K11  | Not from the paths (uniform conditional sampling). Possibly from the operator's distribution of targets, which no diagnostic watches (LA-05). §70's terminal-convergence check does not exist in `packages/lab`. |

## 9. Section L — OHLC and terminal price integrity

| Q   | Answer                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Yes — the candle is folded from a real path; `bars.ts` widens high and low only from visited prices.                                                                                                                              |
| L2  | Yes — the sum, and nothing else.                                                                                                                                                                                                  |
| L3  | Yes.                                                                                                                                                                                                                              |
| L4  | Yes; `"produces a different path for the same target on a different draw"` is asserted.                                                                                                                                           |
| L5  | **Not always — LA-02.** The settlement tick at a boundary instant is the next candle's first tick, not the closing candle's last.                                                                                                 |
| L6  | Yes: the published tick record is the single source (INV-003, INV-009); `settle.ts` reads it with the same `priceAtOrBefore` the battery samples with.                                                                            |
| L7  | **They can, by exactly one tick, when a tick lands on the boundary millisecond.** Measured at one 1m candle in 471–1,163 on the shipped engine. The rules differ — half-open bucket, inclusive lookup — and no test relates them. |

## 10. Section M — Target reachability

| Q   | Answer                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Only as the operator types it, in lattice steps. Neither route nor screen converts a price to a distance.                                                                                |
| M2  | No. `ticksRemaining` is returned; no clock time, and the window is not a candle (LA-04).                                                                                                 |
| M3  | Yes — measured, not estimated.                                                                                                                                                           |
| M4  | Yes: `easy ≥ 1/100`, `normal ≥ 1/2,000`, `difficult ≥ 1/50,000`, `critical` below, `outside-natural-range` when no draw of 200,000 lands or the target is impossible by parity or range. |
| M5  | Yes, and it names why: _"The remaining ticks can move at most 2288 lattice steps and the target is 999999 away, so no path reaches it"_ (executed in the browser today, zero attempts).  |
| M6  | It refuses rather than warns, because there is no correction to require: an unreachable close is not made.                                                                               |
| M7  | No (LA-06).                                                                                                                                                                              |
| M8  | Nothing to exclude yet; the fence is written into ADR-0015 §3 for when there is.                                                                                                         |

## 11. Section N — Expiration / settlement presets

Not built (LA-08). PH-23 §3 called them _"the sharpest thing in the
specification"_ and said they are fine — each is a target one lattice step from
entry, reached by selection. N4's tick size would be the lattice quantum, which
already is the asset's own. The distance from design to product here is short
and entirely unbuilt.

## 12. Section O — Simulated positions

Not built (LA-08). O10's isolation exists structurally — the Lab is a separate
process with its own state directory and its screen cannot name a production
asset (PH-23.5) — but there are no positions to isolate. `packages/trading`
settles any `Contract` against any `TickRecord`, deterministically, and would
settle a Lab contract against the Lab market's record without change; nothing
composes that.

## 13. Section P — Scenario lab

None of P1–P16 exists as a route or a screen (LA-03). As selection criteria:

| Scenario                             | Predicate                                         | Modifies engine conditions?                                               |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------- |
| P1 / P2 bullish, bearish trend       | `bullishPressure`, `bearishPressure` (net ≥ n)    | no — selects a natural continuation with that net displacement            |
| P3 sideways                          | `compressedVolatility` (range ≤ r), approximately | no                                                                        |
| P4 bull → pullback                   | `trendThenPullback(rise, depth)`                  | no                                                                        |
| P5 bear → pullback                   | —                                                 | not defined                                                               |
| P6–P9 breakouts, false breakouts     | —                                                 | not defined (`touches` reaches a level; nothing expresses hold or fail)   |
| P10–P11 reversals                    | —                                                 | not defined                                                               |
| P12 / P13 expansion, compression     | `expandedVolatility`, `compressedVolatility`      | no — selects a realised range; the engine's volatility state is untouched |
| P14–P16 noise, extreme, low activity | —                                                 | not defined; activity is the arrival process, which signs cannot select   |

**P17: yes, by the only means available.** A scenario is a predicate; the engine
generated every candidate; the Lab kept one. That is the principle exactly, and
it also bounds what a scenario can be: anything that would need the _magnitude_
or _arrival_ engine to behave differently — a genuine volatility regime, a
change of tick rate, a shock (LA-01) — is not a selection over signs and
cannot be produced this way. P12/P13 select a realised range, not a regime.

## 14. §17 — What the Lab can observe (the scope clarification)

Exists today, over the Lab's own surface:

- **Volatility and regime, live**: `magnitudeState.modulators` reports the
  volatility regime (`compressed | normal | elevated | stressed`) with its
  `remainingMs`, the cascade `phase` with `ageMs`, `pathLength` and
  `averagePathRate`; `arrivalState` reports `excitation` and `averageMagnitude`.
  The screen shows the regime and the cursors and refreshes every 2 s.
- **Volatility clustering, regime range, transitions, distribution shape**: the
  fifteen realism metrics, each with its band, on a one-million-tick fork.
- **Directional bias**: exactly one half, always, and the Lab says why. The
  engine does not expose a bias because it does not have one (ADR-0003).
- **Predictability**: the battery, ~800 hypotheses, with its resolution beside
  the verdict.

Does not exist: a live "trend strength" number (a realised trend is an excursion
of a fair random walk; the honest live figure is net displacement over a window,
which is not served); a regime-transition _timeline_ (the `EngineEvent` stream
in `LabSession` is designed for it and is never fed).

## 15. What this audit did not do

It did not fix anything. LA-01 and LA-02 are defects and are the next work; the
rest are the phases PH-23 §10 already names. It did not run the full battery
beyond the Lab's bounded route, and it did not audit sections A–E, which the
update did not include.
