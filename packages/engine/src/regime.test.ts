import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type RandomSource } from '@otc/core';
import type { MagnitudeContext } from './magnitude.js';
import { pow } from '@otc/core';
import {
  assertRegimeConfig,
  DEFAULT_REGIMES,
  REGIME_DURATIONS,
  REGIME_LEVELS,
  splitRegimeLevel,
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
    ['a non-positive activity', { activity: 0 }],
    ['a negative minimum', { minimumMs: -1 }],
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
        { ...DEFAULT_REGIMES[regime], minimumMs: 0, scaleMs: 1_000, shape: 1 },
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
        { ...DEFAULT_REGIMES[regime], minimumMs: 0, scaleMs: 1e-12, shape: 1 },
      ]),
    ) as RegimeConfig;
    const modulator = new VolatilityRegimeModulator(degenerate, derive('degenerate'));
    expect(() => modulator.advance(context(1_000_000, 1))).toThrow(RangeError);
  });
});

/**
 * PH-34: what the Human Owner saw and asked for. "Vi que muchos activos en una
 * vela está en un régimen y ya en la otra cambia […] que el régimen más alto
 * sea el que menos dure pero tampoco una vela."
 */
describe('regimes last like a market, and move as a ladder (PH-34)', () => {
  /** Every completed sojourn of a long run, by regime, in milliseconds. */
  function sojourns(stream: string, steps = 2_000_000): Record<string, number[]> {
    const modulator = new VolatilityRegimeModulator(DEFAULT_REGIMES, derive(stream));
    const out: Record<string, number[]> = {};
    let current = modulator.regime;
    let since = 0;
    let first = true;
    for (let i = 1; i <= steps; i += 1) {
      modulator.advance(context(1_000, i));
      since += 1_000;
      if (modulator.regime !== current) {
        // The first sojourn started before anything was observed; skip it.
        if (!first) (out[current] ??= []).push(since);
        first = false;
        current = modulator.regime;
        since = 0;
      }
    }
    return out;
  }

  it('never ends a regime before its minimum', () => {
    const observed = sojourns('minimum');
    for (const regime of VOLATILITY_REGIMES) {
      const lengths = observed[regime] ?? [];
      expect(lengths.length, `${regime} was visited`).toBeGreaterThan(20);
      // A one-second step can end a sojourn up to a second late, never early.
      expect(Math.min(...lengths), regime).toBeGreaterThanOrEqual(
        REGIME_DURATIONS[regime].minimumMs,
      );
    }
  });

  it('makes the highest regime the shortest, and never a single five-minute candle', () => {
    const observed = sojourns('ordering');
    const median = (values: readonly number[]): number =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    const stressed = median(observed.stressed!);
    for (const regime of ['compressed', 'normal', 'elevated'] as const) {
      expect(stressed, `stressed against ${regime}`).toBeLessThan(median(observed[regime]!));
    }
    expect(Math.min(...observed.stressed!)).toBeGreaterThanOrEqual(2 * 5 * 60_000);
  });

  it('moves one step at a time, up or down', () => {
    const modulator = new VolatilityRegimeModulator(DEFAULT_REGIMES, derive('ladder'));
    let previous = VOLATILITY_REGIMES.indexOf(modulator.regime);
    const steps = new Set<number>();
    for (let i = 1; i <= 2_000_000; i += 1) {
      modulator.advance(context(1_000, i));
      const now = VOLATILITY_REGIMES.indexOf(modulator.regime);
      if (now !== previous) steps.add(now - previous);
      previous = now;
    }
    expect([...steps].sort()).toEqual([-1, 1]);
  });

  it('reports the activity of the regime in force, for the arrival model', () => {
    const modulator = new VolatilityRegimeModulator(DEFAULT_REGIMES, derive('activity'));
    let mismatches = 0;
    for (let i = 1; i <= 200_000; i += 1) {
      modulator.advance(context(1_000, i));
      if (modulator.activity !== DEFAULT_REGIMES[modulator.regime].activity) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });

  it('puts calm above the real market, and each level above the one below', () => {
    expect(REGIME_LEVELS.compressed).toBeGreaterThan(1);
    for (let i = 1; i < VOLATILITY_REGIMES.length; i += 1) {
      expect(REGIME_LEVELS[VOLATILITY_REGIMES[i]!]).toBeGreaterThan(
        REGIME_LEVELS[VOLATILITY_REGIMES[i - 1]!],
      );
    }
  });
});

describe('a level is split between tick rate and size (PH-34)', () => {
  it.each([
    [0.8, 0.25, 0],
    [2.3, 0.25, 0],
    [2.3, 0.6, 0],
    [0.8, 0.3, 1.1],
  ])(
    'keeps variance per unit time at level² (level %s, coupling %s, floor %s)',
    (level, h, floor) => {
      const { activity, multiplier } = splitRegimeLevel(level, h, floor);
      // rate × size², where faster ticks mean shorter intervals and the duration
      // coupling shrinks each tick by rate^(−h).
      const variancePerTime = activity * pow(multiplier * pow(activity, -h), 2);
      expect(variancePerTime).toBeCloseTo(level * level, 12);
    },
  );

  it('carries half of the variance as ticks when nothing floors the rate', () => {
    expect(splitRegimeLevel(2.3, 0.25).activity).toBeCloseTo(2.3, 15);
  });

  it('raises the rate to the floor and shrinks the size to match', () => {
    const floored = splitRegimeLevel(0.8, 0.25, 1.1);
    expect(floored.activity).toBe(1.1);
    expect(floored.multiplier).toBeLessThan(splitRegimeLevel(0.8, 0.25).multiplier);
  });

  it('refuses a level that is not positive', () => {
    expect(() => splitRegimeLevel(0, 0.25)).toThrow(RangeError);
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
