import { describe, expect, it } from 'vitest';
import { allTimeframes, nests, timeframe } from '../time/timeframe.js';
import { CandleAggregator, foldCandles, foldTicks, type Candle } from './candle.js';
import { makeTicks, type StreamShape } from './testStreams.js';

/**
 * Large-scale exhaustive sweep of the aggregation invariants, plus throughput.
 * The fast versions of these properties run in the unit suite; this is the one
 * that runs at production-like volume.
 */

const TFS = allTimeframes();

const SHAPES: StreamShape[] = [
  { name: 'dense multi-day', meanGapMs: 250, ticks: 400_000, gapProbability: 0, gapMs: 0 },
  {
    name: 'bursty with outages',
    meanGapMs: 400,
    ticks: 200_000,
    gapProbability: 0.001,
    gapMs: 3_600_000,
  },
  { name: 'sparse multi-week', meanGapMs: 60_000, ticks: 40_000, gapProbability: 0, gapMs: 0 },
];

describe('cross-timeframe coherence at volume', () => {
  it.each(SHAPES)('$name: every ordered timeframe pair agrees', (shape) => {
    const ticks = makeTicks(shape);
    let pairs = 0;
    for (let i = 0; i < TFS.length; i += 1) {
      const fine = TFS[i]!;
      const fineCandles = foldTicks(fine, ticks);
      for (let j = i; j < TFS.length; j += 1) {
        const coarse = TFS[j]!;
        expect(nests(fine, coarse)).toBe(true);
        expect(foldCandles(coarse, fineCandles), `${fine.id} -> ${coarse.id}`).toEqual(
          foldTicks(coarse, ticks),
        );
        pairs += 1;
      }
    }
    expect(pairs).toBe((TFS.length * (TFS.length + 1)) / 2);
  });

  it('holds through a chain of successive re-folds', () => {
    // 1s -> 5s -> 15s -> ... -> 1d must equal 1s -> 1d directly. Error would
    // accumulate here if the fold were not exactly associative.
    const ticks = makeTicks(SHAPES[0]!);
    let chained: Candle[] = foldTicks(TFS[0]!, ticks);
    for (let i = 1; i < TFS.length; i += 1) {
      chained = foldCandles(TFS[i]!, chained);
      expect(chained, `chained to ${TFS[i]!.id}`).toEqual(foldTicks(TFS[i]!, ticks));
    }
  });
});

describe('streaming equals batch at volume', () => {
  it('agrees over a long dense stream on every timeframe', () => {
    const ticks = makeTicks(SHAPES[0]!);
    for (const tf of TFS) {
      const aggregator = new CandleAggregator(tf);
      const streamed: Candle[] = [];
      for (const tick of ticks) {
        const closed = aggregator.accept(tick);
        if (closed !== null) streamed.push(closed);
      }
      const open = aggregator.current();
      if (open !== null) streamed.push(open);
      expect(streamed, tf.id).toEqual(foldTicks(tf, ticks));
    }
  });
});

describe('throughput', () => {
  it('aggregates far faster than a live market produces ticks', () => {
    const ticks = makeTicks(SHAPES[0]!);
    const tf = timeframe('1m');

    // Warm up, then measure the streaming path, which is what a live runtime uses.
    for (let round = 0; round < 2; round += 1) {
      const warm = new CandleAggregator(tf);
      for (const tick of ticks) warm.accept(tick);
    }

    const aggregator = new CandleAggregator(tf);
    const start = process.hrtime.bigint();
    let closedCount = 0;
    for (const tick of ticks) {
      if (aggregator.accept(tick) !== null) closedCount += 1;
    }
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const perSecond = ticks.length / seconds;

    console.info(
      `candle aggregation: ${(perSecond / 1e6).toFixed(2)}M ticks/s ` +
        `(${ticks.length.toLocaleString()} ticks, ${closedCount.toLocaleString()} candles closed)`,
    );
    expect(closedCount).toBeGreaterThan(0);
    expect(perSecond).toBeGreaterThan(1_000_000);
  });
});
