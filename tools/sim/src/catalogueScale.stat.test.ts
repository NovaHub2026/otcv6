// Invariant evidence: INV-007 (assets have genuinely distinct personalities), INV-003 (one stream per asset).
import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import {
  ASSET_ARCHETYPES,
  ASSET_CATALOGUE,
  AUTHORING_ATTEMPTS,
  minimumDispersionSpanMs,
  registerAsset,
  requestFromBrief,
  traitDistance,
  traitDistanceCheck,
  MINIMUM_TRAIT_DISTANCE,
  type PersonalityTraits,
  type RegisteredAsset,
} from '@otc/engine';

/**
 * A catalogue at scale, guarded on every gate.
 *
 * `catalogueScale.ts` registers a hundred assets for real and takes minutes;
 * this asserts the properties that **depend on the size of the catalogue**, and
 * those turn out to be cheap. Registration's cost is per asset and dominated by
 * simulation — the family decides it, not how many assets already exist. What
 * genuinely scales is:
 *
 * - **feasibility**, because every draw is an independent chance to draw a
 *   personality its own cascade cannot author. Cycle Audit 6 (CA6-24) measured
 *   3.64% of `alt-crypto` briefs unauthorable, which is a 36% chance that a
 *   twelve-asset build fails outright and a near-certainty at a hundred;
 * - **differentiation**, because the comparisons grow as n² and INV-007 is a
 *   statement about the **closest pair**, not about the average.
 *
 * Both are measured here at a scale well past a hundred, in seconds, because
 * neither involves the lattice calibration or the dispersion fit.
 */

const keyring = MasterKeyring.forTesting('catalogue-scale-guard');

/** Briefs per archetype. 25 x 8 = 200, twice the target catalogue size. */
const PER_ARCHETYPE = 25;

function brief(archetypeId: string, index: number) {
  return {
    id: `guard-${archetypeId}-${index}`,
    archetypeId,
    displayName: `${archetypeId} ${index}`,
    referencePrice: 100,
  };
}

describe('a catalogue of a hundred is feasible', () => {
  it('draws 200 personalities that every solve can actually author', async () => {
    // **The measurement that made this subphase worth running.** After the
    // CA6-24 clamp, 1 brief in 400 was *still* refused at `authoring` — all of
    // them `alt-crypto`, all of them at the clamped ceiling. That is a 22%
    // chance a hundred-asset build stops on one, and the operator sees a
    // refusal about a personality they never chose.
    //
    // The clamp is an estimate: the reachable tail weight has no closed form and
    // is measured by simulation (PH-10.1 §5.1). The only exact oracle is the
    // solve, so `requestFromBrief` runs it and retreats the target until it
    // succeeds. `retreats` is how many steps that took, and it must never reach
    // the limit — which is the only outcome that would still refuse.
    const retreated: string[] = [];
    const exhausted: string[] = [];
    for (const archetype of ASSET_ARCHETYPES) {
      for (let index = 0; index < PER_ARCHETYPE; index += 1) {
        const id = `guard-${archetype.id}-${index}`;
        const { retreats } = requestFromBrief(brief(archetype.id, index), {
          keyring,
          environment: 'simulation',
        });
        if (retreats > 0) retreated.push(`${id} (${retreats})`);
        if (retreats >= AUTHORING_ATTEMPTS) exhausted.push(id);
        if (index % 5 === 4) await new Promise((resolve) => setImmediate(resolve));
      }
      // Yield between families. Each is seconds of solving, and a worker that
      // never returns to its own event loop fails the whole run with every test
      // passing — which this file did, at 99.9 seconds, until the watchdog in
      // `vitest.setup.statistical.ts` measured it.
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(exhausted, `${exhausted.length} briefs no solve could author`).toEqual([]);
    // Informational, and worth keeping in the record: the retreat is rare, so
    // the estimated ceiling is nearly always right and this is a safety net
    // rather than a second sampler.
    console.info(
      `retreated: ${retreated.length} of ${ASSET_ARCHETYPES.length * PER_ARCHETYPE}` +
        (retreated.length === 0 ? '' : ` — ${retreated.join(', ')}`),
    );
  }, 600_000);

  it('keeps 200 personalities apart, pair by pair', async () => {
    const drawn: { id: string; traits: PersonalityTraits }[] = [];
    for (const archetype of ASSET_ARCHETYPES) {
      for (let index = 0; index < PER_ARCHETYPE; index += 1) {
        drawn.push({
          id: `guard-${archetype.id}-${index}`,
          traits: requestFromBrief(brief(archetype.id, index), {
            keyring,
            environment: 'simulation',
          }).request.traits,
        });
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    for (const asset of ASSET_CATALOGUE) {
      drawn.push({ id: asset.definition.id, traits: asset.definition.traits });
    }

    let closest = { distance: Infinity, a: '', b: '' };
    let pairs = 0;
    for (let i = 0; i < drawn.length; i += 1) {
      if (i % 32 === 0) await new Promise((resolve) => setImmediate(resolve));
      for (let j = i + 1; j < drawn.length; j += 1) {
        pairs += 1;
        const distance = traitDistance(drawn[i]!.traits, drawn[j]!.traits);
        if (distance < closest.distance) {
          closest = { distance, a: drawn[i]!.id, b: drawn[j]!.id };
        }
      }
    }

    // **These are the drawn personalities, not the registered ones.** The solve
    // moves `clustering`, which is one of the eleven traits compared, so this is
    // a close proxy rather than the registered distance. The registered figure —
    // over the real hundred-asset build — is in
    // `docs/evidence/CYCLE-7-CATALOGUE-SCALE.md`, and it is what the pipeline
    // actually enforces at registration time.
    expect(pairs).toBeGreaterThan(20_000);
    expect(
      closest.distance,
      `closest pair ${closest.a} / ${closest.b} at ${closest.distance.toFixed(5)}`,
    ).toBeGreaterThan(MINIMUM_TRAIT_DISTANCE);
  }, 300_000);

  it('registers one asset from every archetype against a full catalogue', async () => {
    // The whole pipeline, once per family, with `existing` carrying everything
    // already registered — the differentiation check is the only stage whose
    // cost depends on how many assets exist, and this is where it is exercised.
    const registered: RegisteredAsset[] = [];
    for (const archetype of ASSET_ARCHETYPES) {
      const { request } = requestFromBrief(brief(archetype.id, 900), {
        keyring,
        environment: 'simulation',
      });
      const outcome = await registerAsset(request, {
        keyring,
        environment: 'simulation',
        existing: [...ASSET_CATALOGUE, ...registered],
        differentiates: traitDistanceCheck(),
        calibration: { replicates: 2, simulatedMs: minimumDispersionSpanMs(request.traits) },
      });
      expect(
        outcome.kind,
        outcome.kind === 'refused' ? `${outcome.stage}: ${outcome.reason}` : '',
      ).toBe('registered');
      if (outcome.kind === 'registered') registered.push(outcome.asset);
      // Yield between families: each of these is seconds of simulation, and a
      // worker that never returns to its own event loop fails the run with every
      // test passing (`CLAUDE.md` §5).
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(registered.length).toBe(ASSET_ARCHETYPES.length);
  }, 600_000);
});
