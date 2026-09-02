import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type InstrumentSpec } from '@otc/core';
import { FIXTURES, fixtureByName } from './fixtures.js';
import { assertFixtureOptions, type FixtureOptions } from './types.js';

const instrument: InstrumentSpec = {
  id: 'spec-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const baseOptions = (overrides: Partial<FixtureOptions> = {}): FixtureOptions => ({
  instrument,
  keyring: MasterKeyring.forTesting('fixture-spec'),
  env: 'simulation',
  ticks: 2_000,
  startInstant: epochMillis(1_776_000_000_000),
  meanIntervalMs: 1_000,
  strength: 0.5,
  ...overrides,
});

function drain(fixtureName: string, options: FixtureOptions): number[] {
  const source = fixtureByName(fixtureName).create(options);
  const prices: number[] = [];
  for (;;) {
    const tick = source.next();
    if (tick === null) break;
    prices.push(tick.price);
  }
  return prices;
}

describe('fixture registry', () => {
  it('exposes both controls and seven planted defects', () => {
    // Two controls, not one: `symmetricControl` is the anti-predictability
    // control and `gaussianRandomWalk` is the realism control, which passes
    // every attack precisely because it is not a market. The seventh defect,
    // `biasedCoin`, is the uniform edge the battery's sensitivity is quoted
    // for (a4-01).
    expect(FIXTURES).toHaveLength(9);
    expect(FIXTURES.map((f) => f.name)).toContain('biasedCoin');
    expect(FIXTURES.map((f) => f.name)).toContain('symmetricControl');
    expect(FIXTURES.map((f) => f.name)).toContain('gaussianRandomWalk');
    expect(new Set(FIXTURES.map((f) => f.name)).size).toBe(FIXTURES.length);
  });

  it('describes each defect', () => {
    for (const fixture of FIXTURES) {
      expect(fixture.description.length).toBeGreaterThan(20);
      expect(fixture.defect.length).toBeGreaterThan(4);
      expect(fixture.targetHorizons.length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown name', () => {
    expect(() => fixtureByName('nope')).toThrow(RangeError);
  });
});

describe('fixture options', () => {
  it('refuses the production environment', () => {
    // These engines leak by construction; a production label must be impossible.
    expect(() => assertFixtureOptions(baseOptions({ env: 'production' }))).toThrow(RangeError);
    for (const fixture of FIXTURES) {
      expect(() => fixture.create(baseOptions({ env: 'production' })), fixture.name).toThrow(
        RangeError,
      );
    }
  });

  it('requires a strength in [0, 1]', () => {
    for (const strength of [-0.1, 1.1, Number.NaN]) {
      expect(() => assertFixtureOptions(baseOptions({ strength }))).toThrow(RangeError);
    }
    for (const strength of [0, 0.5, 1]) {
      expect(() => assertFixtureOptions(baseOptions({ strength }))).not.toThrow();
    }
  });

  it('requires a positive tick count and interval', () => {
    expect(() => assertFixtureOptions(baseOptions({ ticks: 0 }))).toThrow(RangeError);
    expect(() => assertFixtureOptions(baseOptions({ ticks: 1.5 }))).toThrow(RangeError);
    expect(() => assertFixtureOptions(baseOptions({ meanIntervalMs: 0 }))).toThrow(RangeError);
  });
});

describe('every fixture is reproducible', () => {
  it.each(FIXTURES.map((f) => f.name))(
    '%s produces an identical stream from identical options',
    (name) => {
      expect(drain(name, baseOptions())).toEqual(drain(name, baseOptions()));
    },
  );

  it.each(FIXTURES.map((f) => f.name))('%s differs across key epochs', (name) => {
    const a = drain(name, baseOptions({ keyEpoch: 0 }));
    const b = drain(name, baseOptions({ keyEpoch: 1 }));
    expect(a).not.toEqual(b);
  });
});

describe('every fixture produces a well-formed stream', () => {
  it.each(FIXTURES.map((f) => f.name))('%s emits ordered, finite, integer prices', (name) => {
    const source = fixtureByName(name).create(baseOptions());
    let previous = source.next()!;
    let count = 1;
    for (;;) {
      const tick = source.next();
      if (tick === null) break;
      expect(tick.sequence).toBe(previous.sequence + 1);
      expect(tick.instant).toBeGreaterThan(previous.instant);
      expect(Number.isSafeInteger(tick.price)).toBe(true);
      previous = tick;
      count += 1;
    }
    expect(count).toBe(2_000);
  });

  it.each(FIXTURES.map((f) => f.name))('%s actually moves', (name) => {
    const prices = drain(name, baseOptions());
    // displayQuantization publishes on a deliberately coarse grid — at strength
    // 0.5 that is one level per 101 lattice steps — so it visits far fewer
    // distinct values than the rest. That coarseness is the planted defect.
    const minimumDistinct = name === 'displayQuantization' ? 5 : 50;
    expect(new Set(prices).size, name).toBeGreaterThan(minimumDistinct);
    expect(prices[prices.length - 1]).not.toBe(prices[0]);
  });

  it('stays bounded at maximum strength, on every fixture', () => {
    // A fixture whose state diverges is broken, not more strongly planted: the
    // leverage variance recursion is non-stationary above its ceiling, which is
    // why strength is mapped onto a stable range rather than used directly.
    for (const fixture of FIXTURES) {
      const prices = drain(fixture.name, baseOptions({ strength: 1, ticks: 20_000 }));
      const extreme = Math.max(...prices.map((p) => Math.abs(p)));
      expect(Number.isFinite(extreme), fixture.name).toBe(true);
      expect(extreme, fixture.name).toBeLessThan(5e9);
    }
  });
});

describe('the control ignores strength', () => {
  it('produces the same stream at every strength', () => {
    const zero = drain('symmetricControl', baseOptions({ strength: 0 }));
    const full = drain('symmetricControl', baseOptions({ strength: 1 }));
    expect(full).toEqual(zero);
  });
});
