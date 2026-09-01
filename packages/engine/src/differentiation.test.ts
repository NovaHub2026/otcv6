// Invariant evidence: INV-007 (asset differentiation).
import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import type { CalibratedAsset } from './asset.js';
import { ASSET_CATALOGUE, configFor, type RegisteredAsset } from './catalogue.js';
import { MINIMUM_TRAIT_DISTANCE, traitDistance, traitDistanceCheck } from './differentiation.js';
import { ASSET_ARCHETYPES, sampleArchetype } from './families.js';
import type { PersonalityTraits } from './personality.js';

const eurusd = ASSET_CATALOGUE[0]!;
const gbpjpy = ASSET_CATALOGUE[1]!;
const btcusd = ASSET_CATALOGUE[2]!;

function candidate(
  from: RegisteredAsset,
  traits: PersonalityTraits = from.definition.traits,
  logVariancePerMs = from.evidence.logVariancePerMs,
): CalibratedAsset {
  return {
    definition: { ...from.definition, id: 'candidate', traits },
    instrument: from.instrument,
    config: configFor(from),
    evidence: { ...from.evidence, logVariancePerMs },
  };
}

describe('the distance between two personalities', () => {
  it('is zero for a personality and itself, and symmetric', () => {
    expect(traitDistance(eurusd.definition.traits, eurusd.definition.traits)).toBe(0);
    expect(traitDistance(eurusd.definition.traits, btcusd.definition.traits)).toBe(
      traitDistance(btcusd.definition.traits, eurusd.definition.traits),
    );
  });

  it('is a mean rather than a sum, so it stays on a scale of one', () => {
    // Every trait normalised onto its own bound, so the extreme corners of the
    // space are 1 apart however many traits there are.
    expect(traitDistance(eurusd.definition.traits, btcusd.definition.traits)).toBeLessThan(1);
    expect(traitDistance(eurusd.definition.traits, gbpjpy.definition.traits)).toBeGreaterThan(0.1);
  });

  it('reads a time trait on a log axis', () => {
    // Doubling a 15-second memory and doubling a 400-second one are the same
    // change of character; on a linear axis the second would count 27x more.
    const base = eurusd.definition.traits;
    const near = traitDistance(base, { ...base, arrivalMemoryMs: base.arrivalMemoryMs * 2 });
    const far = traitDistance(base, { ...base, arrivalMemoryMs: base.arrivalMemoryMs / 2 });
    expect(near).toBeCloseTo(far, 12);
  });
});

describe('the registration guard refuses a personality already present', () => {
  const check = traitDistanceCheck();

  it('refuses an exact copy', () => {
    const refusal = check(candidate(eurusd), ASSET_CATALOGUE);
    expect(refusal).toMatch(/same market under two names/);
    expect(refusal).toMatch(/eurusd/);
  });

  it('admits the same personality at a different scale', () => {
    // Two assets that differ only in amplitude are the trivial kind of
    // different, and the trivial kind is still a different market — a copy at
    // twice the amplitude sits at 0.0217, just past the threshold, and its
    // dispersion is double.
    const traits = {
      ...eurusd.definition.traits,
      volatility: eurusd.definition.traits.volatility * 2,
    };
    expect(traitDistance(eurusd.definition.traits, traits)).toBeGreaterThan(MINIMUM_TRAIT_DISTANCE);
    expect(
      check(candidate(eurusd, traits, eurusd.evidence.logVariancePerMs * 4), ASSET_CATALOGUE),
    ).toBeNull();
  });

  it('needs both conditions before it refuses', () => {
    // Traits close but the budget far apart: a quiet and a loud version of one
    // character, which the catalogue is entitled to hold.
    const nudged = {
      ...eurusd.definition.traits,
      regimeTempo: eurusd.definition.traits.regimeTempo * 1.001,
    };
    expect(traitDistance(eurusd.definition.traits, nudged)).toBeLessThan(MINIMUM_TRAIT_DISTANCE);
    expect(
      check(candidate(eurusd, nudged, eurusd.evidence.logVariancePerMs * 4), ASSET_CATALOGUE),
    ).toBeNull();
    // The same pair at the same budget is a duplicate.
    expect(check(candidate(eurusd, nudged), ASSET_CATALOGUE)).not.toBeNull();
  });

  it('admits every asset already in the catalogue against the others', () => {
    for (const asset of ASSET_CATALOGUE) {
      const others = ASSET_CATALOGUE.filter((other) => other !== asset);
      expect(check(candidate(asset), others), asset.definition.id).toBeNull();
    }
  });

  it('admits an empty catalogue', () => {
    expect(check(candidate(eurusd), [])).toBeNull();
  });

  it('takes a stricter threshold when one is asked for', () => {
    const strict = traitDistanceCheck({ minimumDistance: 0.5, minimumDispersionRatio: 100 });
    expect(strict(candidate(btcusd), [eurusd])).not.toBeNull();
  });
});

describe('the threshold sits below where sampled siblings live', () => {
  it('admits every pair drawn from the archetypes', () => {
    // The guard catches copying; it must not become a spacing rule, because an
    // operator whose legitimate draws keep being refused will widen the boxes,
    // and wider boxes are the opposite of what INV-007 wants.
    //
    // Measured over 96 assets, the closest same-archetype pair is 0.0233. This
    // runs a smaller sweep and asserts the same thing: no sampled pair falls
    // below the threshold.
    const keyring = MasterKeyring.forTesting('sibling-distance');
    const drawn: PersonalityTraits[] = [];
    for (const archetype of ASSET_ARCHETYPES) {
      const stream = keyring.derive({
        env: 'test',
        asset: 'siblings',
        purpose: archetype.id,
        keyEpoch: 0,
      });
      for (let i = 0; i < 5; i += 1) drawn.push(sampleArchetype(archetype, stream).traits);
    }
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        closest = Math.min(closest, traitDistance(drawn[i]!, drawn[j]!));
      }
    }
    expect(closest).toBeGreaterThan(MINIMUM_TRAIT_DISTANCE);
  });
});
