// Invariant evidence: INV-001 (economic independence).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis } from '@otc/core';
import { admit, breaches } from './limiter.js';
import type { Contract } from './contract.js';

const PAYOUT = 0.99;
let counter = 0;
function contract(over: Partial<Contract> = {}): Contract {
  counter += 1;
  return {
    id: `c${counter}`,
    assetId: 'eurusd',
    direction: 'up',
    stake: 100,
    entryInstant: epochMillis(1_776_000_000_000),
    horizonMs: durationMillis(30_000),
    payoutRatio: PAYOUT,
    ...over,
  };
}

const policy = { maxEventExposure: 500 };

describe('the limiter refuses concentration, not volume', () => {
  it('accepts a book within the limit', () => {
    const open = [contract(), contract()];
    expect(admit(open, contract(), policy).accepted).toBe(true);
  });

  it('refuses the contract that would breach one event', () => {
    // Five contracts of 100 at 0.99 is 495 of exposure; the sixth crosses 500.
    const open = Array.from({ length: 5 }, () => contract());
    const decision = admit(open, contract(), policy);
    expect(decision.accepted).toBe(false);
    if (decision.accepted) return;
    expect(decision.wouldBe).toBeCloseTo(594, 6);
    expect(decision.limit).toBe(500);
  });

  it('names the event and the limit so a trader can see why', () => {
    const open = Array.from({ length: 6 }, () => contract());
    const decision = admit(open, contract(), policy);
    expect(decision.accepted).toBe(false);
    if (decision.accepted) return;
    expect(decision.reason).toContain('eurusd');
    expect(decision.reason).toContain('limit');
    expect(decision.event.assetId).toBe('eurusd');
  });

  it('does not refuse volume spread across events', () => {
    // A hundred contracts on a hundred distinct expiries is a hundred times the
    // stake of the refused book above, and carries a hundredth of the
    // concentration. The limiter must not confuse the two.
    const open = Array.from({ length: 100 }, (_, i) =>
      contract({ entryInstant: epochMillis(1_776_000_000_000 + i * 60_000) }),
    );
    const next = contract({ entryInstant: epochMillis(1_776_000_000_000 + 500 * 60_000) });
    expect(admit(open, next, policy).accepted).toBe(true);
    expect(breaches(open, policy)).toEqual([]);
  });
});

describe('netting is respected, so hedges are never refused', () => {
  it('accepts the opposite side of an event already at its limit', () => {
    // The case a naive limiter gets wrong. This event is over the limit on the
    // CALL side; a PUT *reduces* net exposure, so refusing it would push the
    // book further from balance while believing it was being careful.
    const open = Array.from({ length: 8 }, () => contract());
    expect(breaches(open, policy)).toHaveLength(1);
    const hedge = contract({ direction: 'down' });
    expect(admit(open, hedge, policy).accepted).toBe(true);
  });

  it('still refuses the side that worsens it', () => {
    const open = Array.from({ length: 8 }, () => contract());
    expect(admit(open, contract(), policy).accepted).toBe(false);
  });

  it('accepts freely once a book is balanced', () => {
    const open = [
      ...Array.from({ length: 8 }, () => contract()),
      ...Array.from({ length: 8 }, () => contract({ direction: 'down' })),
    ];
    expect(breaches(open, policy)).toEqual([]);
    expect(admit(open, contract(), policy).accepted).toBe(true);
  });
});

describe('the limiter refuses what it cannot assess', () => {
  it('rejects a non-positive limit', () => {
    expect(() => admit([], contract(), { maxEventExposure: 0 })).toThrow(RangeError);
    expect(() => admit([], contract(), { maxEventExposure: -1 })).toThrow(RangeError);
  });

  it('accepts into an empty book below the limit', () => {
    expect(admit([], contract(), policy).accepted).toBe(true);
  });

  it('refuses a single contract larger than the whole limit', () => {
    expect(admit([], contract({ stake: 10_000 }), policy).accepted).toBe(false);
  });
});
