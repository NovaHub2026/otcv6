// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring } from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine } from '@otc/engine';
import { buildObserverDataset, runBatteryAsync, withheldFamilies } from '@otc/lab';

/**
 * The red-team verdict: families that never shaped the engine.
 *
 * Every family in the main registry was available while PH-3 tuned the market
 * process, which is how it should have been used — but it means a clean verdict
 * from those families is no longer *independent* evidence. They are the families
 * the engine was shaped to survive.
 *
 * PH-2 measured that failure mode: a conventional battery of 354 hypotheses
 * returned clean on an engine whose volatility was keyed to the price level,
 * because the family that would have caught it did not exist yet.
 *
 * These four condition on quantities no prior family used and no tuning decision
 * ever considered — inter-arrival time, the sequence counter, restart-seam
 * proximity, and a second asset's movement. Each is calibrated against a planted
 * edge in `withheld.stat.test.ts`, so a clean verdict here means something the
 * existing battery's verdict can no longer mean.
 *
 * **If one of these fires, it is a finding for the record, not a target.**
 * Tuning against them would destroy the only property that makes them worth
 * having. PH-9 §5 forbids it explicitly.
 */

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('red-team');
const TICKS = 3_000_000;

async function datasetFor(assetIndex: number, ticks: number) {
  const asset = ASSET_CATALOGUE[assetIndex]!;
  return buildObserverDataset({
    source: createMarketEngine({
      config: configFor(asset),
      keyring,
      environment: 'simulation',
      start: { instant: GENESIS, price: logPrice(0) },
      maxTicks: ticks,
    }),
    maxTicks: ticks,
  });
}

describe('the withheld families find nothing in the real engine', () => {
  it('is clean under inter-arrival, sequence-counter and cross-asset conditioning', async () => {
    const subject = await datasetFor(0, TICKS);
    // A genuinely independent second asset: separate key derivation, separate
    // streams, sharing only a clock. This is the family that would catch a
    // shared-state leak between markets.
    const reference = await datasetFor(2, TICKS);

    const verdict = await runBatteryAsync(subject, {
      families: withheldFamilies({
        sequenceModulus: 7,
        reference: {
          instants: reference.instants,
          prices: reference.prices,
          lookbackMs: 30_000,
        },
      }),
      trainingFraction: 0.3,
    });

    const shortest = verdict.sensitivity[0];
    // eslint-disable-next-line no-console -- recorded evidence for PH-9
    console.info(
      `red team: ${verdict.coverage.hypothesesTested} hypotheses across ` +
        `${verdict.coverage.families} withheld families, ` +
        `${verdict.clean ? 'CLEAN' : 'EXPLOITABLE'}, ` +
        `worst |z| ${verdict.worst === null ? 'n/a' : Math.abs(verdict.worst.z).toFixed(2)}, ` +
        `floor ${shortest?.minimumDetectableEffectPoints.toFixed(3) ?? 'n/a'}pp`,
    );

    // Cannot pass vacuously: a family that bucketed nothing would test nothing,
    // which is precisely how the seam family first appeared to be clean.
    expect(verdict.coverage.hypothesesTested).toBeGreaterThan(30);
    expect(verdict.coverage.families).toBe(3);
    expect(
      verdict.clean,
      `withheld families found: ${verdict.exploitable
        .map((f) => `${f.family}/${f.horizon} edge ${f.edgePoints.toFixed(3)}pp`)
        .join(', ')}`,
    ).toBe(true);
  }, 900_000);

  it('is clean across a real restart seam', async () => {
    // Seams did not exist until PH-5 and have never been attacked. Build one for
    // real: run, checkpoint the cursors, restart beyond them, and attack the
    // joined series at the seam.
    const asset = ASSET_CATALOGUE[0]!;
    const half = 900_000;
    const first = createMarketEngine({
      config: configFor(asset),
      keyring,
      environment: 'simulation',
      start: { instant: GENESIS, price: logPrice(0) },
      maxTicks: half,
    });
    const before = [];
    for (;;) {
      const tick = first.next();
      if (tick === null) break;
      before.push(tick);
    }
    const snapshot = first.snapshot();

    // Restart beyond every consumed position, as `seamFrom` does.
    const cursors: Record<string, string> = {};
    for (const [purpose, cursor] of Object.entries(snapshot.cursors)) {
      const block = BigInt(cursor.split(':')[0]!) + 4_096n;
      cursors[purpose] = `${block.toString()}:0`;
    }
    const second = createMarketEngine({
      config: configFor(asset),
      keyring,
      environment: 'simulation',
      start: { instant: snapshot.instant, price: snapshot.price, sequence: snapshot.sequence },
      cursors,
      maxTicks: half,
    });
    const after = [];
    for (;;) {
      const tick = second.next();
      if (tick === null) break;
      after.push(tick);
    }

    const joined = [...before, ...after];
    const dataset = await buildObserverDataset({
      source: {
        instrument: asset.instrument,
        next: (() => {
          let i = 0;
          return () => (i < joined.length ? joined[i++]! : null);
        })(),
      },
      maxTicks: joined.length,
    });

    const verdict = await runBatteryAsync(dataset, {
      families: withheldFamilies({ seamIndices: [before.length] }),
      trainingFraction: 0.3,
      minimumBucketSamples: 200,
    });

    // eslint-disable-next-line no-console -- recorded evidence for PH-9
    console.info(
      `red team seam: ${verdict.coverage.hypothesesTested} hypotheses, ` +
        `${verdict.clean ? 'CLEAN' : 'EXPLOITABLE'}, seam at tick ${before.length}`,
    );

    expect(verdict.coverage.hypothesesTested).toBeGreaterThan(5);
    expect(
      verdict.clean,
      `seam is exploitable: ${verdict.exploitable.map((f) => f.family).join(', ')}`,
    ).toBe(true);
  }, 900_000);
});
