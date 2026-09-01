// Invariant evidence: INV-001 (economic independence).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis } from '@otc/core';
import { admit, breaches, ExposureBook } from './limiter.js';
import { assessBookRisk, exposureByEvent } from './exposure.js';
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

describe('Cycle Audit 5: one millisecond of jitter is not two hundred bets', () => {
  // Measured by an auditor: 200 contracts entered one millisecond apart inside
  // an 11.4-second tick gap settle against one entry tick and one expiry tick —
  // one Bernoulli draw. Keyed on the raw instant they were reported as 200
  // events, accepted in full at a peak of 99 against a limit of 500, while the
  // true single-comparison obligation was 39.6x the limit.
  const TICK = 1_100;
  const resolve = (_assetId: string, instant: number): number => Math.floor(instant / TICK) * TICK;

  const jittered = (n: number): Contract[] =>
    Array.from({ length: n }, (_, i) =>
      contract({
        id: `j${i}`,
        stake: 100,
        entryInstant: epochMillis(1_776_000_000_000 + i),
      }),
    );

  it('groups contracts inside one tick interval into a single event', () => {
    const book = jittered(200);
    expect(exposureByEvent(book)).toHaveLength(200);
    expect(exposureByEvent(book, resolve)).toHaveLength(1);
  });

  it('reports one effective bet, not two hundred', () => {
    const spread = assessBookRisk(jittered(200));
    const resolved = assessBookRisk(jittered(200), resolve);
    expect(spread.effectiveBets).toBeGreaterThan(100);
    expect(resolved.effectiveBets).toBeCloseTo(1, 5);
  });

  it('the exported admit() and breaches() take the resolver too', () => {
    // **Cycle Audit 6, A6-04.** PH-16.3 threaded the resolver through
    // `exposureByEvent`, `assessBookRisk` and `ExposureBook`, and stopped there.
    // These two are the module-level functions a venue calls to decide whether
    // to take a trade and to audit a book it already holds, and both still
    // grouped by the raw entry instant — so Cycle Audit 5's construction worked
    // against them unchanged: 200 of 200 admitted, 39.6x the limit, and
    // `breaches` reporting nothing at all.
    const policy = { maxEventExposure: 500 };
    const book = jittered(200);

    const blind: Contract[] = [];
    for (const c of book) {
      if (admit(blind, c, policy).accepted) blind.push(c);
    }
    expect(blind).toHaveLength(200);
    // What that book is actually worth on one settlement: 39.6x the limit.
    const trueExposure = exposureByEvent(blind, resolve)[0]!.netExposure;
    expect(trueExposure / policy.maxEventExposure).toBeGreaterThan(39);
    expect(breaches(blind, policy)).toEqual([]);
    expect(breaches(blind, policy, resolve)).toHaveLength(1);

    const guarded: Contract[] = [];
    for (const c of book) {
      if (admit(guarded, c, policy, resolve).accepted) guarded.push(c);
    }
    expect(guarded.length).toBeLessThan(10);
    expect(breaches(guarded, policy, resolve)).toEqual([]);
  });

  it('the limiter caps a jittered book the same as an unjittered one', () => {
    const policy = { maxEventExposure: 500 };
    const withResolver = new ExposureBook(resolve);
    let admitted = 0;
    for (const c of jittered(200)) {
      if (withResolver.admit(c, policy).accepted) {
        withResolver.add(c);
        admitted += 1;
      }
    }
    expect(admitted).toBeLessThan(10);
    expect(withResolver.peakExposure()).toBeLessThanOrEqual(policy.maxEventExposure);

    // Without one, every contract is its own event and the cap never binds.
    const blind = new ExposureBook();
    let blindAdmitted = 0;
    for (const c of jittered(200)) {
      if (blind.admit(c, policy).accepted) {
        blind.add(c);
        blindAdmitted += 1;
      }
    }
    expect(blindAdmitted).toBe(200);
  });
});
