// Invariant evidence: INV-007 (asset differentiation).
import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import { ASSET_ARCHETYPES, sampleArchetype } from './families.js';
import { authorPersonality } from './personality.js';

/**
 * Every archetype draws briefs the solve can author.
 *
 * The property CA6-24 falsified, asserted directly: sampling and authoring were
 * separate steps and nothing connected them — `sampleArchetype` drew a tail
 * weight from a band and `authorPersonality` refused it.
 *
 * Moved here from `families.test.ts` by the out-of-band audit of 2026-09-02
 * (a1-04): forty-eight solves are 25 seconds of synchronous work, which the
 * unit project's timeout cannot see and which, with a task update in flight,
 * is most of the way to the runner's own sixty-second limit. The loop yields
 * a full event-loop turn between archetypes.
 */
const keyring = MasterKeyring.forTesting('families-spec');
const stream = (label: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'families', purpose: label, keyEpoch: 0 });

/** Two chained immediates: one is not a full loop turn (a1-01). */
const yieldToLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

describe('sampling and authoring agree', () => {
  it('never draws a brief the solve cannot author', async () => {
    const refused: string[] = [];
    for (const archetype of ASSET_ARCHETYPES) {
      await yieldToLoop();
      const source = stream(`authorable-${archetype.id}`);
      for (let draw = 0; draw < 6; draw += 1) {
        const sample = sampleArchetype(archetype, source);
        const derive = (purpose: string): RandomSource =>
          stream(`solve-${archetype.id}-${draw}-${purpose}`);
        try {
          authorPersonality(
            sample.traits,
            { excessKurtosis: sample.excessKurtosis, tickRms: sample.tickRms },
            derive,
          );
        } catch (error) {
          refused.push(`${archetype.id} draw ${draw}: ${(error as Error).message}`);
        }
      }
    }
    expect(refused).toEqual([]);
  }, 300_000);
});
