// Invariant evidence: INV-007 (asset differentiation), INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type RandomSource } from '@otc/core';
import {
  ASSET_CATALOGUE,
  configFor,
  createMarketEngine,
  HEAVY_SUITE_SAMPLE,
  runMirrorTest,
  sampleCatalogue,
  type MarketEngine,
} from '@otc/engine';
import {
  assetSignature,
  buildObserverDataset,
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

/**
 * Which assets this run puts through the battery (PH-26.1).
 *
 * Forty-six simulated days plus a full battery per asset is 78.3 M simulated
 * ticks at five assets — the single largest term in the statistical suite — and
 * would be 470 M at thirty. The run measures a fixed, stratified sample and
 * prints what it left out; every asset is put through the battery by the
 * evidence run at the phase boundary. The mirror test above stays exhaustive:
 * it is cheap, and it is the structural gate no asset may skip.
 */
const BATTERY_SAMPLE = sampleCatalogue(
  ASSET_CATALOGUE,
  (a) => a.definition.id,
  MasterKeyring.forTesting('catalogue-sample').derive({
    env: 'test',
    asset: 'sample',
    purpose: 'battery',
    keyEpoch: 0,
  }),
  { size: HEAVY_SUITE_SAMPLE },
);

describe('every registered asset survives the battery on its own evidence', () => {
  it('says which assets this run measured, and which it did not (§68)', () => {
    console.info(`battery: ${BATTERY_SAMPLE.describe()}`);
    expect(BATTERY_SAMPLE.measured).toHaveLength(
      Math.min(HEAVY_SUITE_SAMPLE, ASSET_CATALOGUE.length),
    );
  });

  it.each(
    BATTERY_SAMPLE.measured.map((a) => [a.definition.id, ASSET_CATALOGUE.indexOf(a)] as const),
  )('%s is clean and plausible', async (id, index) => {
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
        (report.realism.failed.length > 0 ? ` — failing: ${report.realism.failed.join(', ')}` : ''),
    );

    expect(report.predictability.clean, `${id} predictability`).toBe(true);
    expect(report.realism.plausible, `${id} realism`).toBe(true);
  });
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

  /**
   * Stream families the null and the measurement are both taken over.
   *
   * Cycle Audit 4 found the single-seed version of this test passing on luck.
   * The identical-personality control — five copies of ONE personality — reached
   * **33.5% with a permutation p of 0.005** on other seeds, which would have
   * failed both of the assertions this test used to make. Three of eight seeds
   * put the control at p <= 0.01.
   *
   * One draw of a noisy quantity is not the quantity.
   */
  const SEEDS = ['multi-asset', 'seed-a', 'seed-b'] as const;
  /** What a classifier scores by guessing: one in N. */
  const CHANCE = 1 / ASSET_CATALOGUE.length;

  /** The real catalogue, and the identical-personality control, on one seed. */
  async function measureUnder(
    seed: string,
  ): Promise<{ full: number; shape: number; controlFull: number; controlShape: number }> {
    const seeded = MasterKeyring.forTesting(seed);
    const real = [];
    for (let i = 0; i < ASSET_CATALOGUE.length; i += 1) {
      const asset = ASSET_CATALOGUE[i]!;
      real.push({
        asset: asset.definition.id,
        signatures: await signaturesFor(() =>
          createMarketEngine({
            config: configFor(asset),
            keyring: seeded,
            environment: 'simulation',
            start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
            maxTicks: SIGNATURE_TICKS,
          }),
        ),
      });
    }

    // The null: the same personality N times, under N ids and therefore N
    // stream families — as many copies as the catalogue has assets, so the
    // control is the same measurement at the same size. This reproduces every
    // dependence in the real measurement because it *is* the real measurement
    // — the only difference is whether the personalities differ. (PH-26.1: it
    // read five copies by name, which was the catalogue size and not a
    // property of the null.)
    const base = ASSET_CATALOGUE[0]!;
    const control = [];
    for (const name of ASSET_CATALOGUE.map((_, i) => `c${String(i + 1)}`)) {
      control.push({
        asset: name,
        signatures: await signaturesFor(() =>
          createMarketEngine({
            config: { ...configFor(base), instrument: { ...base.instrument, id: name } },
            keyring: seeded,
            environment: 'simulation',
            start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
            maxTicks: SIGNATURE_TICKS,
          }),
        ),
      });
    }

    return {
      full: measureDifferentiation(real).accuracy,
      shape: measureDifferentiation(real, SHAPE_FEATURES).accuracy,
      controlFull: measureDifferentiation(control).accuracy,
      controlShape: measureDifferentiation(control, SHAPE_FEATURES).accuracy,
    };
  }

  it('separates the catalogue beyond anything identical personalities reach', async () => {
    // ## What this test asserts, and why not a p-value
    //
    // The null is the **identical-personality control's own distribution**, not
    // 1/5 and not a permutation.
    //
    // Cycle Audit 4 measured the permutation null returning p <= 0.01 for five
    // copies of one personality in three of eight stream families. The reason is
    // exchangeability: each asset's windows are contiguous slices of one
    // continuous realisation, so they share slow state and are genuinely more
    // alike than windows from different runs — under the null. Shuffling
    // destroys that, so the observed arrangement sits in the tail for reasons
    // unrelated to whether the labels mean anything.
    //
    // The control has no such problem. It carries every dependence the real
    // measurement has, because it is the same measurement with the personalities
    // made identical. So the claim is a **separation of two distributions**,
    // which is both honest and stronger than a p-value that does not hold.
    const measured = [];
    for (const seed of SEEDS) measured.push(await measureUnder(seed));

    const realShape = measured.map((m) => m.shape);
    const controlShape = measured.map((m) => m.controlShape);
    const realFull = measured.map((m) => m.full);
    const controlFull = measured.map((m) => m.controlFull);
    const range = (a: number[]) =>
      `${(Math.min(...a) * 100).toFixed(1)}-${(Math.max(...a) * 100).toFixed(1)}%`;

    console.info(
      `differentiation over ${SEEDS.length} stream families:\n` +
        `  full signature: real ${range(realFull)} vs identical control ${range(controlFull)}\n` +
        `  shape only:     real ${range(realShape)} vs identical control ${range(controlShape)}`,
    );

    // The separation, on both signatures: the worst real draw beats the best
    // control draw. No overlap is the claim.
    expect(Math.min(...realShape)).toBeGreaterThan(Math.max(...controlShape));
    expect(Math.min(...realFull)).toBeGreaterThan(Math.max(...controlFull));

    // And the control stays where a null belongs. Asserted as a band across
    // seeds rather than a single draw, because a single draw is what made the
    // previous version of this test pass on luck. The band is a multiple of
    // chance — 1.5 × 1/N, which is the 0.3 this read at five assets — so it
    // means the same thing at thirty (PH-26.1).
    expect(Math.max(...controlShape)).toBeLessThan(1.5 * CHANCE);
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
    // No permutation p-value here. Cycle Audit 4 measured it returning p <= 0.01
    // for five copies of ONE personality in three of eight stream families, so it
    // does not control what it appears to. The null this claim rests on is the
    // identical-personality control's own distribution, asserted in the test
    // above; what remains here is the *attribution*.

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
      `shape-only attribution: overall ${(shape.accuracy * 100).toFixed(1)}%; ` +
        `rhythm features alone ${(rhythmOnly.accuracy * 100).toFixed(1)}%, ` +
        `tail features alone ${(tailOnly.accuracy * 100).toFixed(1)}%`,
    );

    // The floor. PH-4.3 measured 30.0% here with a shared cascade, and the
    // identical-personality control tops out at 25.0% across eight seeds. It is
    // stated as a multiple of chance — 1.6 × 1/N, the 0.32 this read at five
    // assets — because an absolute 0.32 at thirty assets, where chance is 1/30,
    // would be a six-times-harder test of the same property and would fail on a
    // catalogue that is more differentiated, not less (PH-26.1).
    expect(shape.accuracy).toBeGreaterThan(1.6 * shape.chance);

    // The attribution: the five features PH-10 made per-asset carry the
    // separation, while the two it deliberately held fixed do not. If a future
    // change raises the headline by widening tails instead, this inverts.
    expect(rhythmOnly.accuracy).toBeGreaterThan(tailOnly.accuracy);
    // 1.75 × chance: 0.35 at five assets.
    expect(rhythmOnly.accuracy).toBeGreaterThan(1.75 * rhythmOnly.chance);
  });
});
