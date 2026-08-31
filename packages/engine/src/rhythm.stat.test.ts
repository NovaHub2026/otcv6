// Invariant evidence: INV-007 (asset differentiation).
import { describe, expect, it } from 'vitest';
import { MasterKeyring, type InstrumentSpec, type RandomSource } from '@otc/core';
import {
  DEFAULT_TRAITS,
  expandPersonality,
  predictedExcessKurtosis,
  solveClustering,
  TRAIT_BOUNDS,
  type PersonalityTraits,
} from './personality.js';

/**
 * The exhaustive depth sweep for the co-varied kurtosis solve.
 *
 * It lives here rather than in the unit project because each solve runs two
 * 400,000-step simulations of the structure layer — the one layer with no closed
 * form — and fifteen depths of that overran a 5s unit timeout under full-suite
 * load. The claim is "every admissible depth", so the sweep stayed exhaustive
 * and moved projects instead of being thinned to fit.
 */

const instrument: InstrumentSpec = {
  id: 'rhythm-sweep-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const keyring = MasterKeyring.forTesting('rhythm-sweep');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'rhythm-sweep', purpose, keyEpoch: 0 });

describe('the co-varied solve across every admissible depth', () => {
  it('hits its target from depth 4 to depth 18', async () => {
    // Yields between depths: fifteen solves is fifteen pairs of 400k-step
    // simulations, and a synchronous block that long starves the worker's RPC
    // channel (B-005).
    const breathe = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));
    const misses: string[] = [];
    for (
      let depth = TRAIT_BOUNDS.cascadeDepth.min;
      depth <= TRAIT_BOUNDS.cascadeDepth.max;
      depth += 1
    ) {
      const target = 40;
      // Spacing tightened and span widened so the ladder still fits between the
      // slowest component and the tick rate at depth 18. Both are tail-neutral,
      // so neither can flatter the solve.
      const base: PersonalityTraits = {
        ...DEFAULT_TRAITS,
        cascadeDepth: depth,
        cascadeSpanMs: 40 * 3_600_000,
        cascadeSpacing: 1.9,
      };
      const clustering = solveClustering(base, target, derive('structure-probe'));
      const achieved = predictedExcessKurtosis(
        expandPersonality({ ...base, clustering }, instrument),
        derive('structure-probe'),
      );
      const relative = Math.abs(achieved - target) / target;
      if (!(relative < 1e-9)) misses.push(`depth ${depth}: ${achieved} (rel ${relative})`);
      await breathe();
    }
    expect(misses).toEqual([]);
  });
});
