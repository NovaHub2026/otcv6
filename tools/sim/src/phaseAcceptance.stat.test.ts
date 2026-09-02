// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type InstrumentSpec } from '@otc/core';
import {
  createMarketEngine,
  defaultConfigFor,
  runMirrorTest,
  type MarketEngine,
} from '@otc/engine';
import { buildObserverDataset, formatValidationReport, runValidation } from '@otc/lab';

/**
 * PH-3 phase acceptance.
 *
 * Every earlier PH-3 run used four million ticks — 232 simulated days, a
 * 30-second detection floor of about 0.30 percentage points. The threshold the
 * engine must clear at the promotional payout is 0.2513pp, so a clean verdict at
 * that floor did not answer the question the phase exists to answer.
 *
 * This run buys enough simulated time to resolve the product's own margin — by
 * the single-test floor. The gate's own figure at 30 s is 0.315pp here, and the
 * verdict says so beside the floor (a4-01).
 */

const instrument: InstrumentSpec = {
  id: 'acceptance-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const config = defaultConfigFor(instrument);
const keyring = MasterKeyring.forTesting('ph3-acceptance');

/**
 * Independent samples at a horizon are fixed by simulated *duration*, not by
 * tick count, and the engine ticks about once a second — so buying simulated
 * time costs ticks one for one.
 *
 * Twenty-four million ticks is about 330 simulated days. With a 30% training
 * split that leaves roughly 420 000 non-overlapping 30-second contracts to
 * evaluate on, taking the detection floor below the 0.2513pp threshold the
 * promotional payout implies.
 *
 * A 30% training split rather than the 40% default: fitting bucket quantiles and
 * a twelve-parameter model needs far less history than measuring an edge does,
 * and the samples are worth more on the evaluation side.
 */
const TICKS = 24_000_000;

function engine(maxTicks = TICKS): MarketEngine {
  return createMarketEngine({
    config,
    keyring,
    environment: 'simulation',
    start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
    maxTicks,
  });
}

describe('PH-3 acceptance: the canonical engine', () => {
  it('is unexploitable at a resolution finer than the product margin, and plausible', async () => {
    const started = process.hrtime.bigint();
    const dataset = await buildObserverDataset({ source: engine(), maxTicks: TICKS });
    const generationSeconds = Number(process.hrtime.bigint() - started) / 1e9;

    const report = await runValidation(dataset, { battery: { trainingFraction: 0.3 } });
    console.info(formatValidationReport(report));
    console.info(
      `generation: ${(TICKS / generationSeconds / 1e6).toFixed(2)}M ticks/s ` +
        `(${report.simulatedDays.toFixed(0)} simulated days in ${generationSeconds.toFixed(1)}s)`,
    );

    // The question the phase exists to answer.
    expect(report.predictability.clean).toBe(true);
    expect(report.realism.plausible).toBe(true);
    expect(report.acceptable).toBe(true);

    // And answered at a resolution that means something: the shortest horizon
    // must resolve finer than the 0.2513pp threshold implied by the 99% payout.
    const shortest = report.predictability.sensitivity[0]!;
    expect(shortest.horizon).toBe('30s');
    expect(shortest.minimumDetectableEffectPoints).toBeLessThan(0.2513);
    expect(shortest.sufficientForPayout).toBe(true);

    // The figures the living documents quote, pinned rather than printed
    // (out-of-band audit, a4-10). Both are deterministic: the engine is seeded
    // and portable, and each floor is arithmetic on an integer sample count. If
    // either moves, `CURRENT_STATE.md`, `MARKET_MODEL.md` and `VALIDATION.md`
    // carry the old number and must move with it.
    //
    // The single-test floor is the classical one — one test of the whole
    // sample at 80% power. The gate figure is what the verdict can actually turn
    // on: the largest tested bucket reaching the corrected and confirmation
    // thresholds, at 50% power (a4-01). The first is finer than the margin; the
    // second is not, and the documents say which is which.
    expect(shortest.minimumDetectableEffectPoints).toBeCloseTo(0.221, 3);
    expect(shortest.gateMinimumDetectableEffectPoints).toBeCloseTo(0.315, 3);
    expect(shortest.gateSufficientForPayout).toBe(false);

    // Every attack family must actually have run.
    expect([...report.predictability.coverage.featureKinds].sort()).toEqual([
      'learned',
      'level-anchored',
      'temporal',
      'translation-invariant',
    ]);
    expect(report.predictability.coverage.hypothesesTested).toBeGreaterThan(400);
  });

  it('passes the mirror test on the canonical engine', () => {
    // The structural guarantee, on the exact configuration just validated
    // statistically. The harness substitutes the sign source and leaves every
    // other stream identical.
    const signSource = () =>
      keyring.derive({
        env: 'simulation',
        asset: instrument.id,
        purpose: 'sign',
        keyEpoch: 0,
      });

    const result = runMirrorTest(
      (sign) =>
        createMarketEngine({
          config,
          keyring,
          environment: 'simulation',
          start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
          streams: { sign },
        }),
      signSource,
      { burnInTicks: 40_000, compareTicks: 5_000 },
    );
    expect(result.divergences).toEqual([]);
    expect(result.mirrored).toBe(true);
  });
});
