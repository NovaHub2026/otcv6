// Invariant evidence: INV-001 (economic independence), INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring } from '@otc/core';
import { cascadeTypicalProduct, DEFAULT_CASCADE } from './cascade.js';
import { createMarketEngine, DEFAULT_ENGINE_CONFIG } from './factory.js';
import { VolatilityFloorModulator, type FloorSources } from './floor.js';
import type { MagnitudeContext } from './magnitude.js';
import { REGIME_LEVELS, relativeRegimeLevel } from './regime.js';

const context: MagnitudeContext = {
  intervalMs: 1_000,
  previousMagnitude: 10,
  instant: epochMillis(1_776_000_000_000),
  sequence: 1,
};

function sources(regime: number, cascade: number, structure: number): FloorSources {
  return {
    regimeLevel: () => regime,
    cascadeProduct: () => cascade,
    structureMultiplier: () => structure,
  };
}

/**
 * PH-34. "El OTC debe ser dinámico, así que aun en los tramos más tranquilos
 * debe haber un movimiento por arriba de la media del mercado real."
 */
describe('the volatility floor', () => {
  const config = { level: 0.8, cascadeReference: 0.5 };

  it('lifts a level below the floor by exactly the shortfall', () => {
    // 0.8 (compressed) × (0.25 / 0.5) × 0.7 (a coil) = 0.28, lifted to 0.8.
    const floor = new VolatilityFloorModulator(config, sources(0.8, 0.25, 0.7));
    expect(floor.level()).toBeCloseTo(0.28, 15);
    expect(floor.advance(context) * floor.level()).toBeCloseTo(0.8, 15);
  });

  it('leaves a level at or above the floor untouched', () => {
    expect(new VolatilityFloorModulator(config, sources(1, 0.5, 1)).advance(context)).toBe(1);
    expect(new VolatilityFloorModulator(config, sources(0.8, 0.5, 1)).advance(context)).toBe(1);
    expect(new VolatilityFloorModulator(config, sources(2.3, 2, 1.9)).advance(context)).toBe(1);
  });

  it('measures the cascade against its typical state, not its average', () => {
    // At the typical state a regime is at its own level: calm is exactly the
    // floor and nothing is lifted.
    const typical = cascadeTypicalProduct(DEFAULT_CASCADE);
    const floor = new VolatilityFloorModulator(
      { level: relativeRegimeLevel('compressed'), cascadeReference: typical },
      sources(relativeRegimeLevel('compressed'), typical, 1),
    );
    expect(floor.advance(context)).toBe(1);
  });

  it('sits at the calm rung, which is the quietest the market is allowed to be', () => {
    expect(DEFAULT_ENGINE_CONFIG.volatilityFloor!.level).toBe(relativeRegimeLevel('compressed'));
    // Below normal, and the lowest of the four: where the market sits against
    // the instrument it is named for is the calibration's anchor since PH-35
    // (`OTC_DISPERSION_FACTOR`), not this ladder.
    expect(REGIME_LEVELS.compressed).toBeLessThan(REGIME_LEVELS.normal);
    expect(Math.min(...Object.values(REGIME_LEVELS))).toBe(REGIME_LEVELS.compressed);
  });

  it.each([
    ['a non-positive level', { level: 0, cascadeReference: 1 }],
    ['a non-positive reference', { level: 0.8, cascadeReference: 0 }],
  ])('refuses %s', (_name, broken) => {
    expect(() => new VolatilityFloorModulator(broken, sources(1, 1, 1))).toThrow(RangeError);
  });

  it('keeps an engine homogeneous of degree one in its base volatility', () => {
    // The calibration's exact rescale to a dispersion budget rests on it
    // (asset.ts): doubling the base must double every tick, floored or not.
    // The same keyring for both runs: every stream, the rounding one included,
    // draws the same values, so the only difference is the base. The lattice
    // is made negligible because the calibration never touches one: a step
    // count rounded on a coarse lattice feeds the arrival excitation, and two
    // runs a rounding apart drift into different interval sequences.
    const keyring = MasterKeyring.forTesting('floor-homogeneity');
    const run = (baseVolatility: number): number[] => {
      const engine = createMarketEngine({
        config: {
          ...DEFAULT_ENGINE_CONFIG,
          baseVolatility,
          instrument: {
            id: 'floor',
            family: 'forex',
            referencePrice: 100,
            logQuantum: 1e-15,
            displayPrecision: 4,
          },
        },
        keyring,
        environment: 'test',
        start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
      });
      const steps: number[] = [];
      let previous = 0;
      for (let i = 0; i < 5_000; i += 1) {
        const tick = engine.next()!;
        steps.push(Math.abs(tick.price - previous));
        previous = tick.price;
      }
      return steps;
    };
    const single = run(1e-5);
    const double = run(2e-5);
    let worst = 0;
    for (let i = 0; i < single.length; i += 1) {
      if (single[i]! < 1e6) continue;
      worst = Math.max(worst, Math.abs(double[i]! / single[i]! - 2));
    }
    expect(worst).toBeLessThan(1e-6);
  });
});
