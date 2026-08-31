import { describe, expect, it } from 'vitest';
import {
  assertValidInstrument,
  compare,
  formatDisplayPrice,
  fromDisplayPrice,
  logPrice,
  relativeMove,
  shift,
  stepsBetween,
  toDisplayPrice,
  type InstrumentSpec,
} from './instrument.js';

const EURUSD: InstrumentSpec = {
  id: 'eurusd-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.085,
};

const BTCUSD: InstrumentSpec = {
  id: 'btcusd-otc',
  family: 'crypto',
  logQuantum: 1e-6,
  displayPrecision: 2,
  referencePrice: 64_000,
};

describe('instrument validation', () => {
  it('accepts well-formed specifications', () => {
    expect(() => assertValidInstrument(EURUSD)).not.toThrow();
    expect(() => assertValidInstrument(BTCUSD)).not.toThrow();
  });

  it.each([
    ['uppercase id', { ...EURUSD, id: 'EURUSD' }],
    ['empty id', { ...EURUSD, id: '' }],
    ['unknown family', { ...EURUSD, family: 'bond' as never }],
    ['zero quantum', { ...EURUSD, logQuantum: 0 }],
    ['negative quantum', { ...EURUSD, logQuantum: -1e-6 }],
    ['fractional precision', { ...EURUSD, displayPrecision: 2.5 }],
    ['negative precision', { ...EURUSD, displayPrecision: -1 }],
    ['zero reference price', { ...EURUSD, referencePrice: 0 }],
  ])('rejects %s', (_name, spec) => {
    expect(() => assertValidInstrument(spec as InstrumentSpec)).toThrow(RangeError);
  });
});

describe('canonical price', () => {
  it('must be a safe integer', () => {
    expect(logPrice(0)).toBe(0);
    expect(logPrice(-12_345)).toBe(-12_345);
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => logPrice(bad)).toThrow(RangeError);
    }
  });

  it('shifts by whole steps', () => {
    expect(shift(logPrice(100), -30)).toBe(70);
    expect(() => shift(logPrice(0), 0.5)).toThrow(RangeError);
  });

  it('compares exactly, which is the settlement primitive', () => {
    expect(compare(logPrice(5), logPrice(3))).toBe(1);
    expect(compare(logPrice(3), logPrice(5))).toBe(-1);
    expect(compare(logPrice(4), logPrice(4))).toBe(0);
  });

  it('reports a tie as a tie rather than resolving it', () => {
    // A tie is a genuine outcome of a discrete lattice, not a rounding artefact.
    // Its handling is a product rule, and it is the one place this architecture
    // could leak an edge if ties were awarded to the house.
    expect(compare(logPrice(0), logPrice(0))).toBe(0);
  });
});

describe('display conversion', () => {
  it.each([EURUSD, BTCUSD])('round-trips within one lattice step for $id', (spec) => {
    let worst = 0;
    for (let steps = -200_000; steps <= 200_000; steps += 977) {
      const price = logPrice(steps);
      const back = fromDisplayPrice(spec, toDisplayPrice(spec, price));
      worst = Math.max(worst, Math.abs(back - price));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('maps the lattice origin to the reference price', () => {
    expect(toDisplayPrice(EURUSD, logPrice(0))).toBeCloseTo(1.085, 12);
    expect(fromDisplayPrice(EURUSD, 1.085)).toBe(0);
  });

  it('is monotonic', () => {
    let previous = -Infinity;
    for (let steps = -5000; steps <= 5000; steps += 1) {
      const value = toDisplayPrice(EURUSD, logPrice(steps));
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('formats to the declared precision', () => {
    expect(formatDisplayPrice(EURUSD, logPrice(0))).toBe('1.08500');
    expect(formatDisplayPrice(BTCUSD, logPrice(0))).toBe('64000.00');
  });

  it('rejects non-positive display prices', () => {
    expect(() => fromDisplayPrice(EURUSD, 0)).toThrow(RangeError);
    expect(() => fromDisplayPrice(EURUSD, -1)).toThrow(RangeError);
  });
});

describe('proportionality — the property the log lattice exists for', () => {
  it('gives the same relative move for the same step count at any price level', () => {
    // This is what makes the generator able to ignore the price level entirely,
    // which is what keeps it sign-blind (ADR-0003, ADR-0004).
    const steps = 5_000;
    const moves = [-500_000, -100_000, 0, 100_000, 500_000].map((origin) =>
      relativeMove(EURUSD, logPrice(origin), logPrice(origin + steps)),
    );
    for (const move of moves) {
      expect(move).toBeCloseTo(moves[0]!, 15);
    }
  });

  it('reports a familiar percentage for a familiar step count', () => {
    // 1e-6 log units, 10_000 steps = 0.01 in log space ~ +1.005%
    expect(relativeMove(EURUSD, logPrice(0), logPrice(10_000))).toBeCloseTo(0.01005, 5);
  });

  it('is independent of the instrument reference price', () => {
    const a = relativeMove(EURUSD, logPrice(0), logPrice(3_000));
    const b = relativeMove(BTCUSD, logPrice(0), logPrice(3_000));
    expect(a).toBe(b);
  });

  it('measures distance in whole steps', () => {
    expect(stepsBetween(logPrice(100), logPrice(250))).toBe(150);
  });
});
