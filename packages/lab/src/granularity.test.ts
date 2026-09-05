import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { tickGranularity } from './granularity.js';

const tick = (sequence: number, instant: number, price: number): Tick => ({
  sequence,
  instant: epochMillis(instant),
  price: logPrice(price),
});

describe('tickGranularity', () => {
  it('measures ticks per complete minute, the boundary gap over the range, steps and intervals', () => {
    const base = 1_776_000_000_000; // a minute boundary
    // Minute 0 (partial, dropped): one tick. Minute 1: 4 ticks 0,10,-10,5 → range 20, close 5.
    // Minute 2: opens at 25 (gap 20), range 25-... ; minute 3 partial (dropped).
    const ticks: Tick[] = [
      tick(1, base - 1_000, 0),
      tick(2, base + 1_000, 0),
      tick(3, base + 2_000, 10),
      tick(4, base + 3_000, -10),
      tick(5, base + 4_000, 5),
      tick(6, base + 61_000, 25),
      tick(7, base + 62_000, 30),
      tick(8, base + 63_000, 30),
      tick(9, base + 121_000, 31),
    ];
    const report = tickGranularity(ticks);
    expect(report.minutes).toBe(2);
    expect(report.ticksPerMinute).toEqual({ median: 4, p10: 3, p90: 4 });
    // Minute 2: open 25, previous close 5 → gap 20; range 30-25 = 5 → ratio 4.
    expect(report.gapOverRange.median).toBe(4);
    expect(report.gapOverRange.shareAboveQuarter).toBe(1);
    // Two of the eight steps are zero: 0→0 at the start, 30→30 in minute 2.
    expect(report.step.zeroShare).toBeCloseTo(2 / 8);
    // Steps 0,10,20,15,20,5,0,1 → sorted 0,0,1,5,10,15,20,20 → the upper median is 10.
    expect(report.step.median).toBe(10);
    expect(report.intervalMs.median).toBe(1_000);
  });

  it('counts a minute with no ticks as a minute, and never reads across it as adjacent (PH-27.1)', () => {
    // **Cycle Audit 8 (a8), re-planted in PH-27.1.** Buckets were built from
    // ticks alone, so a complete minute with no ticks vanished: it was not a
    // minute, its zero did not reach `ticksPerMinute`, and the minute after it
    // had its opening gap measured against the close of the minute *before*
    // the hole as though the two were adjacent — on a quiet market that read
    // as a gappy chart, which is the opposite of what happened.
    const base = 1_776_000_000_000;
    const ticks: Tick[] = [
      tick(1, base - 1_000, 0),
      // Minute 0: 3 ticks, close 10.
      tick(2, base + 1_000, 0),
      tick(3, base + 2_000, 10),
      tick(4, base + 3_000, 10),
      // Minute 1: nothing.
      // Minute 2: opens at 50 — a gap of 40 from minute 0's close, but not from an adjacent minute.
      tick(5, base + 121_000, 50),
      tick(6, base + 122_000, 52),
      // Minute 3: adjacent to minute 2, opens 53 against close 52 → gap 1 over range 1.
      tick(7, base + 181_000, 53),
      tick(8, base + 182_000, 54),
      // Minute 4: partial, dropped.
      tick(9, base + 241_000, 54),
    ];
    const report = tickGranularity(ticks);
    expect(report.minutes).toBe(4);
    expect(report.quietMinutes).toBe(1);
    expect(report.ticksPerMinute.p10).toBe(0);
    // Only the adjacent pair (minutes 3 → 4) yields a boundary ratio.
    expect(report.gapOverRange.median).toBe(1);
    expect(report.gapOverRange.shareAboveQuarter).toBe(1);
  });

  it('is honest about an empty or tiny sample', () => {
    const report = tickGranularity([]);
    expect(report.minutes).toBe(0);
    expect(Number.isNaN(report.gapOverRange.median)).toBe(true);
  });
});
