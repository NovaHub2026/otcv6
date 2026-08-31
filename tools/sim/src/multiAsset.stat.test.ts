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
  measureDifferentiation,
  permutationPValue,
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

    // Significance against a permutation null, not a binomial tail. The windows
    // are contiguous slices of a few realisations, classified against centroids
    // built from their own asset's other windows — the independence a binomial
    // assumes does not hold, and Cycle Audit 2 measured it reporting p = 4.1e-3
    // for five copies of a single personality.
    const permutationStream = keyring.derive({
      env: 'simulation',
      asset: 'differentiation',
      purpose: 'permutation',
      keyEpoch: 0,
    });
    const measured = measureDifferentiation(real);
    const nullResult = measureDifferentiation(control);
    const realSignificance = permutationPValue(real, permutationStream, 199);
    const controlSignificance = permutationPValue(control, permutationStream, 199);

    console.info(
      `differentiation: real ${(measured.accuracy * 100).toFixed(1)}% ` +
        `(permutation p=${realSignificance.pValue.toFixed(4)}, ` +
        `best shuffle ${(realSignificance.permutedMax * 100).toFixed(1)}%), ` +
        `control ${(nullResult.accuracy * 100).toFixed(1)}% ` +
        `(permutation p=${controlSignificance.pValue.toFixed(4)}), chance 20%`,
    );

    expect(measured.accuracy).toBeGreaterThan(0.45);
    expect(realSignificance.pValue).toBeLessThanOrEqual(0.01);
    // No shuffle of the labels should come close to the real arrangement.
    expect(realSignificance.permutedMax).toBeLessThan(measured.accuracy);

    // The teeth. An identical catalogue must not separate.
    expect(nullResult.accuracy).toBeLessThan(0.32);
    expect(controlSignificance.pValue).toBeGreaterThan(0.01);
  });

  it('separates the assets on shape alone, and the separation is rhythm', async () => {
    // ## What this test used to say
    //
    // Until PH-10 it asserted a *ceiling* — that shape differentiation stayed
    // below 45% — and explained that dividing out pace and amplitude left the
    // assets close to indistinguishable, because the observable volatility
    // dynamics were dominated by an MSM cascade every asset shared. That was
    // true, and it was written as a ceiling deliberately, so that a change which
    // genuinely improved structural differentiation would fail here and force
    // the claim to be rewritten rather than quietly overstated.
    //
    // PH-10 made the cascade's time structure per-asset. Shape differentiation
    // went from 30.0% to 40.5% against a 20% null, with a permutation p at the
    // floor of what 199 shuffles can report and a best shuffle of 30.0%. So the
    // claim is rewritten, and the assertion is now a floor.
    //
    // ## Why the number is worth something
    //
    // Shape differentiation is trivially purchasable: spread the assets further
    // apart in tail weight and this rises without any of them becoming a more
    // distinct *market*. PH-10.2 forbade that — `catalogue.test.ts` pins every
    // asset's tail weight to within 6% of its PH-4 value and its realised tick
    // amplitude to 15 decimal places — so the gain cannot have come from there.
    //
    // The split below shows where it did come from, rather than asserting it.
    const real = [];
    for (let i = 0; i < ASSET_CATALOGUE.length; i += 1) {
      real.push({
        asset: ASSET_CATALOGUE[i]!.definition.id,
        signatures: await signaturesFor(() => engineFor(i, SIGNATURE_TICKS)),
      });
    }
    const shape = measureDifferentiation(real, SHAPE_FEATURES);
    const shapeStream = keyring.derive({
      env: 'simulation',
      asset: 'differentiation',
      purpose: 'permutation-shape',
      keyEpoch: 0,
    });
    const shapeSignificance = permutationPValue(real, shapeStream, 199, SHAPE_FEATURES);

    // Rhythm features: how volatility clusters over time, and how arrivals
    // bunch. These are what PH-10 made per-asset.
    const RHYTHM_FEATURES = [
      'clusteringLag1',
      'clusteringLag5',
      'clusteringLag20',
      'arrivalDispersion',
      'varianceRatio',
    ] as const;
    // Tail features: how heavy the distribution is. These were deliberately
    // held at their PH-4 values, so they should carry little.
    const TAIL_FEATURES = ['kurtosis', 'tailRatio'] as const;

    const rhythmOnly = measureDifferentiation(real, RHYTHM_FEATURES);
    const tailOnly = measureDifferentiation(real, TAIL_FEATURES);

    console.info(
      `shape-only differentiation: ${(shape.accuracy * 100).toFixed(1)}% ` +
        `(permutation p=${shapeSignificance.pValue.toFixed(4)}, ` +
        `best shuffle ${(shapeSignificance.permutedMax * 100).toFixed(1)}%); ` +
        `rhythm features alone ${(rhythmOnly.accuracy * 100).toFixed(1)}%, ` +
        `tail features alone ${(tailOnly.accuracy * 100).toFixed(1)}%; chance 20%`,
    );

    // The floor. PH-4.3 measured 30.0% here with a shared cascade.
    expect(shape.accuracy).toBeGreaterThan(0.35);
    expect(shapeSignificance.pValue).toBeLessThanOrEqual(0.01);
    // No relabelling of the same windows reaches the real arrangement.
    expect(shapeSignificance.permutedMax).toBeLessThan(shape.accuracy);

    // And the attribution: the five features PH-10 made per-asset carry the
    // separation, while the two it deliberately held fixed do not. If a future
    // change raises the headline by widening tails instead, this inverts.
    expect(rhythmOnly.accuracy).toBeGreaterThan(tailOnly.accuracy);
    expect(rhythmOnly.accuracy).toBeGreaterThan(0.35);
  });
});
