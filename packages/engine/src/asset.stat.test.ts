import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import { calibrateAssetAsync } from './asset.js';
import { ASSET_CATALOGUE, registrationKeyLabel } from './catalogue.js';

/**
 * A long calibration does not overflow the stack.
 *
 * This lived in `asset.test.ts` until the out-of-band audit of 2026-09-02
 * (a1-04) measured it at 31 seconds of synchronous computation: the unit
 * project's 20-second timeout is a `setTimeout` race and cannot interrupt
 * synchronous code, so the test it was raised for was the one it could not
 * see. The config's own rule applies — a unit test that needs more than the
 * timeout is a statistical test in the wrong project.
 */
const base = ASSET_CATALOGUE[0]!.definition;

describe('a long calibration does not overflow the stack', () => {
  it('pools tens of thousands of windows from one replicate', async () => {
    // `pooled.push(...returns)` spreads the whole replicate onto the argument
    // stack. At 32 turnovers of a 46-hour cascade — 61 simulated days, 176,000
    // windowed returns — that is a `RangeError` from a line that reads like a
    // copy. It was latent for as long as calibration spans stayed short, and
    // raising `DISPERSION_FIT_TURNOVERS` found it.
    const keyring = MasterKeyring.forTesting('rescale-spec');
    const long = await calibrateAssetAsync(
      base,
      (purpose) =>
        keyring.derive({
          env: 'test',
          asset: registrationKeyLabel('probe'),
          purpose,
          keyEpoch: 0,
        }),
      { replicates: 1, simulatedMs: 90 * 86_400_000 },
    );
    expect(long.evidence.horizons).toBeGreaterThan(250_000);
    expect(long.evidence.logVariancePerMs).toBeGreaterThan(0);
  }, 300_000);
});
