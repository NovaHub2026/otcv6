#!/usr/bin/env node
import { MasterKeyring } from '@otc/core';
import {
  ASSET_ARCHETYPES,
  ASSET_CATALOGUE,
  minimumDispersionSpanMs,
  registerAsset,
  requestFromBrief,
  traitDistance,
  traitDistanceCheck,
  MINIMUM_TRAIT_DISTANCE,
  type RegisteredAsset,
} from '@otc/engine';

/**
 * A hundred assets, registered for real, and what it costs.
 *
 * **A deliberate act, not a test.** The default run registers a hundred assets
 * through the whole six-stage pipeline — four of those stages are simulation —
 * and takes several minutes. `catalogueScale.stat.test.ts` guards the same
 * properties on every gate at a scale the gate can afford, and the difference
 * between the two is stated in `docs/evidence/CYCLE-7-CATALOGUE-SCALE.md`.
 *
 * Three questions, none of which has been answered at this scale:
 *
 * 1. **Does a hundred-asset build succeed?** Cycle Audit 6 (CA6-24) measured a
 *    36% failure rate before the tail-weight clamp: `alt-crypto` drew targets
 *    its own cascade depth could not reach, and `registerAsset` refused at
 *    `authoring`. The clamp is in. The rate after it has never been measured.
 * 2. **Do a hundred assets stay distinct?** Differentiation is pairwise, so the
 *    comparisons grow as n², and what INV-007 is about is the **closest pair**.
 *    Three siblings separating says little about ninety-six.
 * 3. **What does registration cost per asset**, and is the cost dominated by the
 *    family or by anything that grows with the size of the catalogue?
 *
 * Every stream derives from the seed below, so the whole run is reproducible.
 */
const SEED = process.env.OTC_SCALE_SEED ?? 'catalogue-scale';
const COUNT = Number(process.env.OTC_SCALE_COUNT ?? '100');

/**
 * A reference price per family, so the numbers on a chart are plausible.
 *
 * It has no effect on anything measured here — the lattice is derived from the
 * asset's own returns and the personality is drawn before this is read — but an
 * index at 1.09 would make the evidence document harder to read than it needs
 * to be.
 */
const REFERENCE: Record<string, number> = {
  'major-fx': 1.1,
  'cross-fx': 165,
  'blue-chip-index': 5_400,
  'sector-etf': 82,
  metal: 2_400,
  energy: 78,
  'major-crypto': 64_000,
  'alt-crypto': 3.4,
};

interface Attempt {
  readonly id: string;
  readonly archetype: string;
  readonly outcome: 'registered' | 'refused';
  readonly stage: string | null;
  readonly reason: string | null;
  readonly seconds: number;
}

async function main(): Promise<void> {
  const keyring = MasterKeyring.forTesting(SEED);
  const attempts: Attempt[] = [];
  const registered: RegisteredAsset[] = [];

  console.info(`Registering ${COUNT} assets from ${ASSET_ARCHETYPES.length} archetypes.`);
  console.info(`Seed: ${SEED}\n`);

  for (let index = 0; index < COUNT; index += 1) {
    const archetype = ASSET_ARCHETYPES[index % ASSET_ARCHETYPES.length]!;
    const id = `scale-${archetype.id}-${Math.floor(index / ASSET_ARCHETYPES.length)}`;
    const started = Date.now();
    const { request } = requestFromBrief(
      {
        id,
        archetypeId: archetype.id,
        displayName: `${archetype.label} ${index}`,
        referencePrice: REFERENCE[archetype.id] ?? 100,
      },
      { keyring, environment: 'simulation' },
    );
    // The candidate is compared against everything registered so far, exactly
    // as a runtime registration is. That is what makes this an n² measurement
    // rather than a hundred independent ones.
    const outcome = await registerAsset(request, {
      keyring,
      environment: 'simulation',
      existing: [...ASSET_CATALOGUE, ...registered],
      differentiates: traitDistanceCheck(),
      calibration: { replicates: 2, simulatedMs: minimumDispersionSpanMs(request.traits) },
    });
    const seconds = (Date.now() - started) / 1000;
    if (outcome.kind === 'registered') {
      registered.push(outcome.asset);
      attempts.push({
        id,
        archetype: archetype.id,
        outcome: 'registered',
        stage: null,
        reason: null,
        seconds,
      });
    } else {
      attempts.push({
        id,
        archetype: archetype.id,
        outcome: 'refused',
        stage: outcome.stage,
        reason: outcome.reason,
        seconds,
      });
    }
    const last = attempts[attempts.length - 1]!;
    console.info(
      `${String(index + 1).padStart(3)}  ${id.padEnd(24)} ${last.outcome.padEnd(10)} ` +
        `${last.seconds.toFixed(1)}s${last.stage === null ? '' : `  ${last.stage}: ${last.reason?.slice(0, 90) ?? ''}`}`,
    );
  }

  report(attempts, registered);
}

function report(attempts: readonly Attempt[], registered: readonly RegisteredAsset[]): void {
  const refused = attempts.filter((a) => a.outcome === 'refused');
  const seconds = attempts.map((a) => a.seconds).sort((a, b) => a - b);
  const total = seconds.reduce((sum, value) => sum + value, 0);

  console.info(`\n## Registration\n`);
  console.info(`| attempted | registered | refused | total | median | p90 | max |`);
  console.info(`| --- | --- | --- | --- | --- | --- | --- |`);
  console.info(
    `| ${attempts.length} | ${registered.length} | ${refused.length} | ` +
      `${total.toFixed(0)}s | ${quantile(seconds, 0.5).toFixed(1)}s | ` +
      `${quantile(seconds, 0.9).toFixed(1)}s | ${quantile(seconds, 1).toFixed(1)}s |`,
  );

  console.info(`\n### By archetype\n`);
  console.info(`| archetype | attempted | refused | median | max |`);
  console.info(`| --- | --- | --- | --- | --- |`);
  for (const archetype of ASSET_ARCHETYPES) {
    const mine = attempts.filter((a) => a.archetype === archetype.id);
    if (mine.length === 0) continue;
    const times = mine.map((a) => a.seconds).sort((a, b) => a - b);
    console.info(
      `| ${archetype.id} | ${mine.length} | ${mine.filter((a) => a.outcome === 'refused').length} | ` +
        `${quantile(times, 0.5).toFixed(1)}s | ${quantile(times, 1).toFixed(1)}s |`,
    );
  }

  if (refused.length > 0) {
    console.info(`\n### Refusals\n`);
    for (const attempt of refused) {
      console.info(`- \`${attempt.id}\` at **${attempt.stage}** — ${attempt.reason ?? ''}`);
    }
  }

  // --- Differentiation, over every pair -------------------------------------
  const all = [...ASSET_CATALOGUE, ...registered];
  const distances: number[] = [];
  let closest = { distance: Infinity, a: '', b: '' };
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const distance = traitDistance(all[i]!.definition.traits, all[j]!.definition.traits);
      distances.push(distance);
      if (distance < closest.distance) {
        closest = { distance, a: all[i]!.definition.id, b: all[j]!.definition.id };
      }
    }
  }
  distances.sort((a, b) => a - b);

  console.info(`\n## Differentiation\n`);
  console.info(
    `${all.length} assets, ${distances.length.toLocaleString()} pairs, on a scale where 1 is ` +
      `the whole trait space and the floor is ${MINIMUM_TRAIT_DISTANCE}.\n`,
  );
  console.info(`| closest pair | min | p1 | p10 | median |`);
  console.info(`| --- | --- | --- | --- | --- |`);
  console.info(
    `| ${closest.a} / ${closest.b} | ${quantile(distances, 0).toFixed(4)} | ` +
      `${quantile(distances, 0.01).toFixed(4)} | ${quantile(distances, 0.1).toFixed(4)} | ` +
      `${quantile(distances, 0.5).toFixed(4)} |`,
  );
  console.info(
    `\nHeadroom at the floor: the closest pair is ` +
      `${(quantile(distances, 0) / MINIMUM_TRAIT_DISTANCE).toFixed(1)}x the minimum.`,
  );
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index]!;
}

await main();
