// Invariant evidence: INV-004 (timeframe observer independence), INV-003 (single underlying stream).
import { describe, expect, it } from 'vitest';
import {
  epochMillis,
  foldCandles,
  foldTicks,
  logPrice,
  timeframe as timeframeById,
  type Candle,
  type Tick,
} from '@otc/core';
import {
  HistoryError,
  HistoryRecorder,
  refreshRollup,
  HISTORY_BASE_TIMEFRAME,
  HISTORY_ROLLUP_TIMEFRAME,
  InMemoryCandleHistory,
  readTimeframe,
} from './history.js';

const ORIGIN = 1_776_000_000_000;

/**
 * A deterministic saw-tooth tick stream.
 *
 * Not a market and not trying to be: what these tests check is that folding,
 * storing and re-folding agree, and for that the prices only have to be varied
 * enough that a high and a low are distinguishable inside every bar.
 */
function ticks(count: number, everyMs = 6_000): Tick[] {
  const out: Tick[] = [];
  for (let i = 0; i < count; i += 1) {
    const wave = ((i * 37) % 23) - 11;
    out.push({
      sequence: i + 1,
      instant: epochMillis(ORIGIN + i * everyMs),
      price: logPrice(1_000 + wave * 3 + (i % 5)),
    });
  }
  return out;
}

function recordAll(stream: readonly Tick[], batch = 7): ReturnType<HistoryRecorder['drain']>[] {
  const recorder = new HistoryRecorder();
  const drains: ReturnType<HistoryRecorder['drain']>[] = [];
  for (let i = 0; i < stream.length; i += batch) {
    recorder.accept(stream.slice(i, i + batch));
    drains.push(recorder.drain());
  }
  return drains;
}

function flatten(drains: readonly ReturnType<HistoryRecorder['drain']>[]): Candle[] {
  return drains.flatMap((drain) => [...drain]);
}

/** The hourly tier as it is actually built: from the stored minute series. */
async function rollupOf(base: readonly Candle[]): Promise<readonly Candle[]> {
  const history = new InMemoryCandleHistory();
  await history.append('asset', HISTORY_BASE_TIMEFRAME, base);
  await refreshRollup(history, 'asset');
  return history.read(
    'asset',
    HISTORY_ROLLUP_TIMEFRAME,
    epochMillis(0),
    epochMillis(ORIGIN + 30 * 86_400_000),
  );
}

describe('the recorder folds one stream into two tiers', () => {
  // Three hours at six seconds a tick: 1,800 ticks, 180 minute bars, 3 hours.
  const stream = ticks(1_800);

  it('produces the same minute bars as folding the ticks in one go', () => {
    const base = flatten(recordAll(stream));
    const direct = foldTicks(timeframeById(HISTORY_BASE_TIMEFRAME), stream);
    // `foldTicks` keeps the bar still open at the end; the recorder never emits
    // one, because a bar that is still accumulating has a high and a low that
    // are not yet true.
    expect(base).toEqual(direct.slice(0, -1));
  });

  it('never emits the bar it is still accumulating', () => {
    const recorder = new HistoryRecorder();
    recorder.accept(stream.slice(0, 5));
    expect(recorder.drain()).toEqual([]);
    expect(recorder.open()).not.toBeNull();
  });

  it('derives the hourly tier from the minute bars, not from the ticks again', async () => {
    // Two independent folds of one stream is two chances to disagree. This is
    // the operational content of INV-004: a timeframe is a view, so the view of
    // a view has to be the same view.
    const base = flatten(recordAll(stream));
    const rollup = await rollupOf(base);
    const direct = foldTicks(timeframeById(HISTORY_ROLLUP_TIMEFRAME), stream);
    expect(rollup).toEqual(direct.slice(0, rollup.length));
    expect(rollup.every((candle) => candle.timeframe === HISTORY_ROLLUP_TIMEFRAME)).toBe(true);
    expect(base.length).toBeGreaterThan(rollup.length * 50);
  });

  it('emits an hourly bar only once every minute inside it has closed', async () => {
    // The hazard this exists for: an hour built from whichever pieces happened
    // to be in hand carries the extremes of those pieces, and is wrong in the
    // direction that hides a spike. Cycle Audit 6 (F2) measured it at a
    // provisioning handoff: an hour stored with 738 ticks of 1,023.
    const rollup = await rollupOf(flatten(recordAll(stream, 7)));
    const direct = foldTicks(timeframeById(HISTORY_ROLLUP_TIMEFRAME), stream);
    for (const [index, candle] of rollup.entries()) {
      expect(candle.high, `hour ${index} high`).toBe(direct[index]!.high);
      expect(candle.low, `hour ${index} low`).toBe(direct[index]!.low);
    }
  });

  it('keeps what closed in earlier batches until it is drained', () => {
    // The shape real callers use: `backfillMarket` feeds ticks every simulated
    // step and drains every couple of thousand of them, so almost every closed
    // bar is accepted in one call and drained in a much later one. A recorder
    // that only survived accept-then-drain would lose all but the last batch of
    // history, and a test that always drained immediately could not see it.
    const recorder = new HistoryRecorder();
    for (let i = 0; i < stream.length; i += 11) recorder.accept(stream.slice(i, i + 11));
    const base = recorder.drain();
    expect(base).toEqual(flatten(recordAll(stream, stream.length)));
  });

  it('does not depend on how the ticks were batched', async () => {
    // The drain cadence is a property of the caller's loop, never of the market.
    const oneBatch = flatten(recordAll(stream, stream.length));
    const manyBatches = flatten(recordAll(stream, 3));
    expect(manyBatches).toEqual(oneBatch);
    expect(await rollupOf(manyBatches)).toEqual(await rollupOf(oneBatch));
  });

  it('builds the same hourly tier however the minutes were written', async () => {
    // The tier that used to depend on process lifetime. Whatever order or
    // grouping the minutes arrive in, the stored hours are the same hours.
    const base = flatten(recordAll(stream, 7));
    const split = base.length - 17;
    const piecewise = new InMemoryCandleHistory();
    await piecewise.append('asset', HISTORY_BASE_TIMEFRAME, base.slice(0, split));
    await refreshRollup(piecewise, 'asset');
    await piecewise.append('asset', HISTORY_BASE_TIMEFRAME, base.slice(split));
    await refreshRollup(piecewise, 'asset');
    const window = [epochMillis(0), epochMillis(ORIGIN + 30 * 86_400_000)] as const;
    expect(await piecewise.read('asset', HISTORY_ROLLUP_TIMEFRAME, ...window)).toEqual(
      await rollupOf(base),
    );
  });
});

describe('the store is append-only and ordered', () => {
  const stream = ticks(600);
  const base = flatten(recordAll(stream));

  it('reads back what was written', async () => {
    const history = new InMemoryCandleHistory();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base);
    const read = await history.read(
      'eurusd',
      HISTORY_BASE_TIMEFRAME,
      epochMillis(0),
      epochMillis(ORIGIN + 86_400_000),
    );
    expect(read).toEqual(base);
    expect(await history.head('eurusd', HISTORY_BASE_TIMEFRAME)).toBe(
      base[base.length - 1]!.openInstant,
    );
  });

  it('keeps assets and timeframes apart', async () => {
    const history = new InMemoryCandleHistory();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base);
    expect(await history.head('gbpjpy', HISTORY_BASE_TIMEFRAME)).toBeNull();
    expect(await history.head('eurusd', HISTORY_ROLLUP_TIMEFRAME)).toBeNull();
  });

  it('refuses a candle that does not follow the head', async () => {
    const history = new InMemoryCandleHistory();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base);
    await expect(history.append('eurusd', HISTORY_BASE_TIMEFRAME, [base[0]!])).rejects.toThrow(
      HistoryError,
    );
  });

  it('refuses a candle filed under the wrong timeframe', async () => {
    const history = new InMemoryCandleHistory();
    await expect(history.append('eurusd', HISTORY_ROLLUP_TIMEFRAME, [base[0]!])).rejects.toThrow(
      /is a 1m bar/,
    );
  });

  it('refuses a tier it does not store', async () => {
    const history = new InMemoryCandleHistory();
    await expect(history.append('eurusd', '5m', [])).rejects.toThrow(/stores 1m and 1h only/);
    await expect(history.head('eurusd', '1d')).rejects.toThrow(HistoryError);
  });
});

describe('reading a timeframe folds from the right tier', () => {
  // Three and a half days, so that even the daily timeframe has more than one
  // bucket the stored series covers completely. Twenty-four hours was enough
  // until `readTimeframe` started returning whole bars only: a day-long stream
  // that does not start at midnight contains no complete day.
  const stream = ticks(50_400, 6_000);
  const base = flatten(recordAll(stream));
  const window = { from: epochMillis(0), to: epochMillis(ORIGIN + 5 * 86_400_000) };

  async function stored(): Promise<InMemoryCandleHistory> {
    const history = new InMemoryCandleHistory();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base);
    await refreshRollup(history, 'eurusd');
    return history;
  }

  it.each(['1m', '5m', '15m', '30m'] as const)('folds %s from the minute tier', async (target) => {
    const history = await stored();
    const read = await readTimeframe(history, 'eurusd', target, window.from, window.to);
    const direct = foldTicks(timeframeById(target), stream);
    // Every bar, not all-but-the-last. `readTimeframe` now returns only buckets
    // the stored series covers completely, so nothing it returns can be short
    // (Cycle Audit 6, F4).
    expect(read).toEqual(direct.slice(0, read.length));
    expect(read.length).toBeGreaterThan(1);
  });

  it.each(['1h', '4h', '1d'] as const)('folds %s from the hourly tier', async (target) => {
    const history = await stored();
    const read = await readTimeframe(history, 'eurusd', target, window.from, window.to);
    expect(read.every((candle) => candle.timeframe === target)).toBe(true);
    // Same answer as folding the minute tier would have given, at a sixtieth of
    // the rows read.
    expect(read).toEqual(foldCandlesForTest(target, base).slice(0, read.length));
    expect(read.length).toBeGreaterThan(1);
  });

  it('refuses anything finer than the stored base', async () => {
    const history = await stored();
    await expect(readTimeframe(history, 'eurusd', '1s', window.from, window.to)).rejects.toThrow(
      /available only from the tick record/,
    );
    await expect(readTimeframe(history, 'eurusd', '30s', window.from, window.to)).rejects.toThrow(
      HistoryError,
    );
  });

  it('returns nothing for a window before the history starts', async () => {
    const history = await stored();
    const read = await readTimeframe(
      history,
      'eurusd',
      '1h',
      epochMillis(ORIGIN - 30 * 86_400_000),
      // The first hourly bar opens at the bucket boundary *before* the genesis
      // tick, not at the tick, so a window ending at the genesis instant would
      // still contain it.
      epochMillis(ORIGIN - 86_400_000),
    );
    expect(read).toEqual([]);
  });
});

/**
 * The same timeframe, folded from the *base* tier instead of the rollup.
 *
 * So the assertion above is a comparison between the two stored tiers rather
 * than a restatement of one of them.
 */
function foldCandlesForTest(target: '1h' | '4h' | '1d', source: readonly Candle[]): Candle[] {
  return foldCandles(timeframeById(target), source);
}
