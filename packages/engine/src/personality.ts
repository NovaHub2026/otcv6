import { epochMillis, exp, ln, pow, type RandomSource } from '@otc/core';
import type { InstrumentSpec } from '@otc/core';
import { cascadeTypicalProduct, DEFAULT_CASCADE, type CascadeConfig } from './cascade.js';
import { DEFAULT_HAWKES, type HawkesConfig } from './hawkes.js';
import {
  REGIME_DURATIONS,
  REGIME_LADDER,
  relativeRegimeLevel,
  splitRegimeLevel,
  VOLATILITY_REGIMES,
  type RegimeConfig,
  type VolatilityRegime,
} from './regime.js';
import { DEFAULT_STRUCTURE, StructurePhaseModulator, type StructureConfig } from './structure.js';
import type { MarketEngineConfig } from './factory.js';

/**
 * An asset personality: what makes one market feel different from another.
 *
 * `MarketEngineConfig` is about forty numbers. Handing that surface to whoever
 * adds an asset reintroduces both failures PH-3 already paid for once — an
 * unstable Hawkes branching ratio that nothing made visible, and a cascade
 * widening that multiplied into an excess kurtosis of 1366 against a ceiling of
 * 200. Neither parameter looked dangerous locally.
 *
 * A personality is therefore a small vector of traits whose global consequences
 * can be checked before the asset is registered.
 */
export interface PersonalityTraits {
  /** Mean interval between ticks with no excitation, in milliseconds. */
  readonly tempoMs: number;
  /** Typical per-tick move in log units, before any modulation. */
  readonly volatility: number;
  /**
   * How far each cascade component sits from unity: the component multiplier is
   * two-point on `{1 − clustering, 1 + clustering}`.
   *
   * This is the single most dangerous trait. Its contribution to kurtosis is
   * raised to the power of the component count, so a change that reads as a mild
   * widening of one layer is a tenfold change in the tail.
   */
  readonly clustering: number;
  /** Expected offspring per arrival: the Hawkes branching ratio. Below 1. */
  readonly burstiness: number;
  /**
   * Exponent on the macro regime multipliers' distance from unity. 1 leaves the
   * calibrated regimes untouched; 2 doubles their spread in log space.
   */
  readonly regimeSpread: number;
  /** The same, for the structural phase multipliers. */
  readonly structureSpread: number;
  /** Amplitude–duration coupling exponent, in `[0, 1]`. */
  readonly durationCoupling: number;

  // -- rhythm: the time structure of the market ---------------------------
  //
  // Everything below controls *when* things happen rather than how large they
  // are. PH-10.1 §4 records which of them can touch the tail and which cannot:
  // only `cascadeDepth` enters the kurtosis product, and it enters as an
  // exponent. The rest are exactly neutral, by cancellation rather than by
  // approximation.

  /**
   * Number of cascade components: how many distinct timescales the volatility
   * of this market has.
   *
   * The one rhythm trait that is not tail-neutral. The cascade's kurtosis
   * contribution is one component's raised to this power, so a market with a
   * deeper cascade needs proportionally less {@link PersonalityTraits.clustering}
   * per component to land in the same band. {@link solveClustering} does that
   * arithmetic; authoring both by hand is how PH-3 reached an excess kurtosis of
   * 1366.
   */
  readonly cascadeDepth: number;

  /**
   * Mean switching time of the **slowest** cascade component, in milliseconds.
   *
   * The outer edge of this market's volatility memory. Together with
   * {@link PersonalityTraits.cascadeSpacing} and depth it fixes the whole ladder
   * of timescales, and therefore the decay profile of `|return|`
   * autocorrelation — which is what a chart reader perceives as the market's
   * character.
   */
  readonly cascadeSpanMs: number;

  /**
   * Geometric ratio between successive components' switching hazards.
   *
   * Wide spacing gives a market with a few well-separated rhythms; narrow
   * spacing gives one continuous smear of them across a shorter total span.
   */
  readonly cascadeSpacing: number;

  /**
   * How long this market holds a regime: above 1 longer, below 1 it changes
   * character more often.
   *
   * Since PH-34 the trait is a character axis rather than the scale itself: it
   * maps onto a factor in `[0.7, 1.5]` ({@link regimeDurationFactor}) that
   * scales the random part of every sojourn and never shortens a minimum. It
   * used to scale the whole Weibull draw across 0.3–2.7, which gave the most
   * restless assets a median stressed episode of a minute. Exactly
   * tail-neutral: see {@link regimeInflation}.
   */
  readonly regimeTempo: number;

  /**
   * Hawkes excitation memory, in milliseconds: how long a burst keeps exciting
   * further arrivals. `decayPerMs` is its reciprocal.
   *
   * Independent of {@link PersonalityTraits.burstiness}, which fixes how *much*
   * total excitation an arrival contributes. Two markets can share a branching
   * ratio and still burst completely differently — one in short sharp flurries,
   * the other in long swells.
   */
  readonly arrivalMemoryMs: number;
}

/**
 * The traits that reproduce `DEFAULT_ENGINE_CONFIG` exactly.
 *
 * This is load-bearing rather than a convenience. The defaults are the only
 * configuration a full battery has ever cleared, so the personality system must
 * be able to express them with no drift; `personality.test.ts` asserts the
 * expansion is byte-identical to the hand-written defaults.
 */
export const DEFAULT_TRAITS: PersonalityTraits = {
  tempoMs: DEFAULT_HAWKES.baseIntervalMs,
  volatility: 1e-5,
  clustering: 1 - DEFAULT_CASCADE.lowMultiplier,
  burstiness: DEFAULT_HAWKES.branchingRatio,
  regimeSpread: 1,
  structureSpread: 1,
  durationCoupling: 0.25,
  cascadeDepth: DEFAULT_CASCADE.components,
  // Expressed as times rather than hazards so that the reciprocal reproduces the
  // calibrated constants to the last bit: DEFAULT_CASCADE's hazard is written
  // `1 / (6 * 3_600_000)` and DEFAULT_HAWKES' decay `1 / 120_000`.
  cascadeSpanMs: 6 * 3_600_000,
  cascadeSpacing: DEFAULT_CASCADE.hazardRatio,
  regimeTempo: 1,
  arrivalMemoryMs: 120_000,
};

/**
 * Bounds on each trait.
 *
 * These are the outer fence, not the safe region. Passing them means a
 * personality is individually sane; it does not mean the *combination* is, which
 * is what {@link assertPersonalitySafe} exists to decide.
 *
 * Every corner of the fence builds a running engine — `personality.test.ts`
 * drives each one. `clustering: 0` is the constant cascade, admitted by
 * `assertCascadeConfig` since Cycle Audit 7 (a3-03) rather than pushed off the
 * fence, so that every registered asset's traits and every trait distance in
 * `differentiation.ts` stay exactly what was measured.
 */
export const TRAIT_BOUNDS = {
  tempoMs: { min: 250, max: 60_000 },
  volatility: { min: 1e-7, max: 1e-3 },
  clustering: { min: 0, max: 0.4 },
  burstiness: { min: 0, max: 0.9 },
  regimeSpread: { min: 0.25, max: 2.5 },
  structureSpread: { min: 0.25, max: 2.5 },
  durationCoupling: { min: 0, max: 1 },
  cascadeDepth: { min: 4, max: 18 },
  cascadeSpanMs: { min: 30 * 60_000, max: 48 * 3_600_000 },
  cascadeSpacing: { min: 1.3, max: 4.5 },
  regimeTempo: { min: 0.3, max: 3 },
  arrivalMemoryMs: { min: 15_000, max: 900_000 },
} as const satisfies Record<keyof PersonalityTraits, { min: number; max: number }>;

/**
 * The fastest cascade component's mean switching time, as a multiple of the
 * market's base tick interval.
 *
 * A component survives a tick with probability `exp(-tempo / switchingTime)`.
 * At this ratio that is `exp(-2) ≈ 13.5%`: weak, but still memory. Below it the
 * component is effectively independent at every observable lag, so it pays its
 * full share of kurtosis — the expensive part, since depth is an exponent — and
 * buys no autocorrelation, which is the only thing it was added for.
 *
 * The bound is relative to `tempoMs`, not absolute, because "too fast to see" is
 * a statement about the observer. A 500 ms component is a real rhythm in a
 * market that ticks every three seconds and noise in one that ticks every 300 ms.
 *
 * Every trait involved can be individually in range while the combination is
 * degenerate, so this has to be a joint check. It is a floor on waste rather
 * than on safety: `solveClustering` would quietly absorb the kurtosis cost by
 * thinning every component, which is exactly why the waste needs to be visible.
 * The default personality sits at 1.59 ticks, comfortably inside it.
 */
export const MIN_FASTEST_COMPONENT_TICKS = 0.5;

/**
 * Mean switching time of each cascade component, slowest first, in milliseconds.
 *
 * The ladder of timescales this personality actually has. Diagnostics, authoring
 * and the joint bound check.
 */
export function cascadeTimescalesMs(traits: PersonalityTraits): number[] {
  const scales: number[] = [];
  for (let k = 0; k < traits.cascadeDepth; k += 1) {
    scales.push(traits.cascadeSpanMs / pow(traits.cascadeSpacing, k));
  }
  return scales;
}

export function assertPersonalityTraits(traits: PersonalityTraits): void {
  for (const name of Object.keys(TRAIT_BOUNDS) as (keyof PersonalityTraits)[]) {
    const value = traits[name];
    const { min, max } = TRAIT_BOUNDS[name];
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(
        `Personality trait ${name} must be in [${min}, ${max}], received ${value}.`,
      );
    }
  }
  if (!Number.isInteger(traits.cascadeDepth)) {
    throw new RangeError(
      `Personality trait cascadeDepth must be an integer, received ${traits.cascadeDepth}.`,
    );
  }
  const timescales = cascadeTimescalesMs(traits);
  const fastest = timescales[timescales.length - 1]!;
  const floor = MIN_FASTEST_COMPONENT_TICKS * traits.tempoMs;
  if (fastest < floor) {
    throw new RangeError(
      `The fastest cascade component switches every ${fastest.toFixed(1)} ms, below the ` +
        `${floor.toFixed(1)} ms floor set by this market's ${traits.tempoMs} ms tick. It ` +
        `survives a tick with probability ${exp(-traits.tempoMs / fastest).toExponential(2)}, ` +
        `so it is independent noise rather than a rhythm: it pays full kurtosis and buys ` +
        `no autocorrelation. Reduce ` +
        `cascadeDepth (${traits.cascadeDepth}) or cascadeSpacing ` +
        `(${traits.cascadeSpacing}), or lengthen cascadeSpanMs (${traits.cascadeSpanMs}).`,
    );
  }
}

/**
 * Raise a multiplier's log-distance from unity by `spread`.
 *
 * The identity case is short-circuited rather than computed. `exp(1 · ln(0.45))`
 * is not exactly `0.45` in binary floating point, and rounding the calibrated
 * defaults by an ulp would mean the personality system could not reproduce the
 * one configuration a full battery has cleared. Exactness here is the property
 * `personality.test.ts` asserts.
 */
function spreadMultiplier(multiplier: number, spread: number): number {
  if (spread === 1) return multiplier;
  return exp(spread * ln(multiplier));
}

/**
 * The factor `regimeTempo` scales a regime's sojourn by (PH-34).
 *
 * Log-linear on each side of 1, so the trait's whole fence `[0.3, 3]` lands on
 * `[0.7, 1.5]`, the order of the catalogue's thirty assets is kept, and the
 * default trait of exactly 1 is exactly 1 — the default personality still
 * reproduces `DEFAULT_REGIMES` bit for bit.
 */
export const REGIME_DURATION_FACTOR_RANGE = { min: 0.7, max: 1.5 } as const;

export function regimeDurationFactor(regimeTempo: number): number {
  if (regimeTempo === 1) return 1;
  const { min: traitMin, max: traitMax } = TRAIT_BOUNDS.regimeTempo;
  const { min, max } = REGIME_DURATION_FACTOR_RANGE;
  const exponent = regimeTempo < 1 ? ln(min) / ln(traitMin) : ln(max) / ln(traitMax);
  return pow(regimeTempo, exponent);
}

/**
 * The slowest the market may tick on average, in ticks per millisecond: one
 * every two seconds (PH-34, the Human Owner's floor), so a thirty-second
 * contract on the calmest asset in its calmest regime still sees about fifteen.
 */
export const MIN_TICK_RATE_PER_MS = 1 / 2_000;

/**
 * A regime's level relative to normal, with this market's spread applied.
 *
 * `regimeSpread` widens only the levels **above** normal, and through its
 * square root: calm is the Human Owner's floor (×1.2 of the real average) for
 * every asset, and the most violent stress in the catalogue stays within
 * ×3.2–×4.2 of it rather than reaching ×5.
 */
function spreadLevel(regime: VolatilityRegime, spread: number): number {
  const level = relativeRegimeLevel(regime);
  if (level <= 1 || spread === 1) return level;
  return exp(Math.sqrt(spread) * ln(level));
}

/**
 * Expand traits into the engine configuration.
 *
 * Timings, transition weights and hazard shapes are inherited from the
 * calibrated defaults. Only the quantities a personality is *about* — pace,
 * scale, and how far each layer swings — are derived from traits. That keeps the
 * space small enough to gate analytically, and it means an asset cannot
 * accidentally alter the semi-Markov structure that PH-3 validated.
 */
export function expandPersonality(
  traits: PersonalityTraits,
  instrument: InstrumentSpec,
): MarketEngineConfig {
  return { ...personalityConfig(traits), instrument };
}

/**
 * The instrument-independent half of the expansion.
 *
 * Registration needs this: an asset's `logQuantum` is derived from simulating
 * its own behaviour, so the configuration has to exist before the instrument
 * does. Calibration drives the magnitude and arrival stack directly and never
 * touches a lattice.
 */
export function personalityConfig(
  traits: PersonalityTraits,
): Omit<MarketEngineConfig, 'instrument'> {
  assertPersonalityTraits(traits);

  const cascade: CascadeConfig = {
    components: traits.cascadeDepth,
    slowestHazardPerMs: 1 / traits.cascadeSpanMs,
    hazardRatio: traits.cascadeSpacing,
    lowMultiplier: 1 - traits.clustering,
  };

  // The regime layer (PH-34): each level split between tick rate and size at
  // this market's duration coupling, the rate floored at one tick every two
  // seconds, and every sojourn a minimum plus a memoryless remainder scaled by
  // the market's character.
  const minimumActivity = MIN_TICK_RATE_PER_MS * traits.tempoMs * (1 - traits.burstiness);
  const durationFactor = regimeDurationFactor(traits.regimeTempo);
  const regimes = Object.fromEntries(
    VOLATILITY_REGIMES.map((name) => [
      name,
      {
        level: spreadLevel(name, traits.regimeSpread),
        ...splitRegimeLevel(
          spreadLevel(name, traits.regimeSpread),
          traits.durationCoupling,
          minimumActivity,
        ),
        // Multiplication by exactly 1 is exact, so the default personality
        // still reproduces DEFAULT_REGIMES bit for bit.
        minimumMs: REGIME_DURATIONS[name].minimumMs * Math.max(1, durationFactor),
        scaleMs: REGIME_DURATIONS[name].scaleMs * durationFactor,
        shape: 1,
        transitions: REGIME_LADDER[name],
      },
    ]),
  ) as unknown as RegimeConfig;

  const structure = Object.fromEntries(
    (Object.keys(DEFAULT_STRUCTURE) as (keyof StructureConfig)[]).map((name) => [
      name,
      {
        ...DEFAULT_STRUCTURE[name],
        multiplier: spreadMultiplier(DEFAULT_STRUCTURE[name].multiplier, traits.structureSpread),
      },
    ]),
  ) as unknown as StructureConfig;

  const arrival: HawkesConfig = {
    ...DEFAULT_HAWKES,
    baseIntervalMs: traits.tempoMs,
    branchingRatio: traits.burstiness,
    decayPerMs: 1 / traits.arrivalMemoryMs,
  };

  return {
    baseVolatility: traits.volatility,
    cascade,
    regimes,
    structure,
    arrival,
    durationCoupling: traits.durationCoupling,
    volatilityFloor: {
      level: relativeRegimeLevel('compressed'),
      cascadeReference: cascadeTypicalProduct(cascade),
    },
  };
}

// ---------------------------------------------------------------------------
// The analytic volatility-inflation gate
// ---------------------------------------------------------------------------

/**
 * Excess-kurtosis band the realism battery enforces.
 *
 * The upper bound is the one that matters here: three independent multiplier
 * layers compose, so their kurtosis contributions multiply. The lower bound
 * matters too — a market with no fat tails is not realistic either.
 */
export const EXCESS_KURTOSIS_BAND = { min: 1.5, max: 200 } as const;

/** `E[M⁴] / E[M²]²` for a single layer's multiplier. */
function inflation(secondMoment: number, fourthMoment: number): number {
  return fourthMoment / (secondMoment * secondMoment);
}

/**
 * Exact inflation of the cascade.
 *
 * `K` independent components, each two-point on `{m₀, 2−m₀}` with equal
 * probability, so the whole product's ratio is one component's raised to `K`.
 */
function componentInflation(low: number): number {
  const high = 2 - low;
  const low2 = low * low;
  const high2 = high * high;
  const second = (low2 + high2) / 2;
  const fourth = (low2 * low2 + high2 * high2) / 2;
  return inflation(second, fourth);
}

export function cascadeInflation(config: CascadeConfig): number {
  return pow(componentInflation(config.lowMultiplier), config.components);
}

/**
 * One cascade component's inflation, as a function of the clustering trait.
 *
 * `low = 1 − c` and `high = 1 + c`, so this is
 * `(1 + 6c² + c⁴) / (1 + c²)²` — strictly increasing on `[0, 1)`, which is what
 * makes {@link solveClustering}'s bisection sound.
 *
 * Shares {@link componentInflation} with {@link cascadeInflation} rather than
 * re-deriving it, so a personality's solved clustering and its gate reading
 * cannot disagree by a rounding step. Note the direction: this goes
 * clustering → multiplier, never multiplier → clustering. `1 − (1 − c)` is not
 * `c` in binary floating point.
 */
export function cascadeInflationOfClustering(clustering: number): number {
  return componentInflation(1 - clustering);
}

/**
 * Factor by which the cascade multiplies the RMS tick magnitude.
 *
 * Each component has mean 1 but `E[M²] = 1 + c²`, so a deeper cascade produces
 * larger typical moves for the same `volatility` trait. The trait is therefore
 * the *base* scale, not the realised one; this is the difference, and an author
 * choosing a depth should look at it. Lattice calibration derives the published
 * quantum from realised behaviour, so it needs no help — but a realism target
 * expressed in price units does.
 */
export function cascadeRmsGain(traits: PersonalityTraits): number {
  const low = 1 - traits.clustering;
  const high = 2 - low;
  const second = (low * low + high * high) / 2;
  return pow(second, traits.cascadeDepth / 2);
}

/**
 * The Lanczos shift `g + ½` for the nine-coefficient series below, `g = 7`.
 *
 * Kept as the single literal the series was derived with: `shifted + 7.5` and
 * `shifted + 7 + 0.5` are not the same double for every `shifted`, and the
 * coefficients are only valid for this shift.
 */
const LANCZOS_SHIFT = 7.5;

/**
 * Γ(z) for z ≥ 1, by the Lanczos approximation.
 *
 * Only ever called with `1 + 1/shape` for a positive shape, so `z > 1` always
 * (exactly 2 at the regime layer's shape of one since PH-34) and the reflection
 * formula — which would need `Math.sin`, banned here as non-portable — is
 * unreachable.
 */
function gamma(z: number): number {
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  const shifted = z - 1;
  let series = coefficients[0]!;
  for (let i = 1; i < coefficients.length; i += 1) {
    series += coefficients[i]! / (shifted + i);
  }
  const t = shifted + LANCZOS_SHIFT;
  return Math.sqrt(2 * Math.PI) * pow(t, shifted + 0.5) * exp(-t) * series;
}

/**
 * Power-iteration steps for the embedded chain's stationary vector.
 *
 * Four states, irreducible, and the chain mixes in tens of steps; two thousand
 * is far past the point where the vector stops changing at double precision,
 * and costs nothing. Fixed rather than convergence-tested so that the count —
 * and therefore the floating-point result — is identical on every run.
 */
const STATIONARY_POWER_ITERATIONS = 2_000;

/**
 * Exact inflation of the volatility regime layer, per tick.
 *
 * The regime is a semi-Markov chain, so the fraction of *time* spent in a state
 * is not its embedded-chain probability: it is that probability weighted by mean
 * sojourn, `minimum + scale · Γ(1 + 1/shape)`.
 *
 * And since PH-34 the fraction of **ticks** is not the fraction of time: a
 * regime at activity `a` produces `a` times as many ticks per unit time, so the
 * per-tick distribution weights each regime by time × activity. That is the
 * distribution the kurtosis of a tick return is a moment of.
 */
export function regimeInflation(config: RegimeConfig): number {
  let second = 0;
  let fourth = 0;
  for (const regime of regimeTickWeights(config)) {
    const squared = regime.multiplier * regime.multiplier;
    second += regime.weight * squared;
    fourth += regime.weight * squared * squared;
  }
  return inflation(second, fourth);
}

/**
 * Each regime's share of **ticks**, with the level and multiplier it sizes
 * them at: time occupancy of the semi-Markov chain, weighted by activity.
 */
function regimeTickWeights(
  config: RegimeConfig,
  per: 'tick' | 'time' = 'tick',
): readonly { readonly level: number; readonly multiplier: number; readonly weight: number }[] {
  const rows = VOLATILITY_REGIMES.map((name) => {
    const weights = config[name].transitions;
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight) => weight / total);
  });

  // Stationary vector of the embedded chain, by power iteration. The chain is
  // small and irreducible, so this converges quickly and needs no linear algebra.
  let embedded = VOLATILITY_REGIMES.map(() => 1 / VOLATILITY_REGIMES.length);
  for (let iteration = 0; iteration < STATIONARY_POWER_ITERATIONS; iteration += 1) {
    embedded = embedded.map((_, target) =>
      embedded.reduce((sum, mass, source) => sum + mass * rows[source]![target]!, 0),
    );
  }

  const meanSojourn = VOLATILITY_REGIMES.map(
    (name) => config[name].minimumMs + config[name].scaleMs * gamma(1 + 1 / config[name].shape),
  );
  const weighted = embedded.map(
    (mass, index) =>
      mass *
      meanSojourn[index]! *
      (per === 'tick' ? config[VOLATILITY_REGIMES[index]!].activity : 1),
  );
  const total = weighted.reduce((sum, value) => sum + value, 0);
  return VOLATILITY_REGIMES.map((name, index) => ({
    level: config[name].level,
    multiplier: config[name].multiplier,
    weight: weighted[index]! / total,
  }));
}

/** Steps used to estimate the structure layer's inflation. */
export const STRUCTURE_INFLATION_STEPS = 400_000;

/**
 * The fixed inputs the structure estimator drives its modulator with.
 *
 * The estimate is of the multiplier's fourth-to-second moment ratio under the
 * phase process alone, so the modulator is fed a metronome: one tick a second,
 * every tick the same size, from a fixed epoch. **The magnitude is
 * load-bearing** even though its value is not — a constant path rate makes the
 * compression term's tightness exactly 1 on every tick, so the estimate is of
 * the phase multipliers under age-driven transitions only. Any positive constant
 * gives that; ten matches the engine's own starting `referenceMagnitude`, and
 * changing it would move the result by floating-point ulps, which is a
 * different registered kurtosis for every asset in the catalogue.
 */
const STRUCTURE_PROBE_INTERVAL_MS = 1_000;
const STRUCTURE_PROBE_MAGNITUDE = 10;
const STRUCTURE_PROBE_EPOCH_MS = 1_776_000_000_000;

/**
 * Inflation of the structural phase layer, by simulating that layer alone.
 *
 * Its hazard depends on phase age and on how compressed the path has been, so
 * there is no tractable closed form. Simulating one modulator is cheap — no
 * prices, no signs, no engine — and deterministic given the stream.
 */
export function structureInflation(
  config: StructureConfig,
  stream: RandomSource,
  steps: number = STRUCTURE_INFLATION_STEPS,
): number {
  const modulator = new StructurePhaseModulator(config, stream);
  const intervalMs = STRUCTURE_PROBE_INTERVAL_MS;
  let instant = STRUCTURE_PROBE_EPOCH_MS;
  let second = 0;
  let fourth = 0;
  for (let step = 0; step < steps; step += 1) {
    instant += intervalMs;
    const multiplier = modulator.advance({
      intervalMs,
      previousMagnitude: STRUCTURE_PROBE_MAGNITUDE,
      instant: epochMillis(instant),
      sequence: step,
    });
    const squared = multiplier * multiplier;
    second += squared;
    fourth += squared * squared;
  }
  return inflation(second / steps, fourth / steps);
}

/** One state of a layer's stationary distribution: its multiplier and weight. */
interface LayerAtom {
  readonly multiplier: number;
  readonly weight: number;
}

/**
 * The structure layer's stationary distribution, by the same simulation
 * {@link structureInflation} runs: the share of time spent at each phase
 * multiplier. The floor needs the distribution, not only its moments, because
 * it acts on the product of the layers rather than on each one.
 */
export function structureDistribution(
  config: StructureConfig,
  stream: RandomSource,
  steps: number = STRUCTURE_INFLATION_STEPS,
): readonly LayerAtom[] {
  const modulator = new StructurePhaseModulator(config, stream);
  const intervalMs = STRUCTURE_PROBE_INTERVAL_MS;
  let instant = STRUCTURE_PROBE_EPOCH_MS;
  const counts = new Map<number, number>();
  for (let step = 0; step < steps; step += 1) {
    instant += intervalMs;
    const multiplier = modulator.advance({
      intervalMs,
      previousMagnitude: STRUCTURE_PROBE_MAGNITUDE,
      instant: epochMillis(instant),
      sequence: step,
    });
    counts.set(multiplier, (counts.get(multiplier) ?? 0) + 1);
  }
  // Sorted, so the summation order — and therefore the last bit of every
  // moment built from it — does not depend on which phase was visited first.
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([multiplier, count]) => ({ multiplier, weight: count / steps }));
}

/** Binomial coefficient, exactly for the cascade depths `TRAIT_BOUNDS` allows. */
function binomial(n: number, k: number): number {
  let value = 1;
  for (let i = 1; i <= k; i += 1) value = (value * (n - k + i)) / i;
  return value;
}

/**
 * The per-tick fourth-to-second moment ratio of the three layers together,
 * with the volatility floor applied (PH-34).
 *
 * Exact enumeration rather than a product of per-layer ratios, because the
 * floor acts on the **product** of the layers' levels: a cascade state is
 * lifted in a compressed regime and not in a stressed one, so the layers stop
 * being separable the moment a floor exists. Every layer's stationary
 * distribution is known — the regime's semi-Markov occupancy, weighted by
 * activity because a tick return is sampled per tick; the cascade's
 * independent two-point components, a binomial; the structure phases from
 * their own simulation — and the three are independent processes, so the
 * joint distribution is their product and the sum over it is exact.
 *
 * With no floor this is exactly {@link cascadeInflation} ×
 * {@link regimeInflation} × the structure layer's own ratio: moments of a
 * product of independent variables factorise.
 */
export function layeredInflation(
  config: Omit<MarketEngineConfig, 'instrument'>,
  structure: readonly LayerAtom[],
): number {
  const regimes = regimeTickWeights(config.regimes);
  const { components, lowMultiplier } = config.cascade;
  const high = 2 - lowMultiplier;
  const floor = config.volatilityFloor;
  let total = 0;
  let second = 0;
  let fourth = 0;
  for (const regime of regimes) {
    for (let up = 0; up <= components; up += 1) {
      const cascade = pow(high, up) * pow(lowMultiplier, components - up);
      const cascadeWeight = binomial(components, up) / pow(2, components);
      for (const phase of structure) {
        const weight = regime.weight * cascadeWeight * phase.weight;
        let lift = 1;
        if (floor !== null) {
          const level = regime.level * (cascade / floor.cascadeReference) * phase.multiplier;
          if (level < floor.level) lift = floor.level / level;
        }
        const m = regime.multiplier * cascade * phase.multiplier * lift;
        const squared = m * m;
        total += weight;
        second += weight * squared;
        fourth += weight * squared * squared;
      }
    }
  }
  return inflation(second / total, fourth / total);
}

/**
 * The time-average of the regime layer's activity: how much faster than its
 * base tempo a market ticks on average, over the regimes' occupancy (PH-34).
 */
export function meanRegimeActivity(config: RegimeConfig): number {
  let mean = 0;
  VOLATILITY_REGIMES.forEach((name, index) => {
    mean += regimeTickWeights(config, 'time')[index]!.weight * config[name].activity;
  });
  return mean;
}

/**
 * How much more the OTC market moves than the real instrument, on average
 * (PH-34): a seat's reference dispersion times this is the budget the
 * calibration rescales to — exactly, for every asset.
 *
 * **1.7, the Human Owner's number** (2026-09-22). It was first derived from
 * the layered model, typical against typical — calm 20% above the real
 * market's ordinary day, normal 50% — and measured over sixty simulated days
 * per asset that put the whole market at 2.0× the real one (1.45–2.48), calm's
 * typical five minutes at 1.6× a real ordinary day's: the floor and the
 * structure phases raise the typical level more than the analytic estimate
 * saw. Put to them with both anchors, the Human Owner chose the market as a
 * whole at 1.7×. Calm's typical five minutes then sit near 1.4× the real
 * market's ordinary day, and its quietest tenth near the ordinary day itself.
 */
export const OTC_DISPERSION_FACTOR = 1.7;

/**
 * Predicted excess kurtosis of the increment distribution.
 *
 * Increments are `x = s · m` with an independent fair sign, so
 * `kurtosis(x) = E[m⁴] / E[m²]²` exactly — no normality is assumed anywhere.
 * The layers are independent multipliers, so that ratio factorises across them,
 * and the leading 3 is the base half-normal draw's own contribution.
 *
 * This is analytic on purpose. Measuring kurtosis by simulation is not a usable
 * gate: the fourth moment of a heavy-tailed variable converges from below, so a
 * sample estimate is an underestimate whose severity depends on how long you
 * ran. On the default configuration it reads 27.2 at 200k samples and 62.3 at
 * 1M — a gate built on it would pass exactly the configurations that stay quiet
 * in a short test.
 */
export function predictedExcessKurtosis(
  config: Omit<MarketEngineConfig, 'instrument'>,
  stream: RandomSource,
): number {
  if (config.volatilityFloor !== null) {
    return 3 * layeredInflation(config, structureDistribution(config.structure, stream)) - 3;
  }
  const product =
    cascadeInflation(config.cascade) *
    regimeInflation(config.regimes) *
    structureInflation(config.structure, stream);
  return 3 * product - 3;
}

/**
 * The one solve failure a lower target can fix.
 *
 * {@link solveClustering} refuses three ways: the regime and structure layers
 * alone already exceed the target, the target needs more cascade inflation than
 * the clustering bound can provide, and — through `assertPersonalityTraits` on
 * the result — a solved volatility outside its bounds. Only the second is about
 * the *target*. **Cycle Audit 7, a3-12.** `brief.ts` retreated the target on
 * every error, six times, at a fresh structure simulation each: for the first
 * kind a lower target makes the refusal worse, and for the third it is
 * irrelevant. This type is how the brief tells the one it can act on from the
 * two it must report.
 */
export class TailWeightUnreachableError extends RangeError {
  override readonly name = 'TailWeightUnreachableError';
}

/**
 * Bisection steps for the clustering solve.
 *
 * Monotone on `[0, ceiling]`, so about sixty halvings reach the last
 * representable step; a hundred is fixed rather than tolerance-driven so the
 * count, and with it the solved bits, are the same on every run.
 */
const CLUSTERING_BISECTION_STEPS = 100;

/**
 * The `clustering` that puts this personality at a target excess kurtosis.
 *
 * Depth is an exponent on the cascade's kurtosis contribution, so varying it —
 * which is the whole point of PH-10 — moves the tail hard unless clustering
 * moves with it. This does that arithmetic, so a catalogue can be authored as
 * "these assets have different rhythms and comparable tails" rather than as a
 * search for combinations the gate happens to accept.
 *
 * Cheap because of the neutrality results in PH-10.1 §4: neither the regime
 * layer nor the structure layer depends on clustering, so the expensive half of
 * {@link predictedExcessKurtosis} — a 400k-step simulation — is evaluated once
 * and the search runs over a closed form.
 *
 * Bisection rather than the quadratic's closed form is deliberate. Solving
 * `(1 + 6u + u²) = t(1 + u)²` for `u = c²` gives a quadratic whose leading
 * coefficient changes sign at `t = 1` and which has two roots, only one of them
 * admissible. A root-selection error there would be silent, and would produce a
 * personality that misses its target while reporting success. A monotone
 * bisection cannot select the wrong root.
 *
 * Throws rather than clamping when the target is out of reach. A clamped solve
 * returns a plausible number that is not the answer, which is precisely the
 * class of failure the analytic gate exists to make impossible.
 *
 * @param traits Every other trait; the incoming `clustering` is ignored.
 * @param targetExcessKurtosis Excess kurtosis the personality should predict.
 * @param stream Drives the structure layer's simulation. **Load-bearing**: the
 *   structure layer has no closed form, so `predictedExcessKurtosis` is a
 *   simulation estimate and the solve is exact only with respect to the stream it
 *   was given. Solving against one stream and verifying against another lands
 *   within that estimator's noise — around 1% — not at the target. A catalogue
 *   must therefore derive this stream from a recorded label and record it, which
 *   is what makes a registered asset's tail weight reproducible.
 */
export function solveClustering(
  traits: PersonalityTraits,
  targetExcessKurtosis: number,
  stream: RandomSource,
): number {
  if (!Number.isFinite(targetExcessKurtosis) || targetExcessKurtosis <= 0) {
    throw new RangeError(
      `Target excess kurtosis must be finite and positive, received ${targetExcessKurtosis}.`,
    );
  }
  const config = personalityConfig(traits);
  if (config.volatilityFloor !== null) {
    return solveClusteringWithFloor(traits, targetExcessKurtosis, stream);
  }
  const fixed = regimeInflation(config.regimes) * structureInflation(config.structure, stream);
  const requiredCascade = (targetExcessKurtosis + 3) / (3 * fixed);

  if (requiredCascade < 1) {
    throw new RangeError(
      `The regime and structure layers alone predict an excess kurtosis of ` +
        `${(3 * fixed - 3).toFixed(2)}, already above the target of ` +
        `${targetExcessKurtosis}. No clustering can reach it: the cascade can only ` +
        `add tail weight. Lower regimeSpread or structureSpread.`,
    );
  }

  const perComponent = pow(requiredCascade, 1 / traits.cascadeDepth);
  const ceiling: number = TRAIT_BOUNDS.clustering.max;
  if (cascadeInflationOfClustering(ceiling) < perComponent) {
    throw new TailWeightUnreachableError(
      `An excess kurtosis of ${targetExcessKurtosis} needs more cascade inflation than ` +
        `clustering ${ceiling} can provide at depth ${traits.cascadeDepth}. Raise ` +
        `cascadeDepth, or raise regimeSpread so another layer carries some of the tail.`,
    );
  }

  let low = 0;
  let high = ceiling;
  for (let iteration = 0; iteration < CLUSTERING_BISECTION_STEPS; iteration += 1) {
    const middle = (low + high) / 2;
    if (cascadeInflationOfClustering(middle) < perComponent) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * The clustering solve when a volatility floor couples the layers (PH-34).
 *
 * The floor makes the cascade's contribution depend on the regime and the
 * structure phase it multiplies, so the required cascade inflation can no
 * longer be divided out of a product. The solve bisects clustering against
 * {@link layeredInflation} instead, on one structure distribution drawn from
 * `stream` — the distribution does not depend on clustering, so the bisection
 * is exact with respect to it, as the unfloored solve is with respect to its
 * stream. The predicted kurtosis rises with clustering: a wider cascade adds
 * tail above the floor faster than the floor removes it below
 * (`personality.test.ts` checks it on the catalogue's own traits).
 */
function solveClusteringWithFloor(
  traits: PersonalityTraits,
  targetExcessKurtosis: number,
  stream: RandomSource,
): number {
  const structure = structureDistribution(personalityConfig(traits).structure, stream);
  const predictedAt = (clustering: number): number =>
    3 * layeredInflation(personalityConfig({ ...traits, clustering }), structure) - 3;
  const ceiling: number = TRAIT_BOUNDS.clustering.max;
  const least = predictedAt(0);
  if (least > targetExcessKurtosis) {
    throw new RangeError(
      `The regime and structure layers alone predict an excess kurtosis of ` +
        `${least.toFixed(2)}, already above the target of ${targetExcessKurtosis}. No ` +
        `clustering can reach it: the cascade can only add tail weight. Lower ` +
        `regimeSpread or structureSpread.`,
    );
  }
  if (predictedAt(ceiling) < targetExcessKurtosis) {
    throw new TailWeightUnreachableError(
      `An excess kurtosis of ${targetExcessKurtosis} needs more cascade inflation than ` +
        `clustering ${ceiling} can provide at depth ${traits.cascadeDepth} above the ` +
        `volatility floor. Raise cascadeDepth, or raise regimeSpread so another layer ` +
        `carries some of the tail.`,
    );
  }
  let low = 0;
  let high = ceiling;
  for (let iteration = 0; iteration < CLUSTERING_BISECTION_STEPS; iteration += 1) {
    const middle = (low + high) / 2;
    if (predictedAt(middle) < targetExcessKurtosis) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** A personality authored from targets, with what it actually achieved. */
export interface AuthoredPersonality {
  readonly traits: PersonalityTraits;
  /** What the gate predicts for {@link AuthoredPersonality.traits}. */
  readonly achievedExcessKurtosis: number;
  /** RMS per-tick magnitude contributed by base volatility and the cascade. */
  readonly tickRms: number;
}

/**
 * Author a personality from a rhythm and two targets.
 *
 * The two traits that cannot be chosen independently of the rhythm are solved
 * for rather than guessed:
 *
 *  - `clustering`, because cascade depth is an exponent on tail weight
 *    ({@link solveClustering});
 *  - `volatility`, because a deeper cascade produces larger typical moves for
 *    the same base scale ({@link cascadeRmsGain}). Left alone, changing an
 *    asset's rhythm would silently change its amplitude, and the differentiation
 *    that produced would be the trivial kind PH-10 exists to stop claiming.
 *
 * `derive` is called more than once with the same purpose and must return
 * equivalent fresh streams each time — the counter-addressable sources of
 * ADR-0002 do. The solve is exact only with respect to that stream, so the
 * returned {@link AuthoredPersonality.achievedExcessKurtosis} is what the asset
 * records. Recording the *target* would be publishing a number nothing computed.
 */
export function authorPersonality(
  base: PersonalityTraits,
  targets: { readonly excessKurtosis: number; readonly tickRms: number },
  derive: (purpose: string) => RandomSource,
): AuthoredPersonality {
  if (!(targets.tickRms > 0) || !Number.isFinite(targets.tickRms)) {
    throw new RangeError(
      `Target tick RMS must be finite and positive, received ${targets.tickRms}.`,
    );
  }
  const clustering = solveClustering(base, targets.excessKurtosis, derive('kurtosis'));
  const shaped = { ...base, clustering };
  const traits: PersonalityTraits = {
    ...shaped,
    volatility: targets.tickRms / cascadeRmsGain(shaped),
  };
  assertPersonalityTraits(traits);
  return {
    traits,
    achievedExcessKurtosis: predictedExcessKurtosis(personalityConfig(traits), derive('kurtosis')),
    tickRms: traits.volatility * cascadeRmsGain(traits),
  };
}

/**
 * Reject a personality whose layers would compound outside the realism band.
 *
 * PH-3 discovered this class of defect by running a ten-minute simulation and
 * then recalibrating four times. This decides it in microseconds, before the
 * asset is registered.
 */
export function assertPersonalitySafe(
  config: Omit<MarketEngineConfig, 'instrument'>,
  stream: RandomSource,
): number {
  const predicted = predictedExcessKurtosis(config, stream);
  if (predicted > EXCESS_KURTOSIS_BAND.max) {
    throw new RangeError(
      `Personality would compound to an excess kurtosis of ${predicted.toFixed(1)}, ` +
        `above the realism ceiling of ${EXCESS_KURTOSIS_BAND.max}. The volatility layers ` +
        `multiply: reduce clustering, regimeSpread or structureSpread.`,
    );
  }
  if (predicted < EXCESS_KURTOSIS_BAND.min) {
    throw new RangeError(
      `Personality would compound to an excess kurtosis of ${predicted.toFixed(2)}, ` +
        `below the realism floor of ${EXCESS_KURTOSIS_BAND.min}. A market with no fat ` +
        `tails is not realistic either: raise clustering or regimeSpread.`,
    );
  }
  // Returned so a registration can record what it checked without paying for the
  // structure simulation twice.
  return predicted;
}
