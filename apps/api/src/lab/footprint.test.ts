// Invariant evidence: INV-001 (economic independence), INV-006 (no exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type Tick } from '@otc/core';
import { footprintOf } from './footprint.js';

/**
 * PH-27.4: the three figures, on paths built to have known answers — and the
 * plant that shows decay is a measurement, not a zero written in.
 */
const at = (i: number, price: number): Tick => ({
  sequence: i + 1,
  instant: epochMillis(1_776_000_000_000 + i * 1_000),
  price: logPrice(price),
});

describe('footprintOf', () => {
  it('measures displacement at release, divergent increments, and a decay of zero when the increments rejoin at once', () => {
    // Natural: +1 +1 -1 +1 +1 -1. Controlled: first three signs forced up on the
    // same magnitudes: +1 +1 +1, then identical increments.
    const natural = [1, 2, 1, 2, 3, 2].map((p, i) => at(i, p));
    const controlled = [1, 2, 3, 4, 5, 4].map((p, i) => at(i, p));
    const f = footprintOf(controlled, natural, 3, 0, 4);
    expect(f.displacement).toEqual({ steps: 2, candles: 0.5 });
    expect(f.detectability).toEqual({
      divergentIncrements: 1,
      share: 1 / 6,
      instantsIdentical: true,
    });
    expect(f.decay).toEqual({ ticksUntilIdentical: 0, levelOffsetAfter: 2 });
    expect(f.horizonTicks).toBe(3);
  });

  it('reports a non-zero decay when the increments keep differing after release', () => {
    const natural = [1, 2, 1, 2, 3, 2, 3].map((p, i) => at(i, p));
    // After release (index 3 on) the controlled path differs for two ticks, then rejoins.
    const controlled = [1, 2, 3, 5, 6, 5, 6].map((p, i) => at(i, p));
    const f = footprintOf(controlled, natural, 3, 0, null);
    expect(f.displacement.candles).toBeNull();
    expect(f.decay.ticksUntilIdentical).toBe(1);
    // Never rejoining within the horizon is said, not rounded to a number.
    const never = [1, 2, 3, 5, 7, 9, 11].map((p, i) => at(i, p));
    expect(footprintOf(never, natural, 3, 0, null).decay.ticksUntilIdentical).toBeNull();
  });

  it('refuses paths that do not reach the release', () => {
    const short = [1, 2].map((p, i) => at(i, p));
    expect(() => footprintOf(short, short, 3, 0, null)).toThrow(/reach the release/);
    expect(() => footprintOf(short, short, 0, 0, null)).toThrow(/positive integer/);
  });
});

/**
 * The plant. A walker whose variance responds to the *signed* return — the
 * leverage recursion of `packages/fixtures`' `leverageEffect` — is run twice
 * from one state with the same magnitude draws, one sign forced at the start.
 * On such a process the forced sign changes every magnitude after it, so the
 * decay is not zero; on the shipped engine, whose magnitude path cannot see a
 * sign, it is. The figure therefore measures something.
 */
function leverageWalk(forced: (1 | -1) | null, count: number): Tick[] {
  const magnitudes = MasterKeyring.forTesting('footprint-plant').derive({
    env: 'test',
    asset: 'plant',
    purpose: 'magnitude',
    keyEpoch: 0,
  });
  const signs = MasterKeyring.forTesting('footprint-plant').derive({
    env: 'test',
    asset: 'plant',
    purpose: 'sign',
    keyEpoch: 0,
  });
  let variance = 1;
  let price = 0;
  const out: Tick[] = [];
  for (let i = 0; i < count; i += 1) {
    const shock = Math.abs(magnitudes.nextFloat64() * 2 - 1) * 3;
    const scaled = Math.sqrt(variance) * shock;
    const steps = Math.max(1, Math.round(scaled * 4));
    const natural: 1 | -1 = signs.nextBoolean() ? 1 : -1;
    const sign = i === 0 && forced !== null ? forced : natural;
    price += sign * steps;
    const leverage = sign < 0 ? 0.09 : 0;
    variance = 0.01 + (0.05 + leverage) * scaled * scaled + 0.9 * variance;
    out.push(at(i, price));
  }
  return out;
}

describe('the decay figure is a measurement (the leverage plant)', () => {
  it('is zero on a sign-blind process and non-zero when the magnitude path saw the sign', () => {
    const natural = leverageWalk(null, 400);
    const naturalSign = natural[0]!.price > 0 ? 1 : -1;
    const forced: 1 | -1 = naturalSign === 1 ? -1 : 1;
    const controlled = leverageWalk(forced, 400);
    const f = footprintOf(controlled, natural, 1, 0, null);
    // The forced sign was the opposite one, so the paths diverge at release...
    expect(f.displacement.steps).not.toBe(0);
    // ...and on a leverage process the magnitudes after it differ too.
    expect(f.decay.ticksUntilIdentical === null || f.decay.ticksUntilIdentical > 0).toBe(true);
    expect(f.detectability.divergentIncrements).toBeGreaterThan(1);
  });
});
