import { describe, expect, it } from 'vitest';
import {
  measureDifferentiation,
  differentiationPValue,
  SHAPE_FEATURES,
  SIGNATURE_FEATURES,
  type AssetSignature,
} from './differentiation.js';

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
