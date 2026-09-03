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

  it('refuses the same personality at a different scale', () => {
    // **Cycle Audit 6, CA6-25.** This test used to assert the opposite. A copy
    // registered at twice the amplitude sat 0.0217 away — just past the old
    // threshold — and the guard's second condition let it through outright at
    // any dispersion ratio above 1.05. Measured on the project's own
    // classifier, such a pair is indistinguishable: 46.3 / 47.5 / 51.2% on the
    // full signature against a 50% chance rate. One market, louder, twice.
    for (const factor of [1.06, 2, 40]) {
      const traits = {
        ...eurusd.definition.traits,
        volatility: eurusd.definition.traits.volatility * factor,
      };
      // Amplitude is not part of the distance at all now.
      expect(traitDistance(eurusd.definition.traits, traits)).toBe(0);
      expect(
        check(candidate(eurusd, traits, eurusd.evidence.logVariancePerMs * factor * factor), [
          eurusd,
        ]),
        `factor ${factor}`,
      ).not.toBeNull();
    }
  });

  it('refuses a near-copy however far apart the budgets are', () => {
    const nudged = {
      ...eurusd.definition.traits,
      regimeTempo: eurusd.definition.traits.regimeTempo * 1.0005,
    };
    expect(traitDistance(eurusd.definition.traits, nudged)).toBeLessThan(MINIMUM_TRAIT_DISTANCE);
    expect(
      check(candidate(eurusd, nudged, eurusd.evidence.logVariancePerMs * 16), [eurusd]),
    ).not.toBeNull();
  });

  it('holds the floor at the value INV-007 was reasoned to, not at whatever it says (CA7-22)', () => {
    // **Cycle Audit 7.** Every assertion about the floor in this repository was
    // written against `MINIMUM_TRAIT_DISTANCE` itself, so all of them
    // self-adjust. An auditor lowered it from 0.01 to 1e-4 — a hundredfold
    // weakening of the registration enforcement of INV-007 — and the whole unit
    // suite passed, and so did the statistical guard that keeps 200
    // personalities apart. The guarded window was roughly (9e-5, 0.016]; inside
    // it, nothing in the gate had an opinion.
    //
    // A constant that a docstring reasons about at length, and that decides
    // whether an invariant is enforced, is pinned to its number.
    expect(MINIMUM_TRAIT_DISTANCE).toBe(0.01);

    // And the refusal is checked at an absolute distance rather than a relative
    // one, so the check cannot follow the constant down.
    const near = {
      ...eurusd.definition.traits,
      regimeTempo: eurusd.definition.traits.regimeTempo * 1.02,
    };
    const distance = traitDistance(eurusd.definition.traits, near);
    expect(distance, 'the fixture must sit inside the floor to test it').toBeLessThan(0.01);
    expect(distance, 'and above the noise, so it is a real near-copy').toBeGreaterThan(1e-4);
    expect(
      check(candidate(eurusd, near, eurusd.evidence.logVariancePerMs * 16), [eurusd]),
      'a pair 0.0001-close was admitted: the floor is not being enforced at 0.01',
    ).not.toBeNull();
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
    const strict = traitDistanceCheck({ minimumDistance: 0.5 });
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
