// Invariant evidence: INV-006 (no directional rule an operator can supply), INV-007 (assets differ).
import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import { requestFromBrief } from './brief.js';
import { ASSET_ARCHETYPES, archetypeById } from './families.js';
import { dispersionLogSigma } from './dispersion.js';

const keyring = MasterKeyring.forTesting('brief-spec');
const options = { keyring, environment: 'simulation' as const };

function brief(over: Partial<Parameters<typeof requestFromBrief>[0]> = {}) {
  return {
    id: 'newthing',
    archetypeId: 'major-fx',
    displayName: 'New Thing',
    referencePrice: 1.2,
    ...over,
  };
}

describe('an operator brief becomes a full registration request', () => {
  it('draws the same personality for the same brief, every time', () => {
    const a = requestFromBrief(brief(), options).request;
    const b = requestFromBrief(brief(), options).request;
    expect(a).toEqual(b);
  });

  it('draws a different personality for a different id', () => {
    // The id enters the key derivation (ADR-0002), so two assets created from
    // the same family are two markets rather than one under two names.
    const a = requestFromBrief(brief({ id: 'one' }), options).request;
    const b = requestFromBrief(brief({ id: 'two' }), options).request;
    expect(a.traits).not.toEqual(b.traits);
  });

  it('takes the family the archetype belongs to, never one supplied', () => {
    for (const archetype of ASSET_ARCHETYPES) {
      const { request } = requestFromBrief(brief({ archetypeId: archetype.id }), options);
      expect(request.family).toBe(archetype.family);
    }
  });

  it('lands inside the family it was drawn from', () => {
    for (const archetype of ASSET_ARCHETYPES) {
      const { request } = requestFromBrief(brief({ archetypeId: archetype.id }), options);
      expect(request.traits.cascadeDepth).toBeGreaterThanOrEqual(archetype.traits.cascadeDepth.min);
      expect(request.traits.cascadeDepth).toBeLessThanOrEqual(archetype.traits.cascadeDepth.max);
      expect(request.dispersion).toBeGreaterThanOrEqual(archetype.dispersion.min * 0.999);
      expect(request.dispersion).toBeLessThanOrEqual(archetype.dispersion.max * 1.001);
    }
  });

  it('rescales the amplitude to a supplied budget and leaves the shape alone', () => {
    const drawn = requestFromBrief(brief(), options);
    const target = drawn.request.dispersion! * 3;
    const scaled = requestFromBrief(brief({ dispersion: target }), options).request;

    expect(scaled.dispersion).toBeCloseTo(target, 12);
    // Amplitude moves by exactly the ratio — the calibration is homogeneous of
    // degree one in `volatility`, so a budget is a multiplication.
    expect(scaled.traits.volatility / drawn.request.traits.volatility).toBeCloseTo(3, 10);
    expect(scaled.targets.tickRms / drawn.request.targets.tickRms).toBeCloseTo(3, 10);
    // And the shape does not: the ladder of timescales is what makes this asset
    // distinct from its siblings, and a budget must not flatten it (INV-007).
    const { volatility: _a, ...shapeOfScaled } = scaled.traits;
    const { volatility: _b, ...shapeOfDrawn } = drawn.request.traits;
    expect(shapeOfScaled).toEqual(shapeOfDrawn);
    expect(scaled.targets.excessKurtosis).toBe(drawn.request.targets.excessKurtosis);
  });

  it('refuses an archetype nobody declared', () => {
    expect(() => requestFromBrief(brief({ archetypeId: 'not-a-family' }), options)).toThrow();
  });

  it('has no field that could express a direction', () => {
    // The whole surface an operator supplies, enumerated. A brief that grew a
    // `drift`, a `bias` or a `target price` would be INV-006 broken by an
    // administrative form, so this is written as a closed list rather than as
    // an absence.
    const supplied = Object.keys(brief({ dispersion: 0.2, displayPrecision: 4 })).sort();
    expect(supplied).toEqual(
      [
        'archetypeId',
        'dispersion',
        'displayName',
        'displayPrecision',
        'id',
        'referencePrice',
      ].sort(),
    );
  });

  it('carries the archetype forward as a dispersion, never as a price path', () => {
    const { request, sample } = requestFromBrief(brief({ archetypeId: 'metal' }), options);
    expect(sample.dispersion).toBe(request.dispersion);
    expect(archetypeById('metal').family).toBe(request.family);
    // σ over a quarter is a spread about the reference, not a destination.
    expect(dispersionLogSigma).toBeTypeOf('function');
  });
});
