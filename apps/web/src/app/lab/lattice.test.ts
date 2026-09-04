import { describe, expect, it } from 'vitest';
import { fromDisplayPrice, toDisplayPrice, type InstrumentSpec } from '@otc/core';
import { nearestLevelPrice, type Lattice } from './lattice.js';

/**
 * Cycle Audit 8 (a2): the price the operator marks is the price the Lab arms.
 *
 * Nothing tested this. An auditor added `+ 1` to the level and the whole gate
 * stayed green, both browser suites included: every click on the chart, every
 * Target Price, every close mark landed one lattice level above the price the
 * operator chose — and PH-24.21's `above` / `below` conditions were then armed
 * against the wrong side of it.
 *
 * The property that matters is a round trip: what this returns must be a level
 * the Lab's own `resolveTarget` accepts, which is exactly "renders back to
 * itself at the asset's display precision".
 */
const EURUSD: Lattice & InstrumentSpec = {
  id: 'eurusd',
  family: 'forex',
  logQuantum: 2.7511622644263434e-7,
  referencePrice: 1.085,
  displayPrecision: 7,
};

const XAUUSD: Lattice & InstrumentSpec = {
  id: 'xauusd',
  family: 'commodity',
  logQuantum: 6.1e-7,
  referencePrice: 2_350,
  displayPrecision: 3,
};

describe('a marked price is a lattice level', () => {
  it('returns the level the kernel would resolve, not one beside it', () => {
    for (const spec of [EURUSD, XAUUSD]) {
      for (const offset of [0, 1e-5, -1e-5, 3.7e-4]) {
        const asked = spec.referencePrice * (1 + offset);
        const marked = nearestLevelPrice(spec, asked);
        expect(marked, `no level near ${String(asked)}`).not.toBeNull();
        // The kernel's own conversion of the returned price is a level that
        // renders back to it — the test `resolveTarget` applies before arming.
        const level = fromDisplayPrice(spec, Number(marked!));
        expect(toDisplayPrice(spec, level).toFixed(spec.displayPrecision)).toBe(marked);
        // And it is the *nearest* level: no neighbour is closer to what was asked.
        const here = Math.abs(Number(marked) - asked);
        for (const neighbour of [level - 1, level + 1]) {
          const price = toDisplayPrice(spec, neighbour as typeof level);
          expect(
            Math.abs(price - asked),
            `a neighbour is nearer than the level chosen`,
          ).toBeGreaterThanOrEqual(here - Number.EPSILON * asked);
        }
      }
    }
  });

  it('is a fixed point: marking a marked price changes nothing', () => {
    for (const spec of [EURUSD, XAUUSD]) {
      const once = nearestLevelPrice(spec, spec.referencePrice * 1.0003)!;
      expect(nearestLevelPrice(spec, Number(once))).toBe(once);
    }
  });

  it('refuses what is not a price', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nearestLevelPrice(EURUSD, bad)).toBeNull();
    }
  });
});
