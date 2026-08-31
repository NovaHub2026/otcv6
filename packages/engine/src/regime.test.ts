import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type RandomSource } from '@otc/core';
import type { MagnitudeContext } from './magnitude.js';
import {
  assertRegimeConfig,
  DEFAULT_REGIMES,
  VOLATILITY_REGIMES,
  VolatilityRegimeModulator,
  weibullSample,
  type RegimeConfig,
} from './regime.js';

const keyring = MasterKeyring.forTesting('regime-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'regime', purpose, keyEpoch: 0 });

const context = (
  intervalMs: number,
  sequence: number,
  previousMagnitude = 10,
): MagnitudeContext => ({
  intervalMs,
  previousMagnitude,
  instant: epochMillis(1_776_000_000_000 + sequence * intervalMs),
  sequence,
});

describe('configuration', () => {
  it('accepts the defaults', () => {
    expect(() => assertRegimeConfig(DEFAULT_REGIMES)).not.toThrow();
  });

  it.each([
    ['a non-positive multiplier', { multiplier: 0 }],
    ['a non-positive scale', { scaleMs: 0 }],
    ['a non-positive shape', { shape: 0 }],
    ['the wrong number of transitions', { transitions: [1, 0] }],
    ['a negative transition weight', { transitions: [0, -1, 0, 0] }],
    ['transitions that sum to zero', { transitions: [0, 0, 0, 0] }],
  ])('rejects %s', (_name, override) => {
    const broken = {
      ...DEFAULT_REGIMES,
      normal: { ...DEFAULT_REGIMES.normal, ...override },
    } as RegimeConfig;
    expect(() => assertRegimeConfig(broken)).toThrow(RangeError);
  });
});

describe('Weibull sojourns', () => {
  it('matches the distribution mean for the configured shape and scale', () => {
    // For shape k and scale L the mean is L * Gamma(1 + 1/k). At k = 0.75 that
    // is L * Gamma(2.3333) ~= 1.1907 L.
    const stream = derive('weibull-mean');
    const scale = 1_000;
    const shape = 0.75;
    let total = 0;
    const draws = 400_000;
    for (let i = 0; i < draws; i += 1) total += weibullSample(stream, scale, shape);
    expect(total / draws / scale).toBeCloseTo(1.1907, 1);
  });

  it('is heavy-tailed at shape below one', () => {
    const stream = derive('weibull-tail');
    const samples: number[] = [];
    for (let i = 0; i < 200_000; i += 1) samples.push(weibullSample(stream, 1_000, 0.7));
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length * 0.5)]!;
    const p999 = samples[Math.floor(samples.length * 0.999)]!;
    // An exponential (shape 1) gives a p99.9/median ratio near 10. Shape 0.7
    // gives a far longer tail, which is what "no characteristic duration" means.
    expect(p999 / median).toBeGreaterThan(20);
  });

  it('produces only positive finite durations', () => {
    // Counted rather than asserted per sample. Two hundred thousand expect()
    // calls cost about five seconds of matcher overhead — this test used to sit
    // exactly on the unit project's timeout and would fail whenever the suite
    // was under load, which is a latent CI failure rather than a real one.
    const stream = derive('weibull-finite');
    let invalid = 0;
    let smallest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 100_000; i += 1) {
      const value = weibullSample(stream, 500, 0.65);
      if (!(value > 0) || !Number.isFinite(value)) invalid += 1;
      if (value < smallest) smallest = value;
    }
    expect(invalid, 'non-positive or non-finite durations').toBe(0);
    expect(smallest).toBeGreaterThan(0);
  });
});

describe('the regime chain', () => {
  it('visits every regime', () => {
    const modulator = new VolatilityRegimeModulator(DEFAULT_REGIMES, derive('visits'));
    const seen = new Set<string>();
    for (let i = 1; i <= 400_000; i += 1) {
      modulator.advance(context(1_000, i));
      seen.add(modulator.regime);
    }
    expect([...seen].sort()).toEqual([...VOLATILITY_REGIMES].sort());
  });

  it('spends most time in the lower regimes, as configured', () => {
    const modulator = new VolatilityRegimeModulator(DEFAULT_REGIMES, derive('occupancy'));
    const occupancy: Record<string, number> = {};
    const steps = 500_000;
    for (let i = 1; i <= steps; i += 1) {
      modulator.advance(context(1_000, i));
      occupancy[modulator.regime] = (occupancy[modulator.regime] ?? 0) + 1;
    }
    // Stressed episodes are short and rare; compressed and normal dominate.
    expect((occupancy.stressed ?? 0) / steps).toBeLessThan(0.2);
    expect(((occupancy.compressed ?? 0) + (occupancy.normal ?? 0)) / steps).toBeGreaterThan(0.4);
  });

  it('returns the configured multiplier for the current regime', () => {
    const modulator = new VolatilityRegimeModulator(DEFAULT_REGIMES, derive('multiplier'));
    let mismatches = 0;
    for (let i = 1; i <= 50_000; i += 1) {
      const before = modulator.regime;
      const multiplier = modulator.advance(context(1_000, i));
      if (multiplier !== DEFAULT_REGIMES[before].multiplier) mismatches += 1;
    }
    expect(mismatches, 'multipliers disagreeing with the current regime').toBe(0);
  });

  it('handles an interval longer than a sojourn', () => {
    // A single tick can span several regimes. Skipping them silently would
    // distort occupancy, so the modulator consumes transitions in a loop.
    const brief: RegimeConfig = Object.fromEntries(
      VOLATILITY_REGIMES.map((regime) => [
        regime,
        { ...DEFAULT_REGIMES[regime], scaleMs: 1_000, shape: 1 },
      ]),
    ) as RegimeConfig;
    const modulator = new VolatilityRegimeModulator(brief, derive('long-interval'));
    expect(() => modulator.advance(context(100_000, 1))).not.toThrow();
    expect(VOLATILITY_REGIMES).toContain(modulator.regime);
  });

  it('refuses a degenerate configuration rather than looping forever', () => {
    const degenerate: RegimeConfig = Object.fromEntries(
      VOLATILITY_REGIMES.map((regime) => [
        regime,
        { ...DEFAULT_REGIMES[regime], scaleMs: 1e-12, shape: 1 },
      ]),
    ) as RegimeConfig;
    const modulator = new VolatilityRegimeModulator(degenerate, derive('degenerate'));
    expect(() => modulator.advance(context(1_000_000, 1))).toThrow(RangeError);
  });
});

describe('sojourns are non-lattice', () => {
  it('does not phase-lock to the candle or expiry grids', () => {
    // A regime lasting a whole number of ticks or candles would be found by the
    // battery's temporal families. Transition instants must be uniform modulo
    // every grid that matters.
    const modulator = new VolatilityRegimeModulator(DEFAULT_REGIMES, derive('lattice'));
    const transitionInstants: number[] = [];
    let previous = modulator.regime;
    let instant = 0;
    for (let i = 1; i <= 3_000_000; i += 1) {
      instant += 1_000;
      modulator.advance(context(1_000, i));
      if (modulator.regime !== previous) {
        transitionInstants.push(instant);
        previous = modulator.regime;
      }
    }
    expect(transitionInstants.length).toBeGreaterThan(500);

    for (const grid of [60_000, 900_000]) {
      const buckets = new Array<number>(10).fill(0);
      for (const t of transitionInstants) {
        buckets[Math.floor(((t % grid) / grid) * 10)]! += 1;
      }
      const expected = transitionInstants.length / 10;
      let chi = 0;
      for (const count of buckets) {
        const d = count - expected;
        chi += (d * d) / expected;
      }
      // 9 degrees of freedom, upper 0.999 critical value 27.88.
      expect(chi, `grid ${grid}: chi2=${chi.toFixed(2)}`).toBeLessThan(27.88);
    }
  });
});

describe('snapshot and restore', () => {
  it('reproduces a continuation exactly', () => {
    const modulator = new VolatilityRegimeModulator(DEFAULT_REGIMES, derive('snap'));
    for (let i = 1; i <= 20_000; i += 1) modulator.advance(context(1_000, i));
    const state = modulator.snapshot();
    const expected = Array.from({ length: 500 }, (_, i) => modulator.advance(context(1_000, i)));

    const restoredStream = derive('snap');
    const restored = new VolatilityRegimeModulator(DEFAULT_REGIMES, restoredStream);
    for (let i = 1; i <= 20_000; i += 1) restored.advance(context(1_000, i));
    restored.restore(state);
    expect(Array.from({ length: 500 }, (_, i) => restored.advance(context(1_000, i)))).toEqual(
      expected,
    );
  });

  it('rejects an unknown regime in a snapshot', () => {
    const modulator = new VolatilityRegimeModulator(DEFAULT_REGIMES, derive('bad-snap'));
    expect(() => modulator.restore({ regime: 'euphoric', remainingMs: 1 })).toThrow(RangeError);
  });
});
