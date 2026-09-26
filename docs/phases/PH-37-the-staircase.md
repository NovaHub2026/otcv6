# PH-37 — The Staircase: A Price You Can Read Tick By Tick

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-37
Status: APPROVED
Approved: 2026-09-24 — on the integrated verification in PH-37.2 (`GATE_EXIT=0` on `0abaf26`)
Cycle: 13 (phase 1)
Created: 2026-09-23
Branch: `feature/ph-37-the-staircase`, cut from `main`

---

## 1. What the Human Owner said

On 2026-09-23, after watching `v2.3.0` run:

> "el problema nunca estuvo en la cantidad de tick ni en el tamaño de la vela,
> el problema esta en que en un mercado que no es nada volatil generalmente el
> precio se mueve sin saltos poco a poco […] ahora mismo aun estando en un
> regimen normal parece como si tuviera una volatilidad alta porque el precio se
> mueve de un punto a otro mucho mayor muy rapido, ahora dependiendo del regimen
> esto si haria sentido"

Two statements, and both were measured before either was answered.

## 2. What was measured

**The catalogue is quoted between 6 and 356 times more finely than the
instruments it is named for.** Every asset but one:

|         | our lattice | the real instrument quotes to |           ratio |
| ------- | ----------: | ----------------------------: | --------------: |
| EUR/USD |  0.00000036 |                       0.00001 |       27× finer |
| EUR/GBP |  0.00000023 |                       0.00001 |       43× finer |
| AAPL    |     0.00032 |                          0.01 |       31× finer |
| NU      |    0.000031 |                          0.01 |      320× finer |
| BNB     |      0.0013 |                           0.1 |       79× finer |
| BTC     |       0.123 |                          0.01 | 12× **coarser** |

The consequence, measured on the live venue's own tape (3,667 ticks of three
assets) and reproduced offline over 33 hours of market time per asset: **the
price moves on 93–99% of ticks**, by a jagged amount, and 30-second contracts
settle at the money 0.1–0.75% of the time. A real EUR/USD tape at five decimals
leaves **45.8%** of its ticks with the price unchanged. What the Human Owner is
seeing is not volatility: it is resolution.

**The regime barely changes the size of a step.** Relative to calm, a stressed
tick is ×1.41 on EUR/USD, ×1.34 on BTC and ×1.03 on TSLA. PH-34 sent half of a
regime's volatility into the arrival rate, so agitation arrives as _more ticks_
rather than _bigger moves_ — which is the opposite of the instinct, and of what
the Human Owner asked for.

**And the arrival process can see the publication lattice.** `engine.ts` sets
`previousMagnitude = steps`, the floored lattice step count, and Hawkes excites
on it. A step of zero excites nothing and does not even enter the running
average the excitation normalises against, so a coarser lattice — which makes
half the steps zero — **cuts the tick rate**: 1.00 → 0.74 /s on EUR/USD,
3.67 → 1.52 /s on BNB, purely from how the price is published. The calibration
feeds the same field in units of base volatility (`asset.ts` says so: "No
quantum exists yet"), so the calibration and the engine have been exciting on
different quantities all along.

**This is not the root of PH-34's pace error, which was checked rather than
assumed.** With the coupling removed the formula `baseIntervalMs · (1 − n)`
still misses by ×0.94 to ×2.93 across the catalogue — DOGE was ×3.0 before and
is ×2.93 after. The cause is the **intensity clamp**: the stationary multiplier
`1/(1 − n)` is 2.14 on TSLA, 2.32 on EUR/USD, 3.60 on BTC and **7.68 on DOGE**
against a clamp of 8, and the measured pace error follows that order exactly.
The clamp is a deliberate stability guard, so PH-34's measured fit loop is the
right mechanism and stays.

## 3. What was decided

By the Human Owner, with the measured table in front of them (2026-09-23):

1. **The lattice is chosen by a refund ceiling, per asset**: the coarsest
   lattice whose realised at-the-money rate at 30 seconds stays at or below
   **5%**. Measured, not solved — the same discipline as PH-34's pace fit.
   Anchoring literally to the real instrument was rejected because it is not
   uniform: it would leave PBR and NU refunding 26% and 45% of 30-second
   contracts.
2. **The regime's volatility splits 0.25 into arrivals** instead of 0.5. The
   step from calm to stressed is `span^(1 − share)`, so the ladder's span of ×2
   gives ×1.41 today and **×1.68** at a quarter, while the tick rate still
   rises with the regime — by ×1.41 instead of ×2.

## 4. What this phase may not do

- **Change what the market does.** The volatility, the regimes, the durations
  and the level stay where PH-34 and PH-35 put them. This phase changes the
  lattice the price is _published_ on and how a regime's volatility is split —
  not how far the market travels.
- **Let the lattice reach the generator.** The arrival process must stop seeing
  the rounding. It keeps seeing the magnitude, which is sign-blind, so ADR-0003
  is untouched — and the mirror test runs on every subphase that touches
  `packages/engine`.
- **Publish a price finer than the lattice.** `displayPrecision` is recomputed
  from the quantum, as `rescaleCalibration` already says: a display finer than
  the lattice invites a trader to read a move that did not happen.

  **Corrected 2026-09-25 (Cycle Audit 13, a1-2): this bullet is unsatisfiable as
  written, and the catalogue does not satisfy it.** A decimal display and a
  quantum that is not a power of ten leave no third option — the display is
  either finer than the lattice or coarser — and coarser breaks two things that
  matter more: two adjacent lattice prices would print as one string, so a
  settled move could show no change, and `formatDisplayPrice` would stop
  round-tripping through `fromDisplayPrice`. `Math.ceil` therefore picks finer,
  for every one of the thirty assets, and predates this phase. What the phase
  actually delivered is a coarser lattice, not a last digit that moves by one:
  measured, EUR/USD's quantum is 4.69 units of its last displayed digit, so that
  digit moves by 5, 9, 4 or 14 and never by 1. The way to satisfy the intent is
  to snap each chosen quantum to the decimal grid — the coarsest lattice whose
  quantum is a whole number of last-digit units while the 30-second refund stays
  under the ceiling — which is a phase of its own and is named in Cycle Audit
  13's record.

- **Hide the cost.** Refunds rise from 0.1–0.75% to 3–5% per asset at 30
  seconds. The release notes say so in those words, because it is the Human
  Owner's margin.

## 5. Subphases

| Subphase | Title                                                                    |
| -------- | ------------------------------------------------------------------------ |
| PH-37.1  | The arrival process stops seeing the lattice, and the regime splits 0.25 |
| PH-37.2  | The lattice by refund ceiling, and the thirty assets on it               |

PH-37.1 comes first because the lattice cannot be chosen while coarsening it
still moves the tick rate: every candidate would be measured on a different
market.

## 6. What it costs

- **A full recalibration of the thirty**, with every pinned statistical number
  re-measured by its own procedure.
- **One seam per asset on upgrade**, as at `v2.2.0` and `v2.3.0`. The published
  price moves by at most half of the new quantum — 0.03 pips on EUR/USD — so
  no broker sees a jump.
- **Refunds.** Three to five contracts in a hundred at 30 seconds, against
  three in a thousand.
