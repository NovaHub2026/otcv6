// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream).
import { describe, expect, it } from 'vitest';
import {
  epochMillis,
  foldTicks,
  logPrice,
  MasterKeyring,
  priceAtOrBefore,
  timeframe,
  type InstrumentSpec,
  type Tick,
} from '@otc/core';
import { createMarketEngine, defaultConfigFor } from './factory.js';

const instrument: InstrumentSpec = {
  id: 'shared-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const config = defaultConfigFor(instrument);
const START = { instant: epochMillis(1_776_000_000_000), price: logPrice(0) };

function ticksFrom(keyringSeed: string, count: number): Tick[] {
  const engine = createMarketEngine({
    config,
    keyring: MasterKeyring.forTesting(keyringSeed),
    environment: 'test',
    start: START,
  });
  const out: Tick[] = [];
  for (let i = 0; i < count; i += 1) {
    const tick = engine.next();
    if (tick === null) break;
    out.push(tick);
  }
  return out;
}

describe('the market is shared (INV-002)', () => {
  // INV-002 is the invariant a user can check against a friend sitting next to
  // them: same asset, same moment, same price. Every other guarantee in the
  // system is worthless if two observers can be shown different markets.
  const reference = ticksFrom('shared-market', 20_000);

  it('is identical for two independently constructed processes', () => {
    // Two servers holding the same key, started from the same point, are the
    // same market. This is what makes the market shared rather than per-session.
    const second = ticksFrom('shared-market', 20_000);
    expect(second).toEqual(reference);
  });

  it('is a different market under a different key', () => {
    // Teeth: if every keyring produced the same stream, the test above would
    // pass for the wrong reason.
    const other = ticksFrom('a-different-market', 20_000);
    expect(other).not.toEqual(reference);
  });

  it('shows observers sampling at different cadences the same price', () => {
    // One observer polls every tick; another polls every 37th. Where their
    // observation instants coincide, the price in force must agree exactly.
    const instants = new Float64Array(reference.map((t) => t.instant));
    const prices = new Int32Array(reference.map((t) => t.price));

    for (let i = 0; i < reference.length; i += 37) {
      const sparse = priceAtOrBefore(instants, prices, reference[i]!.instant);
      expect(sparse, `tick ${i}`).not.toBeNull();
      expect(sparse!.price, `tick ${i}`).toBe(reference[i]!.price);
    }
  });

  it('resolves an instant between ticks to the last price, for everyone', () => {
    const instants = new Float64Array(reference.map((t) => t.instant));
    const prices = new Int32Array(reference.map((t) => t.price));

    for (let i = 1; i < 400; i += 1) {
      const gap = reference[i]!.instant - reference[i - 1]!.instant;
      if (gap < 2) continue;
      const between = epochMillis(reference[i - 1]!.instant + Math.floor(gap / 2));
      expect(priceAtOrBefore(instants, prices, between)!.price).toBe(reference[i - 1]!.price);
    }
  });

  it('derives every timeframe from the one tick stream (INV-003)', () => {
    // A candle is a view of the ticks, never a second source of prices. Its
    // open and close must be the prices of the ticks it names, and its extremes
    // must actually occur inside it.
    const bySequence = new Map(reference.map((t) => [t.sequence, t]));
    const candles = foldTicks(timeframe('1m'), reference);
    expect(candles.length).toBeGreaterThan(5);

    for (const candle of candles) {
      expect(bySequence.get(candle.firstSequence)!.price).toBe(candle.open);
      expect(bySequence.get(candle.lastSequence)!.price).toBe(candle.close);

      let high = -Infinity;
      let low = Infinity;
      for (let s = candle.firstSequence; s <= candle.lastSequence; s += 1) {
        const tick = bySequence.get(s);
        if (tick === undefined) continue;
        high = Math.max(high, tick.price);
        low = Math.min(low, tick.price);
      }
      expect(candle.high).toBe(high);
      expect(candle.low).toBe(low);
    }
  });

  it('agrees with the tick stream at every candle boundary', () => {
    // The price in force at a bucket's final millisecond is that bucket's close:
    // the chart and the tape cannot disagree.
    const instants = new Float64Array(reference.map((t) => t.instant));
    const prices = new Int32Array(reference.map((t) => t.price));
    const durationMs = timeframe('1m').durationMs;
    const candles = foldTicks(timeframe('1m'), reference);

    for (const candle of candles.slice(0, -1)) {
      const lastMs = epochMillis(candle.openInstant + durationMs - 1);
      expect(priceAtOrBefore(instants, prices, lastMs)!.price).toBe(candle.close);
    }
  });
});
