// Invariant evidence: INV-007 (asset differentiation), INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type RandomSource } from '@otc/core';
import {
  ASSET_ARCHETYPES,
  calibrateAssetAsync,
  configFor,
  createMarketEngine,
  dispersionLogSigma,
  minimumDispersionSpanMs,
  registerAsset,
  registrationKeyLabel,
  runMirrorTest,
  sampleArchetype,
  traitDistanceCheck,
  type AssetArchetype,
  type RegisteredAsset,
} from '@otc/engine';
import {
  assetSignature,
  buildObserverDataset,
  measureDifferentiation,
  SHAPE_FEATURES,
  type AssetSignature,
  yieldToLoop,
} from '@otc/lab';

/**
 * PH-17.2 acceptance: a catalogue nobody authored by hand.
 *
 * The five hand-authored assets were each argued for individually. Fifty to a
 * hundred cannot be, so the question this phase has to answer is whether a
 * *sampled* asset is as good as an authored one — legal, sign-blind, on the
 * budget its family declared, and statistically distinct from its own siblings.
 *
 * Three assets from each of the eight archetypes. Three is the smallest number
 * that makes the within-archetype question meaningful, and the within-archetype
 * question is the whole point: separating an alt-coin from an index proves
 * nothing, because families that differ by a factor of forty in amplitude are
 * separable by amplitude alone.
 */
const PER_ARCHETYPE = 3;

/**
 * The calibration span is a property of the asset, not a constant.
 *
 * The first version of this test used twelve hours for everything, on the
 * reasoning that a sloppy registration would only make the checks harder to
 * pass. That reasoning is wrong for a *fit*: it produced a blue-chip index
 * diffusing 4.9 times its own budget, because twelve hours is a third of a
 * turnover of that asset's volatility memory and the fit landed on whichever
 * level the window happened to hold.
 *
 * Cost follows the same rule, and conveniently so — the assets that need the
 * longest spans are the slow ones, whose ticks are cheap. `registerAsset`
 * refuses a span below the bound, so this is not politeness.
 */
function spanFor(cascadeSpanMs: number): { replicates: number; simulatedMs: number } {
  // Three replicates of a third of the required span, not one of all of it.
  // **Cycle Audit 6, CA6-26.** The quantum is a 1% quantile of a heavy-tailed
  // variable and `CALIBRATION_REPLICATES` exists because one realisation puts
  // it only within 18.5%; combining three by median is what brings it inside
  // 15%. At one replicate the acceptance's published lattices spanned 2.4x for
  // one personality registered three times.
  return { replicates: 3, simulatedMs: minimumDispersionSpanMs({ cascadeSpanMs }) / 3 };
}

/** Verification runs twice as long again, on an unrelated keyring. */
function verificationSpanFor(cascadeSpanMs: number): {
  replicates: number;
  simulatedMs: number;
} {
  // Three replicates here too: the check is only as sharp as its own estimator,
  // and a single realisation of a quantity with memory is what CA6-15 was about.
  return { replicates: 3, simulatedMs: (2 * minimumDispersionSpanMs({ cascadeSpanMs })) / 3 };
}

const MIRROR_TICKS = 120_000;
const WINDOW_TICKS = 2_000;
const WINDOWS = 40;
const SIGNATURE_TICKS = WINDOW_TICKS * WINDOWS + 10;

const referencePriceFor: Record<string, number> = {
  'major-fx': 1.1,
  'cross-fx': 150,
  'blue-chip-index': 5_000,
  'sector-etf': 90,
  metal: 2_400,
  energy: 78,
  'major-crypto': 60_000,
  'alt-crypto': 3.5,
};

interface SampledAsset {
  readonly archetype: AssetArchetype;
  readonly asset: RegisteredAsset;
  readonly budget: number;
}

async function buildCatalogue(): Promise<readonly SampledAsset[]> {
  const keyring = MasterKeyring.forTesting('sampled-catalogue');
  const differentiates = traitDistanceCheck();
  const built: SampledAsset[] = [];
  for (const archetype of ASSET_ARCHETYPES) {
    const stream = keyring.derive({
      env: 'simulation',
      asset: 'archetype-sampling',
      purpose: archetype.id,
      keyEpoch: 0,
    });
    for (let index = 0; index < PER_ARCHETYPE; index += 1) {
      const sample = sampleArchetype(archetype, stream);
      const id = `${archetype.id}-${index}`;
      const outcome = await registerAsset(
        {
          id,
          family: archetype.family,
          displayName: `${archetype.label} ${index + 1}`,
          referencePrice: referencePriceFor[archetype.id]!,
          traits: sample.traits,
          targets: { excessKurtosis: sample.excessKurtosis, tickRms: sample.tickRms },
          dispersion: sample.dispersion,
        },
        {
          keyring,
          environment: 'simulation',
          existing: built.map((entry) => entry.asset),
          differentiates,
          calibration: spanFor(sample.traits.cascadeSpanMs),
        },
      );
      if (outcome.kind !== 'registered') {
        throw new Error(`${id} refused at ${outcome.stage}: ${outcome.reason}`);
      }
      built.push({ archetype, asset: outcome.asset, budget: sample.dispersion });
    }
  }
  return built;
}

function engineFor(
  asset: RegisteredAsset,
  maxTicks: number,
  seed = 'sampled-catalogue-run',
  sign?: RandomSource,
) {
  return createMarketEngine({
    config: configFor(asset),
    keyring: MasterKeyring.forTesting(seed),
    environment: 'simulation',
    start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
    maxTicks,
    ...(sign === undefined ? {} : { streams: { sign } }),
  });
}

/** The same market under another id: a different stream family, one character. */
function under(asset: RegisteredAsset, id: string): RegisteredAsset {
  return {
    ...asset,
    definition: { ...asset.definition, id },
    instrument: { ...asset.instrument, id },
  };
}

async function signaturesFor(
  asset: RegisteredAsset,
  seed: string,
): Promise<readonly AssetSignature[]> {
  // **Out-of-band audit, a1-01.** This built 80,010 ticks per asset with the
  // default 250,000-tick chunk, so the builder's only yield never fired, and
  // twenty-four assets plus their control clones — 92 s on the hosted runner —
  // ran as one macrotask-free stretch while the previous test's task update was
  // in flight. Vitest's sixty-second reply timer then fired before the reply
  // was read: `Timeout calling "onTaskUpdate"`, every test passing, `main` red
  // on four consecutive pushes and green locally on 8% of headroom.
  const dataset = await buildObserverDataset({
    source: engineFor(asset, SIGNATURE_TICKS, seed),
    maxTicks: SIGNATURE_TICKS,
    chunkTicks: 10_000,
  });
  return Array.from({ length: WINDOWS }, (_, w) =>
    assetSignature(dataset, w * WINDOW_TICKS, WINDOW_TICKS),
  );
}

/** Spearman's rank correlation. Ties broken by order, which is enough here. */
function rankCorrelation(xs: readonly number[], ys: readonly number[]): number {
  const rank = (values: readonly number[]): number[] => {
    const order = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value);
    const ranks = new Array<number>(values.length);
    order.forEach((entry, position) => {
      ranks[entry.index] = position;
    });
    return ranks;
  };
  const a = rank(xs);
  const b = rank(ys);
  const n = a.length;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += (a[i]! - b[i]!) ** 2;
  return 1 - (6 * sum) / (n * (n * n - 1));
}

describe('a catalogue drawn from the archetypes', () => {
  let catalogue: readonly SampledAsset[];

  it('registers three assets from every archetype', async () => {
    catalogue = await buildCatalogue();
    expect(catalogue).toHaveLength(ASSET_ARCHETYPES.length * PER_ARCHETYPE);
    // Every one of them went through the same registration a hand-authored
    // asset would: safety gate, personality solve, lattice calibration,
    // dispersion fit, and the INV-007 guard against everything before it.
    for (const entry of catalogue) {
      expect(entry.asset.instrument.logQuantum, entry.asset.definition.id).toBeGreaterThan(0);
      expect(entry.asset.evidence.volatilityScale, entry.asset.definition.id).not.toBe(1);
    }
  }, 600_000);

  it('is structurally sign-blind, asset by asset', async () => {
    // The guarantee that matters, and the one no statistical battery replaces.
    // These personalities were drawn by a generator rather than reasoned about
    // by anyone, which is exactly why each of them has to be checked: negate
    // the sign stream and every latent variable must be bit-identical while
    // every increment is exactly negated.
    const keyring = MasterKeyring.forTesting('sampled-catalogue-run');
    for (const entry of catalogue) {
      const result = runMirrorTest(
        (sign) => engineFor(entry.asset, MIRROR_TICKS, 'sampled-catalogue-run', sign),
        () =>
          keyring.derive({
            env: 'simulation',
            asset: entry.asset.definition.id,
            purpose: 'sign',
            keyEpoch: 0,
          }),
        { burnInTicks: MIRROR_TICKS / 2, compareTicks: MIRROR_TICKS / 2 },
      );
      expect(result.divergences, entry.asset.definition.id).toEqual([]);
      expect(result.mirrored, entry.asset.definition.id).toBe(true);
      // Twenty-four mirror tests of 120,000 ticks each is half a minute of
      // uninterrupted CPU, and a synchronous block that long starves the test
      // worker's own progress channel: every test passes and the run still
      // exits 1 with `Timeout calling "onTaskUpdate"`. It cost PH-4 a phase
      // gate (B-005), recurred in PH-10.3, and recurred here.
      await yieldToLoop();
    }
  }, 900_000);

  it('lands on the dispersion budget its family declared', async () => {
    // Re-measured on an unrelated keyring over a span the registration never
    // saw. The registration hits its target by construction — it measures once
    // and rescales — so asserting the recorded number would assert arithmetic.
    // What is genuinely open is whether the *rate* it measured is the rate the
    // asset actually diffuses at.
    const keyring = MasterKeyring.forTesting('dispersion-verification');
    const budgets: number[] = [];
    const realised: number[] = [];
    const rows: string[] = [];
    for (const entry of catalogue) {
      const fresh = await calibrateAssetAsync(
        entry.asset.definition,
        (purpose) =>
          keyring.derive({
            env: 'simulation',
            asset: registrationKeyLabel(entry.asset.definition.id),
            purpose: `verify-${purpose}`,
            keyEpoch: 0,
          }),
        verificationSpanFor(entry.asset.definition.traits.cascadeSpanMs),
      );
      const measured = dispersionLogSigma(fresh.evidence);
      budgets.push(entry.budget);
      realised.push(measured);
      rows.push(
        `${entry.asset.definition.id.padEnd(20)} budget ${(100 * entry.budget).toFixed(1)}% ` +
          `realised ${(100 * measured).toFixed(1)}% ratio ${(measured / entry.budget).toFixed(3)}`,
      );
    }
    console.info(rows.join('\n'));

    const ratios = realised.map((value, index) => value / budgets[index]!).sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)]!;
    console.info(
      `dispersion ratio: median ${median.toFixed(3)}, ` +
        `min ${ratios[0]!.toFixed(3)}, max ${ratios[ratios.length - 1]!.toFixed(3)}`,
    );

    // The budget is honoured in the mean. A two-day realisation of a process
    // whose volatility remembers for up to two days is a noisy estimate of its
    // own diffusion rate, so the per-asset band is wide and says so.
    // Sixteen turnovers in the fit and thirty-two in the check, three replicates
    // each. **Cycle Audit 6 (CA6-15/16) moved the median from 1.156 to 1.024**:
    // the old four-turnover fit was systematically low, and since the rescale
    // factor is `budget / measured`, every asset overshot its declared budget by
    // about that much. The median is the number that shows a *bias*; the
    // per-asset band shows how noisy a single estimate still is, and is left
    // where one run's observed range (0.63 to 1.52) supports it.
    expect(median).toBeGreaterThan(0.8);
    expect(median).toBeLessThan(1.25);
    expect(ratios[0]).toBeGreaterThan(0.5);
    expect(ratios[ratios.length - 1]).toBeLessThan(2);

    // The ordering is the claim that survives the noise: an asset from a louder
    // family is louder. Across a fortyfold range of budgets this is close to
    // exact, and a broken fit would destroy it long before it moved the median.
    const correlation = rankCorrelation(budgets, realised);
    console.info(`budget-to-realised rank correlation: ${correlation.toFixed(3)}`);
    expect(correlation).toBeGreaterThan(0.9);
  }, 1_800_000);

  it('separates its own siblings, not merely its families', async () => {
    // The measurement PH-17.2 exists for. Separating an alt-coin from an index
    // is separation by amplitude and proves nothing about sampling; separating
    // three assets drawn from *one* archetype is the claim that a hundred
    // assets from eight families are a hundred assets.
    //
    // Shape features only — pace and scale removed — so nothing here can be won
    // by one asset simply moving more or ticking faster.
    //
    // ## The null is a control, not a number
    //
    // Cycle Audit 4 found this project's other differentiation test passing on
    // luck: five copies of ONE personality reached 33.5% against a 20% chance
    // rate, because each asset's windows are contiguous slices of one
    // realisation and therefore share slow state. A threshold set above chance
    // is not a claim about whether the personalities differ.
    //
    // So each archetype is measured twice: three sampled siblings, and three
    // **clones** of the first of them under different ids. The clones carry
    // every dependence the real measurement has, because they are the same
    // measurement with the personalities made identical. Under three unrelated
    // stream families, so the comparison is between two distributions rather
    // than between two draws.
    // **Cycle Audit 6, CA6-22.** Three seeds, compared as `min(real)` against
    // `max(control)`, is a comparison of two extremes over a small sample: an
    // auditor measured that assertion failing on **26 of 120** seed triples
    // drawn from ten families, while the underlying distributions separate by
    // 11 points of mean. The statistic was the problem, not the property.
    //
    // Six seeds, compared **pairwise** — each stream family's sampled figure
    // against its own control — plus the mean difference. Pairing removes the
    // between-seed variance that made the extremes overlap, and it is the
    // comparison the design actually supports: the control exists to be run
    // alongside the real thing on the same seed.
    const SEEDS = [
      'signatures-a',
      'signatures-b',
      'signatures-c',
      'signatures-d',
      'signatures-e',
      'signatures-f',
    ] as const;
    const realBySeed: number[] = [];
    const controlBySeed: number[] = [];
    let lastWhole = 0;

    for (const seed of SEEDS) {
      const signatures = new Map<string, readonly AssetSignature[]>();
      for (const entry of catalogue) {
        signatures.set(entry.asset.definition.id, await signaturesFor(entry.asset, seed));
        await yieldToLoop(); // a1-01: a full loop turn between assets
      }

      const whole = measureDifferentiation(
        catalogue.map((entry) => ({
          asset: entry.asset.definition.id,
          signatures: signatures.get(entry.asset.definition.id)!,
        })),
        SHAPE_FEATURES,
      );
      lastWhole = whole.accuracy;
      console.info(
        `[${seed}] whole catalogue: shape accuracy ${(100 * whole.accuracy).toFixed(1)}% ` +
          `against ${(100 * whole.chance).toFixed(1)}% chance`,
      );

      const real: number[] = [];
      const control: number[] = [];
      for (const archetype of ASSET_ARCHETYPES) {
        const siblings = catalogue.filter((entry) => entry.archetype.id === archetype.id);
        real.push(
          measureDifferentiation(
            siblings.map((entry) => ({
              asset: entry.asset.definition.id,
              signatures: signatures.get(entry.asset.definition.id)!,
            })),
            SHAPE_FEATURES,
          ).accuracy,
        );
        const clone = siblings[0]!.asset;
        const clones = [];
        for (const suffix of ['c1', 'c2', 'c3']) {
          const id = `${archetype.id}-${suffix}`;
          clones.push({ asset: id, signatures: await signaturesFor(under(clone, id), seed) });
          await yieldToLoop(); // a1-01: a full loop turn between clones
        }
        control.push(measureDifferentiation(clones, SHAPE_FEATURES).accuracy);
        await yieldToLoop(); // a1-01: and between archetypes
      }
      const mean = (values: readonly number[]) =>
        values.reduce((sum, value) => sum + value, 0) / values.length;
      realBySeed.push(mean(real));
      controlBySeed.push(mean(control));
      console.info(
        `[${seed}] sibling shape accuracy: sampled ${(100 * mean(real)).toFixed(1)}%, ` +
          `identical-personality control ${(100 * mean(control)).toFixed(1)}%`,
      );
    }

    // The whole catalogue first, where chance is 1/24 and the separation is not
    // subtle.
    expect(lastWhole).toBeGreaterThan(3 / 24);

    // Then the claim that matters: siblings from one box are further apart than
    // clones are, in every stream family, with no overlap between the two sets
    // of three. A single threshold would have been a guess; this is a
    // separation of distributions.
    console.info(
      `sampled ${realBySeed.map((v) => (100 * v).toFixed(1)).join(', ')} vs ` +
        `control ${controlBySeed.map((v) => (100 * v).toFixed(1)).join(', ')}`,
    );
    //
    // With a margin, because "greater than" alone is not enough here. PH-17.2's
    // plant campaign shrank every archetype box to 2% of its width — a
    // catalogue of near-clones, which is precisely the failure this phase
    // exists to prevent — and the bare comparison survived it at 35.7% against
    // 34.8%. The real separation is 11 points; five is comfortably below that
    // and comfortably above the one point a near-clone catalogue produced.
    const differences = realBySeed.map((real, index) => real - controlBySeed[index]!);
    console.info(
      `paired lift per seed: ${differences.map((d) => (100 * d).toFixed(1)).join(', ')}`,
    );
    // Every stream family separates, and the mean lift is large. Neither is a
    // comparison of extremes.
    for (const [index, difference] of differences.entries()) {
      expect(difference, `seed ${SEEDS[index]!}`).toBeGreaterThan(0.03);
    }
    const meanLift = differences.reduce((sum, value) => sum + value, 0) / differences.length;
    expect(meanLift).toBeGreaterThan(0.07);
  }, 1_800_000);
});
