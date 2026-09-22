# PH-34 — The Market's Tempo Follows Its State

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-34
Status: ACTIVE
Cycle: 11 (phase 2)
Created: 2026-09-22
Branch: `feature/ph-34-the-markets-tempo`, cut from `fix/fresh-genesis-key` (ADR-0019), which carries `main`

---

## 1. What the Human Owner asked for

On 2026-09-22, running the engine in their broker, the Human Owner raised three
things about how the market moves, and decided each of them in the same
conversation (the Spanish is theirs):

> "en cuanto a el movimiento de ticks por segundo actualmente es bastante
> grande me gustaría reducirlo en un 40% o incluso mejor ajustarlo al tipo de
> mercado […] no es lo mismo volatilidad y tamaño de la vela que los
> movimientos […] entre más tranquilo el mercado menos se mueve en cuanto a
> ticks"

> "lo que yo me refería es a una combinación entre las características del
> activo y el régimen actual […] un activo tranquilo con un régimen elevado se
> debe mover con más ticks que siendo tranquilo con un régimen menor"

> "tenemos que revisar el tiempo que dura cada régimen porque vi que muchos
> activos en una vela está en un régimen y ya en la otra cambia […] hacer una
> escalera aleatoria también, que el régimen más alto sea el que menos dure
> pero tampoco una vela"

> "que el mercado esté tranquilo y con baja volatilidad no significa que las
> velas sean extremadamente pequeñas […] el OTC debe ser dinámico, así que aun
> en los tramos más tranquilos debe haber un movimiento por arriba de la media
> del mercado real"

Each was measured before it was answered:

- **Tick rate follows the family, not the market's state.** 4.1 ticks a second
  per asset on average; crypto near 10, forex 2–4, equities and indices 1.2–2.8,
  so EUR/USD, a calm pair, ticks twice as often as TSLA. Within an asset the
  regime barely moves the count: the calmest quarter of five-minute candles
  against the most agitated had ranges ×5.8–×6.5 apart and tick counts only
  ×1.3–×1.6 apart on EUR/USD, EUR/GBP and AAPL (×4.0 on BTC).
- **Regimes are far shorter than a market's.** Weibull sojourns with shapes
  0.65–0.8 put most of their mass near zero, and the per-asset `regimeTempo`
  (0.31–2.73 across the catalogue) scales them all. On a typical asset the
  median stressed episode is 5 minutes and 52% end inside one five-minute
  candle; on the most restless asset the median is 1 minute and 80% do. Normal
  can jump straight to stressed (15%) and compressed to stressed (5%).
- **Calm is too calm.** The compressed regime is ×0.45, and the cascade's low
  states multiply it further: the quietest moments of today's market move at
  about a twentieth of its normal rate. The average is calibrated to the real
  instrument (EUR/USD 7.6% a year, AAPL 24%, BTC 68%), so calm sits well below
  what the real market does on an ordinary day.

## 2. What was decided

All of it by the Human Owner, with the numbers below put to them and
confirmed.

1. **Every regime is a level against the real instrument's typical
   volatility**: compressed **×1.2**, normal **×1.5**, elevated **×2.2**,
   stressed **×3.5**. Calm moves 20% more than the real market on an ordinary
   day, and the market as a whole — its own spikes against the real one's — is
   about **1.7×** the real average.

   _Typical against typical_ was the Human Owner's choice, put to them with
   the arithmetic (2026-09-22). A market with fat tails has an average well
   above its typical level — ×1.3–×2.0 for the cascades in this catalogue — so
   calm at +20% of the real **average** would have put the market at
   ≈2.5× the real one (2.2–3.4 by asset), and holding it at 1.7× with calm
   above the average would have taken the tails away (excess kurtosis ≈1.7, a
   nearly Gaussian market). Measured against the real market's typical level,
   all three hold: calm above the real market, 1.7× overall, spikes intact.
   The real instrument's typical level is its reference volatility divided by
   the ratio of average to typical of the asset's own cascade: the OTC market
   is the real one's shape at a higher level.
2. **A floor under the product.** No combination of regime, cascade and
   structure phase takes the volatility level below the calm level, ×1.2 of
   the real market's typical level. The floor is on the level — the expected movement — not
   on each candle, which a fair walk can still make small by chance.
3. **Regimes move as a random ladder**, one step at a time: compressed →
   normal; normal → compressed 45% / elevated 55%; elevated → normal 65% /
   stressed 35%; stressed → elevated.
4. **Regimes last like a market's**, each with a minimum and a random part
   with no mass near zero:

   | Regime     | Minimum | Typical  |
   | ---------- | ------: | -------: |
   | compressed |  30 min |    1–3 h |
   | normal     |  45 min |  1.5–4 h |
   | elevated   |  20 min | 30–90 min |
   | stressed   |  10 min | 15–30 min |

   The per-asset factor keeps each asset's character, narrowed from 0.3–2.7 to
   **0.7–1.5**, and never shortens a minimum.
5. **Half of a regime's volatility arrives as ticks.** A level `L` above normal
   multiplies the tick rate by `L / L_normal` and the effective tick size by the
   square root of that, so each regime's candles are the size its level says:
   compressed ×0.8 ticks, elevated ×1.5, stressed ×2.3, against normal.
6. **Each asset's base rate follows its character**: proportional to the
   square root of its reference volatility, across the thirty, normalised so
   the catalogue's average rate falls **40%** (4.1 → 2.5 ticks a second per
   asset). The calmest assets tick about once a second in normal, crypto about
   three to four times.
7. **Never fewer than one tick every two seconds**, so a thirty-second
   contract on the calmest asset in its calmest regime still sees about
   fifteen.

## 3. What this phase may not do

- **Let timing or magnitude see a sign.** ADR-0003 holds only while the
  magnitude and timing path is blind to direction. Coupling arrivals to the
  regime is coupling one sign-blind state to another; the mirror test runs on
  every subphase that touches `packages/engine`, and the battery at the phase
  gate. A change that passes the battery and fails the mirror is broken.
- **Anchor anything to a level.** The floor is on the volatility level, a
  magnitude; nothing reads a price.
- **Hide the cost to a running market.** A recalibrated asset has a new
  personality fingerprint, so a running market takes one seam on the upgrade
  (continues from its last price, on a new keystream — ADR-0019). That is
  recorded in the release notes, not discovered by a broker.
- **Retune a test to a new seed.** Where a test pins a number the recalibration
  moves, the number is re-measured by the test's own procedure and the reason
  recorded, as PH-24.17 did.

## 4. Subphases

| Subphase | Title                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| PH-34.1  | Regimes as a random ladder that lasts like a market, at levels above the real one |
| PH-34.2  | A floor under the volatility level                                              |
| PH-34.3  | The tick rate follows the asset and its regime                                  |
| PH-34.4  | The thirty assets recalibrated, and every number that moved re-measured         |
| PH-34.5  | Integrated verification, the battery, and what a broker must know to upgrade    |

## 5. What it costs

- **The long measurements restart.** PH-32's fifty-eight-year run (7 of 30
  assets done, every one clean) and PH-33's venue-day scales measure the
  catalogue as it is. On a recalibrated catalogue their verdicts would describe
  a market that no longer exists, so both wait for this phase and rerun on its
  catalogue (`DECISION-LOG.md`, 2026-09-22).
- **Candle gaps in calm stretches.** Fewer ticks per candle widen the step
  between one candle's close and the next open — what PH-24.17 fixed. Calm
  candles now hold fewer ticks and agitated ones more; the metric PH-24.17
  added is re-measured, not assumed.
- **A broker sees a more volatile market.** About 1.7× the real instrument on
  average, by the Human Owner's decision; the release notes say so in those
  words.
