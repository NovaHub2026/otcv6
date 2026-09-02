// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream), INV-004 (timeframe observer independence), INV-008 (continuous market state).
import { describe, expect, it } from 'vitest';
import {
  epochMillis,
  MasterKeyring,
  SteppableClock,
  timeframe as timeframeById,
  type Candle,
  type Tick,
} from '@otc/core';
import {
  archetypeById,
  dispersionLogSigma,
  minimumDispersionSpanMs,
  registerAsset,
  sampleArchetype,
  traitDistanceCheck,
  type RegisteredAsset,
} from '@otc/engine';
import {
  backfillMarket,
  DEFAULT_MAX_CATCH_UP_MS,
  InMemoryCandleHistory,
  MemoryStateStore,
  readTimeframe,
  resumeMarket,
} from '@otc/runtime';
import { yieldToLoop } from '@otc/lab';

/**
 * PH-17 end to end: an asset nobody wrote down, with a past, still running.
 *
 * Each subphase proved its own piece. What none of them could prove alone is
 * that the pieces are one product: a personality drawn from a family, solved and
 * calibrated into an asset that exists nowhere in source, given a history it did
 * not have this morning, and then carried forward live without a discontinuity.
 *
 * The asset here is a fresh draw. Nothing about it appears in the catalogue, in
 * a fixture, or in this file.
 */

const ARCHETYPE = archetypeById('metal');
const GENESIS = epochMillis(1_776_000_000_000);
const BACKFILL_DAYS = 7;
const TARGET = epochMillis(GENESIS + BACKFILL_DAYS * 86_400_000);

describe('an asset drawn, registered, backfilled and carried forward', () => {
  let asset: RegisteredAsset;
  let budget: number;
  const store = new MemoryStateStore();
  const history = new InMemoryCandleHistory();
  const keyring = MasterKeyring.forTesting('asset-lifecycle');
  let backfilled: Tick[] = [];

  it('registers a personality that exists nowhere in source', async () => {
    const sample = sampleArchetype(
      ARCHETYPE,
      keyring.derive({ env: 'simulation', asset: 'lifecycle', purpose: 'sample', keyEpoch: 0 }),
    );
    budget = sample.dispersion;
    const outcome = await registerAsset(
      {
        id: 'lifecycle-metal',
        family: ARCHETYPE.family,
        displayName: 'Lifecycle Metal',
        referencePrice: 2_400,
        traits: sample.traits,
        targets: { excessKurtosis: sample.excessKurtosis, tickRms: sample.tickRms },
        dispersion: sample.dispersion,
      },
      {
        keyring,
        environment: 'simulation',
        existing: [],
        differentiates: traitDistanceCheck(),
        calibration: {
          // Three replicates of the four-turnover minimum, so twelve turnovers
          // of this asset's own volatility memory stand behind the fit. One
          // would satisfy the guard and leave the budget carrying about ±25%,
          // which would make the dispersion check below a band rather than a
          // measurement.
          replicates: 3,
          simulatedMs: minimumDispersionSpanMs(sample.traits),
        },
      },
    );
    if (outcome.kind !== 'registered') throw new Error(`${outcome.stage}: ${outcome.reason}`);
    asset = outcome.asset;

    expect(asset.instrument.logQuantum).toBeGreaterThan(0);
    expect(asset.instrument.displayPrecision).toBeGreaterThan(0);
    // Fitted to its family's budget, and the family's band is where it landed.
    expect(dispersionLogSigma(asset.evidence)).toBeCloseTo(budget, 12);
    expect(budget).toBeGreaterThanOrEqual(ARCHETYPE.dispersion.min);
    expect(budget).toBeLessThanOrEqual(ARCHETYPE.dispersion.max);
  }, 600_000);

  it('is given a week of history it did not have this morning', async () => {
    const collected: Tick[] = [];
    const result = await backfillMarket({
      asset,
      keyring,
      environment: 'simulation',
      genesisInstant: GENESIS,
      targetInstant: TARGET,
      store,
      history,
      onTicks: (ticks) => void collected.push(...ticks),
    });
    backfilled = collected;

    // Seven days: 10,080 minute bars and 168 hourly ones, minus whichever is
    // still open at the target.
    expect(result.baseCandles).toBeGreaterThanOrEqual(10_075);
    expect(result.baseCandles).toBeLessThanOrEqual(10_080);
    expect(result.rollupCandles).toBeGreaterThanOrEqual(167);
    expect(result.rollupCandles).toBeLessThanOrEqual(168);
    console.info(
      `lifecycle-metal: ${result.ticksGenerated.toLocaleString()} ticks over ` +
        `${BACKFILL_DAYS} days, ${result.baseCandles.toLocaleString()} minute bars, ` +
        `${result.retainedTicks.length.toLocaleString()} ticks retained`,
    );
  }, 600_000);

  it('serves an unbroken chart at every timeframe it offers', async () => {
    // INV-004 is a claim about *views*: the market does not change when the
    // display does. Here that has to survive a round trip through storage —
    // ticks folded to minutes, stored, read back, folded again.
    const window = { from: GENESIS, to: epochMillis(TARGET + 3_600_000) };
    for (const id of ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const) {
      const bars = await readTimeframe(history, asset.definition.id, id, window.from, window.to);
      const duration = timeframeById(id).durationMs;
      expect(bars.length, `${id} bars`).toBeGreaterThan(0);
      assertContiguous(bars, duration, id);
      // The last bar of the finest tier can be short, because the minute still
      // accumulating at the target is never stored.
      const expected = Math.floor((BACKFILL_DAYS * 86_400_000) / duration);
      expect(bars.length, `${id} count`).toBeGreaterThanOrEqual(expected - 1);
      expect(bars.length, `${id} count`).toBeLessThanOrEqual(expected + 1);
    }
  }, 600_000);

  it('diffuses at the rate its family budgeted for', () => {
    // The whole chain, checked against itself: a budget drawn from a family
    // band, a base volatility fitted to it from a day of simulation, and a week
    // of published prices whose spread has to agree. One week is a noisy sample
    // of a quarterly figure, so the band is wide and says so.
    const first = backfilled[0]!;
    const last = backfilled[backfilled.length - 1]!;
    let sum = 0;
    for (let i = 1; i < backfilled.length; i += 1) {
      const step = (backfilled[i]!.price - backfilled[i - 1]!.price) * asset.instrument.logQuantum;
      sum += step * step;
    }
    const realised = Math.sqrt((sum / (last.instant - first.instant)) * 90 * 86_400_000);
    console.info(
      `lifecycle-metal quarterly dispersion: budget ${(100 * budget).toFixed(2)}%, ` +
        `realised over ${BACKFILL_DAYS} days ${(100 * realised).toFixed(2)}%`,
    );
    // The realised figure is the accurate one: summing squared per-tick moves
    // is the realised quadratic variation, which has far lower variance than
    // the windowed estimator the calibration must use before a lattice exists.
    // What carries the error is the fit, and twelve turnovers puts it near ±12%.
    expect(realised / budget).toBeGreaterThan(0.72);
    expect(realised / budget).toBeLessThan(1.38);
  });

  it('carries on from the backfill with no seam and no repeated tick', async () => {
    // INV-008: candle, clock and process boundaries never reset the process.
    // The join between a market that was provisioned and one that is running is
    // exactly such a boundary, and it is the one an observer would see.
    const clock = new SteppableClock(TARGET);
    const resumed = await resumeMarket({
      asset,
      keyring,
      environment: 'simulation',
      clock,
      store,
      genesisInstant: GENESIS,
    });
    expect(resumed.outcome.kind).toBe('resumed');

    const continuation: Tick[] = [];
    let now: number = TARGET;
    const until = TARGET + 2 * 3_600_000;
    while (now < until) {
      now = Math.min(now + DEFAULT_MAX_CATCH_UP_MS, until);
      continuation.push(...resumed.market.advanceTo(epochMillis(now)));
      // Two hours of market at a two-second pace is seconds of uninterrupted
      // CPU, which is enough to starve the worker's progress channel — the
      // failure where every test passes and the run exits 1 anyway.
      if (now % (600 * DEFAULT_MAX_CATCH_UP_MS) < DEFAULT_MAX_CATCH_UP_MS) {
        await yieldToLoop();
      }
    }

    const joined = [...backfilled, ...continuation];
    expect(continuation.length).toBeGreaterThan(100);
    for (let i = 1; i < joined.length; i += 1) {
      expect(joined[i]!.sequence, `sequence at ${i}`).toBe(joined[i - 1]!.sequence + 1);
      expect(joined[i]!.instant, `instant at ${i}`).toBeGreaterThan(joined[i - 1]!.instant);
    }
  }, 600_000);
});

/** Every bar follows the previous one by exactly one bucket. */
function assertContiguous(bars: readonly Candle[], durationMs: number, label: string): void {
  for (let i = 1; i < bars.length; i += 1) {
    expect(bars[i]!.openInstant - bars[i - 1]!.openInstant, `${label} gap at ${i}`).toBe(
      durationMs,
    );
  }
}
