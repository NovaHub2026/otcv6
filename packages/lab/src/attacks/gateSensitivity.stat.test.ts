// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type InstrumentSpec } from '@otc/core';
import { fixtureByName } from '@otc/fixtures';
import { PAYOUT_PROMOTIONAL, profitabilityThresholdPoints } from '../economics.js';
import { horizonByLabel } from '../horizons.js';
import { buildObserverDataset, type ObserverDataset } from '../observer.js';
import { sampleOutcomes, upRate } from '../outcomes.js';
import { normalQuantile } from '../statistics.js';
import { formatVerdict, runBatteryAsync, type Verdict } from './battery.js';

/**
 * The gate's sensitivity, measured against the leak it is quoted for.
 *
 * **Out-of-band audit, a4-01.** Every verdict reports a minimum detectable
 * effect: `(z_α + z_power)·√(0.25/n)` for one test of the whole decided sample
 * at α = 0.05 and 80% power. The gate is not that test. It corrects over some
 * 750 hypotheses at once — the first Benjamini–Hochberg rejection needs
 * `|z| ≥ Φ⁻¹(1 − q/2m) ≈ 3.99` — requires the finding to reproduce on a held-out
 * quarter of the data, and until this audit tested only buckets, the largest of
 * which held about half the sample. The auditor re-signed the control's
 * magnitudes with a coin at a realised 0.23pp at 30 s and found no significant
 * 30-second hypothesis while the verdict quoted 0.222pp as detectable.
 *
 * Two things changed. The `unconditional` family tests the full sample as one
 * hypothesis per horizon, so a uniform edge is seen at the n the quoted figure
 * assumes. And every verdict now carries the **gate** figure beside the
 * single-test one: the edge at which the largest tested bucket reaches both
 * thresholds, at 50% power.
 *
 * This file measures both against `biasedCoin` — the uniform edge itself, the
 * smallest leak there is — on the calibration configuration, so that the number
 * `VALIDATION.md` quotes for the gate is a number something runs.
 */

const instrument: InstrumentSpec = {
  id: 'calib-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const keyring = MasterKeyring.forTesting('gate-sensitivity');
/** The calibration configuration: seven million ticks at a five-second mean interval. */
const INTERVAL_MS = 5_000;
const TICKS = 7_000_000;
/**
 * Coin strengths chosen so the realised 30-second edge over the whole record
 * lands on the product margin and on twice it: measured 0.2508pp and 0.5012pp
 * on this configuration and keyring.
 */
const AT_MARGIN = 0.077;
const AT_TWICE_MARGIN = 0.154;
const MARGIN_PP = profitabilityThresholdPoints(PAYOUT_PROMOTIONAL);
const THIRTY_SECONDS = horizonByLabel('30s').durationMs;

async function biasedCoin(strength: number): Promise<ObserverDataset> {
  return buildObserverDataset({
    source: fixtureByName('biasedCoin').create({
      instrument,
      keyring,
      env: 'simulation',
      ticks: TICKS,
      startInstant: epochMillis(1_776_000_000_000),
      meanIntervalMs: INTERVAL_MS,
      strength,
    }),
    maxTicks: TICKS,
  });
}

/** The realised unconditional 30-second edge over the whole record, in points. */
function realisedEdgeAt30s(dataset: ObserverDataset): number {
  return (upRate(sampleOutcomes(dataset, THIRTY_SECONDS)) - 0.5) * 100;
}

/** The gate figure, re-derived from a verdict's own surface size and the bucket's counts. */
function gateFigure(verdict: Verdict, samples: number, confirmationSamples: number): number {
  const zGate = normalQuantile(1 - 0.05 / (2 * verdict.coverage.hypothesesTested));
  return (
    Math.max(zGate * Math.sqrt(0.25 / samples), 1.96 * Math.sqrt(0.25 / confirmationSamples)) * 100
  );
}

describe('the gate sensitivity is measured against a uniform edge (a4-01)', () => {
  it('finds twice the margin at 30 s through the unconditional family, at the full sample', async () => {
    const dataset = await biasedCoin(AT_TWICE_MARGIN);
    const realised = realisedEdgeAt30s(dataset);
    const verdict = await runBatteryAsync(dataset);
    const shortest = verdict.sensitivity[0]!;
    console.info(
      `twice the margin: realised 30s edge ${realised.toFixed(4)}pp; gate MDE ` +
        `${shortest.gateMinimumDetectableEffectPoints.toFixed(4)}pp; ${verdict.exploitable.length} exploitable`,
    );
    expect(realised).toBeGreaterThan(0.45);
    expect(realised).toBeLessThan(0.55);

    const whole = verdict.exploitable.find(
      (f) => f.family === 'unconditional' && f.horizon === '30s',
    );
    expect(whole, 'the unconditional family must catch a 0.5pp uniform edge at 30s').toBeDefined();
    expect(whole!.samples).toBe(shortest.samples);
    // The gate said it could see an edge this size, and it did.
    expect(shortest.gateMinimumDetectableEffectPoints).toBeLessThan(realised);
  });

  it('at the margin, states a gate figure that the single-test figure contradicts', async () => {
    const dataset = await biasedCoin(AT_MARGIN);
    const realised = realisedEdgeAt30s(dataset);
    const verdict = await runBatteryAsync(dataset);
    console.info(formatVerdict(verdict));
    const shortest = verdict.sensitivity[0]!;
    const whole = verdict.findings.find(
      (f) => f.family === 'unconditional' && f.horizon === '30s',
    )!;
    console.info(
      `at the margin: realised 30s edge ${realised.toFixed(4)}pp over the record, ` +
        `${whole.edgePoints.toFixed(4)}pp on the evaluation split (z ${whole.z.toFixed(2)}, n ${whole.samples}); ` +
        `single-test MDE ${shortest.minimumDetectableEffectPoints.toFixed(4)}pp, gate MDE ` +
        `${shortest.gateMinimumDetectableEffectPoints.toFixed(4)}pp; significant ${whole.significant}, ` +
        `material ${whole.material}, confirmed ${whole.confirmed}, exploitable ${whole.exploitable}; ` +
        `verdict ${verdict.clean ? 'clean' : 'EXPLOITABLE'} with ${verdict.exploitable.length} findings`,
    );
    expect(realised).toBeGreaterThan(0.2);
    expect(realised).toBeLessThan(0.3);
    expect(whole.samples).toBe(shortest.samples);

    // The single-test figure calls an edge at the margin detectable. The gate
    // figure — the one the verdict actually turns on — does not. **This is a
    // tripwire**: when it fails, the battery has become able to police the
    // product margin at the gate on this configuration, and `VALIDATION.md`
    // must be rewritten to say so rather than the assertion loosened.
    expect(shortest.minimumDetectableEffectPoints).toBeLessThan(MARGIN_PP);
    expect(shortest.gateMinimumDetectableEffectPoints).toBeGreaterThan(MARGIN_PP);
    expect(shortest.gateSufficientForPayout).toBe(false);

    // And the gate figure is what its definition says, from this verdict's own
    // counts: the largest tested bucket is the whole sample, and the threshold
    // is the first rejection over the whole surface.
    expect(shortest.largestBucketSamples).toBe(whole.samples);
    expect(shortest.gateMinimumDetectableEffectPoints).toBeCloseTo(
      gateFigure(verdict, whole.samples, whole.confirmationSamples),
      6,
    );
  });
});
