# PH-40 — The Engine A Broker Settles Against

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-40
Status: ACTIVE
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
- **Change a lattice with contracts in flight** — ADR-0021's guard, and PH-40.3
  changes lattices, so it says how a deployment does that safely.
- **Integrate.** No code in the broker's repositories. The guide is the deliverable.
