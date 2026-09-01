// Invariant evidence: INV-007 (asset differentiation).
import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import {
  archetypeById,
  assertArchetypeFeasible,
  ASSET_ARCHETYPES,
  sampleArchetype,
  sampleTraits,
  spacingCeiling,
  STARTING_CASCADE_INFLATION,
  startingClustering,
  type AssetArchetype,
} from './families.js';
import {
  assertPersonalitySafe,
  assertPersonalityTraits,
  cascadeTimescalesMs,
  EXCESS_KURTOSIS_BAND,
  MIN_FASTEST_COMPONENT_TICKS,
  personalityConfig,
  TRAIT_BOUNDS,
  type PersonalityTraits,
} from './personality.js';

const keyring = MasterKeyring.forTesting('families-spec');
const stream = (label: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'families', purpose: label, keyEpoch: 0 });

const SAMPLED_TRAITS = [
  'tempoMs',
  'burstiness',
  'regimeSpread',
  'structureSpread',
  'durationCoupling',
  'cascadeDepth',
  'cascadeSpanMs',
  'cascadeSpacing',
  'regimeTempo',
  'arrivalMemoryMs',
] as const satisfies readonly (keyof PersonalityTraits)[];

describe('the archetypes themselves', () => {
  it('are all feasible', () => {
    for (const archetype of ASSET_ARCHETYPES) {
      expect(() => assertArchetypeFeasible(archetype), archetype.id).not.toThrow();
    }
  });

  it('have unique ids and cover every core family', () => {
    const ids = ASSET_ARCHETYPES.map((archetype) => archetype.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ASSET_ARCHETYPES.map((archetype) => archetype.family))).toEqual(
      new Set(['forex', 'crypto', 'commodity', 'index', 'etf']),
    );
  });

  it('span the dispersion range the drift evidence measured', () => {
    // CYCLE-6-DRIFT.md: 1.7% a quarter for an index and 75.6% for BTC. A
    // catalogue whose families all diffuse alike is a set of skins.
    const lowest = Math.min(...ASSET_ARCHETYPES.map((a) => a.dispersion.min));
    const highest = Math.max(...ASSET_ARCHETYPES.map((a) => a.dispersion.max));
    expect(lowest).toBeLessThan(0.02);
    expect(highest).toBeGreaterThan(0.6);
    expect(highest / lowest).toBeGreaterThan(30);
  });

  it('do not all sit in one band', () => {
    // Two archetypes may overlap — a quiet cross and a lively major genuinely
    // do — but a catalogue where every band contains every other band would
    // make the budget decorative.
    const bands = ASSET_ARCHETYPES.map((a) => a.dispersion);
    const disjoint = bands.filter((a) => bands.some((b) => b.min > a.max || b.max < a.min));
    expect(disjoint.length).toBe(bands.length);
  });

  it('refuses a box whose worst corner has no feasible spacing', () => {
    // Deep, short-spanned and fast at once: the fastest component would land
    // below half a tick however the spacing is drawn.
    const impossible: AssetArchetype = {
      ...archetypeById('alt-crypto'),
      traits: {
        ...archetypeById('alt-crypto').traits,
        cascadeDepth: { min: 14, max: 18 },
        cascadeSpanMs: { min: 1_800_000, max: 3_600_000 },
        tempoMs: { min: 900, max: 1_000 },
      },
    };
    expect(() => assertArchetypeFeasible(impossible)).toThrow(/no feasible cascade spacing/);
  });

  it('refuses a box that leaves the trait bounds', () => {
    const outside: AssetArchetype = {
      ...archetypeById('metal'),
      traits: {
        ...archetypeById('metal').traits,
        burstiness: { min: 0.5, max: 0.95 },
      },
    };
    expect(() => assertArchetypeFeasible(outside)).toThrow(/outside the trait bound/);
  });

  it('refuses an unusable dispersion band', () => {
    expect(() =>
      assertArchetypeFeasible({
        ...archetypeById('metal'),
        dispersion: { min: 0.2, max: 0.1 },
      }),
    ).toThrow(/unusable dispersion band/);
  });

  it('names an archetype it does not have', () => {
    expect(() => archetypeById('penny-stock')).toThrow(/Unknown archetype/);
  });
});

describe('sampling draws an asset rather than copying one', () => {
  it.each(ASSET_ARCHETYPES.map((a) => [a.id, a] as const))(
    '%s produces personalities that are individually legal',
    (id, archetype) => {
      const source = stream(`legal-${id}`);
      for (let draw = 0; draw < 60; draw += 1) {
        const traits = sampleTraits(archetype, source);
        expect(() => assertPersonalityTraits(traits), `${id} draw ${draw}`).not.toThrow();
        // The joint constraint the box cannot express: the fastest rung of the
        // ladder must still be slower than half a tick.
        const scales = cascadeTimescalesMs(traits);
        expect(scales[scales.length - 1]!, `${id} draw ${draw} fastest`).toBeGreaterThanOrEqual(
          MIN_FASTEST_COMPONENT_TICKS * traits.tempoMs,
        );
      }
    },
  );

  it.each(ASSET_ARCHETYPES.map((a) => [a.id, a] as const))(
    '%s produces personalities that survive the safety gate',
    (id, archetype) => {
      // Individually-legal traits can still compound past the realism ceiling.
      // The gate runs before the solve in `registerAsset`, so a sampled asset
      // has to arrive inside the band with a `clustering` that is about to be
      // replaced — which is what `startingClustering` is for.
      const source = stream(`safe-${id}`);
      for (let draw = 0; draw < 4; draw += 1) {
        const traits = sampleTraits(archetype, source);
        const predicted = assertPersonalitySafe(
          personalityConfig(traits),
          stream(`gate-${id}-${draw}`),
        );
        expect(predicted, `${id} draw ${draw}`).toBeGreaterThan(EXCESS_KURTOSIS_BAND.min);
        expect(predicted, `${id} draw ${draw}`).toBeLessThan(EXCESS_KURTOSIS_BAND.max);
      }
    },
    60_000,
  );

  it('stays inside its own box', () => {
    for (const archetype of ASSET_ARCHETYPES) {
      const source = stream(`box-${archetype.id}`);
      for (let draw = 0; draw < 40; draw += 1) {
        const traits = sampleTraits(archetype, source);
        for (const name of SAMPLED_TRAITS) {
          const range = archetype.traits[name];
          expect(traits[name], `${archetype.id}.${name}`).toBeGreaterThanOrEqual(range.min);
          // Spacing is the one trait narrowed at sample time, so its upper end
          // is the box's or the feasible ceiling, whichever is lower.
          const ceiling =
            name === 'cascadeSpacing'
              ? Math.min(
                  range.max,
                  spacingCeiling(traits.cascadeSpanMs, traits.cascadeDepth, traits.tempoMs),
                )
              : range.max;
          expect(traits[name], `${archetype.id}.${name}`).toBeLessThanOrEqual(ceiling);
        }
      }
    }
  });

  it('gives two assets from one archetype different personalities', () => {
    // The whole reason families are regions. Twenty copies of one personality
    // would be statistically one asset with twenty names, and INV-007 says
    // assets have genuinely distinct statistical personalities.
    for (const archetype of ASSET_ARCHETYPES) {
      const source = stream(`distinct-${archetype.id}`);
      const first = sampleTraits(archetype, source);
      const second = sampleTraits(archetype, source);
      const shared = SAMPLED_TRAITS.filter((name) => first[name] === second[name]);
      // `cascadeDepth` is a small integer and will collide sometimes; nothing
      // continuous should.
      expect(
        shared.filter((name) => name !== 'cascadeDepth'),
        archetype.id,
      ).toEqual([]);
    }
  });

  it('is a function of the stream and nothing else', () => {
    const a = sampleArchetype(archetypeById('metal'), stream('repeat'));
    const b = sampleArchetype(archetypeById('metal'), stream('repeat'));
    expect(a).toEqual(b);
    const c = sampleArchetype(archetypeById('metal'), stream('other'));
    expect(c.traits.tempoMs).not.toBe(a.traits.tempoMs);
  });

  it('draws a tail weight and a budget from the archetype bands', () => {
    for (const archetype of ASSET_ARCHETYPES) {
      const source = stream(`brief-${archetype.id}`);
      for (let draw = 0; draw < 30; draw += 1) {
        const sample = sampleArchetype(archetype, source);
        expect(sample.excessKurtosis).toBeGreaterThanOrEqual(archetype.excessKurtosis.min);
        expect(sample.excessKurtosis).toBeLessThanOrEqual(archetype.excessKurtosis.max);
        expect(sample.dispersion).toBeGreaterThanOrEqual(archetype.dispersion.min);
        expect(sample.dispersion).toBeLessThanOrEqual(archetype.dispersion.max);
        expect(sample.tickRms).toBeGreaterThan(0);
        expect(sample.traits.volatility).toBeGreaterThanOrEqual(TRAIT_BOUNDS.volatility.min);
        expect(sample.traits.volatility).toBeLessThanOrEqual(TRAIT_BOUNDS.volatility.max);
      }
    }
  });

  it('samples times on a log scale, so the range is not crowded at the top', () => {
    // Linear sampling of `[500, 1000]` puts three quarters of the draws above
    // 625; the meaningful distance between 500 ms and 1 s is the same as
    // between 1 s and 2 s.
    const source = stream('log-scale');
    const archetype = archetypeById('alt-crypto');
    const draws = Array.from({ length: 400 }, () => sampleTraits(archetype, source).tempoMs);
    const midpoint = Math.sqrt(archetype.traits.tempoMs.min * archetype.traits.tempoMs.max);
    const below = draws.filter((value) => value < midpoint).length;
    expect(below).toBeGreaterThan(160);
    expect(below).toBeLessThan(240);
  });
});

describe('the starting clustering keeps the cascade flat across depths', () => {
  it.each([4, 7, 11, 14, 18])('holds the inflation constant at depth %i', (depth) => {
    const c = startingClustering(depth);
    expect((1 + c * c) ** depth).toBeCloseTo(STARTING_CASCADE_INFLATION, 12);
    expect(c).toBeGreaterThan(TRAIT_BOUNDS.clustering.min);
    expect(c).toBeLessThan(TRAIT_BOUNDS.clustering.max);
  });
});

describe('the spacing ceiling', () => {
  it('is the spacing at which the fastest component hits its floor', () => {
    const tempoMs = 2_000;
    const depth = 10;
    const spanMs = 6 * 3_600_000;
    const ceiling = spacingCeiling(spanMs, depth, tempoMs);
    const fastest = spanMs / ceiling ** (depth - 1);
    expect(fastest / tempoMs).toBeCloseTo(MIN_FASTEST_COMPONENT_TICKS * 1.25, 10);
  });

  it('is unconstrained for a single-component cascade', () => {
    expect(spacingCeiling(3_600_000, 1, 1_000)).toBe(TRAIT_BOUNDS.cascadeSpacing.max);
  });
});
