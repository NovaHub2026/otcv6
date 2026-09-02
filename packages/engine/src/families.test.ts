// Invariant evidence: INV-007 (asset differentiation).
import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import {
  archetypeById,
  assertArchetypeFeasible,
  ASSET_ARCHETYPES,
  KURTOSIS_HEADROOM,
  reachableExcessKurtosis,
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
  authorPersonality,
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
    // Deliberately feasible at the *easy* corner — shallowest cascade, longest
    // span, slowest tempo, where the ceiling is 14.6 against a spacing floor of
    // 2.8 — and infeasible at the worst one, where it is 2.28. A check that
    // looked at the wrong corner would pass this box and then admit samples
    // whose fastest rung is faster than the tick.
    const impossible: AssetArchetype = {
      ...archetypeById('alt-crypto'),
      traits: {
        ...archetypeById('alt-crypto').traits,
        cascadeDepth: { min: 5, max: 12 },
        cascadeSpanMs: { min: 1.5 * 3_600_000, max: 4 * 3_600_000 },
        tempoMs: { min: 500, max: 1_000 },
      },
    };
    const easiest = spacingCeiling(
      impossible.traits.cascadeSpanMs.max,
      impossible.traits.cascadeDepth.min,
      impossible.traits.tempoMs.min,
    );
    expect(easiest).toBeGreaterThan(impossible.traits.cascadeSpacing.min);
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
      for (let draw = 0; draw < 8; draw += 1) {
        const sample = sampleArchetype(archetype, source);
        // Inside the band. `alt-crypto` drew depths at which the cascade
        // could not supply its own band's *upper* end, and Cycle Audit 6
        // (CA6-24) measured 3.64% of its briefs as unauthorable; the target is
        // clamped to the reachable ceiling now, the way `cascadeSpacing`
        // already was. **Cycle Audit 7, a3-05.** The clamp then fell below the
        // band's *lower* end for one alt-crypto draw in twenty, silently; the
        // box was narrowed so that a family's band means what it says, and a
        // clamp below it is recorded when it happens. The ceiling itself is
        // not re-derived here: it is a 20,000-step estimate, exact only for
        // the stream that produced it.
        expect(sample.excessKurtosis).toBeLessThanOrEqual(archetype.excessKurtosis.max);
        expect(sample.excessKurtosis, `${archetype.id} draw ${draw}`).toBeGreaterThanOrEqual(
          archetype.excessKurtosis.min,
        );
        expect(sample.clampedFrom, `${archetype.id} draw ${draw}`).toBeUndefined();
        expect(sample.dispersion).toBeGreaterThanOrEqual(archetype.dispersion.min);
        expect(sample.dispersion).toBeLessThanOrEqual(archetype.dispersion.max);
        expect(sample.tickRms).toBeGreaterThan(0);
        expect(sample.traits.volatility).toBeGreaterThanOrEqual(TRAIT_BOUNDS.volatility.min);
        expect(sample.traits.volatility).toBeLessThanOrEqual(TRAIT_BOUNDS.volatility.max);
      }
    }
  });

  it('clamps a target the rhythm cannot reach, on the personality that proved it', () => {
    // A depth-5 draw from the `alt-crypto` box as it stood before a3-05,
    // recorded rather than searched for at test time: its cascade tops out at
    // an excess kurtosis of about 128 while the archetype's band asks for 130
    // to 165. Under the old rule `sampleArchetype` handed that band straight
    // to `authorPersonality`, which refused — 3.64% of alt-crypto briefs, and
    // 36% of hundred-asset builds (CA6-24).
    const cornered: PersonalityTraits = {
      tempoMs: 560.6339400438212,
      volatility: 0.000043520995997473905,
      clustering: 0.3139435352195007,
      burstiness: 0.8663606951367631,
      regimeSpread: 1.3338960382343328,
      structureSpread: 0.8716258348783997,
      durationCoupling: 0.5155280877593532,
      cascadeDepth: 5,
      cascadeSpanMs: 5_619_889.119264998,
      cascadeSpacing: 3.722331169744061,
      regimeTempo: 0.40953375154302174,
      arrivalMemoryMs: 16_767.956020108642,
    };
    const archetype = archetypeById('alt-crypto');
    const ceiling = reachableExcessKurtosis(cornered, stream('cornered-ceiling'));
    expect(ceiling).toBeLessThan(archetype.excessKurtosis.min);

    // What the clamp asks for instead is authorable. The unreachable half is
    // not asserted here on purpose: `solveClustering` bisects against a
    // simulated gate, so failing to reach a target is minutes of work, and the
    // property that matters is that the sampler never asks for it.
    const derive = (purpose: string): RandomSource => stream(`cornered-${purpose}`);
    expect(() =>
      authorPersonality(
        cornered,
        { excessKurtosis: ceiling * KURTOSIS_HEADROOM, tickRms: 1e-5 },
        derive,
      ),
    ).not.toThrow();
  }, 120_000);

  it('says so when a rhythm cannot reach the floor of its band', () => {
    // **Cycle Audit 7, a3-05.** The record has to distinguish a draw the
    // family asked for from one the rhythm imposed. A band no rhythm in the
    // catalogue can reach — the realism ceiling is 200 — forces the clamp on
    // every draw, and every draw says which floor it fell below.
    const unreachable: AssetArchetype = {
      ...archetypeById('alt-crypto'),
      excessKurtosis: { min: 5_000, max: 6_000 },
    };
    const source = stream('unreachable');
    for (let draw = 0; draw < 4; draw += 1) {
      const sample = sampleArchetype(unreachable, source);
      expect(sample.clampedFrom, `draw ${draw}`).toBe(5_000);
      expect(sample.excessKurtosis, `draw ${draw}`).toBeLessThan(5_000);
    }
  });

  it('draws alt-crypto inside its band, at the scale the clamp used to miss', async () => {
    // **Cycle Audit 7, a3-05.** Measured at 2,000 draws per candidate: with a
    // depth floor of 5 one draw in twenty landed below the band, all at depths
    // 5 and 6; with a floor of 7, none did. Three hundred draws here is the
    // scale a unit test affords, and it would have failed the old box about
    // fifteen times over.
    const archetype = archetypeById('alt-crypto');
    const source = stream('alt-crypto-band');
    let belowBand = 0;
    for (let draw = 0; draw < 300; draw += 1) {
      const sample = sampleArchetype(archetype, source);
      if (
        sample.clampedFrom !== undefined ||
        sample.excessKurtosis < archetype.excessKurtosis.min
      ) {
        belowBand += 1;
      }
      // A draw costs a 20,000-step structure simulation; three hundred of them
      // in one synchronous block would starve the worker's RPC channel.
      if (draw % 20 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(belowBand).toBe(0);
  }, 60_000);

  it('samples times on a log scale, so the range is not crowded at the top', () => {
    // The meaningful distance between 500 ms and 1 s is the same as between
    // 1 s and 2 s, and linear sampling would put the typical draw a third of
    // the way further up the range than it belongs.
    //
    // Asserted on the *mean*, because the two hypotheses are far apart there
    // and close everywhere else. Over [500, 1000] a log-uniform mean is
    // `(max - min) / ln(max / min)` = 721.3 and a uniform mean is 750; with
    // 2,000 draws the standard error is about 3.2 ms, so the alternative sits
    // nine of them away. A count either side of the midpoint separates the same
    // two hypotheses by barely one.
    const source = stream('log-scale');
    const { min, max } = archetypeById('alt-crypto').traits.tempoMs;
    const draws = Array.from(
      { length: 2_000 },
      () => sampleTraits(archetypeById('alt-crypto'), source).tempoMs,
    );
    const mean = draws.reduce((sum, value) => sum + value, 0) / draws.length;
    const logUniformMean = (max - min) / Math.log(max / min);
    const uniformMean = (max + min) / 2;
    const standardError = (max - min) / Math.sqrt(12 * draws.length);
    expect(Math.abs(mean - logUniformMean)).toBeLessThan(4 * standardError);
    expect(Math.abs(mean - uniformMean)).toBeGreaterThan(5 * standardError);
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
