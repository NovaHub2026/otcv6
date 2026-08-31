import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type InstrumentSpec } from '@otc/core';
import { fixtureByName } from '@otc/fixtures';
import { buildObserverDataset, type ObserverDataset } from './observer.js';
import { formatValidationReport, runValidation } from './report.js';

/**
 * The two batteries are opposing constraints, and this suite is the proof.
 *
 * A memoryless Gaussian random walk passes every attack and fails to be a
 * market. Without the realism gate it would be the cheapest way to satisfy PH-2
 * while building exactly the anti-goal the Project Introduction names first.
 */

const instrument: InstrumentSpec = {
  id: 'validation-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const keyring = MasterKeyring.forTesting('validation-report');
const TICKS = 3_000_000;

async function dataset(name: string): Promise<ObserverDataset> {
  return buildObserverDataset({
    source: fixtureByName(name).create({
      instrument,
      keyring,
      env: 'simulation',
      ticks: TICKS,
      startInstant: epochMillis(1_776_000_000_000),
      meanIntervalMs: 5_000,
      strength: 0,
    }),
    maxTicks: TICKS,
  });
}

describe('the two batteries are independent constraints', () => {
  it('a Gaussian random walk is unexploitable but not a market', async () => {
    const report = await runValidation(await dataset('gaussianRandomWalk'));
    console.info(formatValidationReport(report));

    expect(report.predictability.clean).toBe(true);
    expect(report.realism.plausible).toBe(false);
    expect(report.acceptable).toBe(false);
    // It fails the second-moment facts specifically.
    expect(report.realism.failed).toContain('absolute-return-autocorrelation-lag1');
    expect(report.realism.failed).toContain('excess-kurtosis');
  });

  it('a stochastic-volatility process satisfies both', async () => {
    const report = await runValidation(await dataset('symmetricControl'));
    console.info(
      `symmetricControl: predictability ${report.predictability.clean ? 'clean' : 'EXPLOITABLE'}, ` +
        `realism ${report.realism.passed}/${report.realism.metrics.length}, ` +
        `acceptable=${report.acceptable}, ${report.elapsedSeconds.toFixed(1)}s`,
    );
    expect(report.predictability.clean).toBe(true);
    expect(report.realism.plausible).toBe(true);
    expect(report.acceptable).toBe(true);
  });

  it('a leaking market fails even when it is perfectly plausible', async () => {
    // Realism alone is no defence either: the leverage effect is a genuine
    // stylized fact, and it is worth percentage points of edge.
    const leaking = await buildObserverDataset({
      source: fixtureByName('leverageEffect').create({
        instrument,
        keyring,
        env: 'simulation',
        ticks: TICKS,
        startInstant: epochMillis(1_776_000_000_000),
        meanIntervalMs: 5_000,
        strength: 1,
      }),
      maxTicks: TICKS,
    });
    const report = await runValidation(leaking);
    console.info(
      `leverageEffect: predictability ${report.predictability.clean ? 'clean' : 'EXPLOITABLE'}, ` +
        `realism ${report.realism.passed}/${report.realism.metrics.length}, acceptable=${report.acceptable}`,
    );
    expect(report.predictability.clean).toBe(false);
    expect(report.acceptable).toBe(false);
  });
});

describe('the combined report', () => {
  it('carries both verdicts and the run metadata', async () => {
    const report = await runValidation(await dataset('symmetricControl'));
    expect(report.instrument).toBe('validation-otc');
    expect(report.ticks).toBe(TICKS);
    expect(report.simulatedDays).toBeGreaterThan(100);
    expect(report.predictability.coverage.hypothesesTested).toBeGreaterThan(300);
    expect(report.realism.metrics.length).toBeGreaterThan(10);
    expect(report.acceptable).toBe(report.predictability.clean && report.realism.plausible);
  });
});
