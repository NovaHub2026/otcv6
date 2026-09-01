import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import { ruinProbability, simulateRuin } from './ruin.js';

/**
 * The Lundberg bound, checked against a simulated walk.
 *
 * Moved out of `ruin.test.ts` in PH-15.1. It is 20,000 paths of up to 2,000
 * steps — a Monte Carlo estimate compared against an analytic bound, which is a
 * statistical assertion by every definition this project uses — and it sat at
 * 2.5 seconds against the unit project's 5-second timeout. It passed for as
 * long as nothing ran beside it and failed the moment PH-15.1 added a test that
 * spawns processes.
 *
 * That is the exact failure `testCost.test.ts` documents: "it appears when the
 * suite gets busier, and it looks like the new work broke something". The new
 * work did not break it; the new work revealed that it had never had headroom.
 *
 * Seeded, so it is deterministic. A statistical assertion that can fail randomly
 * is a defect, not a flake.
 */

const keyring = MasterKeyring.forTesting('ruin-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'ruin', purpose, keyEpoch: 0 });

const book = (over: Partial<Parameters<typeof ruinProbability>[0]> = {}) => ({
  bankroll: 1_000,
  winProbability: 0.5,
  lossPerEvent: 0.99,
  gainPerEvent: 1,
  ...over,
});

describe('the Lundberg bound holds against a simulated walk', () => {
  it('bounds a simulation of the same walk', () => {
    // Lundberg is an upper bound that tightens with capital. A finite horizon
    // can only ruin fewer paths than an infinite one, so the simulation must
    // come in at or below it.
    const inputs = book({ bankroll: 40 });
    const bound = ruinProbability(inputs).probability;
    const simulated = simulateRuin(inputs, 20_000, derive('walk'), 2_000);
    expect(simulated).toBeLessThanOrEqual(bound + 0.02);
    expect(bound).toBeLessThan(1);
  });
});
