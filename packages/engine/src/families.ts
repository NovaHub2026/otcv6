import { pow, type AssetFamily, type RandomSource } from '@otc/core';
import { DISPERSION_WINDOW_MS } from './dispersion.js';
import {
  cascadeInflation,
  cascadeRmsGain,
  MIN_FASTEST_COMPONENT_TICKS,
  personalityConfig,
  regimeInflation,
  structureInflation,
  TRAIT_BOUNDS,
  type PersonalityTraits,
} from './personality.js';

/**
 * Families as **anchors**, not templates.
 *
 * The catalogue has to reach fifty to a hundred assets, and there are two ways
 * to get there. Copying five personalities twenty times each is one of them, and
 * it produces a hundred charts that are genuinely different — the asset id
 * enters the key derivation (ADR-0002), so identical traits under different ids
 * share no prices at all. It also makes INV-007 false as written: assets have
 * *genuinely distinct statistical personalities*, and twenty copies of one
 * personality are statistically one asset with twenty names.
 *
 * So an archetype is a **region**, and every asset is a fresh draw from it.
 * Nothing is copied. Two assets from the same archetype differ in tempo, in
 * cascade depth, in how long their volatility remembers, and in how far they
 * diffuse — while still reading as the same kind of market, which is the thing
 * families are for.
 *
 * ## What an archetype fixes
 *
 * The two traits that cannot be chosen independently of the rhythm —
 * `clustering` and `volatility` — are absent from every range below. They are
 * solved: `clustering` from the sampled tail-weight target, `volatility` from
 * the sampled dispersion budget. Sampling them directly is how PH-3 reached an
 * excess kurtosis of 1366.
 *
 * ## The dispersion budget
 *
 * A quarter's spread, in log units, sampled per asset from the archetype's band.
 * This is the answer to "an asset must not run away": not a price ceiling, which
 * would make `P(down) > P(up)` near the bound and hand an observer a rule, but a
 * diffusion rate chosen before the asset exists and blind to every price it will
 * ever print. See `dispersion.ts`.
 *
 * The bands span a factor of forty, from an index that moves 1.5% in a quarter
 * to an alt-coin that moves 65%, because that range is what makes a catalogue
 * feel like a market rather than a set of skins.
 */

export interface Range {
  readonly min: number;
  readonly max: number;
}

/** The traits an archetype samples. `clustering` and `volatility` are solved. */
export type SampledTraitRanges = {
  readonly [K in Exclude<keyof PersonalityTraits, 'clustering' | 'volatility'>]: Range;
};

export interface AssetArchetype {
  /** Stable slug, used in documentation and in the admin surface. */
  readonly id: string;
  readonly label: string;
  /** The core family an asset drawn from this archetype belongs to. */
  readonly family: AssetFamily;
  /** One-line character, for an operator choosing between them. */
  readonly character: string;
  /** σ of the terminal log return over a quarter. See `dispersion.ts`. */
  readonly dispersion: Range;
  /** Target excess kurtosis, which `clustering` is solved to reach. */
  readonly excessKurtosis: Range;
  readonly traits: SampledTraitRanges;
}

/**
 * Margin over {@link MIN_FASTEST_COMPONENT_TICKS} when the spacing is clamped.
 *
 * The fastest cascade component must not be faster than half a tick, and the
 * constraint couples four traits — span, spacing, depth and tempo — so a box of
 * independent ranges cannot satisfy it at every corner. Rather than refuse the
 * corners, {@link sampleTraits} narrows the spacing range to the feasible part
 * and samples uniformly inside that. The margin keeps a sample off the boundary,
 * where a rounding difference would decide validity.
 */
export const SPACING_FEASIBILITY_MARGIN = 1.25;

/** The largest hazard ratio that keeps the fastest component slow enough. */
export function spacingCeiling(spanMs: number, depth: number, tempoMs: number): number {
  if (depth <= 1) return TRAIT_BOUNDS.cascadeSpacing.max;
  const slowestPermittedFastest =
    MIN_FASTEST_COMPONENT_TICKS * SPACING_FEASIBILITY_MARGIN * tempoMs;
  return pow(spanMs / slowestPermittedFastest, 1 / (depth - 1));
}

/**
 * A starting `clustering` that is safe for any rhythm, before the solve.
 *
 * The safety gate runs on the traits as submitted, ahead of the solve, because
 * it costs microseconds and the solve costs a second — so a sampled personality
 * has to arrive already inside the realism band even though its `clustering` is
 * about to be replaced.
 *
 * A per-component two-point multiplier on `{1 − c, 1 + c}` contributes `1 + c²`
 * to the variance ratio, and depth is an exponent on it. Holding
 * `(1 + c²)^depth` at a constant therefore keeps the cascade's contribution flat
 * across every depth in range. The constant is 1.6, which is where the five
 * hand-authored assets sit (1.36 to 1.79) at tail weights from 42 to 150.
 */
export const STARTING_CASCADE_INFLATION = 1.6;

export function startingClustering(depth: number): number {
  return Math.sqrt(pow(STARTING_CASCADE_INFLATION, 1 / depth) - 1);
}

/**
 * Margin between the reachable tail weight and the one a sample may ask for.
 *
 * `solveClustering` bisects, and the analytic gate it bisects against is itself
 * estimated by simulation, so a target sitting exactly on the ceiling is a
 * target the solve reaches only on the stream that measured it. Five per cent
 * is enough that a draw survives being solved against a different one.
 */
export const KURTOSIS_HEADROOM = 0.95;

/**
 * Steps behind the ceiling estimate.
 *
 * A twentieth of what `predictedExcessKurtosis` uses by default, because this is
 * a *ceiling* with five per cent of headroom under it rather than a number
 * anything is solved to. At the full 400,000 steps sampling an asset cost about
 * 120 ms and a unit test drawing 240 of them timed out; at 20,000 the ceiling
 * moves by well under the headroom and a draw is free again.
 */
export const CEILING_INFLATION_STEPS = 20_000;

/** The largest excess kurtosis this rhythm can reach, at maximum clustering. */
export function reachableExcessKurtosis(traits: PersonalityTraits, stream: RandomSource): number {
  const config = personalityConfig({ ...traits, clustering: TRAIT_BOUNDS.clustering.max });
  const product =
    cascadeInflation(config.cascade) *
    regimeInflation(config.regimes) *
    structureInflation(config.structure, stream, CEILING_INFLATION_STEPS);
  return 3 * product - 3;
}

function uniform(stream: RandomSource, range: Range): number {
  return range.min + stream.nextFloat64() * (range.max - range.min);
}

/**
 * Uniform on a logarithmic scale.
 *
 * For a trait that is a *time* — tempo, cascade span, arrival memory — the
 * meaningful distance between 30 seconds and 60 is the same as between 5 minutes
 * and 10. Sampling those linearly would crowd every asset against the top of the
 * range.
 */
function logUniform(stream: RandomSource, range: Range): number {
  const t = stream.nextFloat64();
  return range.min * pow(range.max / range.min, t);
}

function integerUniform(stream: RandomSource, range: Range): number {
  const span = Math.round(range.max) - Math.round(range.min) + 1;
  return Math.round(range.min) + stream.nextBoundedUint32(span);
}

/** Draw one personality from an archetype's region. */
export function sampleTraits(archetype: AssetArchetype, stream: RandomSource): PersonalityTraits {
  const ranges = archetype.traits;
  const tempoMs = logUniform(stream, ranges.tempoMs);
  const cascadeDepth = integerUniform(stream, ranges.cascadeDepth);
  const cascadeSpanMs = logUniform(stream, ranges.cascadeSpanMs);
  const ceiling = spacingCeiling(cascadeSpanMs, cascadeDepth, tempoMs);
  const cascadeSpacing = uniform(stream, {
    min: ranges.cascadeSpacing.min,
    max: Math.min(ranges.cascadeSpacing.max, ceiling),
  });
  return {
    tempoMs,
    volatility: 1e-5,
    clustering: startingClustering(cascadeDepth),
    burstiness: uniform(stream, ranges.burstiness),
    regimeSpread: uniform(stream, ranges.regimeSpread),
    structureSpread: uniform(stream, ranges.structureSpread),
    durationCoupling: uniform(stream, ranges.durationCoupling),
    cascadeDepth,
    cascadeSpanMs,
    cascadeSpacing,
    regimeTempo: uniform(stream, ranges.regimeTempo),
    arrivalMemoryMs: logUniform(stream, ranges.arrivalMemoryMs),
  };
}

/**
 * A first guess at the base volatility that reaches a dispersion target.
 *
 * Only a guess, and it does not have to be a good one: `registerAsset` measures
 * what the personality actually diffuses at and rescales exactly, because the
 * calibration is homogeneous of degree one in this trait. What it buys is a
 * calibration that runs at a sane scale, so the correction is a factor near one
 * rather than a factor of a thousand.
 *
 * The Hawkes mean interval is `tempo × (1 − burstiness)`; the remaining layers —
 * regime, structure, duration coupling — raise the realised spread by something
 * between 1.2 and 1.6, which is exactly why this is a guess and not a formula.
 */
export function provisionalTickRms(traits: PersonalityTraits, dispersion: number): number {
  const meanIntervalMs = traits.tempoMs * (1 - traits.burstiness);
  return dispersion / Math.sqrt(DISPERSION_WINDOW_MS / meanIntervalMs);
}

export interface ArchetypeSample {
  readonly traits: PersonalityTraits;
  readonly excessKurtosis: number;
  readonly tickRms: number;
  /** σ of the terminal log return over a quarter, the asset is fitted to. */
  readonly dispersion: number;
  /**
   * The archetype's tail-weight floor, present only when the rhythm just drawn
   * cannot reach it and {@link ArchetypeSample.excessKurtosis} therefore sits
   * *below* the family's own band.
   *
   * **Cycle Audit 7, a3-05.** The clamp below did this silently for one
   * `alt-crypto` draw in twenty, by up to 27%, and nothing downstream could
   * tell a draw the family asked for from one the rhythm imposed. The record
   * now says so; `families.test.ts` measures how often it has to.
   */
  readonly clampedFrom?: number;
}

/** Draw a complete authoring brief: a personality, a tail weight, a budget. */
export function sampleArchetype(archetype: AssetArchetype, stream: RandomSource): ArchetypeSample {
  const traits = sampleTraits(archetype, stream);
  // The tail weight the *rhythm just drawn* can actually reach.
  //
  // **Cycle Audit 6, CA6-24.** `alt-crypto` draws a target in [130, 165] and a
  // cascade depth in [5, 8], and at depth 5 the cascade cannot supply that much
  // inflation however wide its components are: 3.64% of its briefs could not be
  // authored at all, so `registerAsset` refused them at stage `authoring`.
  // P(a 12-asset draw hits one) is 36% — better than one in three builds of the
  // hundred-asset catalogue this exists for, failing outright. The acceptance
  // survived only because its first three draws happened to be feasible.
  //
  // Clamped the way `cascadeSpacing` already is, rather than refused: the
  // ceiling is computed from this personality with `clustering` at its own upper
  // bound, which is exactly what the solve would be searching against.
  const ceiling = reachableExcessKurtosis(traits, stream) * KURTOSIS_HEADROOM;
  const excessKurtosis = uniform(stream, {
    min: Math.min(archetype.excessKurtosis.min, ceiling),
    max: Math.min(archetype.excessKurtosis.max, ceiling),
  });
  const dispersion = logUniform(stream, archetype.dispersion);
  return {
    traits: {
      ...traits,
      volatility: provisionalTickRms(traits, dispersion) / cascadeRmsGain(traits),
    },
    excessKurtosis,
    tickRms: provisionalTickRms(traits, dispersion),
    dispersion,
    // Below the floor, the range above collapsed to the ceiling and the draw
    // is the ceiling: the family asked for more than this rhythm can give.
    ...(ceiling < archetype.excessKurtosis.min
      ? { clampedFrom: archetype.excessKurtosis.min }
      : {}),
  };
}

/**
 * Refuse an archetype whose box has an infeasible corner.
 *
 * Every range below is independent of every other, and three of them jointly
 * decide whether the fastest cascade component is faster than the tick. The
 * spacing is narrowed at sample time to keep that true — but only if there is
 * something left to narrow to. This decides that at module load, for the worst
 * corner of the box: deepest cascade, shortest span, fastest tempo.
 *
 * Written as a check rather than as care, because the ranges below will be
 * edited by whoever adds the ninth family, and the failure it prevents is a
 * personality that registers and then behaves as though its ladder had fewer
 * rungs than it claims.
 */
export function assertArchetypeFeasible(archetype: AssetArchetype): void {
  const { traits } = archetype;
  const ceiling = spacingCeiling(
    traits.cascadeSpanMs.min,
    Math.round(traits.cascadeDepth.max),
    traits.tempoMs.max,
  );
  if (ceiling < traits.cascadeSpacing.min) {
    throw new RangeError(
      `Archetype ${archetype.id} has no feasible cascade spacing at its worst corner: ` +
        `depth ${traits.cascadeDepth.max}, span ${traits.cascadeSpanMs.min} ms and tempo ` +
        `${traits.tempoMs.max} ms admit at most ${ceiling.toFixed(3)}, below the range floor ` +
        `of ${traits.cascadeSpacing.min}. Shorten the cascade, lengthen the span, or slow the tempo.`,
    );
  }
  for (const [name, range] of Object.entries(traits) as [keyof SampledTraitRanges, Range][]) {
    const bound = TRAIT_BOUNDS[name];
    if (range.min < bound.min || range.max > bound.max || range.min > range.max) {
      throw new RangeError(
        `Archetype ${archetype.id} samples ${name} over [${range.min}, ${range.max}], outside ` +
          `the trait bound [${bound.min}, ${bound.max}].`,
      );
    }
  }
  if (!(archetype.dispersion.min > 0) || archetype.dispersion.min > archetype.dispersion.max) {
    throw new RangeError(`Archetype ${archetype.id} has an unusable dispersion band.`);
  }
}

const HOUR = 3_600_000;
const SECOND = 1_000;

/**
 * The eight archetypes.
 *
 * Five core families, and eight characters across them, because "forex" and
 * "crypto" are what a broker calls an asset while *deep and slow* versus *sparse
 * and bursty* is what a chart reader actually sees. The two crypto archetypes
 * differ from each other by more than the two forex ones differ from each other.
 *
 * Dispersion bands come from [`CYCLE-6-DRIFT.md`](../../../docs/evidence/CYCLE-6-DRIFT.md)
 * and the calibration-derived measurement recorded beside it: 1.5% a quarter for
 * an index, 65% for an alt-coin, with the hand-authored five landing at 1.5%,
 * 4.5%, 8.0%, 19.3% and 53.6%.
 */
export const ASSET_ARCHETYPES: readonly AssetArchetype[] = [
  {
    id: 'major-fx',
    label: 'Major currency pair',
    family: 'forex',
    character: 'A deep ladder of timescales and a long memory. Holds a regime.',
    dispersion: { min: 0.03, max: 0.06 },
    excessKurtosis: { min: 45, max: 75 },
    traits: {
      tempoMs: { min: 2_200, max: 4_200 },
      burstiness: { min: 0.52, max: 0.66 },
      regimeSpread: { min: 0.9, max: 1.15 },
      structureSpread: { min: 0.9, max: 1.15 },
      durationCoupling: { min: 0.18, max: 0.32 },
      cascadeDepth: { min: 11, max: 16 },
      cascadeSpanMs: { min: 24 * HOUR, max: 44 * HOUR },
      cascadeSpacing: { min: 1.9, max: 2.8 },
      regimeTempo: { min: 1.2, max: 2.2 },
      arrivalMemoryMs: { min: 150 * SECOND, max: 400 * SECOND },
    },
  },
  {
    id: 'cross-fx',
    label: 'Currency cross',
    family: 'forex',
    character: 'Few, widely separated rhythms and a memory that fades in a minute.',
    dispersion: { min: 0.14, max: 0.24 },
    excessKurtosis: { min: 85, max: 130 },
    traits: {
      tempoMs: { min: 1_400, max: 2_400 },
      burstiness: { min: 0.55, max: 0.7 },
      regimeSpread: { min: 1.05, max: 1.3 },
      structureSpread: { min: 0.85, max: 1.1 },
      durationCoupling: { min: 0.18, max: 0.32 },
      cascadeDepth: { min: 6, max: 9 },
      cascadeSpanMs: { min: 5 * HOUR, max: 12 * HOUR },
      cascadeSpacing: { min: 3.0, max: 4.2 },
      regimeTempo: { min: 0.4, max: 0.8 },
      arrivalMemoryMs: { min: 25 * SECOND, max: 70 * SECOND },
    },
  },
  {
    id: 'blue-chip-index',
    label: 'Blue-chip index',
    family: 'index',
    character: 'The longest memory and the slowest turnover in the catalogue.',
    dispersion: { min: 0.01, max: 0.022 },
    excessKurtosis: { min: 30, max: 55 },
    traits: {
      // **Cycle Audit 6, CA6-27.** At 7,000 ms and 38% branching the mean
      // interval is 4.3 s, and Hawkes gaps then leave more than 1% of
      // 30-second horizons with no tick at all — so the 1% quantile of
      // `|30s return|` is exactly zero and the calibration refuses with "the
      // asset does not move", blaming amplitude for a tempo problem. Narrowed
      // to a 3.5-second mean interval at the worst corner.
      tempoMs: { min: 4_200, max: 6_000 },
      burstiness: { min: 0.42, max: 0.56 },
      regimeSpread: { min: 0.75, max: 0.95 },
      structureSpread: { min: 1.2, max: 1.45 },
      durationCoupling: { min: 0.18, max: 0.32 },
      cascadeDepth: { min: 7, max: 10 },
      cascadeSpanMs: { min: 36 * HOUR, max: 46 * HOUR },
      cascadeSpacing: { min: 3.0, max: 3.9 },
      regimeTempo: { min: 1.9, max: 2.8 },
      arrivalMemoryMs: { min: 300 * SECOND, max: 600 * SECOND },
    },
  },
  {
    id: 'sector-etf',
    label: 'Sector fund',
    family: 'etf',
    character: 'Structure-led: the session shape matters more than the regime.',
    dispersion: { min: 0.035, max: 0.07 },
    excessKurtosis: { min: 40, max: 70 },
    traits: {
      tempoMs: { min: 3_000, max: 5_200 },
      burstiness: { min: 0.42, max: 0.58 },
      regimeSpread: { min: 0.85, max: 1.1 },
      structureSpread: { min: 1.1, max: 1.4 },
      durationCoupling: { min: 0.2, max: 0.35 },
      cascadeDepth: { min: 8, max: 12 },
      cascadeSpanMs: { min: 20 * HOUR, max: 40 * HOUR },
      cascadeSpacing: { min: 2.2, max: 3.4 },
      regimeTempo: { min: 1.3, max: 2.2 },
      arrivalMemoryMs: { min: 180 * SECOND, max: 420 * SECOND },
    },
  },
  {
    id: 'metal',
    label: 'Precious metal',
    family: 'commodity',
    character: 'Volatility memory that starts and ends inside a session.',
    dispersion: { min: 0.06, max: 0.105 },
    excessKurtosis: { min: 80, max: 115 },
    traits: {
      tempoMs: { min: 3_400, max: 5_200 },
      burstiness: { min: 0.48, max: 0.62 },
      regimeSpread: { min: 1.1, max: 1.35 },
      structureSpread: { min: 0.8, max: 1.0 },
      durationCoupling: { min: 0.18, max: 0.32 },
      cascadeDepth: { min: 9, max: 13 },
      cascadeSpanMs: { min: 3 * HOUR, max: 7 * HOUR },
      cascadeSpacing: { min: 1.8, max: 2.5 },
      regimeTempo: { min: 0.7, max: 1.2 },
      arrivalMemoryMs: { min: 80 * SECOND, max: 160 * SECOND },
    },
  },
  {
    id: 'energy',
    label: 'Energy contract',
    family: 'commodity',
    character: 'Bursty and shallow: flurries of arrivals, short-lived rhythms.',
    dispersion: { min: 0.13, max: 0.22 },
    excessKurtosis: { min: 100, max: 145 },
    traits: {
      tempoMs: { min: 1_600, max: 2_800 },
      burstiness: { min: 0.65, max: 0.8 },
      regimeSpread: { min: 1.2, max: 1.45 },
      structureSpread: { min: 0.85, max: 1.1 },
      durationCoupling: { min: 0.3, max: 0.5 },
      cascadeDepth: { min: 6, max: 9 },
      cascadeSpanMs: { min: 2.5 * HOUR, max: 6 * HOUR },
      cascadeSpacing: { min: 2.4, max: 3.8 },
      regimeTempo: { min: 0.5, max: 0.9 },
      arrivalMemoryMs: { min: 30 * SECOND, max: 90 * SECOND },
    },
  },
  {
    id: 'major-crypto',
    label: 'Major cryptocurrency',
    family: 'crypto',
    character: 'The most timescales of any archetype, and restless regimes.',
    dispersion: { min: 0.34, max: 0.5 },
    excessKurtosis: { min: 115, max: 155 },
    traits: {
      tempoMs: { min: 900, max: 1_500 },
      burstiness: { min: 0.72, max: 0.82 },
      regimeSpread: { min: 1.25, max: 1.45 },
      structureSpread: { min: 0.9, max: 1.15 },
      durationCoupling: { min: 0.2, max: 0.35 },
      cascadeDepth: { min: 14, max: 18 },
      cascadeSpanMs: { min: 24 * HOUR, max: 40 * HOUR },
      cascadeSpacing: { min: 1.85, max: 2.25 },
      regimeTempo: { min: 0.3, max: 0.5 },
      arrivalMemoryMs: { min: 15 * SECOND, max: 30 * SECOND },
    },
  },
  {
    id: 'alt-crypto',
    label: 'Alternative cryptocurrency',
    family: 'crypto',
    character: 'Fast, shallow and extreme. The widest budget in the catalogue.',
    dispersion: { min: 0.48, max: 0.68 },
    excessKurtosis: { min: 130, max: 165 },
    traits: {
      // **Cycle Audit 6, CA6-23.** This was the narrowest box in the
      // catalogue, and its siblings were not distinguishable from three clones
      // of one personality: a 4.7pp lift at p ≈ 0.17, against 8–20pp everywhere
      // else. A family is a *region*, and a region this small is a template
      // with jitter. Widened on the five traits that were tightest, keeping the
      // character — fast, shallow, extreme — and the feasible spacing corner.
      //
      // **Cycle Audit 7, a3-05.** The depth floor was 5, and a five- or
      // six-rung cascade cannot reach this band's floor of 130 at the lower
      // end of the regime and structure spreads however wide its components
      // are, so the CA6-24 clamp drew *below* the band — silently — for one
      // asset in twenty. Measured at 2,000 draws per candidate:
      //
      // | change                    | below band | where                       |
      // | ------------------------- | ---------- | --------------------------- |
      // | none (depth floor 5)      | 97         | d5: 95/435, d6: 2/377       |
      // | depth floor 6             | 0          | d6 min 130.1 — 2/377 above  |
      // | depth floor 7             | 0          | every d7+ draw ≥ 130.0      |
      // | band floor 120 / 100 / 95 | 56 / 9 / 2 | d5 ceilings reach 84.7      |
      // | regimeSpread floor 1.35   | 17         | d5 still short              |
      //
      // A band floor would have to fall to about 84 to hold, which is a
      // `metal`; a depth floor of 6 misses about one draw in five hundred.
      // Seven keeps the band and the character — still the shallowest ladder
      // in the catalogue beside `cross-fx` and `energy`.
      tempoMs: { min: 450, max: 1_100 },
      burstiness: { min: 0.72, max: 0.88 },
      regimeSpread: { min: 1.2, max: 1.5 },
      structureSpread: { min: 0.8, max: 1.2 },
      durationCoupling: { min: 0.3, max: 0.65 },
      cascadeDepth: { min: 7, max: 9 },
      cascadeSpanMs: { min: 1.5 * HOUR, max: 5 * HOUR },
      cascadeSpacing: { min: 2.6, max: 4.2 },
      regimeTempo: { min: 0.3, max: 0.6 },
      arrivalMemoryMs: { min: 15 * SECOND, max: 45 * SECOND },
    },
  },
];

export function archetypeById(id: string): AssetArchetype {
  const found = ASSET_ARCHETYPES.find((archetype) => archetype.id === id);
  if (found === undefined) {
    const known = ASSET_ARCHETYPES.map((archetype) => archetype.id).join(', ');
    throw new RangeError(`Unknown archetype ${id}. The catalogue offers: ${known}.`);
  }
  return found;
}
