import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import {
  measureDifferentiation,
  differentiationPValue,
  permutationPValue,
  SHAPE_FEATURES,
  SIGNATURE_FEATURES,
  type AssetSignature,
} from './differentiation.js';

const permutationStream = (): ReturnType<MasterKeyring['derive']> =>
  MasterKeyring.forTesting('permutation').derive({
    env: 'test',
    asset: 'differentiation',
    purpose: 'permutation',
    keyEpoch: 0,
  });

/**
 * Mechanics of the metric, on synthetic signatures.
 *
 * The property that matters is not that it scores highly on the real catalogue —
 * that would be satisfied by a metric that always scores highly. It is that it
 * lands at chance when the assets are the same. These tests fix both ends with
 * data whose answer is known by construction.
 */

function signature(overrides: Partial<AssetSignature>): AssetSignature {
  return {
    logPace: 0,
    logScale: 0,
    kurtosis: 10,
    clusteringLag1: 0.3,
    clusteringLag5: 0.2,
    clusteringLag20: 0.15,
    tailRatio: 10,
    arrivalDispersion: 1.1,
    varianceRatio: 1,
    ...overrides,
  };
}

/** Deterministic pseudo-noise: these tests must never depend on a lucky draw. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

describe('the differentiation metric', () => {
  it('scores at chance when every asset is the same', () => {
    // The control that gives the metric meaning. Same distribution, different
    // draws: a classifier has nothing to find.
    const labelled = ['a', 'b', 'c', 'd'].map((asset, index) => ({
      asset,
      signatures: Array.from({ length: 25 }, (_, w) =>
        signature({ kurtosis: 10 + noise(index * 100 + w) }),
      ),
    }));
    const result = measureDifferentiation(labelled);
    expect(result.chance).toBe(0.25);
    expect(result.accuracy).toBeLessThan(0.45);
    expect(differentiationPValue(result)).toBeGreaterThan(0.01);
  });

  it('scores perfectly when the assets are cleanly separated', () => {
    const labelled = ['a', 'b', 'c', 'd'].map((asset, index) => ({
      asset,
      signatures: Array.from({ length: 25 }, (_, w) =>
        signature({ kurtosis: 10 + index * 50 + noise(index * 100 + w) }),
      ),
    }));
    const result = measureDifferentiation(labelled);
    expect(result.accuracy).toBe(1);
    expect(result.perfectlySeparated).toEqual(['a', 'b', 'c', 'd']);
    expect(differentiationPValue(result)).toBeLessThan(1e-12);
  });

  it('sees a difference that lives only in a feature it is given', () => {
    // Separated on pace alone. Under the full signature that is visible; under
    // the shape-only subset it must vanish, because shape excludes pace by
    // construction. This is what stops the shape claim from quietly borrowing
    // the scale claim's evidence.
    const labelled = ['a', 'b', 'c'].map((asset, index) => ({
      asset,
      signatures: Array.from({ length: 25 }, (_, w) =>
        signature({ logPace: index * 4 + noise(index * 100 + w) }),
      ),
    }));
    expect(measureDifferentiation(labelled).accuracy).toBe(1);
    expect(measureDifferentiation(labelled, SHAPE_FEATURES).accuracy).toBeLessThan(0.55);
  });

  it('excludes pace and scale from the shape subset', () => {
    expect(SHAPE_FEATURES).not.toContain('logPace');
    expect(SHAPE_FEATURES).not.toContain('logScale');
    expect(SHAPE_FEATURES.length).toBe(SIGNATURE_FEATURES.length - 2);
  });

  it('never classifies a window using itself', () => {
    // Leave-one-out is what keeps the accuracy honest. With one window per asset
    // the centroid of the true asset would be the window itself, and accuracy
    // would be 100% for any data at all — so few windows are rejected.
    const labelled = ['a', 'b'].map((asset) => ({
      asset,
      signatures: [signature({}), signature({})],
    }));
    expect(() => measureDifferentiation(labelled)).toThrow(/at least 3 windows/);
  });

  it('rejects malformed input', () => {
    expect(() => measureDifferentiation([{ asset: 'a', signatures: [] }])).toThrow(
      /at least two assets/,
    );
    expect(() =>
      measureDifferentiation([
        { asset: 'a', signatures: Array.from({ length: 5 }, () => signature({})) },
        { asset: 'b', signatures: Array.from({ length: 4 }, () => signature({})) },
      ]),
    ).toThrow(/same number of windows/);
  });

  it('does not count an exact tie as a correct classification', () => {
    // **Out-of-band audit, a4-11.** Two assets with identical signatures: every
    // held-out window is equidistant from both centroids. Ties resolved to the
    // first candidate, so asset `a` was reported "never confused with any
    // other" while being identical to `b` — accuracy 0.5, `perfectlySeparated`
    // `['a']`. Unreachable on measured signatures (no exact tie among 384
    // distances), and wrong as a definition: a window the classifier cannot
    // place is a confused window, not a correct one.
    const labelled = ['a', 'b'].map((asset) => ({
      asset,
      signatures: Array.from({ length: 3 }, () => signature({})),
    }));
    const result = measureDifferentiation(labelled);
    expect(result.accuracy).toBe(0);
    expect(result.perfectlySeparated).toEqual([]);
    expect(result.confusion).toEqual([
      [0, 3],
      [3, 0],
    ]);
  });

  it('reports a confusion matrix that accounts for every window', () => {
    const labelled = ['a', 'b', 'c'].map((asset, index) => ({
      asset,
      signatures: Array.from({ length: 10 }, (_, w) =>
        signature({ kurtosis: 10 + index * 30 + noise(index * 7 + w) }),
      ),
    }));
    const result = measureDifferentiation(labelled);
    for (const row of result.confusion) {
      expect(row.reduce((sum, value) => sum + value, 0)).toBe(10);
    }
  });
});

describe('significance is measured against a permutation null', () => {
  /**
   * The binomial tail this replaces assumed 200 independent classifications.
   * They are contiguous slices of a few realisations, each classified against a
   * centroid built from its own asset's other windows — neither independent nor
   * identically informative. Cycle Audit 2 measured the binomial reporting
   * p = 4.1e-3 for five copies of a single personality.
   */
  function labelledFrom(spread: number) {
    return ['a', 'b', 'c', 'd', 'e'].map((asset, index) => ({
      asset,
      signatures: Array.from({ length: 30 }, (_, w) =>
        signature({ kurtosis: 10 + index * spread + noise(index * 100 + w) }),
      ),
    }));
  }

  it('reports near-certainty as insignificant when the assets are identical', () => {
    const identical = labelledFrom(0);
    const { pValue, observed } = permutationPValue(identical, permutationStream(), 199);
    expect(observed).toBeLessThan(0.45);
    // The whole point: shuffling labels on identical data changes nothing, so
    // the observed run is unremarkable among its permutations.
    expect(pValue).toBeGreaterThan(0.05);
  });

  it('still reports a genuine separation as significant', () => {
    const separated = labelledFrom(60);
    const { pValue, observed, permutedMax } = permutationPValue(
      separated,
      permutationStream(),
      199,
    );
    expect(observed).toBe(1);
    expect(permutedMax).toBeLessThan(1);
    expect(pValue).toBeLessThanOrEqual(1 / 200);
  });

  it('cannot report a p-value below its own resolution', () => {
    // An honest floor: with N permutations the smallest reportable value is
    // 1/(N+1). The binomial happily printed 5.1e-25 from 200 dependent trials.
    const { pValue } = permutationPValue(labelledFrom(60), permutationStream(), 99);
    expect(pValue).toBeGreaterThanOrEqual(1 / 100);
  });

  it('is deterministic for a given stream', () => {
    const data = labelledFrom(20);
    const first = permutationPValue(data, permutationStream(), 99);
    const second = permutationPValue(data, permutationStream(), 99);
    expect(second).toEqual(first);
  });
});
