# Architecture — The generative market model

Type: SUPPORTING DOCUMENTATION (living)
Describes: what exists in `packages/engine/` today
Decisions: [ADR-0003](../decisions/ADR-0003-conditional-sign-symmetry.md), [ADR-0004](../decisions/ADR-0004-canonical-price-representation.md), [ADR-0005](../decisions/ADR-0005-volatility-cascade.md)

---

## The one line that matters

```ts
const magnitude = magnitudeModel.advance(context); // non-negative, log units
const steps = floor(magnitude / logQuantum + u); // quantise the MAGNITUDE
const sign = signStream.nextBoolean() ? 1 : -1; // an independent fair coin
price += sign * steps; // integer log lattice
```

Everything else in the engine — cascade, regimes, structure phases, arrivals,
duration coupling — exists to produce that `magnitude`. None of it can see the
coin or the price.

That is what makes `P(up) = P(down)` **exactly**, at every horizon and under
every public conditioning: flipping every future sign is a measure-preserving
involution that leaves every latent variable pointwise unchanged while negating
the displacement. Anti-predictability is a theorem about the architecture rather
than a calibration outcome.

## The sign boundary is a type boundary

```ts
interface MagnitudeContext {
  intervalMs: number; // elapsed time
  previousMagnitude: number; // an absolute size, never signed
  instant: EpochMillis; // wall clock: not derived from any sign
  sequence: number;
}
```

There is no field for a price or a sign, so reading one is a compile error rather
than an oversight. That matters more than it sounds: the leverage effect —
volatility responding to the _signed_ return — is one of the most robust stylized
facts in real markets, arrives as a three-line change, leaves the process an
exact martingale, and is worth **2.9 percentage points** of directional edge.

## Layers

```
   arrival        HawkesArrivalModel        when the next tick happens
      │           self-exciting, |x|-driven, adaptive reference
      ▼
   magnitude      CascadeMagnitudeModel     base * cascade * |z|
      │           Markov-switching multifractal, 4-18 components, per asset
      ├── ×       VolatilityRegimeModulator  compressed / normal / elevated / stressed
      │           continuous-time semi-Markov, Weibull sojourns, shape < 1
      ├── ×       StructurePhaseModulator    coil / expansion / neutral / exhaustion
      │           age- and compression-dependent hazard, reflection-invariant
      └── ×       DurationCouplingModulator  (interval / reference)^h
                  whether volatility arrives as more ticks or bigger ticks
      ▼
   sign           an independent fair coin, from its own cryptographic stream
      ▼
   price          integer log lattice
```

Layers compose as multipliers so each can be measured on its own: turning one off
is a configuration change, which is what makes a realism movement attributable to
the mechanism that caused it.

## Personality: what makes one asset a different market

A `MarketEngineConfig` is about forty numbers, and handing that surface to
whoever adds an asset reintroduces both failures PH-3 paid for once — an unstable
Hawkes branching ratio that nothing made visible, and a cascade widening that
compounded to an excess kurtosis of 1366 against a ceiling of 200. So an asset is
authored as a **personality**: a small trait vector whose global consequences can
be checked analytically before anything is simulated.

Twelve traits, in two groups.

**Pace and scale** — `tempoMs`, `volatility`, `burstiness`, `clustering`,
`regimeSpread`, `structureSpread`, `durationCoupling`. How fast the market ticks,
how far it moves, how heavy its tails are.

**Rhythm** — `cascadeDepth`, `cascadeSpanMs`, `cascadeSpacing`, `regimeTempo`,
`arrivalMemoryMs`. The ladder of timescales on which volatility actually moves:
how many there are, how far apart they sit, how long a regime is held, how long a
burst keeps exciting the next arrival.

The second group is PH-10's. Before it, the entire time structure of the market
was one shared configuration, so five of the seven scale-free shape features any
observer can measure were identical across the catalogue by construction. Assets
differed in size, not in character.

### Depth is an exponent, and that is the whole design constraint

The cascade's contribution to kurtosis is one component's raised to the power of
the component count. A market authored with a deeper cascade and unchanged
`clustering` does not get slightly fatter tails; it gets exponentially fatter
ones.

Of the five rhythm traits, four are **kurtosis-neutral** and one is that
exponent:

| Trait             | Effect on the tail                                                   |
| ----------------- | -------------------------------------------------------------------- |
| `cascadeSpanMs`   | none — never read in the moment product                              |
| `cascadeSpacing`  | none — never read in the moment product                              |
| `arrivalMemoryMs` | none — timing is not a magnitude multiplier                          |
| `regimeTempo`     | none — cancels exactly between a stationary weight and its own total |
| `cascadeDepth`    | **exponent**                                                         |

So rhythm can be varied freely, and depth is varied together with clustering:
`solveClustering` finds the clustering that puts a given depth at a target tail
weight, analytically, in microseconds. `authorPersonality` also divides out
`cascadeRmsGain`, because a deeper cascade produces larger typical moves from the
same base scale — without that, changing an asset's rhythm would silently change
its amplitude.

A joint bound rejects a ladder whose fastest component resamples faster than the
market ticks: such a component pays full kurtosis and buys no autocorrelation at
any observable lag. It is a floor on waste rather than on safety, and it has to
be loud precisely because `solveClustering` would otherwise absorb the cost by
thinning every component — including the slow ones carrying the long memory.

### None of it can see a sign

Every rhythm quantity is a function of elapsed time and its own randomness. That
keeps ADR-0003's involution intact, and the mirror test is the check rather than
the argument: exact, zero divergences, on a personality using all five.

## How structure emerges without a level

A `coil` is a stretch of suppressed magnitude. The "range" a viewer sees is the
running high and low of that stretch — the engine is not steering toward a level,
it is producing small moves for a while. When the phase resolves into
`expansion`, magnitudes jump and the walk leaves the area it had been wandering
in, which reads as a breakout. Because the direction of departure is a fresh fair
coin, roughly half of those breakouts return through the range, which reads as a
false breakout and a retest.

The transition hazard depends on **path length per unit time** and on phase age,
both reflection-invariant. PH-2 measured what the level-anchored alternative
costs: volatility keyed to the price level is invisible to every conventional
attack family and yields a material directional edge.

**The engine generates volatility and activity regimes. It cannot generate
directional ones.** A "bullish trend" is not a state the engine enters; it is a
realized excursion of a driftless walk. Measured displacement heterogeneity is
about ten times the median against a random walk's 3.9, so those excursions are
abundant — a viewer sees trends because trends happen.

## What is measured

Phase acceptance, on 24 million ticks spanning 327 simulated days:

|                        | Result                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attack battery         | **clean** — all four feature kinds, ~800 hypotheses (797 on the 2026-09-02 run; ~570 before the unconditional family and the sweeping clock grid) |
| Detection floor at 30s | **0.221pp** single-test, finer than the 0.2513pp the 99% payout implies; **0.315pp** at the gate (out-of-band audit a4-01, `VALIDATION.md`)       |
| Realism                | **15/15 metrics**                                                                                                                                 |
| Mirror test            | zero divergences (reflected through the origin; the interior-snapshot harness of 2026-09-02 also passes — out-of-band audit a3-01)                |
| Generation             | 0.41M ticks/s                                                                                                                                     |

Realism detail on that run: return autocorrelation ~0.002, absolute-return
autocorrelation strong at lag 1 and still positive at lag 500, excess kurtosis
inside the 1.5–200 band, two-sided wick fraction 0.645, and mean same-sign run
length 2.000 — a fair coin.

## Calibration notes worth keeping

**Kurtosis multiplies across layers.** Excess kurtosis of a normal scale mixture
is `3 · prod(E[M⁴] / E[M²]²)` over independent multiplicative factors. Three
layers that each look reasonable alone compounded to 1366 against a ceiling of 200. Each layer's spread is therefore gentler than it would be in isolation.

**Sample kurtosis grows with the sample.** The same configuration measured 127 on
1.5M ticks and 191 on 4M: a longer run has more opportunity to observe the tail.
Parameters carry margin so a longer run does not breach the band.

**The tick rate is a product requirement.** About one second, because the
shortest contract is 30 seconds. At a five-second interval a contract resolves on
five ticks, ties become common, and two-sided wick fraction fell to 0.282 against
a floor of 0.30.

**Self-exciting arrivals normalise against a running average**, so the branching
ratio is what the configuration says regardless of the volatility scale above
them. A fixed reference was tried: the effective branching ratio exceeded one,
the process ran permanently pinned to its safety clamp, and the realized tick
rate was three times the configured one — with nothing failing.

## Entry point

```ts
const engine = createMarketEngine({
  config: defaultConfigFor(instrument),
  keyring,
  environment: 'simulation',
  start: { instant, price },
});
```

Every stream is derived under a label carrying environment, instrument and
purpose, so two assets are cryptographically isolated and a simulation can never
collide with production. A restart supplies `cursors` from the persisted lease
high-water mark rather than the snapshot, so no keystream position is ever
consumed twice.
