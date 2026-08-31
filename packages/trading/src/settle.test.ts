// Invariant evidence: INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis } from '@otc/core';
import { DEFAULT_AT_MONEY_POLICY, type Contract } from './contract.js';
import { NotSettleableError, settle, tally, type TickRecord } from './settle.js';

/** A record with ticks every second, at the prices given. */
function record(prices: number[], startMs = 1_000_000): TickRecord {
  return {
    instants: new Float64Array(prices.map((_, i) => startMs + i * 1_000)),
    prices: Int32Array.from(prices),
  };
}

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'c1',
    assetId: 'eurusd',
    direction: 'up',
    stake: 100,
    entryInstant: epochMillis(1_002_000),
    horizonMs: durationMillis(3_000),
    payoutRatio: 0.85,
    ...overrides,
  };
}

describe('settlement resolves against the published record', () => {
  const rising = record([0, 10, 20, 30, 40, 50, 60, 70]);

  it('pays a correct up call', () => {
    const settlement = settle(contract(), rising);
    expect(settlement.outcome).toBe('win');
    expect(settlement.entryPrice).toBe(20);
    expect(settlement.expiryPrice).toBe(50);
    expect(settlement.returned).toBe(185);
    expect(settlement.net).toBe(85);
  });

  it('loses a wrong down call on the same data', () => {
    const settlement = settle(contract({ direction: 'down' }), rising);
    expect(settlement.outcome).toBe('loss');
    expect(settlement.returned).toBe(0);
    expect(settlement.net).toBe(-100);
  });

  it('records what a dispute would need', () => {
    // "You lost" is not an explanation. INV-009 asks for an outcome to be
    // explainable, and these fields are what makes it checkable by anyone
    // holding the ticks.
    const settlement = settle(contract(), rising);
    expect(settlement.entryIndex).toBe(2);
    expect(settlement.expiryIndex).toBe(5);
    expect(settlement.expiryInstant).toBe(1_005_000);
  });

  it('uses the price in force, not the nearest tick', () => {
    // Entry between ticks resolves to the last tick at or before it — the same
    // rule the charts draw and the battery samples.
    const settlement = settle(contract({ entryInstant: epochMillis(1_002_700) }), rising);
    expect(settlement.entryPrice).toBe(20);
  });

  it('is a pure function of the record', () => {
    const a = settle(contract(), rising);
    const b = settle(contract(), record([0, 10, 20, 30, 40, 50, 60, 70]));
    expect(a).toEqual(b);
  });
});

describe('at-the-money is refunded (ADR-0007)', () => {
  const flat = record([0, 10, 20, 20, 20, 20, 20, 20]);

  it('refunds by default', () => {
    const settlement = settle(contract(), flat);
    expect(DEFAULT_AT_MONEY_POLICY).toBe('refund');
    expect(settlement.outcome).toBe('refund');
    expect(settlement.returned).toBe(100);
    expect(settlement.net).toBe(0);
  });

  it('refunds a down call identically', () => {
    // The point of a refund: direction stops mattering when nothing happened.
    expect(settle(contract({ direction: 'down' }), flat).net).toBe(0);
  });

  it('still supports the alternatives, because a venue is a configuration', () => {
    expect(settle(contract(), flat, 'loss').outcome).toBe('loss');
    expect(settle(contract(), flat, 'loss').net).toBe(-100);
    expect(settle(contract(), flat, 'win').outcome).toBe('win');
    expect(settle(contract(), flat, 'win').net).toBe(85);
  });
});

describe('settlement refuses rather than guesses', () => {
  const ticks = record([0, 10, 20, 30]);

  it('will not settle a contract that has not expired', () => {
    expect(() => settle(contract({ horizonMs: durationMillis(60_000) }), ticks)).toThrow(
      NotSettleableError,
    );
  });

  it('will not settle an entry before the record begins', () => {
    expect(() => settle(contract({ entryInstant: epochMillis(1) }), ticks)).toThrow(
      NotSettleableError,
    );
  });

  it('rejects malformed contracts', () => {
    expect(() => settle(contract({ stake: 0 }), ticks)).toThrow(/Stake must be positive/);
    expect(() => settle(contract({ payoutRatio: -1 }), ticks)).toThrow(/Payout ratio/);
    expect(() => settle(contract({ horizonMs: durationMillis(1) }), ticks)).not.toThrow();
  });
});

describe('the ledger reports the operator margin honestly', () => {
  it('shows the payout as the only edge when the coin is fair', () => {
    // A fair market at an 85% payout: a trader winning exactly half loses 7.5%
    // of everything staked. That is the advertised edge and, under ADR-0007,
    // the whole of it.
    const settlements = [];
    const stakes = [];
    for (let i = 0; i < 1_000; i += 1) {
      const rising = i % 2 === 0;
      const ticks = record(rising ? [0, 10, 20, 30, 40, 50] : [0, 10, 20, 10, 0, -10]);
      settlements.push(settle(contract({ id: `c${i}` }), ticks));
      stakes.push(100);
    }
    const ledger = tally(settlements, stakes);
    expect(ledger.wins + ledger.losses).toBe(1_000);
    expect(ledger.winRateOfDecided).toBeCloseTo(0.5, 6);
    expect(ledger.operatorMargin).toBeCloseTo(0.075, 6);
  });

  it('excludes refunds from the win rate', () => {
    const flat = record([0, 10, 20, 20, 20, 20]);
    const rising = record([0, 10, 20, 30, 40, 50]);
    const settlements = [settle(contract(), flat), settle(contract({ id: 'c2' }), rising)];
    const ledger = tally(settlements, [100, 100]);
    expect(ledger.refunds).toBe(1);
    expect(ledger.winRateOfDecided).toBe(1);
    // A refund returns the stake, so it contributes nothing to margin either way.
    expect(ledger.operatorMargin).toBeCloseTo(-0.425, 6);
  });

  it('rejects mismatched stakes', () => {
    expect(() => tally([], [1])).toThrow(RangeError);
  });
});
