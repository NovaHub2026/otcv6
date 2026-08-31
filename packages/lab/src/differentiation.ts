import { ln, pow, type RandomSource } from '@otc/core';
import type { ObserverDataset } from './observer.js';

/**
 * Whether assets are genuinely distinct markets, or one market relabelled.
 *
 * INV-007 is the invariant most easily faked. Two assets whose parameters differ
 * on paper can still be statistically indistinguishable in output, and a table of
 * different numbers is not evidence that anything differs. So differentiation is
 * measured, against a null that can actually be reached.
 *
 * ## Why the features are scale-free and pace-free
 *
 * Telling EUR/USD from BTC by amplitude is trivial and means nothing: one has a
 * larger `volatility` trait, which is true by construction and visible to anyone.
 * The interesting claim — the one a trader would recognise as *personality* — is
 * that the assets differ in **shape** after scale and pace are divided out.
 *
 * Every feature here is therefore a ratio or a shape statistic. None can be moved
 * by multiplying every return by a constant, or by ticking faster.
 */
export interface AssetSignature {
  /** ln(mean inter-tick interval). Pace — how fast the market moves. */
  readonly logPace: number;
  /** ln(root mean square tick return, in log-price units). Scale. */
  readonly logScale: number;
  /** Kurtosis of tick returns. Tail weight, independent of amplitude. */
  readonly kurtosis: number;
  /** Autocorrelation of |return| at lags 1, 5 and 20: volatility clustering. */
  readonly clusteringLag1: number;
  readonly clusteringLag5: number;
  readonly clusteringLag20: number;
  /** p99 / p50 of |return|: how far the tail sits from the body. */
  readonly tailRatio: number;
  /** Coefficient of variation of inter-tick intervals: arrival burstiness. */
  readonly arrivalDispersion: number;
  /** Var(10-tick return) / (10 x Var(1-tick return)). Diffusive at 1. */
  readonly varianceRatio: number;
}

export const SIGNATURE_FEATURES = [
  'logPace',
  'logScale',
  'kurtosis',
  'clusteringLag1',
  'clusteringLag5',
  'clusteringLag20',
  'tailRatio',
  'arrivalDispersion',
  'varianceRatio',
] as const satisfies readonly (keyof AssetSignature)[];

/**
 * The signature with pace and scale removed.
 *
 * Separating EUR/USD from BTC by amplitude is trivial and true by construction.
 * These are the features that survive dividing both out — whether the assets
 * differ in *shape*, not merely in size. PH-4.3 measured this at close to chance
 * and reports it as such rather than quietly using the full signature for both
 * claims.
 */
export const SHAPE_FEATURES = SIGNATURE_FEATURES.filter(
  (feature) => feature !== 'logPace' && feature !== 'logScale',
);

function autocorrelation(values: Float64Array, lag: number): number {
  const n = values.length - lag;
  if (n <= 1) return 0;
  let meanA = 0;
  for (let i = 0; i < values.length; i += 1) meanA += values[i]!;
  meanA /= values.length;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < values.length; i += 1) {
    const centred = values[i]! - meanA;
    variance += centred * centred;
    if (i < n) covariance += centred * (values[i + lag]! - meanA);
  }
  if (variance === 0) return 0;
  return covariance / variance;
}

function quantileOf(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)));
  return sorted[index]!;
}

/** Signature of one contiguous window of a dataset. */
export function assetSignature(
  dataset: ObserverDataset,
  from: number,
  count: number,
): AssetSignature {
  if (count < 200) {
    throw new RangeError(`A signature needs at least 200 ticks, received ${count}.`);
  }
  const end = Math.min(dataset.tickCount, from + count);
  const size = end - from - 1;
  if (size < 200) {
    throw new RangeError(`Window [${from}, ${end}) is too short for a signature.`);
  }

  const returns = new Float64Array(size);
  const absolute = new Float64Array(size);
  const intervals = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const index = from + i;
    returns[i] = dataset.prices[index + 1]! - dataset.prices[index]!;
    absolute[i] = Math.abs(returns[i]!);
    intervals[i] = dataset.instants[index + 1]! - dataset.instants[index]!;
  }

  let second = 0;
  let fourth = 0;
  for (let i = 0; i < size; i += 1) {
    const squared = returns[i]! * returns[i]!;
    second += squared;
    fourth += squared * squared;
  }
  const meanSquare = second / size;
  const kurtosis = meanSquare === 0 ? 0 : fourth / size / (meanSquare * meanSquare);

  const sortedAbsolute = [...absolute].sort((a, b) => a - b);
  const median = quantileOf(sortedAbsolute, 0.5);
  const tailRatio = median === 0 ? 0 : quantileOf(sortedAbsolute, 0.99) / median;

  let intervalMean = 0;
  for (let i = 0; i < size; i += 1) intervalMean += intervals[i]!;
  intervalMean /= size;
  let intervalVariance = 0;
  for (let i = 0; i < size; i += 1) {
    const centred = intervals[i]! - intervalMean;
    intervalVariance += centred * centred;
  }
  intervalVariance /= size;
  const arrivalDispersion = intervalMean === 0 ? 0 : Math.sqrt(intervalVariance) / intervalMean;

  const block = 10;
  const blocks = Math.floor(size / block);
  let blockSecond = 0;
  for (let b = 0; b < blocks; b += 1) {
    let sum = 0;
    for (let i = 0; i < block; i += 1) sum += returns[b * block + i]!;
    blockSecond += sum * sum;
  }
  const varianceRatio =
    blocks === 0 || meanSquare === 0 ? 1 : blockSecond / blocks / (block * meanSquare);

  let intervalTotal = 0;
  for (let i = 0; i < size; i += 1) intervalTotal += intervals[i]!;

  return {
    logPace: ln(Math.max(1e-9, intervalTotal / size)),
    logScale: ln(Math.max(1e-30, Math.sqrt(meanSquare))),
    kurtosis,
    clusteringLag1: autocorrelation(absolute, 1),
    clusteringLag5: autocorrelation(absolute, 5),
    clusteringLag20: autocorrelation(absolute, 20),
    tailRatio,
    arrivalDispersion,
    varianceRatio,
  };
}

export interface DifferentiationResult {
  /** Fraction of windows assigned to the asset they came from. */
  readonly accuracy: number;
  /** Accuracy expected if the assets were indistinguishable. */
  readonly chance: number;
  readonly windowsPerAsset: number;
  readonly assets: readonly string[];
  /** Row = true asset, column = assigned asset. */
  readonly confusion: readonly (readonly number[])[];
  /** Assets never confused with any other. */
  readonly perfectlySeparated: readonly string[];
}

/**
 * Leave-one-out nearest-centroid classification of windows to assets.
 *
 * The null is explicit and reachable: if every asset were the same market, a
 * classifier could do no better than `1 / assets`. That is what makes this a
 * measurement rather than a demonstration — `differentiation.test.ts` runs it on
 * a control of identical personalities and requires it to land at chance.
 *
 * Features are standardised across the pooled sample first, so a feature with a
 * large numeric range cannot dominate the distance purely by its units.
 */
export function measureDifferentiation(
  labelled: readonly { asset: string; signatures: readonly AssetSignature[] }[],
  features: readonly (keyof AssetSignature)[] = SIGNATURE_FEATURES,
): DifferentiationResult {
  if (labelled.length < 2) {
    throw new RangeError(`Differentiation needs at least two assets, received ${labelled.length}.`);
  }
  const windowsPerAsset = labelled[0]!.signatures.length;
  for (const entry of labelled) {
    if (entry.signatures.length !== windowsPerAsset) {
      throw new RangeError(
        `Every asset needs the same number of windows: ${entry.asset} has ` +
          `${entry.signatures.length}, expected ${windowsPerAsset}.`,
      );
    }
    if (windowsPerAsset < 3) {
      throw new RangeError(`Need at least 3 windows per asset, received ${windowsPerAsset}.`);
    }
  }

  const pooled = labelled.flatMap((entry) => entry.signatures);
  const means: Record<string, number> = {};
  const deviations: Record<string, number> = {};
  for (const feature of features) {
    let sum = 0;
    for (const signature of pooled) sum += signature[feature];
    const mean = sum / pooled.length;
    let variance = 0;
    for (const signature of pooled) {
      const centred = signature[feature] - mean;
      variance += centred * centred;
    }
    means[feature] = mean;
    // A feature that never varies contributes nothing rather than dividing by zero.
    deviations[feature] = Math.sqrt(variance / pooled.length) || 1;
  }
  const vector = (signature: AssetSignature): number[] =>
    features.map((f) => (signature[f] - means[f]!) / deviations[f]!);

  const assets = labelled.map((entry) => entry.asset);
  const vectors = labelled.map((entry) => entry.signatures.map(vector));
  const confusion = assets.map(() => assets.map(() => 0));
  let correct = 0;
  let total = 0;

  for (let trueAsset = 0; trueAsset < assets.length; trueAsset += 1) {
    for (let held = 0; held < windowsPerAsset; held += 1) {
      // Centroids computed with the held-out window excluded from its own asset,
      // so a window is never classified partly by itself.
      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let candidate = 0; candidate < assets.length; candidate += 1) {
        const rows = vectors[candidate]!;
        let distance = 0;
        for (let f = 0; f < features.length; f += 1) {
          let sum = 0;
          let n = 0;
          for (let w = 0; w < windowsPerAsset; w += 1) {
            if (candidate === trueAsset && w === held) continue;
            sum += rows[w]![f]!;
            n += 1;
          }
          const centroid = sum / n;
          const delta = vectors[trueAsset]![held]![f]! - centroid;
          distance += delta * delta;
        }
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      confusion[trueAsset]![best]! += 1;
      if (best === trueAsset) correct += 1;
      total += 1;
    }
  }

  const perfectlySeparated = assets.filter(
    (_asset, index) => confusion[index]![index]! === windowsPerAsset,
  );
  return {
    accuracy: correct / total,
    chance: 1 / assets.length,
    windowsPerAsset,
    assets,
    confusion,
    perfectlySeparated,
  };
}

/**
 * Significance of an observed accuracy, against a **permutation** null.
 *
 * This replaces a binomial tail, and the reason is worth keeping. The binomial
 * assumed `windowsPerAsset x assets` independent trials. They are neither
 * independent nor identically informative: the windows are contiguous slices of
 * a handful of realisations, and each is classified against a centroid built
 * from its own asset's other windows. Cycle Audit 2 measured the consequence by
 * running the identical-personality control on ten independent id-sets — the
 * accuracies ranged 18.5% to 28.0%, and the binomial reported the 28.0% draw as
 * p = 4.1e-3, i.e. "highly significant differentiation" between five copies of
 * one personality.
 *
 * Shuffling the asset labels across the pooled signatures and re-running the
 * classifier carries that dependence structure automatically: the permuted runs
 * are drawn from exactly the same data, with exactly the same correlations, and
 * differ only in whether the labels mean anything.
 *
 * Returns the fraction of permutations scoring at least the observed accuracy,
 * with the observed run counted — so the smallest reportable value is
 * `1 / (permutations + 1)` rather than an arbitrarily small tail.
 */
export function permutationPValue(
  labelled: readonly { asset: string; signatures: readonly AssetSignature[] }[],
  stream: RandomSource,
  permutations = 499,
  features: readonly (keyof AssetSignature)[] = SIGNATURE_FEATURES,
): { pValue: number; observed: number; permutedMax: number; permutations: number } {
  const observed = measureDifferentiation(labelled, features).accuracy;
  const pooled = labelled.flatMap((entry) => entry.signatures);
  const perAsset = labelled[0]!.signatures.length;

  let atLeastObserved = 1; // the observed arrangement is one of the permutations
  let permutedMax = 0;
  for (let round = 0; round < permutations; round += 1) {
    const shuffled = [...pooled];
    // Fisher-Yates from the injected stream: a significance figure that moved
    // between runs would be worth less than no figure at all.
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = stream.nextBoundedUint32(i + 1);
      const swap = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = swap;
    }
    const relabelled = labelled.map((entry, index) => ({
      asset: entry.asset,
      signatures: shuffled.slice(index * perAsset, (index + 1) * perAsset),
    }));
    const accuracy = measureDifferentiation(relabelled, features).accuracy;
    if (accuracy > permutedMax) permutedMax = accuracy;
    if (accuracy >= observed) atLeastObserved += 1;
  }
  return {
    pValue: atLeastObserved / (permutations + 1),
    observed,
    permutedMax,
    permutations,
  };
}

/**
 * Binomial tail: probability of at least `correct` successes in `total` trials
 * at rate `chance`.
 *
 * **Retained only for comparison.** Its independence assumption does not hold
 * for these windows; use {@link permutationPValue} for anything quoted as
 * evidence. Cycle Audit 2 found this function reporting p = 4.1e-3 for five
 * copies of a single personality.
 */
export function differentiationPValue(result: DifferentiationResult): number {
  const total = result.windowsPerAsset * result.assets.length;
  const correct = Math.round(result.accuracy * total);
  const p = result.chance;
  let logFactorial = 0;
  const logFactorials = new Float64Array(total + 1);
  for (let i = 1; i <= total; i += 1) {
    logFactorial += ln(i);
    logFactorials[i] = logFactorial;
  }
  let tail = 0;
  for (let k = correct; k <= total; k += 1) {
    const logChoose = logFactorials[total]! - logFactorials[k]! - logFactorials[total - k]!;
    tail += pow(Math.E, logChoose + k * ln(p) + (total - k) * ln(1 - p));
  }
  return Math.min(1, tail);
}
