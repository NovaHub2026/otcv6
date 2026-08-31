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
} as const satisfies Record<keyof PersonalityTraits, { min: number; max: number }>;

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

  const cascade: CascadeConfig = { ...DEFAULT_CASCADE, lowMultiplier: 1 - traits.clustering };

  const regimes = Object.fromEntries(
    VOLATILITY_REGIMES.map((name) => [
      name,
      {
        ...DEFAULT_REGIMES[name],
        multiplier: spreadMultiplier(DEFAULT_REGIMES[name].multiplier, traits.regimeSpread),
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
export function cascadeInflation(config: CascadeConfig): number {
  const low = config.lowMultiplier;
  const high = 2 - low;
  const low2 = low * low;
  const high2 = high * high;
  const second = (low2 + high2) / 2;
  const fourth = (low2 * low2 + high2 * high2) / 2;
  return pow(inflation(second, fourth), config.components);
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
export function predictedExcessKurtosis(config: MarketEngineConfig, stream: RandomSource): number {
  const product =
    cascadeInflation(config.cascade) *
    regimeInflation(config.regimes) *
    structureInflation(config.structure, stream);
  return 3 * product - 3;
}

/**
 * Reject a personality whose layers would compound outside the realism band.
 *
 * PH-3 discovered this class of defect by running a ten-minute simulation and
 * then recalibrating four times. This decides it in microseconds, before the
 * asset is registered.
 */
export function assertPersonalitySafe(config: MarketEngineConfig, stream: RandomSource): number {
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
