import { ln } from '@otc/core';
import type { CalibratedAsset } from './asset.js';
import type { RegisteredAsset } from './catalogue.js';
import { dispersionLogSigma } from './dispersion.js';
import type { DifferentiationCheck } from './registration.js';
import { TRAIT_BOUNDS, type PersonalityTraits } from './personality.js';

/**
 * The cheap half of INV-007, enforced at registration.
 *
 * A hundred assets built from eight families is only a hundred assets if the
 * personalities are actually drawn rather than copied. `families.ts` draws them;
 * this refuses the case where a draw — or an operator filling a form — lands on
 * top of something already registered.
 *
 * ## What it is, and what it is not
 *
 * It compares **parameters**, not behaviour: each trait mapped onto its own
 * bound, times on a log axis because that is the scale they mean anything on,
 * and the Euclidean distance taken. That makes it deterministic, instant, and
 * available before a single tick is generated.
 *
 * It is therefore *necessary and not sufficient*. Two personalities can differ
 * in parameters and still produce statistically indistinguishable markets — the
 * project has measured exactly that, since shape differentiation across the five
 * hand-authored assets is 40.5% against a 20% null rather than 100%. The
 * sufficient check is statistical, it costs tens of millions of ticks, and it
 * belongs in the acceptance evidence for the catalogue rather than in the path
 * of a single registration.
 *
 * Saying so is the point. A guard that reads as a proof of the invariant, and is
 * a proximity check on a parameter vector, is worse than no guard because it
 * invites reliance — the same failure `standing.ts` was rewritten to remove in
 * Cycle Audit 5.
 */

/** Traits compared on a logarithmic axis: every one of them is a time. */
const LOG_SCALED = ['tempoMs', 'cascadeSpanMs', 'arrivalMemoryMs', 'volatility'] as const;

const COMPARED = Object.keys(TRAIT_BOUNDS) as (keyof PersonalityTraits)[];

function normalise(name: keyof PersonalityTraits, value: number): number {
  const { min, max } = TRAIT_BOUNDS[name];
  if ((LOG_SCALED as readonly string[]).includes(name)) {
    return (ln(value) - ln(min)) / (ln(max) - ln(min));
  }
  return (value - min) / (max - min);
}

/**
 * Distance between two personalities, on a scale where 1 is the whole space.
 *
 * Root *mean* square rather than a plain Euclidean sum, so the number does not
 * grow simply because there are twelve traits — and so a threshold means the
 * same thing if a thirteenth is ever added.
 */
export function traitDistance(a: PersonalityTraits, b: PersonalityTraits): number {
  let total = 0;
  for (const name of COMPARED) {
    const gap = normalise(name, a[name]) - normalise(name, b[name]);
    total += gap * gap;
  }
  return Math.sqrt(total / COMPARED.length);
}

/**
 * How close two personalities may be.
 *
 * Measured, not chosen. Over 96 assets — twelve drawn from each archetype,
 * 4,560 pairs:
 *
 * | pairs                | min    | p10    | median |
 * | -------------------- | ------ | ------ | ------ |
 * | same archetype       | 0.0233 | 0.0481 | 0.0706 |
 * | different archetypes | 0.0470 | 0.1369 | 0.2522 |
 *
 * The five hand-authored assets sit at a minimum of 0.1808 and a median of
 * 0.2736, which says the archetype boxes are tighter than the five originals
 * were spread — as they should be, since eight boxes now cover what five points
 * used to.
 *
 * 0.02 is below every same-archetype pair observed. That is deliberate: this
 * guard's job is to catch **copying**, not to enforce spacing. A threshold set
 * where legitimate siblings live would push an operator towards widening the
 * boxes, which is the opposite of what INV-007 wants — and the sufficient check
 * is statistical anyway.
 *
 * For scale, a personality copied exactly but registered at twice the amplitude
 * lands at 0.021 from its twin on the volatility axis alone, so the threshold
 * sits almost exactly where "the same market, louder" begins.
 */
export const MINIMUM_TRAIT_DISTANCE = 0.02;

/**
 * How close two assets' quarterly dispersion budgets may be, as a ratio.
 *
 * Two assets that differ only in amplitude are the trivial kind of different —
 * PH-10 exists partly to stop claiming that as differentiation — so this is not
 * a separation requirement. It is the opposite: a pair that is close in traits
 * *and* close in scale is a duplicate whatever else is true, so the two
 * conditions are combined rather than either one alone.
 */
export const MINIMUM_DISPERSION_RATIO = 1.05;

export interface TraitDistanceOptions {
  readonly minimumDistance?: number;
  readonly minimumDispersionRatio?: number;
}

/** A {@link DifferentiationCheck} that refuses a personality already present. */
export function traitDistanceCheck(options: TraitDistanceOptions = {}): DifferentiationCheck {
  const minimum = options.minimumDistance ?? MINIMUM_TRAIT_DISTANCE;
  const ratio = options.minimumDispersionRatio ?? MINIMUM_DISPERSION_RATIO;
  return (candidate: CalibratedAsset, existing: readonly RegisteredAsset[]): string | null => {
    const dispersion = dispersionLogSigma(candidate.evidence);
    for (const asset of existing) {
      const distance = traitDistance(candidate.definition.traits, asset.definition.traits);
      if (distance >= minimum) continue;
      const other = dispersionLogSigma(asset.evidence);
      const spread = Math.max(dispersion / other, other / dispersion);
      if (spread >= ratio) continue;
      return (
        `Personality is ${distance.toFixed(4)} from ${asset.definition.id} on a scale where the ` +
        `whole trait space is 1, and their quarterly dispersions differ by a factor of ` +
        `${spread.toFixed(3)}. Below ${minimum} and ${ratio} that is the same market under two ` +
        `names, which is INV-007 broken as the catalogue grows.`
      );
    }
    return null;
  };
}
