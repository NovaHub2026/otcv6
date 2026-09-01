// Invariant evidence: INV-001 (economic independence).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring } from '@otc/core';
import { assessBookRisk, exposureByEvent } from './exposure.js';
import type { Contract } from './contract.js';

/**
 * The operator's risk, and the one number `economics.ts` cannot produce.
 *
 * Four cycles established that the expected edge is exactly the payout margin.
 * These tests are about the *spread* around it, which is what decides whether a
 * venue survives a crowded expiry.
 */

const PAYOUT = 0.99;

function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: `c-${Math.random().toString(36).slice(2)}`,
    assetId: 'eurusd',
    direction: 'up',
    stake: 100,
    entryInstant: epochMillis(1_776_000_000_000),
    horizonMs: durationMillis(30_000),
    payoutRatio: PAYOUT,
    ...over,
  };
}

describe('contracts sharing a settlement event are one bet', () => {
  it('groups by asset, entry and expiry', () => {
    const book = [contract(), contract(), contract()];
    expect(exposureByEvent(book)).toHaveLength(1);
  });

  it('separates different assets, entries and horizons', () => {
    const book = [
      contract(),
      contract({ assetId: 'btcusd' }),
      contract({ entryInstant: epochMillis(1_776_000_001_000) }),
      contract({ horizonMs: durationMillis(60_000) }),
    ];
    expect(exposureByEvent(book)).toHaveLength(4);
  });

  it('makes a thousand crowded contracts one effective bet', () => {
    // The finding this module exists for. A thousand identical contracts carry
    // the variance of ONE bet at a thousand times the stake — none of the √1000
    // dilution that independence would give.
    const crowded = Array.from({ length: 1_000 }, () => contract());
    const spread = Array.from({ length: 1_000 }, (_, i) =>
      contract({ entryInstant: epochMillis(1_776_000_000_000 + i * 60_000) }),
    );

    const crowdedRisk = assessBookRisk(crowded);
    const spreadRisk = assessBookRisk(spread);

    expect(crowdedRisk.effectiveBets).toBeCloseTo(1, 6);
    expect(spreadRisk.effectiveBets).toBeCloseTo(1_000, 6);

    // Same stake, same expectation, wildly different risk.
    expect(crowdedRisk.totalStaked).toBe(spreadRisk.totalStaked);
    expect(crowdedRisk.expectedProfit).toBeCloseTo(spreadRisk.expectedProfit, 9);
    expect(crowdedRisk.standardDeviation / spreadRisk.standardDeviation).toBeCloseTo(
      Math.sqrt(1_000),
      1,
    );
  });
});

describe('opposing contracts net exactly', () => {
  it('cancels a CALL and a PUT of equal stake on one event', () => {
    // One pays exactly when the other does not, so the operator's position is
    // flat whatever happens. This is why total staked is the wrong risk number.
    const [exposure] = exposureByEvent([contract(), contract({ direction: 'down' })]);
    expect(exposure!.netExposure).toBe(0);
    expect(exposure!.adverseDirection).toBeNull();
  });

  it('leaves the residual when the sides are uneven', () => {
    const [exposure] = exposureByEvent([
      contract({ stake: 300 }),
      contract({ direction: 'down', stake: 100 }),
    ]);
    expect(exposure!.netExposure).toBeCloseTo(200 * PAYOUT, 9);
    expect(exposure!.adverseDirection).toBe('up');
  });

  it('gives a perfectly hedged book zero risk and a positive expectation', () => {
    // The operator's dream: it earns the margin on both sides and cannot lose.
    const book = [contract({ stake: 500 }), contract({ direction: 'down', stake: 500 })];
    const risk = assessBookRisk(book);
    expect(risk.standardDeviation).toBe(0);
    expect(risk.worstCase).toBe(0);
    expect(risk.expectedProfit).toBeCloseTo((1_000 * (1 - PAYOUT)) / 2, 9);
  });
});

describe('the risk numbers are what they claim', () => {
  it('expects the payout margin on total stake', () => {
    const book = Array.from({ length: 50 }, (_, i) =>
      contract({ entryInstant: epochMillis(1_776_000_000_000 + i * 60_000) }),
    );
    const risk = assessBookRisk(book);
    expect(risk.expectedProfit).toBeCloseTo((risk.totalStaked * (1 - PAYOUT)) / 2, 9);
  });

  it('reports a worst case that is arithmetic, not a tail estimate', () => {
    const book = [
      contract({ stake: 100 }),
      contract({ stake: 200, entryInstant: epochMillis(1_776_000_100_000) }),
    ];
    expect(assessBookRisk(book).worstCase).toBeCloseTo(300 * PAYOUT, 9);
  });

  it('matches a simulation of the same book', () => {
    // The model is arithmetic; this checks the arithmetic describes reality.
    const book = Array.from({ length: 40 }, (_, i) =>
      contract({ stake: 100 + i, entryInstant: epochMillis(1_776_000_000_000 + i * 60_000) }),
    );
    const risk = assessBookRisk(book);
    const events = exposureByEvent(book);

    const keyring = MasterKeyring.forTesting('exposure-simulation');
    const stream = keyring.derive({ env: 'test', asset: 'risk', purpose: 'coin', keyEpoch: 0 });

    const trials = 20_000;
    let total = 0;
    let totalSquared = 0;
    for (let t = 0; t < trials; t += 1) {
      let profit = 0;
      for (const e of events) {
        // Each event: a fair coin decides whether the operator pays the net
        // exposure or keeps the losing side's stake.
        const operatorWins = stream.nextBoolean();
        profit += operatorWins ? e.netExposure / 2 : -e.netExposure / 2;
      }
      total += profit;
      totalSquared += profit * profit;
    }
    const mean = total / trials;
    const sd = Math.sqrt(totalSquared / trials - mean * mean);

    // The coin is fair, so the simulated mean is zero — the expectation in the
    // model comes from the payout margin, which a fair coin does not produce.
    expect(Math.abs(mean)).toBeLessThan(4 * (risk.standardDeviation / Math.sqrt(trials)));
    expect(sd / risk.standardDeviation).toBeCloseTo(1, 1);
  });
});

describe('the model reports its own assumption', () => {
  it('counts events whose windows overlap', () => {
    // Independence across events holds for disjoint windows. Overlapping ones
    // share sign draws, and a risk number that hid that would be worse than none.
    const overlapping = [
      contract({ horizonMs: durationMillis(900_000) }),
      contract({
        entryInstant: epochMillis(1_776_000_060_000),
        horizonMs: durationMillis(900_000),
      }),
    ];
    expect(assessBookRisk(overlapping).overlappingEvents).toBe(2);
  });

  it('reports none when windows are disjoint', () => {
    const disjoint = [contract(), contract({ entryInstant: epochMillis(1_776_000_060_000) })];
    expect(assessBookRisk(disjoint).overlappingEvents).toBe(0);
  });

  it('does not treat different assets as overlapping', () => {
    // Cryptographically separate streams (ADR-0002): same window, no shared
    // randomness at all.
    const book = [contract(), contract({ assetId: 'btcusd' })];
    expect(assessBookRisk(book).overlappingEvents).toBe(0);
  });
});

describe('the model refuses what it cannot assess', () => {
  it('rejects a non-positive stake', () => {
    expect(() => exposureByEvent([contract({ stake: 0 })])).toThrow(RangeError);
    expect(() => exposureByEvent([contract({ stake: -1 })])).toThrow(RangeError);
    expect(() => exposureByEvent([contract({ stake: Number.NaN })])).toThrow(RangeError);
  });

  it('handles an empty book without dividing by zero', () => {
    const risk = assessBookRisk([]);
    expect(risk.effectiveBets).toBe(0);
    expect(risk.standardDeviation).toBe(0);
    expect(risk.worstCase).toBe(0);
  });
});
