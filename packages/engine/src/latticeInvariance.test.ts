// Invariant evidence: INV-003 (single underlying stream), INV-006 (no exploitable rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type InstrumentSpec } from '@otc/core';
import { createMarketEngine, defaultConfigFor } from './factory.js';

/**
 * The publication lattice does not reach the generator (PH-37.1).
 *
 * **Cycle Audit 13, a1-1: this had no guard at all.** PH-37.1 exists to remove
 * one coupling — `engine.ts` told the layers above it `steps`, the *rounded*
 * move, so a magnitude below one quantum became a zero that excited no arrival
 * and did not enter the running average Hawkes normalises against. Coarsening a
 * lattice therefore slowed the market: measured, a quarter off EUR/USD's tick
 * rate and 60% off BNB's. The fix is one word — the layers are told `quanta`,
 * the magnitude in lattice units, which both consumers normalise against their
 * own running average, so the unit cancels.
 *
 * The auditor restored the old line and every one of the 711 tests in this
 * package stayed green. The nearest thing to a guard, `catalogue.stat.test.ts`'s
 * pace ratio, compares a fresh calibration against the recorded one, and the
 * calibration walk never reads `logQuantum` — so an `engine.ts` change cannot
 * move either side of it.
 *
 * What is asserted here is the strong form, and it is exact rather than
 * statistical: with every other parameter fixed, two engines on lattices 32x
 * apart draw ticks at **the same instants**, tick for tick. Nothing is averaged,
 * so nothing can hide in a tolerance.
 */
const instrument: InstrumentSpec = {
  id: 'invariance-otc',
  family: 'forex',
  logQuantum: 1e-7,
  displayPrecision: 7,
  referencePrice: 1.1,
};
const keyring = MasterKeyring.forTesting('lattice-invariance-spec');
const START = { instant: epochMillis(1_776_000_000_000), price: logPrice(0) };
const TICKS = 2_000;

/** The same market, published on a lattice `factor` times as coarse. */
function instants(factor: number): { instants: number[]; logPrices: number[] } {
  const config = defaultConfigFor(instrument);
  const engine = createMarketEngine({
    // Only the lattice differs. Taking `defaultConfigFor` from the fine
    // instrument and overriding the quantum is deliberate: a coarser instrument
    // would also be calibrated differently, and that would test the calibration
    // rather than the engine.
    config: {
      ...config,
      instrument: { ...instrument, logQuantum: instrument.logQuantum * factor },
    },
    keyring,
    environment: 'test',
    start: START,
  });
  const out = { instants: [] as number[], logPrices: [] as number[] };
  for (let i = 0; i < TICKS; i += 1) {
    const tick = engine.next();
    if (tick === null) break;
    out.instants.push(tick.instant);
    out.logPrices.push(tick.price * instrument.logQuantum * factor);
  }
  return out;
}

describe('the publication lattice does not reach the generator (PH-37.1)', () => {
  it('draws the same arrivals on a lattice 32x as coarse, tick for tick', () => {
    const fine = instants(1);
    const coarse = instants(32);

    expect(fine.instants).toHaveLength(TICKS);
    expect(coarse.instants, 'a coarser lattice changed how many ticks arrived').toHaveLength(
      fine.instants.length,
    );
    // Exact equality, every tick. An arrival process that saw the lattice could
    // not produce this, and a tolerance is what let the coupling hide.
    expect(coarse.instants).toEqual(fine.instants);
  });

  it('keeps the same pace at every step of the ladder the catalogue uses', () => {
    const base = instants(1).instants;
    for (const factor of [4, 8, 12, 16]) {
      const span = instants(factor).instants;
      expect(span, `the lattice reached the arrival process at x${String(factor)}`).toEqual(base);
    }
  });

  it('still publishes a coarser price, so the test is not vacuous', () => {
    // The guard above would also pass if the quantum were ignored altogether.
    // It is not: the same market on a 32x lattice publishes 32x fewer distinct
    // levels, and the price it publishes stays the same market in log units.
    const fine = instants(1);
    const coarse = instants(32);
    const distinct = (xs: number[]): number => new Set(xs).size;
    expect(distinct(coarse.logPrices)).toBeLessThan(distinct(fine.logPrices));
    const last = fine.logPrices.length - 1;
    const drift = Math.abs(coarse.logPrices[last]! - fine.logPrices[last]!);
    const travelled = Math.max(...fine.logPrices.map((p) => Math.abs(p)));
    expect(drift, 'the coarse market is not the same market any more').toBeLessThan(travelled);
  });
});
