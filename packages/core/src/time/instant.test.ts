import { describe, expect, it } from 'vitest';
import {
  addMillis,
  differenceMillis,
  durationMillis,
  epochMillis,
  isValidDurationMillis,
  isValidEpochMillis,
  MAX_EPOCH_MILLIS,
  MINUTE_MS,
} from './instant.js';

describe('epochMillis', () => {
  it('accepts non-negative integers in range', () => {
    for (const v of [0, 1, 1_776_000_000_000, MAX_EPOCH_MILLIS]) {
      expect(epochMillis(v)).toBe(v);
      expect(isValidEpochMillis(v)).toBe(true);
    }
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_EPOCH_MILLIS + 1])(
    'rejects %p',
    (v) => {
      expect(isValidEpochMillis(v)).toBe(false);
      expect(() => epochMillis(v)).toThrow(RangeError);
    },
  );

  it('rejects pre-epoch instants, which would make bucket alignment sign-dependent', () => {
    expect(() => epochMillis(-1)).toThrow(RangeError);
  });
});

describe('durationMillis', () => {
  it('accepts positive integers', () => {
    expect(durationMillis(1)).toBe(1);
    expect(isValidDurationMillis(60_000)).toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects %p', (v) => {
    expect(isValidDurationMillis(v)).toBe(false);
    expect(() => durationMillis(v)).toThrow(RangeError);
  });
});

describe('instant arithmetic', () => {
  it('adds a duration', () => {
    expect(addMillis(epochMillis(1_000), MINUTE_MS)).toBe(61_000);
  });

  it('rejects addition that leaves the representable range', () => {
    expect(() => addMillis(epochMillis(MAX_EPOCH_MILLIS), MINUTE_MS)).toThrow(RangeError);
  });

  it('differences two instants', () => {
    expect(differenceMillis(epochMillis(5_000), epochMillis(2_000))).toBe(3_000);
    expect(differenceMillis(epochMillis(2_000), epochMillis(5_000))).toBe(-3_000);
  });
});
