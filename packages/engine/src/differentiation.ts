import { ln } from '@otc/core';
import type { CalibratedAsset } from './asset.js';
import type { RegisteredAsset } from './catalogue.js';
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
const LOG_SCALED = ['tempoMs', 'cascadeSpanMs', 'arrivalMemoryMs'] as const;

/**
 * Everything except `volatility`, because amplitude is not character.
 *
 * **Cycle Audit 6, CA6-25.** Including it created the loophole the guard exists
 * to close: an exact copy of a personality registered at twice the amplitude
 * sat 0.0217 away — just past the threshold — and was admitted as a distinct
 * asset. Measured on the project's own classifier, such a pair is
 * indistinguishable: 46.3 / 47.5 / 51.2% on the **full** signature against a
 * 50% chance rate. It is one market, louder.
 *
 * Scale is a *budget*, chosen per asset from its family's dispersion band and
 * deliberately free to vary. Character is what INV-007 is about, and it is what
 * this measures.
 */
const COMPARED = (Object.keys(TRAIT_BOUNDS) as (keyof PersonalityTraits)[]).filter(
  (name) => name !== 'volatility',
);

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
 * Measured, not chosen, and re-measured after Cycle Audit 6 removed `volatility`
 * from the distance. Over 96 assets — twelve from each archetype, 4,560 pairs:
 *
 * | pairs                | min    | p10    | median |
 * | -------------------- | ------ | ------ | ------ |
 * | same archetype       | 0.0195 | 0.0464 | 0.0723 |
 * | different archetypes | 0.0536 | 0.1318 | 0.2510 |
 *
 * A single draw's minimum is not a bound, which is the mistake the first version
 * of this docstring made and CA6-15 made again elsewhere in the same cycle. Over
 * **forty** independent 96-asset catalogues the closest pair ranges from 0.0157
 * to 0.0245, and a threshold of 0.02 would refuse a legitimate draw in **five of
 * the forty**.
 *
 * So 0.01: below every closest pair observed across forty catalogues, and still
 * two orders of magnitude above a copy. This guard's job is to catch **copying**,
 * not to enforce spacing — an operator whose legitimate draws keep being refused
 * will widen the boxes, which is the opposite of what INV-007 wants, and the
 * sufficient check is statistical anyway.
 */
export const MINIMUM_TRAIT_DISTANCE = 0.01;

/**
 * There is no amplitude exemption, and there used to be.
 *
 * **Cycle Audit 6, CA6-25.** The guard refused only when the personalities were
 * close **and** their quarterly dispersions were within 5% — so an exact copy
 * registered at 1.06x the budget was admitted, and the project's own classifier
 * put that pair at 46-52% on the full signature against a 50% chance rate. One
 * market, louder, registered twice.
 *
 * The exemption is gone and `volatility` is out of the distance: amplitude is a
 * *budget*, drawn per asset from its family's band and deliberately free to
 * vary, while character is what INV-007 is about. Two assets that differ only in
 * scale are not two personalities, at any ratio.
 */
export interface TraitDistanceOptions {
  readonly minimumDistance?: number;
}

/** A {@link DifferentiationCheck} that refuses a personality already present. */
export function traitDistanceCheck(options: TraitDistanceOptions = {}): DifferentiationCheck {
  const minimum = options.minimumDistance ?? MINIMUM_TRAIT_DISTANCE;
  return (candidate: CalibratedAsset, existing: readonly RegisteredAsset[]): string | null => {
    for (const asset of existing) {
      const distance = traitDistance(candidate.definition.traits, asset.definition.traits);
      if (distance >= minimum) continue;
      return (
        `Personality is ${distance.toFixed(4)} from ${asset.definition.id} on a scale where the ` +
        `whole trait space is 1, and amplitude is not part of that scale. Below ${minimum} it is ` +
        `the same market under two names however loudly either is run, which is INV-007 broken ` +
        `as the catalogue grows.`
      );
    }
    return null;
  };
}
