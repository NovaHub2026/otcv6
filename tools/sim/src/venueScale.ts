#!/usr/bin/env node
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { epochMillis, MasterKeyring, SteppableClock, durationMillis } from '@otc/core';
import {
  ASSET_ARCHETYPES,
  minimumDispersionSpanMs,
  registerAsset,
  requestFromBrief,
  traitDistanceCheck,
  type RegisteredAsset,
} from '@otc/engine';
import {
  backfillMarket,
  InMemoryCandleHistory,
  MemoryStateStore,
  SqliteCandleHistory,
  Venue,
  type HostedMarket,
} from '@otc/runtime';

/**
 * A hundred hosted markets: what they cost to advance and what they cost on
 * disk.
 *
 * **A deliberate act, not a test.** `catalogueScale.ts` answers whether a
 * hundred assets can be *registered*; this answers whether they can be *run*.
 * Two questions, and the second is the one that decides the product's shape:
 *
 * 1. **Does the venue cost scale linearly in markets?** One advance loops every
 *    market. The markets share a clock and nothing else, so it should — and
 *    "should" is what this replaces with a measurement at 5, 25, 50 and 100.
 * 2. **What does a quarter of history cost per asset on disk?** 131,759 candles
 *    per asset per quarter is the number that makes a large catalogue
 *    affordable, and it has never been multiplied by a hundred and weighed.
 *
 * Registration is skipped: the personalities are drawn and calibrated once at
 * the **largest** count and the smaller sizes are prefixes of that draw, because
 * what is being measured is the *runtime* and a fresh solve per size would
 * measure the solve. (Cycle Audit 7, CA7-26: this said "smallest", which is the
 * one design decision the docstring exists to explain, and it disagreed with
 * the code beneath it.)
 */
const SEED = process.env.OTC_VENUE_SEED ?? 'venue-scale';
const SIZES = (process.env.OTC_VENUE_SIZES ?? '5,25,50,100').split(',').map(Number);
/** Simulated hours each measurement advances the venue through. */
const HOURS = Number(process.env.OTC_VENUE_HOURS ?? '6');
/** Simulated days of history backfilled for the storage measurement. */
const STORAGE_DAYS = Number(process.env.OTC_VENUE_STORAGE_DAYS ?? '2');

const keyring = MasterKeyring.forTesting(SEED);
const GENESIS = epochMillis(1_776_000_000_000);

async function build(count: number): Promise<RegisteredAsset[]> {
  const assets: RegisteredAsset[] = [];
  for (let index = 0; index < count; index += 1) {
    const archetype = ASSET_ARCHETYPES[index % ASSET_ARCHETYPES.length]!;
    const { request } = requestFromBrief(
      {
        id: `venue-${index}`,
        archetypeId: archetype.id,
        displayName: `Venue ${index}`,
        referencePrice: 100,
      },
      { keyring, environment: 'simulation' },
    );
    const outcome = await registerAsset(request, {
      keyring,
      environment: 'simulation',
      existing: assets,
      differentiates: traitDistanceCheck(),
      calibration: { replicates: 1, simulatedMs: minimumDispersionSpanMs(request.traits) },
    });
    if (outcome.kind === 'refused') {
      throw new Error(`venue-${index} refused at ${outcome.stage}: ${outcome.reason}`);
    }
    assets.push(outcome.asset);
    if (index % 10 === 0) console.info(`  built ${index + 1}/${count}`);
  }
  return assets;
}

async function main(): Promise<void> {
  const largest = Math.max(...SIZES);
  console.info(
    `Building ${largest} assets (one calibration replicate — this is a runtime\n` +
      `measurement, not a calibration one). Seed: ${SEED}\n`,
  );
  const assets = await build(largest);

  console.info(`\n## Scheduling\n`);
  console.info(`| markets | ticks published | wall seconds | µs per market-advance | ticks/s |`);
  console.info(`| --- | --- | --- | --- | --- |`);

  for (const size of SIZES) {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryStateStore();
    const markets: { asset: RegisteredAsset; market: HostedMarket }[] = [];
    for (const asset of assets.slice(0, size)) {
      const result = await backfillMarket({
        asset,
        keyring,
        environment: 'simulation',
        genesisInstant: epochMillis(GENESIS - 60_000),
        targetInstant: GENESIS,
        store,
        // Discarded: this measurement is about scheduling, and writing candles
        // would put a store's cost inside a number about the venue's.
        history: new InMemoryCandleHistory(),
      });
      markets.push({ asset, market: result.market });
    }
    const venue = new Venue({ clock, markets });
    venue.prime();

    // Advance in steps inside the catch-up bound, exactly as the service does.
    const steps = Math.round((HOURS * 3_600_000) / 15_000);
    let ticks = 0;
    let advances = 0;
    const started = process.hrtime.bigint();
    for (let step = 0; step < steps; step += 1) {
      clock.advance(durationMillis(15_000));
      for (const batch of venue.advance()) ticks += batch.ticks.length;
      advances += 1;
    }
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const perMarketAdvance = (seconds * 1e6) / (advances * size);
    console.info(
      `| ${size} | ${ticks.toLocaleString()} | ${seconds.toFixed(1)} | ` +
        `${perMarketAdvance.toFixed(1)} | ${Math.round(ticks / seconds).toLocaleString()} |`,
    );
  }

  // --- Storage ---------------------------------------------------------------
  console.info(`\n## Storage\n`);
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-venue-scale-'));
  const dbPath = path.join(directory, 'history.db');
  const history = new SqliteCandleHistory(dbPath);
  const store = new MemoryStateStore();
  const sample = assets.slice(0, Math.min(8, assets.length));
  const target = epochMillis(GENESIS + STORAGE_DAYS * 86_400_000);
  let candles = 0;
  for (const asset of sample) {
    const result = await backfillMarket({
      asset,
      keyring,
      environment: 'simulation',
      genesisInstant: GENESIS,
      targetInstant: target,
      store,
      history,
    });
    candles += result.baseCandles;
  }
  // **The measurement this runner got wrong on its first execution.** SQLite is
  // in WAL mode, so a `stat` of `history.db` immediately after the writes reads
  // a nearly empty file — everything is still in `history.db-wal` until a
  // checkpoint. The first run of this runner duly reported 23,032 minute bars
  // occupying 0.0 MB, and a storage budget of 0.00 GB for a hundred assets,
  // which is the shape of a recorded number that is simply false.
  //
  // Closing the database checkpoints the WAL into the main file. That close is
  // the whole of the defence, and the three-file sum is *not* a second one.
  //
  // **Cycle Audit 7, CA7-21.** The comment here used to claim the sum made the
  // measurement checkpoint-independent. Measured: the same backfill reads
  // 1,437,696 B before the close and 602,112 B after — 139% apart — because an
  // un-checkpointed WAL holds copies of pages that also still exist, stale, in
  // the main file, and `-shm` is 32 kB of pure overhead counted as data. The
  // sum is kept because it is harmless and because a `-wal` left behind by a
  // crash would otherwise vanish from the total; it defends nothing on its own,
  // and saying it did was a second wrong claim about the same defect.
  history.close();
  const bytes = (
    await Promise.all(
      ['', '-wal', '-shm'].map(async (suffix) => {
        try {
          return (await stat(`${dbPath}${suffix}`)).size;
        } catch {
          return 0;
        }
      }),
    )
  ).reduce((total, size) => total + size, 0);
  const perAssetDay = bytes / sample.length / STORAGE_DAYS;
  console.info(
    `${sample.length} assets x ${STORAGE_DAYS} days = ${candles.toLocaleString()} minute bars, ` +
      `${(bytes / 1e6).toFixed(1)} MB on disk (${(bytes / candles).toFixed(0)} bytes per bar).\n`,
  );
  console.info(`| per asset-day | per asset-quarter | 100 assets, one quarter |`);
  console.info(`| --- | --- | --- |`);
  console.info(
    `| ${(perAssetDay / 1e3).toFixed(0)} kB | ${((perAssetDay * 90) / 1e6).toFixed(1)} MB | ` +
      `${((perAssetDay * 90 * 100) / 1e9).toFixed(2)} GB |`,
  );
  console.info(
    `\nBytes per bar divides total file size by MINUTE bars, and the file already` +
      ` contains the hourly tier: adding a sixtieth on top double-counts it` +
      ` (Cycle Audit 7, CA7-25). Measured on this shape of run: 1h 192 rows,` +
      ` 1m 11,516 — 52.6 B per minute bar against 51.8 B per stored row.`,
  );
  await rm(directory, { recursive: true, force: true });
}

await main();
