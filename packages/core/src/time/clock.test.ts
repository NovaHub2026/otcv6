import { describe, expect, it } from 'vitest';
import { FixedClock, SteppableClock, SystemClock } from './clock.js';
import { epochMillis, MINUTE_MS, SECOND_MS } from './instant.js';

describe('SystemClock', () => {
  it('reports a plausible current instant', () => {
    const before = Date.now();
    const now = new SystemClock().now();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
    expect(Number.isInteger(now)).toBe(true);
  });
});

describe('FixedClock', () => {
  it('never moves', () => {
    const clock = new FixedClock(epochMillis(1_776_000_000_000));
    expect(clock.now()).toBe(1_776_000_000_000);
    expect(clock.now()).toBe(clock.now());
  });
});

describe('SteppableClock', () => {
  it('moves only when advanced', () => {
    const clock = new SteppableClock(epochMillis(1_000));
    expect(clock.now()).toBe(1_000);
    expect(clock.advance(SECOND_MS)).toBe(2_000);
    expect(clock.now()).toBe(2_000);
    clock.advance(MINUTE_MS);
    expect(clock.now()).toBe(62_000);
  });

  it('can be set directly', () => {
    const clock = new SteppableClock(epochMillis(1_000));
    clock.set(epochMillis(500_000));
    expect(clock.now()).toBe(500_000);
  });

  it('rejects an advance that leaves the representable range', () => {
    const clock = new SteppableClock(epochMillis(8_639_999_999_999_999));
    expect(() => clock.advance(MINUTE_MS)).toThrow(RangeError);
  });
});
