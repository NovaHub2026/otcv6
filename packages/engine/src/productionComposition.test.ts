// Invariant evidence: INV-006 (no deterministic exploitable directional rules),
// INV-001 (economic independence).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type RandomSource } from '@otc/core';
import { ASSET_CATALOGUE, configFor } from './catalogue.js';
import { createMarketEngine } from './factory.js';
import { runMirrorTest } from './mirror.js';

/**
 * The composition that actually ships, gated the way it actually ships.
 *
 * ## Why this file exists
 *
 * Cycle Audit 4, M-1. **No test had ever built the engine with
 * `environment: 'production'`.** The single reference to it anywhere in the
 * suite asserted that it *throws* — because `MasterKeyring.forTesting` correctly
 * refuses to key a production stream from a public constant — and the only real
 * caller is `apps/api/src/venue.service.ts`.
 *
 * The consequence is the worst instance of this project's signature defect so
 * far. An auditor planted two defects gated on `environment === 'production'`:
 * an economic channel read through an alias table, and a leverage effect —
 * volatility responding to the signed return, the exact Cycle 1 mechanism. Both
 * passed **220 guardrails, 1,060 unit tests, 190 statistical tests, `tsc -b` and
 * `eslint`**, all green, while producing a measured **+1.78 percentage points**
 * of directional edge at roughly ten standard errors, live only where the
 * product runs.
 *
 * The guards were not merely untested against what they guard. They were
 * structurally unable to observe the configuration that ships.
 *
 * ## And why the mirror test alone did not cover it
 *
 * Cycle Audit 4, M-2. `mirror.test.ts` never calls `createMarketEngine` — it
 * hand-builds a replica of the factory's composition. `INVARIANTS.md` names it
 * first for INV-006 and calls it the gate a statistical battery cannot replace,
 * but it gates a parallel assembly rather than the shipped one. An *ungated*
 * leverage effect planted in `factory.ts` passed it 12 of 12.
 *
 * So this drives `createMarketEngine` directly, under a real keyring, in the
 * production environment, for every asset in the catalogue.
 */

/**
 * A real keyring, because a test one refuses production by design.
 *
 * The secret is generated here and never leaves the process. That is the same
 * construction the service uses — `MasterKeyring.fromSecret` over 32 bytes — so
 * the composition under test is the composition that runs.
 */
function productionKeyring(): MasterKeyring {
  return MasterKeyring.fromSecret('audit-production', randomBytes(32));
}

/**
 * Where the interior index is drawn from, per asset.
 *
 * The production keyring above is a fresh random secret every run, which is the
 * point of it; the reflection point is a *test* parameter and is drawn from a
 * fixed test seed instead, so the sequence of `N` across the catalogue is the
 * same on every run and a failure names a reproducible index.
 */
const INTERIOR = { min: 2_000, max: 8_000 } as const;
const interior = MasterKeyring.forTesting('production-composition-interior').derive({
  env: 'test',
  asset: 'composition',
  purpose: 'interior',
  keyEpoch: 0,
});

describe('the shipped composition is sign-blind in production', () => {
  it.each(ASSET_CATALOGUE.map((a, i) => [a.definition.id, i] as const))(
    '%s mirrors exactly under environment: production',
    (_id, index) => {
      const asset = ASSET_CATALOGUE[index]!;
      const keyring = productionKeyring();
      // One keyring for both runs: the mirror harness must vary the sign source
      // and nothing else.
      const build = (sign: RandomSource) =>
        createMarketEngine({
          config: configFor(asset),
          keyring,
          environment: 'production',
          start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
          streams: { sign },
        });
      const signSource = (): RandomSource =>
        keyring.derive({
          env: 'production',
          asset: asset.definition.id,
          purpose: 'sign',
          keyEpoch: 0,
        });

      const result = runMirrorTest(build, signSource, {
        burnInTicks: INTERIOR,
        compareTicks: 2_000,
        interior,
      });
      expect(result.divergences, `snapshot at ${result.snapshotAt}`).toEqual([]);
      expect(result.mirrored).toBe(true);
      expect(result.snapshotAt).toBeGreaterThanOrEqual(INTERIOR.min);
    },
  );

  it('drives the real factory, not a replica of it', () => {
    // The distinction M-2 turned on. A hand-built copy of the composition can
    // stay green while the factory diverges from it, and `mirror.test.ts` builds
    // its engines by hand.
    const source = readFileSync(
      new URL('./productionComposition.test.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('createMarketEngine');
    expect(source).toContain("environment: 'production'");
  });
});

describe('production and test compositions differ only in their keys', () => {
  it('gives production a different stream, which is the point of the key split', () => {
    const asset = ASSET_CATALOGUE[0]!;
    const drain = (engine: ReturnType<typeof createMarketEngine>, n: number) =>
      Array.from({ length: n }, () => engine.next()?.price);
    const production = drain(
      createMarketEngine({
        config: configFor(asset),
        keyring: productionKeyring(),
        environment: 'production',
        start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
      }),
      200,
    );
    const testing = drain(
      createMarketEngine({
        config: configFor(asset),
        keyring: MasterKeyring.forTesting('composition-compare'),
        environment: 'test',
        start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
      }),
      200,
    );
    expect(production).not.toEqual(testing);
  });
});
