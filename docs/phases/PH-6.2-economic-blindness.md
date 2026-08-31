# PH-6.2 — The trading boundary and verified economic blindness

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-6.2
Parent phase: PH-6 — Trading Boundary
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Demonstrate INV-001 rather than argue it.

## 2. Why the structural argument was not enough

The guardrail scan proves the price path never _names_ a payout, an exposure or a
position, and `dependencies.test.ts` proves nothing below `apps/` imports a
framework. Both are strong, and neither is a demonstration.

They were also easy to satisfy, because contracts and the engine had never
existed in the same process. There were no positions to leak. PH-6 is the first
moment the invariant can be violated by accident.

## 3. The demonstration

The same market, twice, from the same key, the same genesis and the same clock
schedule. One run quiet. One run traded, hard:

- **one-sided exposure** — every contract in the same direction, so the operator
  carries maximal directional risk;
- **concentrated** — all on one asset;
- **tick-anchored** — an entry on every published tick;
- **state-coupled stakes** — stake scaled by recent realised movement, so the
  size of the operator's exposure tracks the market's own state. That is what a
  naive "risk-managed" venue does, and it is exactly the coupling that would
  surface here if it existed.

**Every published tick must be identical.** Not statistically similar —
identical, as arrays.

The test cannot pass vacuously: it asserts that the quiet run produced more than
500 ticks and the traded run settled more than 200 contracts before it compares
anything.

## 4. Result

All five catalogue assets: **identical tick streams**, traded and untraded.

Ledger from the traded run of `eurusd`, one hour: 4,000 contracts, 15 refunded
(0.38%), win rate of decided contracts 46.68%, operator margin 12.75%.

### Two numbers that need reading carefully

**The 0.38% tie rate is not the 1% PH-4.2 calibrated for, and that is expected.**
PH-4.2 measured non-overlapping wall-clock windows, whose boundaries usually fall
_between_ ticks — so the window opens at a slightly stale price and the measured
move is shorter. A contract entered exactly at a tick has no such staleness, so it
sees a slightly larger move and ties less often. The calibration is therefore
mildly conservative for tick-anchored entries, which is the safe direction.

**The 46.68% win rate is not evidence of bias.** Contracts are entered at every
tick with a 30-second horizon, so at a ~1.3s tick interval about twenty are open
at once and they share most of their price path. `outcomes.ts` flags exactly this
trap. The effective sample size is a small fraction of 4,000, and ~47% sits well
inside one standard error. Reading it as a directional signal would be the same
mistake as reading a single realisation's kurtosis as the truth (PH-4.1).

The claim this subphase makes is the tick identity. The ledger is a sanity check
and is asserted with deliberately loose bands.

## 5. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                            | Result                     |
| -------------------------------- | -------------------------- |
| `npm run format:check`           | PASSED (exit 0)            |
| `npm run lint`                   | PASSED (exit 0)            |
| `npm run build`                  | PASSED (exit 0)            |
| `economicBlindness.stat.test.ts` | PASSED — 6 tests, 5 assets |
| Guardrails                       | PASSED — 128 tests         |

### Known limitations carried forward

- The demonstration covers one process. It does not yet cover a venue where
  trading and price generation are separated across a network boundary, which is
  where PH-7 puts them.
- Trading here has no accounts, balances or identity. A contract carries a stake
  as a number.
