// Invariant evidence: INV-004 (timeframe observer independence), INV-003 (single underlying stream).
import { describe, expect, it } from 'vitest';
import {
  bucketStart,
  epochMillis,
  foldCandles,
  foldTicks,
  logPrice,
  timeframe as timeframeById,
  type Candle,
  type EpochMillis,
  type Tick,
} from '@otc/core';
import {
  HistoryError,
  HistoryRecorder,
  refreshRollup,
  HISTORY_BASE_TIMEFRAME,
  HISTORY_ROLLUP_TIMEFRAME,
  InMemoryCandleHistory,
  lastStoredSequence,
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
  const recorder = new HistoryRecorder({ continuesAfter: null });
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
    const recorder = new HistoryRecorder({ continuesAfter: null });
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
    const recorder = new HistoryRecorder({ continuesAfter: null });
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

describe('a recorder that begins inside a minute never stores that minute (a5-01)', () => {
  // Six minutes at six seconds a tick: ten ticks to the minute.
  const stream = ticks(60);
  const truth = foldTicks(timeframeById(HISTORY_BASE_TIMEFRAME), stream);
  const minute = (index: number): Candle => truth[index]!;

  it('withholds the bucket it did not see from its start, and stores every later one whole', () => {
    // The shape of every restart: process 1 flushed the minutes that had closed
    // and died holding minute 2 open with three ticks in it; process 2 resumes
    // from the checkpoint and sees the rest of minute 2 — seven of its ten
    // ticks. Measured before the fix at a runtime-level handoff: minute 10:02
    // stored with 13 of 15 ticks, its high 103 against a true 134.
    const first = new HistoryRecorder({ continuesAfter: null });
    first.accept(stream.slice(0, 23));
    const storedByFirst = first.drain();
    expect(storedByFirst.map((bar) => bar.openInstant)).toEqual(
      [0, 1].map((i) => minute(i).openInstant),
    );

    const second = new HistoryRecorder({
      continuesAfter: storedByFirst[storedByFirst.length - 1]!.lastSequence,
    });
    second.accept(stream.slice(23));
    const storedBySecond = second.drain();

    const stored = [...storedByFirst, ...storedBySecond];
    // No partial bar: every stored minute is the fold of every tick in it.
    for (const bar of stored) {
      expect(bar, `minute ${bar.openInstant}`).toEqual(
        truth.find((whole) => whole.openInstant === bar.openInstant),
      );
    }
    // The minute the restart landed in is the one missing, and it is named.
    expect(stored.map((bar) => bar.openInstant)).toEqual(
      [0, 1, 3, 4].map((i) => minute(i).openInstant),
    );
    expect(second.withheld?.openInstant).toBe(minute(2).openInstant);
    expect(second.withheld?.tickCount).toBe(7);
    expect(second.withheld?.firstSequence).toBe(24);
  });

  it('keeps its first bucket when it continues exactly where the store ends', () => {
    // Nothing was lost between the stored head and this recorder's first tick,
    // so the bucket that tick opens is seen from its start.
    const first = new HistoryRecorder({ continuesAfter: null });
    first.accept(stream.slice(0, 23));
    const storedByFirst = first.drain();
    const second = new HistoryRecorder({
      continuesAfter: storedByFirst[storedByFirst.length - 1]!.lastSequence,
    });
    second.accept(stream.slice(20));
    expect(second.drain()).toEqual([minute(2), minute(3), minute(4)]);
    expect(second.withheld).toBeNull();
  });

  it('keeps a first bucket that opens before genesis, because nothing precedes sequence 1', () => {
    // The first tick lands twenty seconds into a minute. The bucket begins
    // before it, and is nevertheless whole: no tick exists before the first.
    const late = stream.slice(3).map((tick, i) => ({ ...tick, sequence: i + 1 }));
    const recorder = new HistoryRecorder({ continuesAfter: null });
    recorder.accept(late);
    const direct = foldTicks(timeframeById(HISTORY_BASE_TIMEFRAME), late);
    expect(recorder.drain()).toEqual(direct.slice(0, -1));
    expect(recorder.drain()[0]).toBeUndefined();
    expect(recorder.withheld).toBeNull();
  });

  it('withholds the first bucket when nothing is stored and the stream is not at genesis', () => {
    // A history tier switched on under a market that has been running: the
    // store is empty and the first tick seen is not the first tick there was.
    const recorder = new HistoryRecorder({ continuesAfter: null });
    recorder.accept(stream.slice(23));
    expect(recorder.drain()).toEqual([minute(3), minute(4)]);
    expect(recorder.withheld?.openInstant).toBe(minute(2).openInstant);
  });

  it('can be told where it stands after it has started folding', () => {
    // `HistoryService.observe` is synchronous and the store is not, so the
    // recorder may learn what is stored only at the first flush. Until then it
    // folds and holds; asked to drain before it knows, it refuses rather than
    // guessing which way the first bucket goes.
    const recorder = new HistoryRecorder({ continuesAfter: 'unknown' });
    recorder.accept(stream.slice(23, 45));
    expect(recorder.started).toBe(false);
    expect(() => recorder.drain()).toThrow(HistoryError);
    // Minutes 2 and 3 have closed and are held; minute 4 is open and was seen
    // from its start, so it may be shown live whatever becomes of minute 2.
    expect(recorder.open()?.openInstant).toBe(minute(4).openInstant);

    recorder.continueAfter(20);
    expect(recorder.started).toBe(true);
    expect(recorder.drain()).toEqual([minute(3)]);
    expect(recorder.withheld?.openInstant).toBe(minute(2).openInstant);
    expect(() => {
      recorder.continueAfter(20);
    }).toThrow(HistoryError);
  });

  it('refuses a stream that restarts behind the stored head', () => {
    // Sequence 15 after a store whose newest bar ends at 20 is not a replay of
    // a stored bar — it is a different stream under the same id.
    const recorder = new HistoryRecorder({ continuesAfter: 20 });
    expect(() => {
      recorder.accept(stream.slice(14));
    }).toThrow(HistoryError);
  });

  it('shows no open bar while the open bucket is one it did not see from its start', () => {
    const recorder = new HistoryRecorder({ continuesAfter: 20 });
    recorder.accept(stream.slice(23, 26));
    expect(recorder.open()).toBeNull();
    recorder.accept(stream.slice(26, 32));
    expect(recorder.open()?.openInstant).toBe(minute(3).openInstant);
  });

  it('reports the sequence the stored base series ends at', async () => {
    const history = new InMemoryCandleHistory();
    expect(await lastStoredSequence(history, 'eurusd')).toBeNull();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, truth.slice(0, 3));
    expect(await lastStoredSequence(history, 'eurusd')).toBe(minute(2).lastSequence);
  });
});

describe('the leading edge of a coarser read does not depend on the window (a5-04)', () => {
  // A history whose first stored minute is 10:07: three hours of ticks every
  // twenty seconds from seven minutes past an hour boundary.
  const HOUR = timeframeById('1h').durationMs;
  const HALF = timeframeById('30m').durationMs;
  const T10 = bucketStart(epochMillis(ORIGIN), timeframeById('1h'));
  const T13 = epochMillis(T10 + 3 * HOUR);

  function minutesFrom(firstSequence: number): Candle[] {
    const stream: Tick[] = [];
    for (let i = 0; i < (3 * HOUR - 7 * 60_000) / 20_000; i += 1) {
      const wave = ((i * 37) % 23) - 11;
      stream.push({
        sequence: firstSequence + i,
        instant: epochMillis(T10 + 7 * 60_000 + i * 20_000),
        price: logPrice(1_000 + wave * 3 + (i % 5)),
      });
    }
    return foldTicks(timeframeById(HISTORY_BASE_TIMEFRAME), stream).slice(0, -1);
  }

  async function stored(firstSequence: number): Promise<InMemoryCandleHistory> {
    const history = new InMemoryCandleHistory();
    await history.append('x', HISTORY_BASE_TIMEFRAME, minutesFrom(firstSequence));
    await refreshRollup(history, 'x');
    return history;
  }

  const opens = async (
    history: InMemoryCandleHistory,
    target: '30m' | '1h',
    from: EpochMillis,
  ): Promise<number[]> =>
    (await readTimeframe(history, 'x', target, from, T13)).map((bar) => bar.openInstant);

  it('drops the bucket the history begins inside, whatever `from` is', async () => {
    // Before this test the same 10:00 half-hour was a 69-tick "whole" bar when
    // asked from 09:00 and absent when asked from 10:00, because the
    // one-bucket-back check ran only when the first complete bar was the
    // window's first bucket. The stored series is what it is; the window is
    // the client's business.
    const history = await stored(1_000);
    expect((await opens(history, '30m', T10))[0]).toBe(T10 + HALF);
    expect((await opens(history, '30m', epochMillis(T10 - HOUR)))[0]).toBe(T10 + HALF);
    // And the hourly view agrees with the half-hourly one: the 10:00 hour,
    // which the rollup used to store from 53 of its 60 minutes, is not there.
    expect((await opens(history, '1h', T10))[0]).toBe(T10 + HOUR);
    expect((await opens(history, '1h', epochMillis(T10 - HOUR)))[0]).toBe(T10 + HOUR);
    expect(await history.read('x', HISTORY_ROLLUP_TIMEFRAME, T10, epochMillis(T10 + HOUR))).toEqual(
      [],
    );
  });

  it('keeps the bucket genesis falls inside, whatever `from` is', async () => {
    // The same shape with the first stored minute carrying sequence 1. Nothing
    // precedes genesis, so the bucket that begins before it is whole by
    // definition — and withholding it would start every provisioned asset's
    // daily chart a day late.
    const history = await stored(1);
    for (const from of [T10, epochMillis(T10 - HOUR)]) {
      const [first] = await readTimeframe(history, 'x', '30m', from, T13);
      expect(first?.openInstant).toBe(T10);
      expect(first?.tickCount).toBe(69);
      expect(first?.firstSequence).toBe(1);
      const [hour] = await readTimeframe(history, 'x', '1h', from, T13);
      expect(hour?.openInstant).toBe(T10);
      expect(hour?.tickCount).toBe(159);
    }
  });

  it('returns no bar opening at `to`', async () => {
    // `[from, to)` is the documented window, and the read snapped `to` one
    // bucket outward — so a client paging by fixed windows received the
    // boundary bar twice.
    const history = await stored(1);
    const to = epochMillis(T10 + 2 * HOUR);
    for (const target of ['30m', '1h'] as const) {
      const bars = await readTimeframe(history, 'x', target, T10, to);
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) expect(bar.openInstant, target).toBeLessThan(to);
      expect(bars[bars.length - 1]!.openInstant).toBe(to - timeframeById(target).durationMs);
    }
  });
});
