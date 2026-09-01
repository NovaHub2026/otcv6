// Invariant evidence: INV-009 (reproducible settlement), INV-001 (economic independence).
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

describe('settlement is direction-symmetric (the settlement mirror)', () => {
  /**
   * The settlement analogue of the engine's mirror test, and the gap Cycle Audit
   * 2 found.
   *
   * PH-6's blindness demonstration compares tick streams, which a *settlement*
   * leak leaves completely untouched. The audit planted one — `if (moved ===
   * direction && Math.abs(expiryPrice - entryPrice) <= 20) return 'refund'`,
   * shaving small wins into refunds — and it passed all 769 unit tests, all 137
   * guardrails and the blindness demonstration itself, while lifting the
   * operator's margin from 12.75% to 17.19%.
   *
   * A vocabulary scan is the wrong tool: settlement legitimately reads
   * `direction`. The property that has teeth is symmetry — flipping the trade
   * direction must exchange wins and losses exactly, and leave refunds
   * untouched, because a tie is a property of the prices and not of the bet.
   */
  function mirrorOver(prices: number[], policy?: 'refund' | 'loss' | 'win'): void {
    const ticks = record(prices);
    for (let entry = 0; entry + 4 < prices.length; entry += 1) {
      const base = contract({
        id: `m${entry}`,
        entryInstant: epochMillis(1_000_000 + entry * 1_000),
        horizonMs: durationMillis(3_000),
      });
      const up = settle({ ...base, direction: 'up' }, ticks, policy);
      const down = settle({ ...base, direction: 'down' }, ticks, policy);

      if (up.outcome === 'refund' || down.outcome === 'refund') {
        // A tie belongs to the prices, not to the bet: both sides must see it.
        expect(down.outcome, `entry ${entry}: refund not symmetric`).toBe(up.outcome);
      } else {
        expect(down.outcome, `entry ${entry}: ${up.outcome} did not mirror`).toBe(
          up.outcome === 'win' ? 'loss' : 'win',
        );
      }
      // Both sides must agree on what the market did.
      expect(down.entryPrice).toBe(up.entryPrice);
      expect(down.expiryPrice).toBe(up.expiryPrice);
    }
  }

  it('mirrors on a rising path', () => {
    mirrorOver([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  });

  it('mirrors on a falling path', () => {
    mirrorOver([90, 80, 70, 60, 50, 40, 30, 20, 10, 0]);
  });

  it('mirrors on a path full of ties', () => {
    // The case a shaving leak hides in: many small moves and exact equalities.
    mirrorOver([0, 1, 1, 2, 2, 2, 1, 1, 0, 0, 1, 0, 0, 1, 1]);
  });

  it('mirrors on a jagged path', () => {
    const prices: number[] = [];
    let value = 0;
    for (let i = 0; i < 60; i += 1) {
      // Deterministic pseudo-noise: this must never depend on a lucky draw.
      value += Math.round(Math.sin(i * 2.399) * 7);
      prices.push(value);
    }
    mirrorOver(prices);
  });

  it('mirrors under every at-the-money policy', () => {
    // Under 'loss' and 'win' a tie is asymmetric by definition, so only the
    // decided outcomes are required to mirror — checked by the branch above,
    // which compares refunds for equality and everything else for exchange.
    const path = [0, 5, 5, 10, 10, 10, 5, 0, 0, 5];
    mirrorOver(path, 'refund');
    for (const policy of ['loss', 'win'] as const) {
      const ticks = record(path);
      for (let entry = 0; entry + 4 < path.length; entry += 1) {
        const base = contract({
          id: `p${entry}`,
          entryInstant: epochMillis(1_000_000 + entry * 1_000),
          horizonMs: durationMillis(3_000),
        });
        const up = settle({ ...base, direction: 'up' }, ticks, policy);
        const down = settle({ ...base, direction: 'down' }, ticks, policy);
        const tie = up.entryPrice === up.expiryPrice;
        if (tie) {
          // Both sides get the policy's verdict; it does not depend on direction.
          expect(down.outcome).toBe(up.outcome);
        } else {
          expect(down.outcome).toBe(up.outcome === 'win' ? 'loss' : 'win');
        }
      }
    }
  });

  it('is a test with teeth: a win-shaving rule breaks it', () => {
    // Reproduces the audit's plant against the mirror property directly, so the
    // guard is demonstrated rather than assumed. `shave` stands in for any rule
    // that resolves by looking at whose side the move fell on.
    const shave = (entryPrice: number, expiryPrice: number, direction: 'up' | 'down'): string => {
      if (expiryPrice === entryPrice) return 'refund';
      const moved = expiryPrice > entryPrice ? 'up' : 'down';
      if (moved === direction && Math.abs(expiryPrice - entryPrice) <= 20) return 'refund';
      return moved === direction ? 'win' : 'loss';
    };
    const up = shave(0, 10, 'up');
    const down = shave(0, 10, 'down');
    expect(up).toBe('refund');
    expect(down).toBe('loss');
    // Asymmetric: one side sees a refund where the other sees a decision.
    expect(down).not.toBe('refund');
  });
});

describe('Cycle Audit 5: settlement refuses a window that touches a seam', () => {
  // PH-14.3 built `spansSeam` with the docstring "the settlement path needs to
  // be able to ask", and then nothing asked. An auditor produced a real
  // 93-second failover gap and a contract whose expiry landed inside it: the
  // price query returned null for that instant while the contract settled as a
  // loss against the last pre-seam tick, for real money.
  const instants = Float64Array.from([0, 1_000, 2_000, 95_000, 96_000]);
  const prices = Int32Array.from([0, 5, 7, -40, -38]);
  const seams = [{ lastInstant: 2_000, resumesAtInstant: 95_000 }];

  const spanning = (entryInstant: number, horizonMs: number): Contract =>
    contract({
      id: `c-${entryInstant}-${horizonMs}`,
      entryInstant: epochMillis(entryInstant),
      horizonMs: durationMillis(horizonMs),
    });

  it('refuses a contract whose expiry falls inside the gap', () => {
    expect(() => settle(spanning(1_000, 30_000), { instants, prices, seams })).toThrow(
      NotSettleableError,
    );
  });

  it('refuses a contract whose entry falls inside the gap', () => {
    expect(() => settle(spanning(50_000, 45_000), { instants, prices, seams })).toThrow(
      NotSettleableError,
    );
  });

  it('refuses a contract that spans the whole gap', () => {
    expect(() => settle(spanning(1_000, 94_500), { instants, prices, seams })).toThrow(
      NotSettleableError,
    );
  });

  it('settles a contract entirely on one side of the gap', () => {
    expect(settle(spanning(0, 2_000), { instants, prices, seams }).outcome).toBeDefined();
    expect(settle(spanning(95_000, 1_000), { instants, prices, seams }).outcome).toBeDefined();
  });

  it('a record with no seams behaves exactly as before', () => {
    expect(settle(spanning(1_000, 30_000), { instants, prices }).outcome).toBeDefined();
  });
});
