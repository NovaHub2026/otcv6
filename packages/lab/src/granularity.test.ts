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

  it('is honest about an empty or tiny sample', () => {
    const report = tickGranularity([]);
    expect(report.minutes).toBe(0);
    expect(Number.isNaN(report.gapOverRange.median)).toBe(true);
  });
});
