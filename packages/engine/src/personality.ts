import { epochMillis, exp, ln, pow, type RandomSource } from '@otc/core';
import type { InstrumentSpec } from '@otc/core';
import { DEFAULT_CASCADE, type CascadeConfig } from './cascade.js';
import { DEFAULT_HAWKES, type HawkesConfig } from './hawkes.js';
import { DEFAULT_REGIMES, VOLATILITY_REGIMES, type RegimeConfig } from './regime.js';
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
   * Scalar on every volatility regime's sojourn scale.
   *
   * Above 1, this market holds a regime longer; below 1, it changes character
   * more often. Exactly tail-neutral: see {@link regimeInflation}.
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

  const regimes = Object.fromEntries(
    VOLATILITY_REGIMES.map((name) => [
      name,
      {
        ...DEFAULT_REGIMES[name],
        multiplier: spreadMultiplier(DEFAULT_REGIMES[name].multiplier, traits.regimeSpread),
        // Multiplication by exactly 1 is exact, so the default personality still
        // reproduces DEFAULT_REGIMES bit for bit.
        scaleMs: DEFAULT_REGIMES[name].scaleMs * traits.regimeTempo,
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
 * Γ(z) for z ≥ 1, by the Lanczos approximation.
 *
 * Only ever called with `1 + 1/shape`, and shape is bounded below 1 from above
 * by the regime configuration, so `z > 1.5` always and the reflection formula —
 * which would need `Math.sin`, banned here as non-portable — is unreachable.
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
  const t = shifted + 7.5;
  return Math.sqrt(2 * Math.PI) * pow(t, shifted + 0.5) * exp(-t) * series;
}

/**
 * Exact inflation of the volatility regime layer.
 *
 * The regime is a semi-Markov chain, so the fraction of *time* spent in a state
 * is not its embedded-chain probability: it is that probability weighted by mean
 * sojourn. Weibull sojourns have mean `scale · Γ(1 + 1/shape)`.
 */
export function regimeInflation(config: RegimeConfig): number {
  const rows = VOLATILITY_REGIMES.map((name) => {
    const weights = config[name].transitions;
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight) => weight / total);
  });

  // Stationary vector of the embedded chain, by power iteration. The chain is
  // small and irreducible, so this converges quickly and needs no linear algebra.
  let embedded = VOLATILITY_REGIMES.map(() => 1 / VOLATILITY_REGIMES.length);
  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    embedded = embedded.map((_, target) =>
      embedded.reduce((sum, mass, source) => sum + mass * rows[source]![target]!, 0),
    );
  }

  const meanSojourn = VOLATILITY_REGIMES.map(
    (name) => config[name].scaleMs * gamma(1 + 1 / config[name].shape),
  );
  const weighted = embedded.map((mass, index) => mass * meanSojourn[index]!);
  const total = weighted.reduce((sum, value) => sum + value, 0);
  const stationary = weighted.map((value) => value / total);

  let second = 0;
  let fourth = 0;
  VOLATILITY_REGIMES.forEach((name, index) => {
    const multiplier = config[name].multiplier;
    const squared = multiplier * multiplier;
    second += stationary[index]! * squared;
    fourth += stationary[index]! * squared * squared;
  });
  return inflation(second, fourth);
}

/** Steps used to estimate the structure layer's inflation. */
export const STRUCTURE_INFLATION_STEPS = 400_000;

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
  const intervalMs = 1_000;
  let instant = 1_776_000_000_000;
  let second = 0;
  let fourth = 0;
  for (let step = 0; step < steps; step += 1) {
    instant += intervalMs;
    const multiplier = modulator.advance({
      intervalMs,
      previousMagnitude: 10,
      instant: epochMillis(instant),
      sequence: step,
    });
    const squared = multiplier * multiplier;
    second += squared;
    fourth += squared * squared;
  }
  return inflation(second / steps, fourth / steps);
}

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
  const product =
    cascadeInflation(config.cascade) *
    regimeInflation(config.regimes) *
    structureInflation(config.structure, stream);
  return 3 * product - 3;
}

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
    throw new RangeError(
      `An excess kurtosis of ${targetExcessKurtosis} needs more cascade inflation than ` +
        `clustering ${ceiling} can provide at depth ${traits.cascadeDepth}. Raise ` +
        `cascadeDepth, or raise regimeSpread so another layer carries some of the tail.`,
    );
  }

  // Monotone on [0, ceiling]; ~60 halvings reach the last representable step, and
  // 100 costs nothing.
  let low = 0;
  let high = ceiling;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (low + high) / 2;
    if (cascadeInflationOfClustering(middle) < perComponent) low = middle;
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
