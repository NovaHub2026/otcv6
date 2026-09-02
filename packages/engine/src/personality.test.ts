import { describe, expect, it } from 'vitest';
import {
  epochMillis,
  logPrice,
  MasterKeyring,
  type InstrumentSpec,
  type RandomSource,
} from '@otc/core';
import { DEFAULT_CASCADE } from './cascade.js';
import { createMarketEngine, DEFAULT_ENGINE_CONFIG } from './factory.js';
import { DEFAULT_HAWKES } from './hawkes.js';
import { DEFAULT_REGIMES } from './regime.js';
import { DEFAULT_STRUCTURE } from './structure.js';
import {
  assertPersonalitySafe,
  assertPersonalityTraits,
  cascadeInflation,
  DEFAULT_TRAITS,
  EXCESS_KURTOSIS_BAND,
  expandPersonality,
  predictedExcessKurtosis,
  regimeInflation,
  structureInflation,
  TRAIT_BOUNDS,
  type PersonalityTraits,
} from './personality.js';

const instrument: InstrumentSpec = {
  id: 'personality-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const keyring = MasterKeyring.forTesting('personality-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'personality', purpose, keyEpoch: 0 });

describe('the default traits reproduce the validated baseline', () => {
  // The defaults are the only configuration a full battery has ever cleared.
  // If the personality system cannot express them exactly, every asset it
  // produces starts from an unvalidated baseline.
  const config = expandPersonality(DEFAULT_TRAITS, instrument);

  it('reproduces the cascade exactly', () => {
    expect(config.cascade).toEqual(DEFAULT_CASCADE);
  });

  it('reproduces the regimes exactly', () => {
    expect(config.regimes).toEqual(DEFAULT_REGIMES);
  });

  it('reproduces the structure exactly', () => {
    expect(config.structure).toEqual(DEFAULT_STRUCTURE);
  });

  it('reproduces the arrival process exactly', () => {
    expect(config.arrival).toEqual(DEFAULT_HAWKES);
  });

  it('reproduces the scalar configuration exactly', () => {
    expect(config.baseVolatility).toBe(DEFAULT_ENGINE_CONFIG.baseVolatility);
    expect(config.durationCoupling).toBe(DEFAULT_ENGINE_CONFIG.durationCoupling);
  });
});

describe('trait bounds', () => {
  it('accepts the defaults', () => {
    expect(() => assertPersonalityTraits(DEFAULT_TRAITS)).not.toThrow();
  });

  it.each(Object.keys(TRAIT_BOUNDS) as (keyof PersonalityTraits)[])(
    'rejects %s outside its bounds',
    (name) => {
      const { min, max } = TRAIT_BOUNDS[name];
      expect(() => assertPersonalityTraits({ ...DEFAULT_TRAITS, [name]: max * 2 + 1 })).toThrow(
        RangeError,
      );
      expect(() => assertPersonalityTraits({ ...DEFAULT_TRAITS, [name]: min - 1 })).toThrow(
        RangeError,
      );
      expect(() => assertPersonalityTraits({ ...DEFAULT_TRAITS, [name]: Number.NaN })).toThrow(
        RangeError,
      );
    },
  );

  it('names the offending trait and value', () => {
    expect(() => assertPersonalityTraits({ ...DEFAULT_TRAITS, clustering: 0.9 })).toThrow(
      /clustering.*0\.9/,
    );
  });
});

describe('every corner of the trait bounds builds a running engine', () => {
  // **Cycle Audit 7, a3-03.** `TRAIT_BOUNDS` admitted `clustering: 0` and
  // `VolatilityCascade` refused the `lowMultiplier: 1` it expands to, so two
  // guards on one value disagreed: `assertPersonalityTraits` accepted a
  // personality no engine could be built from, and a registration that started
  // there was refused at `safety` with a cascade message about a trait the
  // caller had set legally. The fence and the engine now agree at every corner.

  /**
   * A legal personality with one trait at a bound.
   *
   * The joint constraint on the ladder — the fastest component slower than half
   * a tick — cannot hold at every corner of a box of independent ranges, so a
   * corner that breaks it is taken on the shallowest ladder instead, and the
   * deepest ladder on the narrowest spacing.
   */
  function corner(name: keyof PersonalityTraits, value: number): PersonalityTraits {
    const traits: PersonalityTraits = { ...DEFAULT_TRAITS, [name]: value };
    try {
      assertPersonalityTraits(traits);
      return traits;
    } catch {
      return name === 'cascadeDepth'
        ? { ...traits, cascadeSpacing: TRAIT_BOUNDS.cascadeSpacing.min }
        : { ...traits, cascadeDepth: TRAIT_BOUNDS.cascadeDepth.min };
    }
  }

  const corners = (Object.keys(TRAIT_BOUNDS) as (keyof PersonalityTraits)[]).flatMap((name) => [
    [`${name} at its minimum`, corner(name, TRAIT_BOUNDS[name].min)] as const,
    [`${name} at its maximum`, corner(name, TRAIT_BOUNDS[name].max)] as const,
  ]);

  it.each(corners)('%s', (_label, traits) => {
    expect(() => assertPersonalityTraits(traits)).not.toThrow();
    const engine = createMarketEngine({
      config: expandPersonality(traits, instrument),
      keyring,
      environment: 'test',
      start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
    });
    let previousInstant = 0;
    let invalid = 0;
    for (let i = 0; i < 2_000; i += 1) {
      const tick = engine.next();
      if (
        tick === null ||
        !Number.isSafeInteger(tick.price) ||
        !Number.isInteger(tick.instant) ||
        tick.instant <= previousInstant
      ) {
        invalid += 1;
      } else {
        previousInstant = tick.instant;
      }
    }
    expect(invalid).toBe(0);
  });
});

describe('the expansion is monotone in each trait', () => {
  // A trait that does not move its parameter in one direction is not a trait; it
  // is a knob nobody can reason about.
  it('clustering widens the cascade', () => {
    const low = expandPersonality({ ...DEFAULT_TRAITS, clustering: 0.1 }, instrument);
    const high = expandPersonality({ ...DEFAULT_TRAITS, clustering: 0.3 }, instrument);
    expect(high.cascade.lowMultiplier).toBeLessThan(low.cascade.lowMultiplier);
    expect(cascadeInflation(high.cascade)).toBeGreaterThan(cascadeInflation(low.cascade));
  });

  it('regimeSpread pushes regime multipliers away from unity', () => {
    const wide = expandPersonality({ ...DEFAULT_TRAITS, regimeSpread: 2 }, instrument);
    expect(wide.regimes.compressed.multiplier).toBeLessThan(DEFAULT_REGIMES.compressed.multiplier);
    expect(wide.regimes.stressed.multiplier).toBeGreaterThan(DEFAULT_REGIMES.stressed.multiplier);
    expect(regimeInflation(wide.regimes)).toBeGreaterThan(regimeInflation(DEFAULT_REGIMES));
  });

  it('leaves timings and transitions untouched', () => {
    // Only scale is a personality. The semi-Markov structure PH-3 validated must
    // not drift per asset.
    const wide = expandPersonality({ ...DEFAULT_TRAITS, regimeSpread: 2.5 }, instrument);
    expect(wide.regimes.normal.scaleMs).toBe(DEFAULT_REGIMES.normal.scaleMs);
    expect(wide.regimes.normal.shape).toBe(DEFAULT_REGIMES.normal.shape);
    expect(wide.regimes.normal.transitions).toEqual(DEFAULT_REGIMES.normal.transitions);
  });
});

describe('the closed forms agree with simulation of their own layer', () => {
  // Acceptance criterion 3: within 15%, and conservative — the closed form is
  // the stationary truth, and a sampled fourth moment converges from below.
  it('cascade closed form sits at or above simulation', () => {
    // Values measured in PH-4.1 by simulating the cascade alone for 3M steps.
    const measured = { 0.78: 4.691, 0.7: 12.511, 0.6: 43.232 };
    for (const [lowMultiplier, simulated] of Object.entries(measured)) {
      const closed = cascadeInflation({
        ...DEFAULT_CASCADE,
        lowMultiplier: Number(lowMultiplier),
      });
      expect(closed, lowMultiplier).toBeGreaterThan(simulated);
      expect(closed / simulated, lowMultiplier).toBeLessThan(1.15);
    }
  });

  it('regime closed form matches simulation', () => {
    // Simulated over 3M steps in PH-4.1.
    expect(regimeInflation(DEFAULT_REGIMES)).toBeGreaterThan(2.776 * 0.9);
    expect(regimeInflation(DEFAULT_REGIMES)).toBeLessThan(2.776 * 1.1);
  });

  it('structure estimate is stable across stream and length', () => {
    // It is simulated, so it must at least be reproducible and not drift with
    // the sample size, or it cannot serve as a gate.
    const a = structureInflation(DEFAULT_STRUCTURE, derive('structure-a'));
    const b = structureInflation(DEFAULT_STRUCTURE, derive('structure-b'));
    const long = structureInflation(DEFAULT_STRUCTURE, derive('structure-a'), 800_000);
    expect(Math.abs(a - b) / a).toBeLessThan(0.1);
    expect(Math.abs(long - a) / a).toBeLessThan(0.1);
  });

  it('is deterministic for a given stream', () => {
    expect(structureInflation(DEFAULT_STRUCTURE, derive('same'))).toBe(
      structureInflation(DEFAULT_STRUCTURE, derive('same')),
    );
  });
});

describe('the kurtosis gate', () => {
  const config = expandPersonality(DEFAULT_TRAITS, instrument);

  it('predicts the default configuration inside the realism band', () => {
    const predicted = predictedExcessKurtosis(config, derive('gate'));
    expect(predicted).toBeGreaterThan(EXCESS_KURTOSIS_BAND.min);
    expect(predicted).toBeLessThan(EXCESS_KURTOSIS_BAND.max);
  });

  it('agrees with the measured full-stack simulation, conservatively', () => {
    // 62.3 excess kurtosis measured over 1M magnitudes in PH-4.1. The prediction
    // must be close, and must not sit below the measurement — a gate that
    // underestimates is worse than no gate.
    const predicted = predictedExcessKurtosis(config, derive('gate'));
    expect(predicted).toBeGreaterThan(62.3);
    expect(predicted).toBeLessThan(62.3 * 1.25);
  });

  it('accepts the default personality', () => {
    expect(() => assertPersonalitySafe(config, derive('gate'))).not.toThrow();
  });

  it('rejects the cascade widening that cost PH-3 four recalibration passes', () => {
    // lowMultiplier 0.6 measured an excess kurtosis of 1366 against a ceiling of
    // 200. The whole point of the gate is that this is now caught before the
    // asset is registered, not after a ten-minute simulation.
    const reckless = expandPersonality({ ...DEFAULT_TRAITS, clustering: 0.4 }, instrument);
    expect(() => assertPersonalitySafe(reckless, derive('gate'))).toThrow(/above the realism/);
  });

  it('rejects a personality with no fat tails at all', () => {
    const flat = expandPersonality(
      { ...DEFAULT_TRAITS, clustering: 0, regimeSpread: 0.25, structureSpread: 0.25 },
      instrument,
    );
    expect(() => assertPersonalitySafe(flat, derive('gate'))).toThrow(/below the realism floor/);
  });

  it('is monotone in clustering', () => {
    const stream = () => derive('gate');
    const calm = expandPersonality({ ...DEFAULT_TRAITS, clustering: 0.1 }, instrument);
    const wild = expandPersonality({ ...DEFAULT_TRAITS, clustering: 0.3 }, instrument);
    expect(predictedExcessKurtosis(wild, stream())).toBeGreaterThan(
      predictedExcessKurtosis(calm, stream()),
    );
  });
});
