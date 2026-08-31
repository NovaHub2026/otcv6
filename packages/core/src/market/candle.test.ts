import { describe, expect, it } from 'vitest';
import { epochMillis } from '../time/instant.js';
import { allTimeframes, nests, timeframe } from '../time/timeframe.js';
import { CandleAggregator, foldCandles, foldTicks, type Candle } from './candle.js';
import { logPrice } from './instrument.js';
import type { Tick } from './tick.js';
import { makeTicks, type StreamShape } from './testStreams.js';

const TFS = allTimeframes();

// Sized for fast inner-loop feedback. The large-scale exhaustive sweep over
// these same properties lives in market.stat.test.ts.
const SHAPES: StreamShape[] = [
  { name: 'dense', meanGapMs: 250, ticks: 8_000, gapProbability: 0, gapMs: 0 },
  { name: 'sparse', meanGapMs: 20_000, ticks: 2_000, gapProbability: 0, gapMs: 0 },
  {
    name: 'bursty with idle gaps',
    meanGapMs: 400,
    ticks: 4_000,
    gapProbability: 0.002,
    gapMs: 3_600_000,
  },
  {
    name: 'very sparse — many empty buckets',
    meanGapMs: 400_000,
    ticks: 600,
    gapProbability: 0,
    gapMs: 0,
  },
];

const STREAMS = SHAPES.map((shape) => ({ shape, ticks: makeTicks(shape) }));

describe('tick-to-candle fold', () => {
  it.each(STREAMS)(
    '$shape.name: open and close are the first and last ticks by sequence',
    ({ ticks }) => {
      for (const tf of TFS) {
        const candles = foldTicks(tf, ticks);
        const bySequence = new Map(ticks.map((t) => [t.sequence, t]));
        for (const candle of candles) {
          expect(bySequence.get(candle.firstSequence)!.price).toBe(candle.open);
          expect(bySequence.get(candle.lastSequence)!.price).toBe(candle.close);
        }
      }
    },
  );

  it.each(STREAMS)('$shape.name: high and low are prices actually visited', ({ ticks }) => {
    // Single pass per timeframe: the ticks of a candle are a contiguous run in
    // sequence order, so the recomputation walks the stream once rather than
    // filtering it per candle.
    for (const tf of TFS) {
      const candles = foldTicks(tf, ticks);
      let cursor = 0;
      for (const candle of candles) {
        let high = Number.NEGATIVE_INFINITY;
        let low = Number.POSITIVE_INFINITY;
        let count = 0;
        let sawHigh = false;
        let sawLow = false;
        while (cursor < ticks.length && ticks[cursor]!.sequence <= candle.lastSequence) {
          const price = ticks[cursor]!.price as number;
          if (price > high) high = price;
          if (price < low) low = price;
          count += 1;
          cursor += 1;
        }
        for (let i = cursor - count; i < cursor; i += 1) {
          const price = ticks[i]!.price as number;
          if (price === candle.high) sawHigh = true;
          if (price === candle.low) sawLow = true;
        }
        expect(candle.high).toBe(high);
        expect(candle.low).toBe(low);
        expect(sawHigh).toBe(true);
        expect(sawLow).toBe(true);
        expect(candle.tickCount).toBe(count);
      }
      expect(cursor).toBe(ticks.length);
    }
  });

  it.each(STREAMS)('$shape.name: every tick lands in exactly one candle', ({ ticks }) => {
    for (const tf of TFS) {
      const candles = foldTicks(tf, ticks);
      const total = candles.reduce((sum, c) => sum + c.tickCount, 0);
      expect(total).toBe(ticks.length);
      for (let i = 1; i < candles.length; i += 1) {
        expect(candles[i]!.openInstant).toBeGreaterThan(candles[i - 1]!.openInstant);
        expect(candles[i]!.firstSequence).toBeGreaterThan(candles[i - 1]!.lastSequence);
      }
    }
  });

  it.each(STREAMS)('$shape.name: candles are epoch-aligned', ({ ticks }) => {
    for (const tf of TFS) {
      for (const candle of foldTicks(tf, ticks)) {
        expect(candle.openInstant % tf.durationMs).toBe(0);
      }
    }
  });

  it('produces no candle for an empty bucket', () => {
    const ticks: Tick[] = [
      { instant: epochMillis(1_776_000_000_000), sequence: 1, price: logPrice(0) },
      // Six hours later: hundreds of empty 1m buckets in between.
      { instant: epochMillis(1_776_000_000_000 + 6 * 3_600_000), sequence: 2, price: logPrice(5) },
    ];
    const candles = foldTicks(timeframe('1m'), ticks);
    expect(candles).toHaveLength(2);
    expect(candles[0]!.tickCount).toBe(1);
    expect(candles[1]!.tickCount).toBe(1);
  });
});

describe('streaming and batch aggregation agree', () => {
  it.each(STREAMS)('$shape.name', ({ ticks }) => {
    for (const tf of TFS) {
      const batch = foldTicks(tf, ticks);
      const aggregator = new CandleAggregator(tf);
      const streamed: Candle[] = [];
      for (const tick of ticks) {
        const closed = aggregator.accept(tick);
        if (closed !== null) streamed.push(closed);
      }
      const open = aggregator.current();
      if (open !== null) streamed.push(open);
      expect(streamed).toEqual(batch);
    }
  });
});

describe('cross-timeframe coherence — the operational content of INV-004', () => {
  // Folding ticks straight to a coarse timeframe must equal folding to a fine
  // one and then re-folding. If this ever fails, a higher timeframe has stopped
  // being a pure view over the same tick stream, and a chart could disagree with
  // a settlement.
  it.each(STREAMS)('$shape.name: every ordered timeframe pair agrees', ({ ticks }) => {
    let pairsChecked = 0;
    for (let i = 0; i < TFS.length; i += 1) {
      const fine = TFS[i]!;
      const fineCandles = foldTicks(fine, ticks);
      for (let j = i; j < TFS.length; j += 1) {
        const coarse = TFS[j]!;
        expect(nests(fine, coarse)).toBe(true);
        const direct = foldTicks(coarse, ticks);
        const reFolded = foldCandles(coarse, fineCandles);
        expect(reFolded, `${fine.id} -> ${coarse.id}`).toEqual(direct);
        pairsChecked += 1;
      }
    }
    expect(pairsChecked).toBe((TFS.length * (TFS.length + 1)) / 2);
  });
});

describe('translation invariance', () => {
  it('shifting every price by a constant shifts every candle by the same constant', () => {
    // The domain must be translation-invariant in log-price: this is the
    // representational statement of the symmetry theorem (ADR-0003/0004).
    const base = makeTicks(SHAPES[0]!);
    const offset = 1_234_567;
    const shifted: Tick[] = base.map((t) => ({ ...t, price: logPrice(t.price + offset) }));

    for (const tf of TFS) {
      const a = foldTicks(tf, base);
      const b = foldTicks(tf, shifted);
      expect(b).toHaveLength(a.length);
      for (let i = 0; i < a.length; i += 1) {
        expect(b[i]!.open - a[i]!.open).toBe(offset);
        expect(b[i]!.high - a[i]!.high).toBe(offset);
        expect(b[i]!.low - a[i]!.low).toBe(offset);
        expect(b[i]!.close - a[i]!.close).toBe(offset);
        expect(b[i]!.tickCount).toBe(a[i]!.tickCount);
        expect(b[i]!.openInstant).toBe(a[i]!.openInstant);
      }
    }
  });
});

describe('malformed input is rejected rather than repaired', () => {
  const at = (instant: number, sequence: number, price: number): Tick => ({
    instant: epochMillis(instant),
    sequence,
    price: logPrice(price),
  });

  it('rejects a non-increasing sequence', () => {
    const aggregator = new CandleAggregator(timeframe('1m'));
    aggregator.accept(at(1_776_000_000_000, 5, 0));
    expect(() => aggregator.accept(at(1_776_000_001_000, 5, 1))).toThrow(RangeError);
    expect(() => aggregator.accept(at(1_776_000_001_000, 4, 1))).toThrow(RangeError);
  });

  it('rejects an instant that moves backwards', () => {
    const aggregator = new CandleAggregator(timeframe('1m'));
    aggregator.accept(at(1_776_000_010_000, 1, 0));
    expect(() => aggregator.accept(at(1_776_000_009_000, 2, 1))).toThrow(RangeError);
  });

  it('does not silently sort: out-of-order input would make open and close ambiguous', () => {
    const ticks = [at(1_776_000_010_000, 1, 0), at(1_776_000_005_000, 2, 1)];
    expect(() => foldTicks(timeframe('1m'), ticks)).toThrow(RangeError);
  });

  it('rejects a re-fold across mixed source timeframes', () => {
    const ticks = makeTicks(SHAPES[1]!);
    const mixed = [...foldTicks(timeframe('1m'), ticks), ...foldTicks(timeframe('5m'), ticks)];
    expect(() => foldCandles(timeframe('1h'), mixed)).toThrow(RangeError);
  });

  it('rejects a re-fold into a timeframe the source does not nest inside', () => {
    const ticks = makeTicks(SHAPES[1]!);
    const hourly = foldTicks(timeframe('1h'), ticks);
    expect(() => foldCandles(timeframe('5m'), hourly)).toThrow(RangeError);
  });

  it('rejects unordered source candles', () => {
    const ticks = makeTicks(SHAPES[1]!);
    const minutes = foldTicks(timeframe('1m'), ticks);
    const reversed = [...minutes].reverse();
    expect(() => foldCandles(timeframe('1h'), reversed)).toThrow(RangeError);
  });

  it('returns nothing for an empty source', () => {
    expect(foldCandles(timeframe('1h'), [])).toEqual([]);
    expect(foldTicks(timeframe('1h'), [])).toEqual([]);
  });
});
