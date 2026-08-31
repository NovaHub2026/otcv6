import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import { estimateConditionalEdge, estimateDirectionalEdge, formatEdgeReport } from './edge.js';

/** A driftless ±1 walk with independent fair signs: no edge exists in it. */
function fairWalk(length: number, purpose = 'fair'): Int32Array {
  const stream = MasterKeyring.forTesting('edge-spec').derive({
    env: 'test',
    asset: 'walk',
    purpose,
    keyEpoch: 0,
  });
  const prices = new Int32Array(length);
  for (let i = 1; i < length; i += 1) {
    prices[i] = prices[i - 1]! + (stream.nextBoolean() ? 1 : -1);
  }
  return prices;
}

describe('estimateDirectionalEdge', () => {
  it('finds no edge in a fair walk', () => {
    const report = estimateDirectionalEdge(fairWalk(400_000), [1, 5, 30, 60]);
    for (const h of report.horizons) {
      expect(Math.abs(h.z), `H=${h.horizon} z=${h.z.toFixed(2)}`).toBeLessThan(4);
    }
  });

  it('finds a deliberately planted drift', () => {
    // Rebuild the walk with an accumulating upward drift, so the estimator is
    // shown to report something when something is there.
    const base = fairWalk(400_000, 'drifted');
    const drifted = new Int32Array(base.length);
    for (let i = 1; i < base.length; i += 1) {
      const increment = base[i]! - base[i - 1]!;
      drifted[i] = drifted[i - 1]! + increment + (i % 10 === 0 ? 1 : 0);
    }
    const report = estimateDirectionalEdge(drifted, [60]);
    expect(report.horizons[0]!.z).toBeGreaterThan(10);
  });

  it('uses non-overlapping windows by default', () => {
    // Overlapping windows are strongly dependent; treating them as independent
    // inflates significance and is the easiest way to produce a meaningless
    // green gate.
    const prices = fairWalk(100_000);
    const spaced = estimateDirectionalEdge(prices, [100]);
    const overlapping = estimateDirectionalEdge(prices, [100], 'overlapping', 1);
    expect(spaced.horizons[0]!.samples).toBeLessThan(overlapping.horizons[0]!.samples / 50);
  });

  it('counts ties separately from decided outcomes', () => {
    const flat = new Int32Array(1000); // never moves: every outcome is a tie
    const report = estimateDirectionalEdge(flat, [10]);
    expect(report.horizons[0]!.samples).toBe(0);
    expect(report.horizons[0]!.ties).toBeGreaterThan(90);
    expect(report.horizons[0]!.upProbability).toBe(0.5);
  });

  it('rejects an invalid horizon', () => {
    expect(() => estimateDirectionalEdge(fairWalk(100), [0])).toThrow(RangeError);
    expect(() => estimateDirectionalEdge(fairWalk(100), [-1])).toThrow(RangeError);
    expect(() => estimateDirectionalEdge(fairWalk(100), [1.5])).toThrow(RangeError);
  });

  it('formats a readable report', () => {
    const text = formatEdgeReport(estimateDirectionalEdge(fairWalk(10_000), [30], 'demo'));
    expect(text).toContain('demo:');
    expect(text).toContain('H=  30');
    expect(text).toContain('P(up)=');
  });
});

describe('the estimator must not look ahead', () => {
  // This is the property the whole corpus depends on. During PH-1 design a probe
  // whose forward window included the entry tick reported z-scores above 1000 on
  // a provably unexploitable process. A battery with the opposite sign of error
  // would have certified a leaking engine as clean.
  const prices = fairWalk(600_000, 'lookahead');

  const previousMove = (p: Int32Array, i: number): number => {
    const delta = p[i - 1]! - p[i - 2]!;
    return delta > 0 ? 1 : delta < 0 ? 0 : -1;
  };

  /** Deliberately wrong: peeks at the increment that is part of the outcome. */
  const peekingMove = (p: Int32Array, i: number): number => {
    const delta = p[i + 1]! - p[i]!;
    return delta > 0 ? 1 : delta < 0 ? 0 : -1;
  };

  it('reports no edge when conditioning on strictly past information', () => {
    const buckets = estimateConditionalEdge(prices, 30, 2, previousMove, 2);
    for (const bucket of buckets) {
      expect(bucket.samples).toBeGreaterThan(1000);
      expect(Math.abs(bucket.z), `${bucket.name} z=${bucket.z.toFixed(2)}`).toBeLessThan(4);
    }
  });

  it('would report a large spurious edge if it peeked, which is how the bug is recognised', () => {
    const peeking = estimateConditionalEdge(prices, 30, 2, peekingMove, 2);
    const worstPeeking = peeking.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
    const honest = estimateConditionalEdge(prices, 30, 2, previousMove, 2);
    const worstHonest = honest.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));

    // The contrast is the point: the same data, the same estimator, one feature
    // that peeks one tick into the outcome window and one that does not.
    expect(Math.abs(worstPeeking.z)).toBeGreaterThan(10);
    expect(Math.abs(worstPeeking.z)).toBeGreaterThan(3 * Math.abs(worstHonest.z));
  });

  it('scores the outcome from the entry index, not the index before it', () => {
    // Entry at i, outcome compares prices[i + H] against prices[i].
    const p = new Int32Array([0, 5, 5, 5, 5]);
    const report = estimateDirectionalEdge(p, [1], 'explicit', 1);
    // Pairs scored: (0->5) up, (5->5) tie, (5->5) tie, (5->5) tie
    expect(report.horizons[0]!.samples).toBe(1);
    expect(report.horizons[0]!.ties).toBe(3);
  });
});

describe('estimateConditionalEdge', () => {
  it('ignores out-of-range bucket values', () => {
    const prices = fairWalk(50_000, 'buckets');
    const buckets = estimateConditionalEdge(prices, 10, 2, () => 5, 2);
    expect(buckets.every((b) => b.samples === 0)).toBe(true);
  });

  it('returns one entry per bucket', () => {
    const prices = fairWalk(50_000, 'count');
    expect(estimateConditionalEdge(prices, 10, 6, (_p, i) => i % 6, 2)).toHaveLength(6);
  });
});
