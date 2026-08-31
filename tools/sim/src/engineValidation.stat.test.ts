import { describe, expect, it } from 'vitest';
import {
  epochMillis,
  logPrice,
  MasterKeyring,
  type InstrumentSpec,
  type RandomSource,
} from '@otc/core';
import {
  CascadeMagnitudeModel,
  DEFAULT_CASCADE,
  MarketEngine,
  PoissonArrivalModel,
} from '@otc/engine';
import { buildObserverDataset, formatValidationReport, runValidation } from '@otc/lab';

/**
 * PH-3.1: the first real market, put in front of the instrument built to break it.
 *
 * The engine is unexploitable by construction — increments are a sign-blind
 * magnitude times an independent fair coin, and the mirror test proves the
 * precondition holds in the code. This suite checks that the attack battery
 * agrees, and measures how much realism the volatility cascade alone buys.
 *
 * Some realism metrics are expected to fail at this stage. Recording which is
 * the point: PH-3.2 and PH-3.3 exist to close whatever gap this measures, and a
 * gap that was never measured cannot be closed deliberately.
 */

const instrument: InstrumentSpec = {
  id: 'ph31-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const TICKS = 4_000_000;
const MEAN_INTERVAL_MS = 5_000;

function buildEngine(): MarketEngine {
  const keyring = MasterKeyring.forTesting('ph31-validation');
  const derive = (purpose: string): RandomSource =>
    keyring.derive({ env: 'simulation', asset: instrument.id, purpose, keyEpoch: 0 });

  const cascade = derive('cascade');
  const shock = derive('shock');
  const arrival = derive('arrival');
  return new MarketEngine({
    instrument,
    // Base volatility chosen so a typical tick moves about ten lattice steps,
    // keeping ties rare and the quote grid far from being a tradeable signal.
    magnitude: new CascadeMagnitudeModel(1e-5, DEFAULT_CASCADE, cascade, shock),
    arrival: new PoissonArrivalModel(MEAN_INTERVAL_MS, arrival),
    streams: {
      sign: derive('sign'),
      rounding: derive('rounding'),
      models: { cascade, shock, arrival },
    },
    start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
    maxTicks: TICKS,
  });
}

describe('the cascade engine under full validation', () => {
  it('is unexploitable and its realism gap is measured', async () => {
    const dataset = await buildObserverDataset({ source: buildEngine(), maxTicks: TICKS });
    const report = await runValidation(dataset);
    console.info(formatValidationReport(report));

    // The architecture guarantees this; the battery is the independent check.
    expect(report.predictability.clean).toBe(true);
    expect(report.predictability.coverage.hypothesesTested).toBeGreaterThan(300);
    expect([...report.predictability.coverage.featureKinds].sort()).toEqual([
      'learned',
      'level-anchored',
      'temporal',
      'translation-invariant',
    ]);

    // The cascade's job: volatility clustering with slow decay.
    const metric = (name: string) => report.realism.metrics.find((m) => m.name === name)!;
    expect(metric('absolute-return-autocorrelation-lag1').pass).toBe(true);
    expect(metric('absolute-return-long-memory').pass).toBe(true);
    expect(metric('volatility-clustering-dominance').pass).toBe(true);
    expect(metric('excess-kurtosis').pass).toBe(true);

    // Sign behaviour must be exactly a fair coin.
    expect(metric('mean-run-length').pass).toBe(true);
    expect(metric('return-autocorrelation-lag1').pass).toBe(true);

    console.info(
      `PH-3.1 realism: ${report.realism.passed}/${report.realism.metrics.length}` +
        (report.realism.failed.length > 0
          ? ` — not yet passing: ${report.realism.failed.join(', ')}`
          : ' — all metrics pass'),
    );
  });

  it('generates far faster than real time', async () => {
    const started = process.hrtime.bigint();
    const dataset = await buildObserverDataset({ source: buildEngine(), maxTicks: 1_000_000 });
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const simulatedDays = (dataset.lastInstant - dataset.firstInstant) / 86_400_000;
    console.info(
      `engine throughput: ${(1_000_000 / seconds / 1e6).toFixed(2)}M ticks/s — ` +
        `${simulatedDays.toFixed(0)} simulated days in ${seconds.toFixed(1)}s`,
    );
    expect(1_000_000 / seconds).toBeGreaterThan(200_000);
  });
});
