import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import {
  adjustmentCoefficient,
  capacity,
  growthOptimalFraction,
  logGrowthPerEvent,
  ruinProbability,
  simulateRuin,
} from './ruin.js';

const keyring = MasterKeyring.forTesting('ruin-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'ruin', purpose, keyEpoch: 0 });

/**
 * A positive edge does not make a venue safe.
 *
 * These are about the gap between "the expectation is favourable" and "the
 * operator survives to collect it" — a gap `economics.ts` could not express.
 */

/** At the 0.99 promotional payout: lose 0.99 per unit, keep 1.00. */
const PROMOTIONAL_GAIN_RATIO = 1 / 0.99;

const book = (over: Partial<Parameters<typeof ruinProbability>[0]> = {}) => ({
  bankroll: 1_000,
  winProbability: 0.5,
  lossPerEvent: 0.99,
  gainPerEvent: 1,
  ...over,
});

describe('the operator has an edge, and it is thin', () => {
  it('earns the payout margin per event', () => {
    const result = ruinProbability(book());
    // 0.5 × 1 − 0.5 × 0.99 = 0.005 per unit staked.
    expect(result.edgePerEvent).toBeCloseTo(0.005, 9);
  });

  it('has no edge, and certain ruin, at a fair payout', () => {
    // Paying 1.00 for a fair coin is a fair game: the operator is ruined with
    // probability 1 given unlimited play, whatever the bankroll.
    const fair = ruinProbability(book({ lossPerEvent: 1, gainPerEvent: 1 }));
    expect(fair.edgePerEvent).toBeCloseTo(0, 12);
    expect(fair.probability).toBe(1);
    expect(fair.adjustmentCoefficient).toBe(0);
  });
});

describe('ruin decays exponentially in the cushion', () => {
  it('falls as bankroll grows, at a rate the coefficient states', () => {
    const small = ruinProbability(book({ bankroll: 100 }));
    const large = ruinProbability(book({ bankroll: 1_000 }));
    expect(large.probability).toBeLessThan(small.probability);
    // exp(−R·u) — a tenfold cushion is the tenth power of the small one.
    expect(large.probability).toBeCloseTo(Math.pow(small.probability, 10), 6);
  });

  it('is near certain when the bankroll is one bet', () => {
    expect(ruinProbability(book({ bankroll: 0.99 })).probability).toBeGreaterThan(0.9);
  });

  it('bounds a simulation of the same walk', () => {
    // Lundberg is an upper bound that tightens with capital. A finite horizon
    // can only ruin fewer paths than an infinite one, so the simulation must
    // come in at or below it.
    const inputs = book({ bankroll: 40 });
    const bound = ruinProbability(inputs).probability;
    const simulated = simulateRuin(inputs, 20_000, derive('walk'), 2_000);
    expect(simulated).toBeLessThanOrEqual(bound + 0.02);
    expect(bound).toBeLessThan(1);
  });
});

describe('the same money is more dangerous when concentrated', () => {
  it('raises ruin at fixed bankroll', () => {
    // PH-13.1's finding carried into survival: the same capital against a
    // hundredfold larger per-event exposure.
    const spread = ruinProbability(book({ lossPerEvent: 0.99, gainPerEvent: 1 }));
    const concentrated = ruinProbability(book({ lossPerEvent: 99, gainPerEvent: 100 }));
    expect(concentrated.probability).toBeGreaterThan(spread.probability);
    expect(concentrated.unitsOfCushion).toBeCloseTo(spread.unitsOfCushion / 100, 6);
  });
});

describe('capacity is the limit that follows', () => {
  const base = { bankroll: 1_000_000, winProbability: 0.5, gainRatio: PROMOTIONAL_GAIN_RATIO };

  it('shrinks as the tolerance tightens', () => {
    const loose = capacity({ ...base, tolerance: 0.1 });
    const tight = capacity({ ...base, tolerance: 0.0001 });
    expect(tight).toBeLessThan(loose);
    expect(tight).toBeGreaterThan(0);
  });

  it('produces a limit that binds, and holds at the limit', () => {
    // A limit calibrated so loosely it never refuses anything is theatre.
    const tolerance = 0.01;
    const limit = capacity({ ...base, tolerance });
    expect(limit).toBeLessThan(base.bankroll);
    const atLimit = ruinProbability({
      bankroll: base.bankroll,
      winProbability: base.winProbability,
      lossPerEvent: limit,
      gainPerEvent: limit * base.gainRatio,
    }).probability;
    expect(atLimit).toBeLessThanOrEqual(tolerance * 1.001);
  });

  it('scales with bankroll, so the limit is a fraction not a constant', () => {
    const small = capacity({ ...base, bankroll: 100_000, tolerance: 0.01 });
    const large = capacity({ ...base, bankroll: 1_000_000, tolerance: 0.01 });
    expect(large / small).toBeCloseTo(10, 1);
  });
});

describe('the thinness of the edge, as a number', () => {
  it('gives a growth-optimal fraction under one percent', () => {
    // The quantitative form of "a 0.25pp edge is thin protection": Kelly says
    // risk well under a percent of capital per event.
    //
    // Note the odds are the OPERATOR's — it risks 0.99 to win 1.00, so the gain
    // per unit risked is 1/0.99. Passing the trader's 0.99 returns zero, which
    // is the correct answer to a different question: the trader's Kelly stake at
    // a fair coin and a 99% payout is nothing, because the bet is unfavourable.
    const fraction = growthOptimalFraction(0.5, PROMOTIONAL_GAIN_RATIO);
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(0.01);
  });

  it('turns growth negative well before the bankroll is at risk', () => {
    const optimum = growthOptimalFraction(0.5, PROMOTIONAL_GAIN_RATIO);
    expect(logGrowthPerEvent(0.5, PROMOTIONAL_GAIN_RATIO, optimum)).toBeGreaterThan(0);
    // At 20% of capital per event the venue shrinks in expectation despite a
    // positive edge. This is how a profitable book still dies.
    expect(logGrowthPerEvent(0.5, PROMOTIONAL_GAIN_RATIO, 0.2)).toBeLessThan(0);
  });

  it('returns no edge for an unfavourable game', () => {
    expect(growthOptimalFraction(0.4, PROMOTIONAL_GAIN_RATIO)).toBe(0);
  });

  it("returns zero for the trader's side of the same contract", () => {
    // Not a bug: at a fair coin and a 99% payout the trader's optimal stake is
    // nothing. The product is supposed to be unfavourable to the trader by
    // exactly the margin, and this is that fact stated as a number.
    expect(growthOptimalFraction(0.5, 0.99)).toBe(0);
  });
});

describe('the model refuses what it cannot assess', () => {
  it('rejects impossible inputs', () => {
    expect(() => ruinProbability(book({ bankroll: 0 }))).toThrow(RangeError);
    expect(() => ruinProbability(book({ lossPerEvent: 0 }))).toThrow(RangeError);
    expect(() => ruinProbability(book({ gainPerEvent: -1 }))).toThrow(RangeError);
    expect(() => ruinProbability(book({ winProbability: 0 }))).toThrow(RangeError);
    expect(() => ruinProbability(book({ winProbability: 1 }))).toThrow(RangeError);
    expect(() => adjustmentCoefficient(book({ bankroll: -1 }))).toThrow(RangeError);
    expect(() =>
      capacity({ bankroll: 100, winProbability: 0.5, gainRatio: 1.01, tolerance: 1 }),
    ).toThrow(RangeError);
    expect(() => simulateRuin(book(), 0, derive('x'))).toThrow(RangeError);
  });
});
