// Invariant evidence: INV-007 (asset differentiation), INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type RandomSource } from '@otc/core';
import {
  ASSET_CATALOGUE,
  configFor,
  createMarketEngine,
  runMirrorTest,
  type MarketEngine,
} from '@otc/engine';
import {
  assetSignature,
  buildObserverDataset,
  differentiationPValue,
  measureDifferentiation,
  runValidation,
  SHAPE_FEATURES,
  type AssetSignature,
} from '@otc/lab';

const keyring = MasterKeyring.forTesting('multi-asset');

/**
 * Per-asset acceptance for PH-4.3.
 *
 * ## Why the battery runs at a coarser floor here than in PH-3
 *
 * PH-3 policed one asset at a 0.217pp detection floor, finer than the 0.2513pp
 * the promotional payout implies, and that took 24 million ticks. Matching it
 * for five assets would cost five times that — and more for the fast ones, since
 * the floor is set by the number of 30-second contracts, so `btcusd` at a 334ms
 * pace needs roughly 85 million ticks to span the same wall-clock period.
 *
 * The acceptance here is therefore layered, and each layer is stated for what it
 * is:
 *
 * 1. **The mirror test, per asset.** Exact, cheap, and structural. It is the
 *    real guarantee: negate the sign stream and every latent variable must be
 *    bit-identical while every increment is exactly negated. No statistical
 *    battery can replace it, and no amount of simulation would make it stronger.
 * 2. **The battery, per asset, over an equal simulated span.** Statistical
 *    confirmation that nothing in a *particular personality* breaks the
 *    structural argument, at a floor that is the same for every asset.
 * 3. **PH-3's full-rigor run**, already recorded, below the payout threshold on
 *    the canonical configuration.
 *
 * All five assets run identical code and differ only in parameters, so a break
 * in the structural argument would be a break in shared code and would surface
 * on any of them.
 */
const ACCEPTANCE_SPAN_MS = 46 * 86_400_000;

/**
 * Ticks needed for a given asset to span {@link ACCEPTANCE_SPAN_MS}.
 *
 * Budgeting by ticks rather than by span was the first attempt and it produced
 * incomparable evidence: three million ticks is 46 days of `eurusd` but only 12
 * days of `btcusd`, whose floor came out at 1.13pp against `eurusd`'s 0.57pp.
 * The detection floor is set by the number of 30-second contracts, which is a
 * property of wall-clock span, so the span is what has to be held equal.
 */
function ticksToSpan(assetIndex: number): number {
  const asset = ASSET_CATALOGUE[assetIndex]!;
  return Math.ceil((ACCEPTANCE_SPAN_MS / asset.evidence.meanIntervalMs) * 1.02);
}

function engineFor(assetIndex: number, maxTicks: number, sign?: RandomSource): MarketEngine {
  const asset = ASSET_CATALOGUE[assetIndex]!;
  return createMarketEngine({
    config: configFor(asset),
    keyring,
    environment: 'simulation',
    start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
    maxTicks,
    ...(sign === undefined ? {} : { streams: { sign } }),
  });
}

describe('every registered asset is structurally sign-blind', () => {
  it.each(ASSET_CATALOGUE.map((a, i) => [a.definition.id, i] as const))(
    '%s passes the mirror test',
    (id, index) => {
      const asset = ASSET_CATALOGUE[index]!;
      const signSource = (): RandomSource =>
        keyring.derive({
          env: 'simulation',
          asset: asset.definition.id,
          purpose: 'sign',
          keyEpoch: 0,
        });
      const result = runMirrorTest(
        (sign) =>
          createMarketEngine({
            config: configFor(asset),
            keyring,
            environment: 'simulation',
            start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
            streams: { sign },
          }),
        signSource,
        { burnInTicks: 25_000, compareTicks: 25_000 },
      );
      expect(result.divergences, `${id} divergences`).toEqual([]);
      expect(result.mirrored).toBe(true);
    },
  );
});

describe('every registered asset survives the battery on its own evidence', () => {
  it.each(ASSET_CATALOGUE.map((a, i) => [a.definition.id, i] as const))(
    '%s is clean and plausible',
    async (id, index) => {
      const maxTicks = ticksToSpan(index);
      const dataset = await buildObserverDataset({
        source: engineFor(index, maxTicks),
        maxTicks,
      });
      const report = await runValidation(dataset, { battery: { trainingFraction: 0.3 } });
      const shortest = report.predictability.sensitivity[0];

      console.info(
        `${id}: ${report.acceptable ? 'ACCEPTABLE' : 'NOT ACCEPTABLE'} — ` +
          `${report.simulatedDays.toFixed(0)} days, realism ${report.realism.passed}/` +
          `${report.realism.metrics.length}, floor ` +
          `${shortest?.minimumDetectableEffectPoints.toFixed(3) ?? 'n/a'}pp, ` +
          `${dataset.tickCount.toLocaleString()} ticks` +
          (report.realism.failed.length > 0
            ? ` — failing: ${report.realism.failed.join(', ')}`
            : ''),
      );

      expect(report.predictability.clean, `${id} predictability`).toBe(true);
      expect(report.realism.plausible, `${id} realism`).toBe(true);
    },
  );
});

describe('the assets are measurably different markets', () => {
  const WINDOW_TICKS = 2_000;
  const WINDOWS = 40;
  const SIGNATURE_TICKS = WINDOW_TICKS * WINDOWS + 10;

  async function signaturesFor(build: () => MarketEngine): Promise<readonly AssetSignature[]> {
    const dataset = await buildObserverDataset({
      source: build(),
      maxTicks: SIGNATURE_TICKS,
    });
    return Array.from({ length: WINDOWS }, (_, w) =>
      assetSignature(dataset, w * WINDOW_TICKS, WINDOW_TICKS),
    );
  }

  it('separates the catalogue far above chance, while identical assets stay at chance', async () => {
    const real = [];
    for (let i = 0; i < ASSET_CATALOGUE.length; i += 1) {
      real.push({
        asset: ASSET_CATALOGUE[i]!.definition.id,
        signatures: await signaturesFor(() => engineFor(i, SIGNATURE_TICKS)),
      });
    }

    // The control that makes the number mean something: the same personality
    // five times over, under five different asset ids and therefore five
    // different stream families. If the metric cannot tell these apart, a high
    // score on the real catalogue is evidence rather than an artefact.
    const base = ASSET_CATALOGUE[0]!;
    const control = [];
    for (const name of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      control.push({
        asset: name,
        signatures: await signaturesFor(() =>
          createMarketEngine({
            config: { ...configFor(base), instrument: { ...base.instrument, id: name } },
            keyring,
            environment: 'simulation',
            start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
            maxTicks: SIGNATURE_TICKS,
          }),
        ),
      });
    }

    const measured = measureDifferentiation(real);
    const nullResult = measureDifferentiation(control);
    console.info(
      `differentiation: real ${(measured.accuracy * 100).toFixed(1)}% ` +
        `(p=${differentiationPValue(measured).toExponential(2)}), ` +
        `control ${(nullResult.accuracy * 100).toFixed(1)}% ` +
        `(p=${differentiationPValue(nullResult).toExponential(2)}), chance 20%`,
    );

    expect(measured.accuracy).toBeGreaterThan(0.45);
    expect(differentiationPValue(measured)).toBeLessThan(1e-10);

    // The teeth. An identical catalogue must not separate.
    expect(nullResult.accuracy).toBeLessThan(0.32);
    expect(differentiationPValue(nullResult)).toBeGreaterThan(0.001);
  });

  it('is honest that the separation is pace and scale, not shape', async () => {
    // Recorded rather than hidden. Dividing out pace and amplitude leaves the
    // assets close to indistinguishable, because the observable volatility
    // dynamics are dominated by the MSM cascade, which every asset shares.
    // Three levers were tried in PH-4.3 — trait spread, regime tempo and
    // cascade memory span — and none moved scale-free shape materially.
    const real = [];
    for (let i = 0; i < ASSET_CATALOGUE.length; i += 1) {
      real.push({
        asset: ASSET_CATALOGUE[i]!.definition.id,
        signatures: await signaturesFor(() => engineFor(i, SIGNATURE_TICKS)),
      });
    }
    const shape = measureDifferentiation(real, SHAPE_FEATURES);
    console.info(
      `shape-only differentiation: ${(shape.accuracy * 100).toFixed(1)}% ` +
        `(p=${differentiationPValue(shape).toExponential(2)}), chance 20%`,
    );
    // Asserted as a *ceiling*, so that a future change which genuinely improves
    // structural differentiation fails this test and forces the claim to be
    // rewritten rather than silently overstated.
    expect(shape.accuracy).toBeLessThan(0.45);
  });
});
