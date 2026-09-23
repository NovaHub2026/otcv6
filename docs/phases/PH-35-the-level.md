# PH-35 — The Level The Market Runs At

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-35
Status: APPROVED
Approved: 2026-09-23 — `GATE_EXIT=0` on `622859f`, with the per-asset evidence in [`PH-35-THE-LEVEL.md`](../evidence/PH-35-THE-LEVEL.md)
Cycle: 12 (phase 2)
Created: 2026-09-23
Branch: `feature/ph-35-the-level`, cut from `main` at `v2.2.0`

---

## 1. What the Human Owner said, after watching PH-34's market

> "la volatilidad en el régimen normal es demasiada alta todavía y si aumenta
> progresivamente tenemos un problema"

Measured before it was answered, over sixty simulated days per asset and thirty
days of candle ranges:

- **A normal five-minute candle of EUR/USD spanned 0.039% of price** — about
  4.5 pips — where the real pair does 2 to 3. Its median day spanned 1.28%
  against about 0.77% for the real one, BTC's 12.6%, TSLA's 7.2%.
- **The market was at 1.86× the real instrument's average**, which is what PH-34
  anchored (1.7) plus the sampling of a sixty-day window.
- **Nothing was ratcheting up.** Regimes are stationary and the calibration
  fixes the long-run level: the volatility a year from now is the volatility
  today. What grows with time is the price's distance from where it started —
  as the square root of time, because the market is a driftless walk — and at
  1.86× it wanders 1.86× as far: ±14% from its reference in a year against
  ±7.7% for the real pair. That is the "progresivamente" this phase answers.

## 2. What was decided

Put to the Human Owner with the arithmetic of three levels and two ladders:

1. **The market moves like the instrument it is named for.**
   `OTC_DISPERSION_FACTOR` is **1.0**, from 1.7. Every regime, the floor and
   every candle scale with it.
2. **The step up between regimes is gentler.** A stressed five-minute candle is
   **1.6×** a normal one, where PH-34 made it 2.3×; the rungs above normal are
   compressed and the calm rung stays where it was, because what was too much
   was the escalation rather than the quiet.
3. **Accepted with it**: a _typical_ five minutes of this market is now
   slightly quieter than a typical five minutes of the real instrument — a
   market with fat tails spends most of its time below its own average — and
   the calm regime sits at about the real instrument's ordinary day rather
   than above it. The floor still holds the market off the floor of its own
   ladder.

Tick rates are untouched: they follow each asset's reference dispersion, which
did not move.

## 3. What this phase may not do

- **Anchor the price.** Nothing may pull the price back toward its reference:
  that is mean reversion, it is exploitable, and it is the one thing the
  product cannot have (ADR-0003, INV-006). A market that wanders less is a
  market that moves less, which is what this phase does instead.
- **Touch the tick rate**, the regime durations or the ladder's shape below
  normal. PH-34 measured those and the Human Owner kept them.

## 4. Subphases

| Subphase | Title                                                | State    |
| -------- | ---------------------------------------------------- | -------- |
| PH-35.1  | The level, the ladder, and the thirty assets on them | APPROVED |

## 5. What it cost, and what it leaves for the next reader

Three assets of thirty left the `aggregational-gaussianity` band, which moved
from 0.85 to 0.95 with the measurement across all thirty recorded beside it
(0.259–0.909, median 0.573). It is a band on a metric that aggregates sixty
**ticks** — twenty to sixty seconds of these markets — and a gentler ladder
puts a tick return and a sixty-tick return in more nearly the same volatility.
A reader who wants the old band back is asking for a sharper step between
regimes, which is the thing this phase was asked to soften; the choice is the
Human Owner's and it is recorded here rather than buried in a constant.
