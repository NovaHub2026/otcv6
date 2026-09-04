import { describe, expect, it } from 'vitest';
import { formatCountdown } from './countdown.js';

/**
 * Cycle Audit 8 (a2): the clock the operator reads.
 *
 * Two screens depend on this being right to the second — the candle countdown
 * (PH-24.22) and the remaining time on a sustained direction (PH-24.24) — and
 * nothing tested it. An auditor changed `Math.ceil` to `Math.floor` and every
 * step of `npm run gate` stayed green, including both browser suites with a
 * real Chromium: the countdown then read `0:00` for the last full second of
 * every candle, which is the second in which an operator decides.
 */
describe('a countdown reads as a clock does', () => {
  it('rounds up, so 0:00 means the time is gone and not merely nearly gone', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(500)).toBe('0:01');
    expect(formatCountdown(999)).toBe('0:01');
    expect(formatCountdown(1_000)).toBe('0:01');
    expect(formatCountdown(1_001)).toBe('0:02');
  });

  it('never shows a negative time', () => {
    expect(formatCountdown(-1)).toBe('0:00');
    expect(formatCountdown(-60_000)).toBe('0:00');
  });

  it('carries minutes, and pads the seconds', () => {
    expect(formatCountdown(59_000)).toBe('0:59');
    expect(formatCountdown(60_000)).toBe('1:00');
    expect(formatCountdown(60_001)).toBe('1:01');
    expect(formatCountdown(119_000)).toBe('1:59');
    expect(formatCountdown(120_000)).toBe('2:00');
    expect(formatCountdown(600_000)).toBe('10:00');
  });

  it('adds hours only when asked, and pads the minutes then', () => {
    expect(formatCountdown(3_600_000)).toBe('60:00');
    expect(formatCountdown(3_600_000, true)).toBe('1:00:00');
    expect(formatCountdown(3_661_000, true)).toBe('1:01:01');
    expect(formatCountdown(59_000, true)).toBe('0:00:59');
    expect(formatCountdown(86_400_000, true)).toBe('24:00:00');
  });
});
