import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type RandomSource } from '@otc/core';
import {
  assertCascadeConfig,
  CascadeMagnitudeModel,
  DEFAULT_CASCADE,
  VolatilityCascade,
  type CascadeConfig,
} from './cascade.js';
import type { MagnitudeContext } from './magnitude.js';

const keyring = MasterKeyring.forTesting('cascade-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'cascade', purpose, keyEpoch: 0 });

const context = (intervalMs: number, sequence = 1): MagnitudeContext => ({
  intervalMs,
  previousMagnitude: 0,
  instant: epochMillis(1_776_000_000_000 + sequence * intervalMs),
  sequence,
});

describe('configuration', () => {
  it('accepts the default', () => {
    expect(() => assertCascadeConfig(DEFAULT_CASCADE)).not.toThrow();
  });

  it.each([
    ['zero components', { components: 0 }],
    ['too many components', { components: 25 }],
    ['fractional components', { components: 2.5 }],
    ['zero hazard', { slowestHazardPerMs: 0 }],
    ['hazard ratio of one', { hazardRatio: 1 }],
    ['multiplier at zero', { lowMultiplier: 0 }],
    ['multiplier above one', { lowMultiplier: 1.000_001 }],
  ])('rejects %s', (_name, override) => {
    expect(() => assertCascadeConfig({ ...DEFAULT_CASCADE, ...override })).toThrow(RangeError);
  });

  it('accepts a multiplier of exactly one as the constant cascade', () => {
    // **Cycle Audit 7, a3-03.** `clustering: 0` is inside `TRAIT_BOUNDS` and
    // expands to this; refusing it here made the two guards disagree about one
    // value. The constant cascade multiplies by exactly 1 forever and still
    // consumes its stream on every switch, so it is a market, just a dull one.
    const constant = new VolatilityCascade({ ...DEFAULT_CASCADE, lowMultiplier: 1 }, derive('one'));
    let offUnity = 0;
    for (let i = 0; i < 5_000; i += 1) {
      if (constant.advance(1_000) !== 1) offUnity += 1;
    }
    expect(offUnity).toBe(0);
    expect(constant.current()).toBe(1);
  });
});

describe('component hazards', () => {
  const cascade = new VolatilityCascade(DEFAULT_CASCADE, derive('hazards'));

  it('are geometrically spaced', () => {
    for (let k = 1; k < DEFAULT_CASCADE.components; k += 1) {
      expect(cascade.hazardOf(k) / cascade.hazardOf(k - 1)).toBeCloseTo(
        DEFAULT_CASCADE.hazardRatio,
        9,
      );
    }
  });

  it('span from hours to seconds', () => {
    const slowestHalfLifeHours = 1 / cascade.hazardOf(0) / 3_600_000;
    const fastestHalfLifeSeconds = 1 / cascade.hazardOf(DEFAULT_CASCADE.components - 1) / 1_000;
    expect(slowestHalfLifeHours).toBeGreaterThan(1);
    expect(fastestHalfLifeSeconds).toBeLessThan(60);
  });
});

describe('switching behaviour', () => {
  it('resamples each component at approximately its hazard', () => {
    // Switching is driven by elapsed TIME, not tick counts: a component that
    // resampled every N ticks would phase-lock to activity, and activity is
    // something an observer can see.
    const config: CascadeConfig = {
      components: 3,
      slowestHazardPerMs: 1 / 100_000,
      hazardRatio: 10,
      lowMultiplier: 0.5,
    };
    const cascade = new VolatilityCascade(config, derive('switching'));
    const intervalMs = 100;
    const steps = 200_000;

    let changes = 0;
    let lastProduct = cascade.current();
    for (let i = 0; i < steps; i += 1) {
      const product = cascade.advance(intervalMs);
      if (product !== lastProduct) changes += 1;
      lastProduct = product;
    }

    // Expected rate, derived rather than guessed: component k switches with
    // probability 1 - exp(-hazard_k * interval), and a switch lands on the other
    // of two values half the time, so the product is unchanged only when no
    // component actually moved.
    let unchanged = 1;
    for (let k = 0; k < config.components; k += 1) {
      unchanged *= 1 - (1 - Math.exp(-cascade.hazardOf(k) * intervalMs)) * 0.5;
    }
    const expected = steps * (1 - unchanged);
    expect(changes).toBeGreaterThan(expected * 0.9);
    expect(changes).toBeLessThan(expected * 1.1);
  });

  it('keeps the multiplier positive and bounded', () => {
    const cascade = new VolatilityCascade(DEFAULT_CASCADE, derive('bounds'));
    const high = 2 - DEFAULT_CASCADE.lowMultiplier;
    let maximum = 0;
    let minimum = Number.POSITIVE_INFINITY;
    let nonPositive = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const value = cascade.advance(1_000);
      if (!(value > 0)) nonPositive += 1;
      maximum = Math.max(maximum, value);
      minimum = Math.min(minimum, value);
    }
    expect(nonPositive, 'non-positive multipliers').toBe(0);
    // Bounded by the extreme all-low and all-high products, computed by the same
    // repeated multiplication the cascade uses. `Math.pow` rounds differently
    // and can sit an ulp below the achievable maximum.
    let lowest = 1;
    let highest = 1;
    for (let k = 0; k < DEFAULT_CASCADE.components; k += 1) {
      lowest *= DEFAULT_CASCADE.lowMultiplier;
      highest *= high;
    }
    expect(minimum).toBeGreaterThanOrEqual(lowest);
    expect(maximum).toBeLessThanOrEqual(highest);
  });

  it('has a mean multiplier near one', () => {
    // Each component is a two-point distribution with unit mean, so the product
    // of independent components has unit mean too. That is what lets base
    // volatility be calibrated independently of the cascade depth.
    const cascade = new VolatilityCascade(DEFAULT_CASCADE, derive('mean'));
    let total = 0;
    const steps = 300_000;
    for (let i = 0; i < steps; i += 1) total += cascade.advance(10_000);
    expect(total / steps).toBeGreaterThan(0.75);
    expect(total / steps).toBeLessThan(1.35);
  });
});

describe('snapshot and restore', () => {
  it('reproduces a continuation exactly', () => {
    const cascade = new VolatilityCascade(DEFAULT_CASCADE, derive('snap'));
    for (let i = 0; i < 5_000; i += 1) cascade.advance(1_000);
    const state = cascade.snapshot();
    const expected = Array.from({ length: 200 }, () => cascade.advance(1_000));

    const restored = new VolatilityCascade(DEFAULT_CASCADE, derive('snap'));
    restored.restore(state);
    // The stream must be positioned identically too; re-derive and skip.
    const fresh = new VolatilityCascade(DEFAULT_CASCADE, derive('snap'));
    for (let i = 0; i < 5_000; i += 1) fresh.advance(1_000);
    fresh.restore(state);
    expect(Array.from({ length: 200 }, () => fresh.advance(1_000))).toEqual(expected);
  });

  it('rejects a snapshot with the wrong component count', () => {
    const cascade = new VolatilityCascade(DEFAULT_CASCADE, derive('mismatch'));
    expect(() => cascade.restore({ multipliers: [1, 1] })).toThrow(RangeError);
  });
});

describe('the magnitude model', () => {
  it('produces non-negative finite magnitudes', () => {
    const model = new CascadeMagnitudeModel(
      1e-5,
      DEFAULT_CASCADE,
      derive('mag-cascade'),
      derive('mag-shock'),
    );
    // Counted, not asserted per sample. A hundred thousand matcher calls cost
    // seconds of pure overhead and put this test on the unit project's 5s
    // timeout, where it failed whenever the suite ran under load.
    let invalid = 0;
    for (let i = 1; i <= 50_000; i += 1) {
      const value = model.advance(context(1_000, i));
      if (!(value >= 0) || !Number.isFinite(value)) invalid += 1;
    }
    expect(invalid, 'negative or non-finite magnitudes').toBe(0);
  });

  it('scales with base volatility', () => {
    const build = (base: number) =>
      new CascadeMagnitudeModel(base, DEFAULT_CASCADE, derive('scale-c'), derive('scale-s'));
    const small = build(1e-5);
    const large = build(1e-4);
    let smallTotal = 0;
    let largeTotal = 0;
    for (let i = 1; i <= 20_000; i += 1) {
      smallTotal += small.advance(context(1_000, i));
      largeTotal += large.advance(context(1_000, i));
    }
    expect(largeTotal / smallTotal).toBeCloseTo(10, 6);
  });

  it('rejects a non-positive base volatility', () => {
    expect(() => new CascadeMagnitudeModel(0, DEFAULT_CASCADE, derive('a'), derive('b'))).toThrow(
      RangeError,
    );
  });
});
