// Invariant evidence: INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring } from '@otc/core';
import { yieldToLoop } from '@otc/core';
import { calibrateAssetAsync } from './asset.js';
import { assetById, configFor, registrationKeyLabel } from './catalogue.js';
import { createMarketEngine } from './factory.js';
import {
  dispersionLogSigma,
  dispersionPercent,
  DISPERSION_WINDOW_MS,
  minimumDispersionSpanMs,
} from './dispersion.js';

/**
 * The claim the whole dispersion budget rests on, checked against brute force.
 *
 * `logVariancePerMs` is read off the calibration's windowed 30-second returns
 * and then extrapolated to a quarter by multiplication, on the grounds that
 * uncorrelated increments make variance additive in time. That is a *derivation*
 * from ADR-0003, and a derivation is exactly the kind of thing that survives a
 * broken implementation.
 *
 * So this measures the other way round: run the real engine many times over,
 * take the spread of where the price ends up, and ask whether the calibration
 * predicted it. Nothing here reads a calibration except to compare against it.
 *
 * ## What the numbers can be
 *
 * Forty replicates give the spread estimate a relative standard error of about
 * 11% if the terminal displacement were Gaussian, and it is not — the process
 * builds fat tails on purpose, and two days is a handful of turnovers of the
 * slower volatility components. Measured across four unrelated seed families
 * and three assets, individual ratios ran 0.816 to 1.099 and the pooled figure
 * 0.933 to 1.073.
 *
 * The pooled figure is therefore the assertion with teeth, and the per-asset
 * band is deliberately loose. An implementation that averaged the absolute move
 * and squared it — which looks like the same thing, and is the mistake this
 * shape of code invites — would land the pooled figure near 0.65, well outside.
 */

// 120, up from 40: the realised side carries all the noise, and CA6-17 showed a
// 14% error in σ passing every band in the suite. Three assets at 120 runs each
// puts the pooled standard error near 4%.
const REPLICATES = 120;
const WARM_UP_MS = 43_200_000;
const SPAN_MS = 2 * 86_400_000;
const START = 1_776_000_000_000;

/**
 * Assets the comparison runs over.
 *
 * `btcusd` and `gbpjpy` are left out on cost alone — between them they are more
 * work than the whole rest of the list — and nothing about them is special
 * here, since every asset runs identical code and the claim under test belongs
 * to the calibration rather than to any personality.
 */
const MEASURED = ['eurusd', 'spx', 'xauusd'] as const;

async function terminalSpread(id: string): Promise<number> {
  const asset = assetById(id);
  const displacements: number[] = [];
  let sinceYield = 0;
  for (let replicate = 0; replicate < REPLICATES; replicate += 1) {
    const engine = createMarketEngine({
      config: configFor(asset),
      keyring: MasterKeyring.forTesting(`terminal-spread-${replicate}`),
      environment: 'simulation',
      start: { instant: epochMillis(START), price: logPrice(0) },
    });
    // Half a day of warm-up first. Dispersion is a property of the stationary
    // process, and every engine starts from a cold cascade at price zero.
    let anchor: number | null = null;
    let last = 0;
    for (;;) {
      const tick = engine.next();
      if (tick === null) break;
      const elapsed = tick.instant - START;
      if (anchor === null && elapsed >= WARM_UP_MS) anchor = tick.price;
      if (elapsed > WARM_UP_MS + SPAN_MS) break;
      last = tick.price;
      sinceYield += 1;
      if (sinceYield >= 250_000) {
        sinceYield = 0;
        await yieldToLoop();
      }
    }
    if (anchor === null) throw new Error(`${id} produced no tick past the warm-up`);
    displacements.push((last - anchor) * asset.instrument.logQuantum);
  }
  // The second moment about zero, not about the sample mean: the process is a
  // martingale, so the mean *is* zero and estimating it would spend a degree of
  // freedom on a number that is known.
  const second =
    displacements.reduce((sum, value) => sum + value * value, 0) / displacements.length;
  return Math.sqrt(second);
}

describe('the diffusion rate predicts where the price actually goes', () => {
  it('matches the spread of sixty independent realisations', async () => {
    const ratios: number[] = [];
    const keyring = MasterKeyring.forTesting('dispersion-fresh-calibration');
    for (const id of MEASURED) {
      const asset = assetById(id);
      const measured = await terminalSpread(id);
      // **Cycle Audit 6, CA6-17 and CA6-19.** This compared brute force against
      // the *recorded* evidence in `catalogue.ts`, so it never executed the line
      // that computes the rate: an auditor multiplied `logVariancePerMs` by 1.3
      // and this test's console output was byte-identical. It calibrates freshly
      // now, at the pooled span `DISPERSION_FIT_TURNOVERS` requires for this
      // asset's own memory — the fixed two-day window it used before was 1.1 to
      // 1.3 turnovers for two of the three assets, below the floor the same
      // subphase introduced.
      const fresh = await calibrateAssetAsync(
        asset.definition,
        (purpose) =>
          keyring.derive({
            env: 'simulation',
            asset: registrationKeyLabel(id),
            purpose,
            keyEpoch: 0,
          }),
        { replicates: 4, simulatedMs: minimumDispersionSpanMs(asset.definition.traits) / 4 },
      );
      const predicted = dispersionLogSigma(fresh.evidence, SPAN_MS);
      const ratio = measured / predicted;
      ratios.push(ratio);
      console.info(
        `${id.padEnd(8)} two-day spread: measured ${measured.toFixed(5)}, ` +
          `predicted ${predicted.toFixed(5)}, ratio ${ratio.toFixed(3)}`,
      );
    }

    const pooled = Math.exp(
      ratios.reduce((sum, value) => sum + Math.log(value), 0) / ratios.length,
    );
    console.info(`pooled ratio across ${MEASURED.length} assets: ${pooled.toFixed(3)}`);

    for (const [index, ratio] of ratios.entries()) {
      expect(ratio, `${MEASURED[index]} ratio`).toBeGreaterThan(0.7);
      expect(ratio, `${MEASURED[index]} ratio`).toBeLessThan(1.55);
    }
    // ±25% pooled, and that is what the data supports rather than what would be
    // convenient. Both sides are honest estimators of one quantity now — the
    // calibration is fresh rather than a recorded constant, and the realised
    // side has three times the runs — but `xauusd` reads 1.33 here and 1.20 in
    // `CYCLE-7-DISPERSION.md`'s independent 40-run measurement. Two runs
    // agreeing on a 20-30% gap is a signal, not noise, and its cause is not yet
    // known (B-029).
    //
    // So this bounds a systematic error in the diffusion rate to about ±25%,
    // not the ±14% a tighter band would claim. CA6-17 planted 30% in the rate —
    // 14% in σ — and is therefore only **partly** closed: the test executes the
    // line now, where before it compared brute force against a hard-coded
    // constant and could not see the plant at all.
    expect(pooled).toBeGreaterThan(0.85);
    expect(pooled).toBeLessThan(1.3);
  }, 600_000);

  it('states a quarter in the units an operator thinks in', () => {
    // The catalogue's own numbers, against the hundred-replicate 90-day
    // measurement in CYCLE-6-DRIFT.md: 4.0%, 18.4%, 75.6%, 1.7% and 8.4%. Four
    // of the five agree within 12%; btcusd reads low, and it is the asset whose
    // volatility memory is longest relative to the calibration span.
    const table = MEASURED.map((id) => {
      const sigma = dispersionLogSigma(assetById(id).evidence, DISPERSION_WINDOW_MS);
      return `${id}: ${(100 * dispersionPercent(sigma)).toFixed(1)}%`;
    });
    console.info(`quarterly dispersion — ${table.join(', ')}`);
    expect(dispersionPercent(dispersionLogSigma(assetById('spx').evidence))).toBeLessThan(
      dispersionPercent(dispersionLogSigma(assetById('btcusd').evidence)),
    );
  });
});
