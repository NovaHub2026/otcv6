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
  return { replicates: 1, simulatedMs: minimumDispersionSpanMs({ cascadeSpanMs }) };
}

/** Verification runs twice as long again, on an unrelated keyring. */
function verificationSpanFor(cascadeSpanMs: number): {
  replicates: number;
  simulatedMs: number;
} {
  return { replicates: 1, simulatedMs: 2 * minimumDispersionSpanMs({ cascadeSpanMs }) };
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
  const dataset = await buildObserverDataset({
    source: engineFor(asset, SIGNATURE_TICKS, seed),
    maxTicks: SIGNATURE_TICKS,
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

  it('is structurally sign-blind, asset by asset', () => {
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
    // Four turnovers of volatility memory in the fit and eight in the check, so
    // each estimate carries roughly ±25% and the ratio of two of them rather
    // more. The band is what that arithmetic allows, not what the run produced.
    expect(median).toBeGreaterThan(0.75);
    expect(median).toBeLessThan(1.35);
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
    const SEEDS = ['signatures-a', 'signatures-b', 'signatures-c'] as const;
    const realBySeed: number[] = [];
    const controlBySeed: number[] = [];
    let lastWhole = 0;

    for (const seed of SEEDS) {
      const signatures = new Map<string, readonly AssetSignature[]>();
      for (const entry of catalogue) {
        signatures.set(entry.asset.definition.id, await signaturesFor(entry.asset, seed));
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
        }
        control.push(measureDifferentiation(clones, SHAPE_FEATURES).accuracy);
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
    expect(Math.min(...realBySeed)).toBeGreaterThan(Math.max(...controlBySeed));
  }, 1_800_000);
});
