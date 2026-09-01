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

  it('matches a simulation that settles the contracts, not the model', () => {
    // **Cycle Audit 5, CA5-08.** This simulated `e.netExposure / 2` — the
    // model's own quantity — so it validated the model against itself, and went
    // on passing while the reported spread was short by a factor of `(1+r)/r`.
    // It now resolves each event with a coin and pays the contracts out by the
    // same arithmetic `settle.ts` uses: a winner returns `stake·(1+r)`, so the
    // operator pays `stake·r`; a loser returns nothing, so the operator keeps
    // `stake`.
    const book = Array.from({ length: 40 }, (_, i) =>
      contract({ stake: 100 + i, entryInstant: epochMillis(1_776_000_000_000 + i * 60_000) }),
    );
    const risk = assessBookRisk(book);

    const byEvent = new Map<string, Contract[]>();
    for (const c of book) {
      const key = `${c.assetId}|${c.entryInstant}|${c.entryInstant + c.horizonMs}`;
      byEvent.set(key, [...(byEvent.get(key) ?? []), c]);
    }

    const keyring = MasterKeyring.forTesting('exposure-simulation');
    const stream = keyring.derive({ env: 'test', asset: 'risk', purpose: 'coin', keyEpoch: 0 });

    const trials = 20_000;
    let total = 0;
    let totalSquared = 0;
    for (let t = 0; t < trials; t += 1) {
      let profit = 0;
      for (const group of byEvent.values()) {
        const rose = stream.nextBoolean();
        for (const c of group) {
          const won = (c.direction === 'up') === rose;
          profit += won ? -c.stake * c.payoutRatio : c.stake;
        }
      }
      total += profit;
      totalSquared += profit * profit;
    }
    const mean = total / trials;
    const sd = Math.sqrt(totalSquared / trials - mean * mean);

    // Both moments, against the model. The mean is the payout margin the
    // operator actually collects, which the old simulation could not see at all
    // because a fair coin over `net/2` has mean zero by construction.
    expect(sd / risk.standardDeviation).toBeCloseTo(1, 1);
    // The mean is compared against its own standard error, not with a fixed
    // tolerance. At a spread of ~755 over 20,000 trials the sample mean carries
    // a standard error of ~5.3 against a model expectation of ~24 — a 22%
    // relative error, so `toBeCloseTo(1)` on the ratio would fail on ordinary
    // noise and pass or fail for reasons unrelated to the model.
    const standardError = sd / Math.sqrt(trials);
    expect(Math.abs(mean - risk.expectedProfit)).toBeLessThan(4 * standardError);
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
