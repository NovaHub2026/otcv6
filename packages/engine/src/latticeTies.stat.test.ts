// Invariant evidence: INV-003 (single underlying stream), INV-009 (reproducible
// settlement).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring } from '@otc/core';
import { MEASURED_LATTICE_TIE_RATES, TARGET_TIE_RATE } from './asset.js';
import { ASSET_CATALOGUE, configFor } from './catalogue.js';
import { createMarketEngine } from './factory.js';

/**
 * The realised at-the-money rate on the series that actually settles.
 *
 * `TARGET_TIE_RATE` is a calibration target measured against a *continuous* log
 * return, because the quantum is the quantity being chosen and the measurement
 * cannot depend on it. A real tie is a different event: the published integer
 * price unchanged between entry and expiry. `MEASURED_LATTICE_TIE_RATES` records
 * the second one, and under ADR-0007 it is the rate at which stakes come back.
 *
 * ## Why this file exists
 *
 * It did not, and it should have. Cycle Audit 2 measured those rates and
 * recorded them in a doc comment. PH-10 then re-authored the cascade's time
 * structure, which changed the 30-second return distribution and moved every one
 * of them. Nothing failed, because the constant was exported and read by nobody.
 *
 * That is this project's most repeated defect wearing new clothes: evidence that
 * exists, is documented as sufficient, and cannot fail.
 *
 * ## Why it is a mean over replicates
 *
 * The first version of this test measured one long run per asset and used a
 * binomial standard error. It failed — correctly — because three of five assets
 * moved three to four times that error on a second seed.
 *
 * Consecutive 30-second horizons are not independent draws; volatility clusters,
 * so tie-proneness is autocorrelated across hours. The limiting quantity is
 * independent volatility epochs, not horizons: one replicate spans 67 simulated
 * hours and the slowest cascade component turns over in 36 to 44, so sampling
 * more horizons inside a single run buys almost nothing. Replicates buy
 * everything.
 *
 * The stream family here is deliberately not one the recorded values were
 * measured with, so a pass means the numbers reproduce rather than that a seed
 * was memorised.
 */

const HORIZON_MS = 30_000;
const HORIZONS_PER_REPLICATE = 8_000;
const REPLICATES = 12;

/**
 * Three standard errors on a 12-replicate mean, at the worst measured
 * between-replicate spread (0.19pp, eurusd), plus the recorded mean's own error.
 */
const TOLERANCE = 0.002;

function tieRate(index: number, label: string): number {
  const asset = ASSET_CATALOGUE[index]!;
  const keyring = MasterKeyring.forTesting(label);
  const start = 1_776_000_000_000;
  const engine = createMarketEngine({
    config: configFor(asset),
    keyring,
    environment: 'simulation',
    start: { instant: epochMillis(start), price: logPrice(0) },
  });

  let boundary = start + HORIZON_MS;
  let openPrice = engine.price;
  let last = engine.price;
  let ties = 0;
  let counted = 0;

  // No assertion inside the loop: this runs into the millions of ticks, and an
  // `expect` per iteration is the cost defect `testCost.test.ts` exists to catch.
  while (counted < HORIZONS_PER_REPLICATE) {
    const tick = engine.next();
    if (tick === null) break;
    while (tick.instant >= boundary && counted < HORIZONS_PER_REPLICATE) {
      if (last === openPrice) ties += 1;
      openPrice = last;
      counted += 1;
      boundary += HORIZON_MS;
    }
    last = tick.price;
  }
  return counted === 0 ? Number.NaN : ties / counted;
}

describe('the recorded lattice tie rates reproduce', () => {
  it.each(ASSET_CATALOGUE.map((a, i) => [a.definition.id, i] as const))(
    '%s settles at the money at its recorded rate',
    (id, index) => {
      const recorded = MEASURED_LATTICE_TIE_RATES[id as keyof typeof MEASURED_LATTICE_TIE_RATES];
      expect(recorded, `${id} has no recorded lattice tie rate`).toBeGreaterThan(0);

      const rates: number[] = [];
      for (let replicate = 0; replicate < REPLICATES; replicate += 1) {
        rates.push(tieRate(index, `ties-verify-${id}-${replicate}`));
      }
      const mean = rates.reduce((sum, r) => sum + r, 0) / rates.length;
      const variance =
        rates.reduce((sum, r) => sum + (r - mean) * (r - mean), 0) / (rates.length - 1);
      const standardError = Math.sqrt(variance / rates.length);

      console.info(
        `${id}: lattice tie rate ${(mean * 100).toFixed(3)}% ` +
          `(recorded ${(recorded * 100).toFixed(3)}%, ±${(3 * standardError * 100).toFixed(3)}pp ` +
          `at 3se over ${REPLICATES} replicates)`,
      );

      expect(Math.abs(mean - recorded), `${id} drifted from its recorded rate`).toBeLessThan(
        TOLERANCE,
      );

      // The qualitative claim the constant exists to make, asserted rather than
      // narrated: the realised rate sits below the nominal target, so the error
      // is in the safe direction — fewer refunds than the calibration implies.
      expect(mean, `${id} realised rate above nominal`).toBeLessThan(TARGET_TIE_RATE);
    },
  );
});

describe('the tie measurement can fail', () => {
  it('finds a far higher rate on a deliberately coarse lattice', () => {
    // Teeth. A tie counter that never counts a tie passes every assertion above
    // by drifting low, and "no ties at all" is exactly what a broken comparison
    // produces. Widening the quantum 40x must produce many more ties.
    const asset = ASSET_CATALOGUE[0]!;
    const keyring = MasterKeyring.forTesting('lattice-ties-coarse');
    const start = 1_776_000_000_000;
    const engine = createMarketEngine({
      config: {
        ...configFor(asset),
        instrument: { ...asset.instrument, logQuantum: asset.instrument.logQuantum * 40 },
      },
      keyring,
      environment: 'simulation',
      start: { instant: epochMillis(start), price: logPrice(0) },
    });

    let boundary = start + HORIZON_MS;
    let openPrice = engine.price;
    let last = engine.price;
    let ties = 0;
    let counted = 0;
    const horizons = 4_000;
    while (counted < horizons) {
      const tick = engine.next();
      if (tick === null) break;
      while (tick.instant >= boundary && counted < horizons) {
        if (last === openPrice) ties += 1;
        openPrice = last;
        counted += 1;
        boundary += HORIZON_MS;
      }
      last = tick.price;
    }
    const coarse = ties / counted;
    console.info(`coarse-lattice control: ${(coarse * 100).toFixed(2)}% ties at 40x quantum`);
    expect(coarse).toBeGreaterThan(0.05);
  });
});
