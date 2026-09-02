// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream), INV-008 (continuous market state).
import { describe, expect, it } from 'vitest';
import {
  bucketStart,
  epochMillis,
  foldTicks,
  logPrice,
  MasterKeyring,
  SteppableClock,
  timeframe as timeframeById,
  type Tick,
} from '@otc/core';
import { assetById, configFor, createMarketEngine } from '@otc/engine';
import { backfillMarket, BackfillError } from './backfill.js';
import { HostedMarket, DEFAULT_MAX_CATCH_UP_MS } from './hosted.js';
import {
  HISTORY_BASE_TIMEFRAME,
  HISTORY_ROLLUP_TIMEFRAME,
  InMemoryCandleHistory,
} from './history.js';
import { MemoryStateStore } from './fileStore.js';
import { resumeMarket } from './resume.js';

const asset = assetById('spx');
const keyring = MasterKeyring.forTesting('backfill-spec');
const GENESIS = epochMillis(1_776_000_000_000);
/** Six hours: long enough for hourly bars, short enough for a unit test. */
const SPAN_MS = 6 * 3_600_000;
const TARGET = epochMillis(GENESIS + SPAN_MS);

function options(over: Record<string, unknown> = {}) {
  return {
    asset,
    keyring,
    environment: 'test' as const,
    genesisInstant: GENESIS,
    targetInstant: TARGET,
    store: new MemoryStateStore(),
    history: new InMemoryCandleHistory(),
    ...over,
  };
}

/**
 * A market run live from genesis to `to`, as the reference.
 *
 * The step is deliberately **different** from the backfill's. A comparison
 * against the same cadence would be near-tautological — the same code called the
 * same number of times — whereas what actually has to be true is that the tick
 * stream does not depend on how often anything asks for it. That is INV-002 at
 * the level of the runtime: two observers polling at different rates see one
 * market.
 */
function liveThrough(to: number, stepMs = 1_000): { market: HostedMarket; ticks: Tick[] } {
  const clock = new SteppableClock(GENESIS);
  const market = new HostedMarket({
    engine: createMarketEngine({
      config: configFor(asset),
      keyring,
      environment: 'test',
      start: { instant: GENESIS, price: logPrice(0) },
    }),
    clock,
  });
  const ticks: Tick[] = [];
  let now: number = GENESIS;
  while (now < to) {
    now = Math.min(now + stepMs, to);
    ticks.push(...market.advanceTo(epochMillis(now)));
  }
  return { market, ticks };
}

describe('a backfilled market is the market, not a picture of one', () => {
  it('produces exactly the ticks a live market would have', async () => {
    // The property everything else rests on. A backfill that drove the engine
    // directly instead of going through the runtime would be a second way of
    // producing prices, and any divergence would show up as a chart that
    // disagrees with the record precisely where the backfill ends (INV-003).
    const collected: Tick[] = [];
    const result = await backfillMarket(
      options({ onTicks: (ticks: readonly Tick[]) => void collected.push(...ticks) }),
    );
    // Backfilled at the 15-second bound, compared against a market advanced
    // every second: 1,440 calls against 21,600, and one stream.
    const live = liveThrough(TARGET);
    expect(collected).toEqual(live.ticks);
    expect(result.ticksGenerated).toBe(live.ticks.length);
    expect(result.ticksGenerated).toBeGreaterThan(1_000);
  }, 60_000);

  it('joins to the live market with no seam and no repeated tick', async () => {
    // INV-008: candle, clock and process boundaries never reset the process. The
    // checkpoint the backfill leaves is the join, so the first tick after it is
    // the tick the backfill would have produced next.
    const store = new MemoryStateStore();
    const backfilled: Tick[] = [];
    await backfillMarket(
      options({ store, onTicks: (ticks: readonly Tick[]) => void backfilled.push(...ticks) }),
    );

    const clock = new SteppableClock(TARGET);
    const resumed = await resumeMarket({
      asset,
      keyring,
      environment: 'test',
      clock,
      store,
      genesisInstant: GENESIS,
    });
    expect(resumed.outcome.kind).toBe('resumed');

    const continuation: Tick[] = [];
    let now: number = TARGET;
    const until = TARGET + 30 * 60_000;
    while (now < until) {
      now = Math.min(now + DEFAULT_MAX_CATCH_UP_MS, until);
      continuation.push(...resumed.market.advanceTo(epochMillis(now)));
    }

    const live = liveThrough(until);
    expect([...backfilled, ...continuation]).toEqual(live.ticks);
  }, 60_000);
});

describe('what the backfill writes', () => {
  it('stores both tiers, covering the span', async () => {
    const history = new InMemoryCandleHistory();
    const result = await backfillMarket(options({ history }));
    // Six hours: 360 minute bars and 6 hourly bars, minus whichever is still
    // open at the target.
    expect(result.baseCandles).toBeGreaterThanOrEqual(355);
    expect(result.baseCandles).toBeLessThanOrEqual(360);
    expect(result.rollupCandles).toBeGreaterThanOrEqual(5);
    expect(result.rollupCandles).toBeLessThanOrEqual(6);
    expect(await history.head('spx', HISTORY_BASE_TIMEFRAME)).not.toBeNull();
    expect(await history.head('spx', HISTORY_ROLLUP_TIMEFRAME)).not.toBeNull();
  }, 60_000);

  it('keeps only the tail of the tick record', async () => {
    // Ninety days of ticks is millions of rows whose only reader is a chart that
    // reduces them to columns. What has to survive is what a settlement can be
    // disputed against.
    const result = await backfillMarket(options({ tickRetentionMs: 10 * 60_000 }));
    expect(result.retainedTicks.length).toBeGreaterThan(0);
    expect(result.retainedTicks.length).toBeLessThan(result.ticksGenerated);
    for (const tick of result.retainedTicks) {
      expect(tick.instant).toBeGreaterThanOrEqual(TARGET - 10 * 60_000);
    }
  }, 60_000);

  it('reaches its target rather than stopping near it', async () => {
    // A loop that stopped a step short would leave the market fifteen seconds
    // behind on the day it opens, and every assertion above would still pass:
    // the ticks would agree, the candles would cover almost the whole span, and
    // the checkpoint would resume cleanly into a market that is silently late.
    const store = new MemoryStateStore();
    const result = await backfillMarket(options({ store }));
    const record = await store.load('spx');
    const last = result.retainedTicks[result.retainedTicks.length - 1]!;
    expect(record!.lastPublished!.instant).toBe(last.instant);
    // The exact statement, and it does not depend on how far apart ticks
    // happen to fall: the market holds one tick pulled ahead and not yet due,
    // so a backfill that reached its target has a pending tick *beyond* it. A
    // gap measured in mean intervals would have been a guess — the first
    // version of this assertion used two of them and failed on ordinary
    // arrival variance at 7,077ms against 6,705.
    expect(record!.pending).not.toBeNull();
    expect(record!.pending!.instant).toBeGreaterThan(TARGET);
    expect(last.instant).toBeLessThanOrEqual(TARGET);
  }, 60_000);

  it('leaves a checkpoint the live market can resume from', async () => {
    const store = new MemoryStateStore();
    await backfillMarket(options({ store }));
    const record = await store.load('spx');
    expect(record).not.toBeNull();
    expect(record!.savedAt).toBe(TARGET);
    expect(record!.lastPublished).not.toBeNull();
    expect(record!.lastPublished!.instant).toBeLessThanOrEqual(TARGET);
  }, 60_000);
});

describe('a backfill is genesis, and refuses to be anything else', () => {
  it('refuses when a record already exists', async () => {
    // Generating a second history under one id would publish a different market
    // to observers who saw the first (INV-002), spend keystream positions twice
    // (INV-010), and leave every settlement recorded against the old series
    // unreproducible (INV-009).
    //
    // It also closes a subtler door: a backfill that could be repeated could be
    // repeated until the chart looked right, and then the operator would be
    // choosing the prices.
    const store = new MemoryStateStore();
    await backfillMarket(options({ store }));
    await expect(backfillMarket(options({ store }))).rejects.toThrow(/already has a record/);
    await expect(backfillMarket(options({ store }))).rejects.toThrow(BackfillError);
  }, 90_000);

  it('refuses when the history holds candles and the record does not', async () => {
    // **Cycle Audit 6, CA6-28.** Candles flush throughout a backfill; the
    // checkpoint is written once at the end. A crash between them leaves
    // history and no record, and the guard consulted only the record — so a
    // re-run was admitted and either died on the first append or, with a later
    // genesis, spliced a second market into the same id.
    const store = new MemoryStateStore();
    const history = new InMemoryCandleHistory();
    await backfillMarket(options({ store, history }));

    const orphaned = new MemoryStateStore();
    await expect(backfillMarket(options({ store: orphaned, history }))).rejects.toThrow(
      /history already holds candles/,
    );
    // And the refusal says what an operator has to decide, rather than leaving
    // the asset silently unprovisionable.
    await expect(backfillMarket(options({ store: orphaned, history }))).rejects.toThrow(
      /delete its history as well as its record/,
    );
  }, 120_000);

  it('refuses a step past the catch-up bound', async () => {
    // ADR-0010: no unobserved burst may span a contract. A backfill has no more
    // authority to invent one than a running venue does, and a step larger than
    // the bound is exactly that — with the added twist that it would also stop
    // being the live path, which is the only reason to trust its output.
    //
    // Asserted on the error *type*, not on its message. `HostedMarket` refuses
    // an over-long advance with a `CatchUpTooLargeError` whose text also says
    // "catch-up bound", so a message match passed even with this guard removed —
    // the right answer for the wrong reason, and a plant found it.
    await expect(backfillMarket(options({ stepMs: DEFAULT_MAX_CATCH_UP_MS + 1 }))).rejects.toThrow(
      BackfillError,
    );
  });

  it.each([
    ['a target before its genesis', { targetInstant: epochMillis(GENESIS - 1) }],
    ['a target at its genesis', { targetInstant: GENESIS }],
    ['a zero step', { stepMs: 0 }],
    ['a negative retention', { tickRetentionMs: -1 }],
  ])('refuses %s', async (_label, over) => {
    await expect(backfillMarket(options(over))).rejects.toThrow(BackfillError);
  });
});

describe('the minute containing the target is stored whole (a5-01)', () => {
  it('hands the live path a recorder that has seen the open minute, so the join minute is not short', async () => {
    // A target thirty seconds into a minute, which is where every real target
    // falls. The backfill's own recorder holds that minute open; the process
    // then carries the market forward through the same runtime and the minute
    // closes on the live side of the join. Measured before the fix, with a
    // fresh recorder started at the join as `HistoryService.#catchUp` did: the
    // join minute stored with 8 of 18 ticks, its open 713 against a true 672
    // and its high 743 missing.
    const target = epochMillis(TARGET + 30_000);
    const history = new InMemoryCandleHistory();
    const result = await backfillMarket(options({ history, targetInstant: target }));

    const until = target + 90_000;
    let now: number = target;
    while (now < until) {
      now = Math.min(now + DEFAULT_MAX_CATCH_UP_MS, until);
      result.recorder.accept(result.market.advanceTo(epochMillis(now)));
    }
    const closed = result.recorder.drain();
    await history.append('spx', HISTORY_BASE_TIMEFRAME, closed);

    const joinMinute = bucketStart(target, timeframeById(HISTORY_BASE_TIMEFRAME));
    const [stored] = await history.read(
      'spx',
      HISTORY_BASE_TIMEFRAME,
      joinMinute,
      epochMillis(joinMinute + 60_000),
    );
    const live = liveThrough(until);
    const whole = foldTicks(timeframeById(HISTORY_BASE_TIMEFRAME), live.ticks).find(
      (bar) => bar.openInstant === joinMinute,
    );
    expect(whole).toBeDefined();
    expect(whole!.firstSequence).toBeLessThan(
      result.retainedTicks[result.retainedTicks.length - 1]!.sequence,
    );
    expect(stored).toEqual(whole);
    expect(result.recorder.withheld).toBeNull();
  }, 60_000);
});
