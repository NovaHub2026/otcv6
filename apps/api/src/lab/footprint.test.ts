// Invariant evidence: INV-001 (economic independence), INV-006 (no exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type RandomSource, type Tick } from '@otc/core';
import {
  CascadeMagnitudeModel,
  DEFAULT_CASCADE,
  MarketEngine,
  PoissonArrivalModel,
  type MagnitudeContext,
  type MagnitudeModel,
} from '@otc/engine';
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

  it('sees an instant that moved (CA9 a8-02)', () => {
    const natural = [1, 2, 1, 2].map((p, i) => at(i, p));
    const shifted = natural.map((t, i) =>
      i === 2 ? { ...t, instant: epochMillis(t.instant + 1) } : t,
    );
    expect(footprintOf(shifted, natural, 1, 0, null).detectability.instantsIdentical).toBe(false);
    expect(footprintOf(natural, natural, 1, 0, null).detectability.instantsIdentical).toBe(true);
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

/**
 * The plant through the real engine's magnitude path (Cycle Audit 9, a5-05).
 *
 * The walker above shows the arithmetic; this shows the engine. Two
 * `MarketEngine`s from identical streams, both with the mirror test's
 * `LeverageMagnitudeModel` — a magnitude model that keeps its own copy of the
 * last sign — one of them with its first sign forced the other way. On the
 * shipped `CascadeMagnitudeModel` the same forced sign leaves every later
 * increment identical (decay 0); with the back door wired, the magnitudes
 * after the forced sign differ and the decay figure is not zero. The figure
 * therefore measures the engine's sign-blindness, not the walker's.
 */
class LeverageMagnitudeModel implements MagnitudeModel {
  #boost = 1;
  #lastSign = 1;
  constructor(private readonly inner: MagnitudeModel) {}
  observeSign(sign: number): void {
    this.#lastSign = sign;
  }
  advance(context: MagnitudeContext): number {
    this.#boost = this.#boost * 0.95 + (this.#lastSign < 0 ? 1.6 : 1) * 0.05;
    return this.inner.advance(context) * this.#boost;
  }
  snapshot(): unknown {
    return { inner: this.inner.snapshot(), boost: this.#boost, lastSign: this.#lastSign };
  }
  restore(state: unknown): void {
    const typed = state as { inner: unknown; boost: number; lastSign: number };
    this.inner.restore(typed.inner);
    this.#boost = typed.boost;
    this.#lastSign = typed.lastSign;
  }
}

function engineTicks(
  leverage: boolean,
  forceFirst: (1 | -1) | null,
  count: number,
): { ticks: Tick[]; startPrice: number } {
  const keyring = MasterKeyring.forTesting('footprint-engine-plant');
  const derive = (purpose: string): RandomSource =>
    keyring.derive({ env: 'test', asset: 'plant', purpose, keyEpoch: 0 });
  const cascade = derive('cascade');
  const shock = derive('shock');
  const arrival = derive('arrival');
  const base = new CascadeMagnitudeModel(1e-5, DEFAULT_CASCADE, cascade, shock);
  const lever = leverage ? new LeverageMagnitudeModel(base) : null;
  const sign = derive('sign');
  let drawn = 0;
  // The sign stream, with the first draw forced when asked and — when the
  // back door is wired — every draw reported to the magnitude model.
  const observing: RandomSource = {
    ...sign,
    label: sign.label,
    nextBoolean: () => {
      const natural = sign.nextBoolean();
      const value = drawn === 0 && forceFirst !== null ? forceFirst === 1 : natural;
      drawn += 1;
      lever?.observeSign(value ? 1 : -1);
      return value;
    },
    nextUint32: () => sign.nextUint32(),
    nextUint64: () => sign.nextUint64(),
    nextFloat64: () => sign.nextFloat64(),
    nextBoundedUint32: (b: number) => sign.nextBoundedUint32(b),
    nextBytes: (n: number) => sign.nextBytes(n),
    position: () => sign.position(),
    seek: (c) => sign.seek(c),
  };
  const engine = new MarketEngine({
    instrument: {
      id: 'plant-otc',
      family: 'forex',
      logQuantum: 1e-5,
      displayPrecision: 5,
      referencePrice: 1,
    },
    magnitude: lever ?? base,
    arrival: new PoissonArrivalModel(1_000, arrival),
    streams: { sign: observing, rounding: derive('rounding'), models: { cascade, shock, arrival } },
    start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
  });
  const ticks: Tick[] = [];
  for (let i = 0; i < count; i += 1) {
    const tick = engine.next();
    if (tick === null) break;
    ticks.push(tick);
  }
  return { ticks, startPrice: 0 };
}

describe('the decay figure on the engine itself (CA9 a5-05)', () => {
  it('is zero on the shipped magnitude path and non-zero when the magnitude path sees the sign', () => {
    const natural = engineTicks(false, null, 300);
    const naturalFirst: 1 | -1 = natural.ticks[0]!.price > 0 ? 1 : -1;
    const forced: 1 | -1 = naturalFirst === 1 ? -1 : 1;

    const shipped = footprintOf(engineTicks(false, forced, 300).ticks, natural.ticks, 1, 0, null);
    expect(shipped.displacement.steps).not.toBe(0);
    expect(shipped.detectability.instantsIdentical).toBe(true);
    expect(shipped.decay.ticksUntilIdentical).toBe(0);

    const levered = engineTicks(true, null, 300);
    const leveredForced = engineTicks(true, forced, 300);
    const leak = footprintOf(leveredForced.ticks, levered.ticks, 1, 0, null);
    expect(leak.detectability.instantsIdentical).toBe(true);
    expect(leak.decay.ticksUntilIdentical === null || leak.decay.ticksUntilIdentical > 0).toBe(
      true,
    );
    expect(leak.detectability.divergentIncrements).toBeGreaterThan(1);
  });
});
