import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { LabPositions, presetLevel, PRESETS, recordOf } from './positions.js';

/**
 * PH-24.3 §4: the presets, on the lattice, and a position's entry read as
 * settlement reads.
 */
const t0 = epochMillis(1_776_000_000_000);
const tick = (offset: number, sequence: number, price: number): Tick => ({
  instant: epochMillis(t0 + offset),
  sequence,
  price: logPrice(price),
});

describe('presets compute a lattice level from the entry (§41)', () => {
  const entry = logPrice(1000);
  it.each([
    ['win-minimum', 'up', 1001],
    ['win-minimum', 'down', 999],
    ['loss-minimum', 'up', 999],
    ['loss-minimum', 'down', 1001],
    ['tie', 'up', 1000],
    ['exact-entry', 'down', 1000],
    ['entry-plus-tick', 'down', 1001],
    ['entry-minus-tick', 'up', 999],
  ] as const)('%s for a %s position → %i', (preset, direction, level) => {
    expect(presetLevel(preset, entry, direction)).toBe(level);
  });

  it('names every preset the specification lists, and no other', () => {
    expect([...PRESETS].sort()).toEqual(
      [
        'entry-minus-tick',
        'entry-plus-tick',
        'exact-entry',
        'loss-minimum',
        'tie',
        'win-minimum',
      ].sort(),
    );
  });
});

describe('a simulated position', () => {
  const ticks = [tick(1_000, 1, 100), tick(4_000, 2, 105), tick(9_000, 3, 103)];

  it('takes its entry price as the price in force at opening (ADR-0017)', () => {
    const positions = new LabPositions();
    // Opened between the second and third tick: the second is in force.
    const position = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
    );
    expect(position.entryPrice).toBe(105);
    expect(position.expiryInstant).toBe(t0 + 66_000);
    expect(position.contract.id).toBe('lab-1');
  });

  it('several coexist, and several may share an expiry (O6, O7)', () => {
    const positions = new LabPositions();
    const a = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
    );
    const b = positions.open(
      { assetId: 'eurusd', direction: 'down', stake: 20, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
    );
    expect(a.expiryInstant).toBe(b.expiryInstant);
    expect(positions.list('eurusd')).toHaveLength(2);
    expect(positions.list('btcusd')).toHaveLength(0);
  });

  it('refuses to open before any price is in force, and refuses nonsense', () => {
    const positions = new LabPositions();
    expect(() =>
      positions.open(
        { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
        epochMillis(t0),
        ticks,
      ),
    ).toThrow(RangeError);
    expect(() =>
      positions.open(
        { assetId: 'eurusd', direction: 'up', stake: 0, horizonMs: 60_000 },
        epochMillis(t0 + 6_000),
        ticks,
      ),
    ).toThrow(RangeError);
    expect(() =>
      positions.open(
        { assetId: 'eurusd', direction: 'up', stake: 1, horizonMs: 10 },
        epochMillis(t0 + 6_000),
        ticks,
      ),
    ).toThrow(RangeError);
  });

  it('expects win, loss or refund from a close level, and says what the expectation rests on', () => {
    const positions = new LabPositions();
    const call = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
    );
    expect(LabPositions.expected(call, logPrice(106), 'armed-target')).toMatchObject({
      outcome: 'win',
      basis: 'armed-target',
    });
    expect(LabPositions.expected(call, logPrice(104), 'current-price')).toMatchObject({
      outcome: 'loss',
      basis: 'current-price',
    });
    expect(LabPositions.expected(call, logPrice(105), 'armed-target').outcome).toBe('refund');
  });

  it('settles with the production settle, against the record, only once the record covers expiry', () => {
    const positions = new LabPositions();
    const put = positions.open(
      { assetId: 'eurusd', direction: 'down', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
    );
    expect(LabPositions.actual(put, ticks)).toBeNull(); // record ends before expiry: refused, not guessed
    const later = [...ticks, tick(65_000, 4, 101), tick(70_000, 5, 99)];
    const settlement = LabPositions.actual(put, later)!;
    expect(settlement.outcome).toBe('win'); // 101 < 105 for a put
    expect(settlement.expiryPrice).toBe(101);
    expect(recordOf(later).prices.length).toBe(5);
  });
});
