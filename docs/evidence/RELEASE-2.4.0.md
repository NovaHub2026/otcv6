# Release 2.4.0 — The Staircase

Type: EVIDENCE (the release record)
Recorded: 2026-09-24
Tag: `v2.4.0` — the PH-37 merge, gated green locally on `0abaf26` and corroborated by hosted CI
Supersedes: [`RELEASE-2.3.1.md`](RELEASE-2.3.1.md) for deployment
Package: `tools/sim/scripts/integration-package.sh v2.4.0 <dir>`

---

## 1. Why this release exists

Running `v2.3.0`, the Human Owner said the market looked volatile when it was
not, and was precise about what they meant: it was not the tick rate and it was
not the size of the candle. _"En un mercado que no es nada volátil el precio se
mueve sin saltos, poco a poco."_ A calm EUR/USD crawls — it rests, and when it
moves it moves the smallest unit it has.

Measured, the cause was not the market. It was the **resolution**: the catalogue
published between 6 and 356 times finer than the instruments the assets are
named for — EUR/USD 27 times finer than a pipette, NU 320 times finer than a
cent — so **the price moved on 93%–99% of ticks**, jaggedly, where the same tape
read at a real EUR/USD's five decimals leaves **45.8%** of its ticks unchanged.
The market underneath was already right: 0.75 pips of range in 68 seconds is a
calm EUR/USD.

## 2. What changed

**Every asset's lattice is chosen by what it refunds.** A tie is an
at-the-money settlement and a refund (ADR-0007), so the lattice is the coarsest
one whose realised rate at thirty seconds clears a ceiling — **5%, the Human
Owner's number**, set with the measured cost of each alternative in front of
them. The 1% quantile that used to choose it is only where the search starts.

**Anchoring to the real instrument was measured and rejected.** It is not
uniform: at a one-cent lattice, PBR and NU — an 18-dollar and a 14-dollar stock
— leave 92% and 97% of their ticks unchanged and refund 26% and 45% of
thirty-second contracts. A ceiling is uniform; the texture each asset gets under
it is whatever its own volatility allows.

**A regime arrives as a bigger step, not only as more ticks.** The split moved
from a half to a quarter: a stressed tick now steps ×1.68 of a calm one instead
of ×1.41, and the rate still rises with the regime.

## 3. What a broker sees on upgrade

|                                             | Before (`v2.3.1`) |                                   After |
| ------------------------------------------- | ----------------: | --------------------------------------: |
| Ticks that leave the price unchanged        |             1%–7% |                         **20.5%–52.8%** |
| Median thirty-second move, in lattice steps |         40 to 150 |                          **4.3 to 6.2** |
| Published decimals (EUR/USD, TSLA, BTC)     |         7 / 4 / 1 |                           **6 / 3 / 0** |
| At-the-money refunds at 30 s                |     0.167%–0.435% |                         **3.31%–4.77%** |
| 30-second detection floor (single test)     |           0.215pp | **0.219pp** — still finer than 0.2513pp |
| API contract                                |           `2.1.0` |                      `2.1.0`, unchanged |

**The refund is the cost, and it is the one the Human Owner chose**: three to
five contracts in a hundred at thirty seconds, against three in a thousand. It
buys a price that rests and then steps.

**One seam per asset, and the price does not jump — which took two attempts.**
A published price is an integer count of quanta, so a market resumed onto a
different lattice has its last published price re-expressed on the new one: a
rounding, at most half a new quantum, 0.02 pips on EUR/USD. The discontinuity is
recorded, published by `GET /markets/:id/seams`, and respected by `settle`: a
contract whose window touches it does not settle.

**The first attempt shipped a conversion that could not run.** It read the
quantum a price counted in from the checkpoint — a field this same release adds,
so on the one upgrade that needs it no checkpoint declares one. The code called
that a rare corner. It is the upgrade path of every deployment that was running,
and on the live venue it moved thirty markets by a median of **31.7%** and as
much as **1,474%**: TSLA from 305.99 to 65.56, DOGE from 0.0895 to 1.4084. The
seams were recorded and `settle` refused across them, so nothing settled
wrongly; what was wrong was every price published afterwards.

Three sources could have answered and none does — the checkpoint predates the
field, the tick record stores integers, and so does the candle history. So
**this release carries the lattice it moved from**, per asset, taken from the
catalogue `v2.3.1` shipped. A checkpoint that declares its own quantum uses that
and never reaches the table; the table answers only for one written before the
field existed, which is the last time it can be needed for these values.

The repair of the venue that hit it used the system's own mechanism: one
recorded seam per asset, each opening at the price it had, recomputed from the
index it occupied on its old lattice. Measured after: **0.066% maximum
deviation** across the thirty, which is half a new quantum plus the seconds of
market that passed.

**The Lab's distance unit is a true tenth of the candle.** It was rounded to
whole lattice steps, which was harmless at two hundred steps a candle and takes
thirty per cent out of `+10 units is one candle` at eighteen. Relative controls
round where the ask is made, never below one step.

## 4. What was measured

| Measure                                                     | Result                                                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Refund per asset, on a family the calibration never touches | 3.31%–4.77%, mean 3.96%, twelve replicates each — [`PH-37-TIE-RATES.md`](PH-37-TIE-RATES.md)                     |
| The build that chose each lattice                           | [`PH-37-THE-STAIRCASE.md`](PH-37-THE-STAIRCASE.md)                                                               |
| Ticks at rest, on the shipped engine                        | 20.5%–52.8%, mean 34.7% (400,000 ticks per asset)                                                                |
| Lattice resolution across the thirty                        | 4.32–6.24 steps, a factor of 1.44 where it was 3.8                                                               |
| Predictability                                              | battery clean; 30 s floor 0.219pp against the 0.2513pp the payout implies                                        |
| Structure                                                   | the mirror test passes on the full stack                                                                         |
| Differentiation                                             | real 11.8%–14.9% shape against an identical-personality control at 5.2%–7.6%, no overlap                         |
| The phase gate                                              | `GATE_EXIT=0` on `0abaf26` — unit 172 files / 3,526 tests on both legs; statistical 47 / 411 with a real browser |

## 5. Four defects the phase found that were not its subject

- **The publication lattice reached the generator.** The arrival process was
  excited by the floored step count, so coarsening the lattice cut the tick rate
  — 1.00 to 0.74 a second on EUR/USD, 3.67 to 1.52 on BNB — for no reason anyone
  chose. It sees the magnitude now, and the rate is identical at ×1, ×8 and ×32.
- **Every market opened at half pace.** Self-excitation started at zero, so a
  genesis — and every seam, including the automatic one `v2.3.0` shipped — ran
  at a fraction of its calibrated rate for its first stretch: 0.86 ticks a
  second over the first 300 against 1.55 settled, over 150 independent markets.
  It opens at the stationary excitation now, and the bias is −2.3%.
- **A seam onto a different lattice would have divided the price by twelve.**
  The checkpoint records the quantum its price counts in.
- **A checkpoint taken before the first tick did not replay.** The record caught
  it as two streams claiming one asset, which is what it was (INV-009).
- **And one this release found in itself**, after the gate and on a live venue:
  the lattice conversion above, which could not read what it needed on the only
  upgrade that needs it. The gate could not have caught it — every test in it
  writes its checkpoints with the field already present, which is why the guard
  that now exists drops the field deliberately.

## 6. Why 2.4.0 and not 3.0.0

The API contract is untouched at `2.1.0`: every route, field and refusal is what
it was, and a client built against `v2.1.0` needs no change. A price carries one
or two fewer decimals, which the contract has always published per asset in
`displayPrecision`. What changed is the market's texture and what it refunds,
and both are recalibrations — the one thing they do to a running deployment, the
seam, is a mechanism the contract already publishes.

## 7. Upgrading

Replace the binary and restart with the state directory intact. Each market
takes one seam, visible at `GET /markets/:id/seams`; the price it continues from
is the one it published, re-expressed on the new lattice — from the quantum the
checkpoint declares, or, for a checkpoint written by `v2.3.1` or earlier, from
the table this release carries. **Upgrade from `v2.3.1` or later**: a deployment
that skips it cannot be converted from a checkpoint older than the table's
values, and its prices would be reinterpreted rather than carried. Nothing else is
required, and a client needs no change — but a broker showing prices should
confirm it reads `displayPrecision` per asset rather than assuming the old one.
