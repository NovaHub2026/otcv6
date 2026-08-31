import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type RandomSource } from '@otc/core';
import {
  assertHawkesConfig,
  DEFAULT_HAWKES,
  DurationCouplingModulator,
  HawkesArrivalModel,
} from './hawkes.js';
import type { ArrivalContext, MagnitudeContext } from './magnitude.js';

const keyring = MasterKeyring.forTesting('hawkes-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'hawkes', purpose, keyEpoch: 0 });

/** Arrival context: the model is told the interval that has already elapsed. */
const context = (
  elapsedSincePreviousMs: number,
  previousMagnitude: number,
  sequence = 1,
): ArrivalContext => ({
  elapsedSincePreviousMs,
  previousMagnitude,
  instant: epochMillis(1_776_000_000_000 + sequence * elapsedSincePreviousMs),
  sequence,
});

/** Magnitude context, for the duration-coupling modulator. */
const magnitudeContext = (
  intervalMs: number,
  previousMagnitude: number,
  sequence = 1,
): MagnitudeContext => ({
  intervalMs,
  previousMagnitude,
  instant: epochMillis(1_776_000_000_000 + sequence * intervalMs),
  sequence,
});

describe('configuration', () => {
  it('accepts the defaults', () => {
    expect(() => assertHawkesConfig(DEFAULT_HAWKES)).not.toThrow();
  });

  it('rejects an explosive branching ratio', () => {
    // Above one, each tick begets more than one successor on average and the
    // interval collapses toward zero.
    expect(() => assertHawkesConfig({ ...DEFAULT_HAWKES, branchingRatio: 1.5 })).toThrow(
      RangeError,
    );
  });

  it.each([
    ['a non-positive base interval', { baseIntervalMs: 0 }],
    ['a negative branching ratio', { branchingRatio: -1 }],
    ['a non-positive decay', { decayPerMs: 0 }],
    ['a non-positive reference magnitude', { referenceMagnitude: 0 }],
    ['a clamp at or below one', { maxIntensityMultiplier: 1 }],
  ])('rejects %s', (_name, override) => {
    expect(() => assertHawkesConfig({ ...DEFAULT_HAWKES, ...override })).toThrow(RangeError);
  });
});

describe('the intensity responds to activity', () => {
  it('shortens intervals during a burst of above-average magnitudes', () => {
    // Excitation is normalised against a running average, so it responds to
    // magnitudes that are large *relative to recent activity*. A market that is
    // quiet in absolute terms should not tick slowly forever — that is the whole
    // reason the reference is adaptive rather than fixed.
    const model = new HawkesArrivalModel(DEFAULT_HAWKES, derive('burst'));

    // Establish a baseline at a steady magnitude.
    let baselineTotal = 0;
    for (let i = 1; i <= 4_000; i += 1) {
      baselineTotal += model.nextIntervalMs(context(1_000, 10, i));
    }
    const baselineMean = baselineTotal / 4_000;

    // Then a short burst several times the running average.
    let burstTotal = 0;
    const burst = 300;
    for (let i = 4_001; i <= 4_000 + burst; i += 1) {
      burstTotal += model.nextIntervalMs(context(200, 60, i));
    }
    expect(burstTotal / burst).toBeLessThan(baselineMean * 0.8);
  });

  it('treats a steady quiet market the same as a steady busy one', () => {
    // Two markets differing only in absolute scale must tick at the same rate:
    // the adaptive reference removes the level, leaving only the dynamics.
    const quiet = new HawkesArrivalModel(DEFAULT_HAWKES, derive('scale'));
    const busy = new HawkesArrivalModel(DEFAULT_HAWKES, derive('scale'));
    // Warm up first: the running average starts at the configured reference and
    // takes time to reach each market's own level, and that transient is not
    // what this test is about.
    for (let i = 1; i <= 40_000; i += 1) {
      quiet.nextIntervalMs(context(1_000, 3, i));
      busy.nextIntervalMs(context(1_000, 300, i));
    }
    let quietTotal = 0;
    let busyTotal = 0;
    for (let i = 40_001; i <= 60_000; i += 1) {
      quietTotal += quiet.nextIntervalMs(context(1_000, 3, i));
      busyTotal += busy.nextIntervalMs(context(1_000, 300, i));
    }
    expect(busyTotal / quietTotal).toBeGreaterThan(0.9);
    expect(busyTotal / quietTotal).toBeLessThan(1.1);
  });

  it('decays excitation when nothing happens', () => {
    const model = new HawkesArrivalModel(DEFAULT_HAWKES, derive('decay'));
    for (let i = 1; i <= 200; i += 1) model.nextIntervalMs(context(1_000, 60, i));
    const excited = model.intensityMultiplier;
    expect(excited).toBeGreaterThan(1.5);

    // A long quiet gap with no magnitude should bring it back toward one.
    for (let i = 1; i <= 20; i += 1) model.nextIntervalMs(context(120_000, 0, i));
    expect(model.intensityMultiplier).toBeLessThan(1.05);
  });

  it('never returns an interval below one millisecond', () => {
    const model = new HawkesArrivalModel(DEFAULT_HAWKES, derive('floor'));
    let invalid = 0;
    let smallest = Number.POSITIVE_INFINITY;
    for (let i = 1; i <= 50_000; i += 1) {
      const interval = model.nextIntervalMs(context(1, 500, i));
      if (!Number.isInteger(interval) || interval < 1) invalid += 1;
      if (interval < smallest) smallest = interval;
    }
    expect(invalid, 'non-integer or sub-millisecond intervals').toBe(0);
    expect(smallest).toBeGreaterThanOrEqual(1);
  });
});

describe('stability', () => {
  it('does not run away over a long feedback loop', () => {
    // The interval the model returns is fed straight back as the elapsed time,
    // which is the arrangement that would explode if the branching ratio were
    // wrong. The clamp is a backstop; this asserts the unclamped process is sane.
    const model = new HawkesArrivalModel(DEFAULT_HAWKES, derive('stability'));
    let interval = DEFAULT_HAWKES.baseIntervalMs;
    let total = 0;
    const ticks = 200_000;
    for (let i = 1; i <= ticks; i += 1) {
      interval = model.nextIntervalMs(context(interval, DEFAULT_HAWKES.referenceMagnitude, i));
      total += interval;
    }
    const mean = total / ticks;
    // Excitation raises the rate, so the mean interval sits below the base — but
    // it must not collapse.
    expect(mean).toBeGreaterThan(100);
    expect(mean).toBeLessThan(DEFAULT_HAWKES.baseIntervalMs);
    expect(model.intensityMultiplier).toBeLessThanOrEqual(DEFAULT_HAWKES.maxIntensityMultiplier);
  });

  it('clamps the intensity under a pathological magnitude sequence', () => {
    const model = new HawkesArrivalModel(DEFAULT_HAWKES, derive('clamp'));
    for (let i = 1; i <= 5_000; i += 1) model.nextIntervalMs(context(1, 100_000, i));
    expect(model.intensityMultiplier).toBe(DEFAULT_HAWKES.maxIntensityMultiplier);
  });
});

describe('snapshot and restore', () => {
  it('reproduces a continuation exactly', () => {
    const model = new HawkesArrivalModel(DEFAULT_HAWKES, derive('snap'));
    for (let i = 1; i <= 5_000; i += 1) model.nextIntervalMs(context(1_000, 12, i));
    const state = model.snapshot();
    const expected = Array.from({ length: 300 }, (_, i) =>
      model.nextIntervalMs(context(1_000, 12, i)),
    );

    const restored = new HawkesArrivalModel(DEFAULT_HAWKES, derive('snap'));
    for (let i = 1; i <= 5_000; i += 1) restored.nextIntervalMs(context(1_000, 12, i));
    restored.restore(state);
    expect(
      Array.from({ length: 300 }, (_, i) => restored.nextIntervalMs(context(1_000, 12, i))),
    ).toEqual(expected);
  });

  it('rejects an invalid snapshot', () => {
    const model = new HawkesArrivalModel(DEFAULT_HAWKES, derive('bad'));
    expect(() => model.restore({ excitation: -1 })).toThrow(RangeError);
    expect(() => model.restore({ excitation: Number.NaN })).toThrow(RangeError);
  });
});

describe('duration coupling', () => {
  it('has no effect at exponent zero', () => {
    const coupling = new DurationCouplingModulator(0, 5_000);
    for (const interval of [1, 100, 5_000, 60_000]) {
      expect(coupling.advance(magnitudeContext(interval, 10))).toBe(1);
    }
  });

  it('scales as the square root of the interval at exponent one half', () => {
    // Volatility from elapsed time: a gap twice as long carries sqrt(2) times
    // the move, so variance per unit time is constant.
    const coupling = new DurationCouplingModulator(0.5, 5_000);
    expect(coupling.advance(magnitudeContext(5_000, 10))).toBeCloseTo(1, 9);
    expect(coupling.advance(magnitudeContext(20_000, 10))).toBeCloseTo(2, 9);
    expect(coupling.advance(magnitudeContext(1_250, 10))).toBeCloseTo(0.5, 9);
  });

  it('is monotonic in the interval', () => {
    const coupling = new DurationCouplingModulator(0.35, 5_000);
    let previous = 0;
    for (let interval = 1; interval <= 60_000; interval += 137) {
      const value = coupling.advance(magnitudeContext(interval, 10));
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('rejects an exponent outside [0, 1]', () => {
    expect(() => new DurationCouplingModulator(-0.1, 1_000)).toThrow(RangeError);
    expect(() => new DurationCouplingModulator(1.1, 1_000)).toThrow(RangeError);
    expect(() => new DurationCouplingModulator(0.5, 0)).toThrow(RangeError);
  });
});
