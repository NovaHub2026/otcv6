# PH-40 — The Engine A Broker Settles Against

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-40
Status: APPROVED
Approved: 2026-09-27 — the full gate on `3c043df`, `GATE_EXIT=0` with a real browser: 181 unit files / 3,680 tests (131 s), the same under coverage with every floor held (273 s), 47 statistical files / 411 tests (4,530 s); probe timestamps continuous from 19:16 to 20:39 UTC, so no clock jump
Cycle: 14 (phase 1)
Created: 2026-09-26

---

## 1. Why this phase exists

The Human Owner showed the engine the broker it is going to serve — the Orbit
frontend and a reference backend written in the language their team uses — and
asked for one thing: **finish the engine for how that broker actually operates**.
Not an integration: the integration is their team's, and this phase ends with the
documentation they will do it from.

Read from their code, that broker works like this:

- **It opens** a contract at the price the client _saw_, bound by an HMAC quote
  ticket over `(symbol, price, ts-in-seconds)`.
- **It settles** at `priceAt(symbol, floor(expiresAt / 1000))` — the second, not
  the millisecond — formatted with its own `pricescale`, and compares **the two
  display strings as numbers**; equal is `settled_draw`.
- **It displays at most five decimals**, two above 10,000. That is hard-coded twice:
  `Math.min(100_000, pricescale)` in the TradingView datafeed, and a 2-or-5 rule in
  every trading screen. So the precision it shows is the precision it settles at.
- **Its UI refuses to open** a contract on a quote older than fifteen seconds unless
  a heartbeat refreshes it.
- **TradingView** asks for resolutions 1, 5, 15 and 30 minutes and maps 60, 120, 240
  and 1D; it reads `pricescale`, `minmov` and a `volume` on every bar.
- **Its admin can steer OTC prices** through an "OTC radar" — nudge, pulse, trend,
  target. The engine will never serve that: INV-001.

## 2. What the engine owes it, measured

**Six of thirty assets have a lattice finer than one digit the broker can show**:
USD/CHF (a step of 0.24 of the fifth decimal), EUR/GBP 0.25, AUD/USD 0.41, EUR/USD
0.47, GBP/USD 0.55, DOGE/USDT 0.58. On those, a move the engine made can print as
no move, and because the broker settles on the printed string, a contract can be
declared a draw on a price that moved, or a trader can see `1.16320 → 1.16320` and
be paid. It is a fairness defect at exactly the point where the engine meets a
broker, and it is the engine's to fix.

**The other twenty-four** do not collide, but their step is not a whole number of
displayed digits (Cycle Audit 13, a1-2): the last digit jumps by 5, 9, 4 or 14 —
the Human Owner's original complaint in PH-37, still true on screen.

## 3. The rules this phase is built on

[ADR-0021](../decisions/ADR-0021-a-contract-settles-at-its-final-millisecond.md),
decided by the Human Owner on 2026-09-26: a contract settles at its final
millisecond with the price in force at that millisecond, across any seam; a seam
never closes a market; the one exception is a lattice change, which a release must
never make with contracts in flight.

## 4. Subphases

| Subphase | Title                                                                         |
| -------- | ----------------------------------------------------------------------------- |
| PH-40.1  | A contract settles at its final millisecond, and a seam never closes a market |
| PH-40.2  | A market that is open says so: a heartbeat carrying the price in force        |
| PH-40.3  | The lattice a broker can display, on every asset                              |
| PH-40.4  | What TradingView reads: a typed candle, its precision and its volume          |
| PH-40.5  | One restart writes one seam, and the seam rate measured on an isolated engine |
| PH-40.6  | The guide a broker integrates from                                            |

## 5. What this phase may not do

- **Serve any price-steering surface.** The radar does not exist for engine
  symbols. That is INV-001 and it is not negotiable.
- **Move the refund ceiling.** If a lattice the broker can display breaks the Human
  Owner's 5% ceiling on an asset, that is their decision to make with the number in
  front of them — raise the ceiling, or show one more decimal on that asset — and
  this phase measures it rather than choosing.
- **Change a lattice with contracts in flight** — ADR-0021's guard. As built,
  PH-40.3 changed no lattice at all: only six display precisions, which move no
  integer and owe no seam.
- **Integrate.** No code in the broker's repositories. The guide is the deliverable.

## 6. What the phase delivered

| Subphase | Delivered                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PH-40.1  | A contract settles at its final millisecond, across any ordinary seam; `/price` answers the price in force inside a seam and names it; only a change of lattice refuses (ADR-0021, contract 3.1.0). |
| PH-40.2  | An opt-in heartbeat carrying the tick in force and `asOf`, never ahead of the record or of the connection; `/price` final through the last clean pass (3.2.0).                                      |
| PH-40.3  | Every step visible at the published precision down to half the reference price — `meta-otc` had hidden moves on the live record; six precisions change, no lattice.                                 |
| PH-40.4  | A typed candle in the contract, `displayPrecision` on every price and candle, and a conformance check that refolds stored bars (3.3.0; Cycle Audit 13 a3-03, a2-04).                                |
| PH-40.5  | One restart writes one seam (#23); the seam rate measured with the host to itself: none, even at twice as many busy processes as cores.                                                             |
| PH-40.6  | [`ORBIT.md`](../integration/ORBIT.md) and `npm run evidence:broker-fit`.                                                                                                                            |

## 7. Phase verification

the full gate on `3c043df`, `GATE_EXIT=0` with a real browser: 181 unit files / 3,680 tests (131 s), the same under coverage with every floor held (273 s), 47 statistical files / 411 tests (4,530 s); probe timestamps continuous from 19:16 to 20:39 UTC, so no clock jump. Each subphase was approved from its own targeted gate first; every
red run on the way is recorded in the subphase that met it, including one in the
browser panel suite whose cause was not established (PH-40.3 §6).

**After the merge, the live venue found two more** (PH-40.5 §6): a first pass
that came 39 s late after a seamed boot reopened every market, and the record's
retention trim cost 17% of the process. Both fixed with guards watched failing,
and the whole was gated again: the full gate on `a7c3077`, `GATE_EXIT=0` with a
real browser — 181 unit files / 3,683 tests, the coverage floors held, 47
statistical files / 411 tests (3,816 s), probe timestamps continuous. A run
before it was void: the host slept 1 h 48 min inside the statistical suite and a
test's own timer fired on the clock jump. Hosted CI on the first merge
(`f9b8d14`) was red on one Lab browser flow that normally takes a second and did
not arm; nothing in PH-40 touches that path, and its failure now reports what
the plan said.

## 8. What is left, and whose it is

- **The Human Owner's: six assets at five decimals.** A broker that shows and
  settles at five decimals refunds 7.4%–16.0% of 30-second contracts on USD/CHF,
  EUR/GBP, AUD/USD, GBP/USD, DOGE/USDT and EUR/USD, against `settle()`'s 3.5%–4.4%.
  Recommended: the broker shows the engine's `displayPrecision` (six decimals on
  those six). The alternatives — coarsen those lattices, or raise the 5% ceiling
  for them — are PH-40.3 §4, with their numbers.
- **The broker's, documented in [`ORBIT.md`](../integration/ORBIT.md):** the entry
  price must be the one in force when the server accepts (a one-second-old quote
  wins 56–61% of 30-second contracts); settlement at the millisecond, not the
  second; the display precision above.
- **The engine's, next:** Cycle Audit 12's finding 7 (the calibration), and Cycle
  Audit 13's a6-06 c and a8-02; `FollowerMarket.priceAt` still refuses inside a
  seam, to close before multi-node settlement is offered.
