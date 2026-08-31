import { describe, expect, it } from 'vitest';
import {
  assessEconomics,
  breakevenWinRate,
  expectedValuePerTrade,
  PAYOUT_PROMOTIONAL,
  PAYOUT_TYPICAL,
  profitabilityRatio,
  profitabilityThresholdPoints,
} from './economics.js';

describe('breakeven win rate', () => {
  it('is 54.05% at the typical 85% payout', () => {
    expect(breakevenWinRate(PAYOUT_TYPICAL)).toBeCloseTo(0.5405405405405406, 12);
  });

  it('is 50.25% at the 99% promotional payout', () => {
    // This is the number that governs the architecture: a quarter of a
    // percentage point of directional bias is the whole margin.
    expect(breakevenWinRate(PAYOUT_PROMOTIONAL)).toBeCloseTo(0.5025125628140703, 12);
  });

  it('states the threshold in percentage points', () => {
    expect(profitabilityThresholdPoints(PAYOUT_TYPICAL)).toBeCloseTo(4.054, 3);
    expect(profitabilityThresholdPoints(PAYOUT_PROMOTIONAL)).toBeCloseTo(0.251, 3);
  });

  it('falls as the payout rises', () => {
    let previous = 1;
    for (const payout of [0.5, 0.7, 0.85, 0.9, 0.99, 1]) {
      const breakeven = breakevenWinRate(payout);
      expect(breakeven).toBeLessThan(previous);
      previous = breakeven;
    }
    expect(breakevenWinRate(1)).toBe(0.5);
  });

  it('rejects an invalid payout', () => {
    for (const bad of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY, 101]) {
      expect(() => breakevenWinRate(bad)).toThrow(RangeError);
    }
  });
});

describe('expected value', () => {
  it('is zero exactly at breakeven', () => {
    for (const payout of [0.5, 0.85, 0.99]) {
      expect(expectedValuePerTrade(breakevenWinRate(payout), payout)).toBeCloseTo(0, 12);
    }
  });

  it('is negative for a fair coin at any payout below 100%', () => {
    expect(expectedValuePerTrade(0.5, PAYOUT_TYPICAL)).toBeCloseTo(-0.075, 12);
    expect(expectedValuePerTrade(0.5, PAYOUT_PROMOTIONAL)).toBeCloseTo(-0.005, 12);
  });

  it('quantifies the leverage-effect leak measured in PH-1', () => {
    // A 2.9pp directional bias against a 99% payout: profitable, from a process
    // that is an exact martingale.
    const assessment = assessEconomics(0.529, PAYOUT_PROMOTIONAL);
    expect(assessment.profitable).toBe(true);
    expect(assessment.expectedValue).toBeGreaterThan(0.05);
    expect(assessment.edgePoints).toBeCloseTo(2.9, 6);
  });

  it('shows the same bias is not yet profitable at 85%', () => {
    const assessment = assessEconomics(0.529, PAYOUT_TYPICAL);
    expect(assessment.profitable).toBe(false);
    expect(assessment.expectedValue).toBeLessThan(0);
  });

  it('rejects an invalid win rate', () => {
    expect(() => expectedValuePerTrade(-0.1, 0.85)).toThrow(RangeError);
    expect(() => expectedValuePerTrade(1.1, 0.85)).toThrow(RangeError);
  });
});

describe('profitability ratio', () => {
  it('is one exactly at breakeven', () => {
    expect(profitabilityRatio(breakevenWinRate(0.85), 0.85)).toBeCloseTo(1, 12);
  });

  it('exceeds one when the observer profits', () => {
    expect(profitabilityRatio(0.55, PAYOUT_PROMOTIONAL)).toBeGreaterThan(1);
    expect(profitabilityRatio(0.51, PAYOUT_TYPICAL)).toBeLessThan(1);
  });
});
