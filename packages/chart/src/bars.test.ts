// Invariant evidence: INV-004 (timeframe observer independence), INV-002 (shared market).
import { describe, expect, it } from 'vitest';
import {
  bucketStart,
  displayPrice,
  LiveBarBuilder,
  panelTimeframe,
  PANEL_TIMEFRAMES,
  SeriesError,
  toBars,
  type HistoryCandle,
  type InstrumentView,
} from './bars.js';

const instrument: InstrumentView = {
  logQuantum: 2.7511622644263434e-7,
  referencePrice: 1.085,
  displayPrecision: 7,
};

const ORIGIN = 1_776_000_000_000;

function candle(index: number, over: Partial<HistoryCandle> = {}): HistoryCandle {
  return {
    openInstant: ORIGIN + index * 60_000,
    timeframe: '1m',
    open: 1_000,
    high: 1_040,
    low: 960,
    close: 1_020,
    tickCount: 43,
    firstSequence: index * 43 + 1,
    lastSequence: index * 43 + 43,
    ...over,
  };
}

function tick(sequence: number, instant: number, price: number) {
  return { sequence, instant, price } as never;
}

describe('the bridge from the record to a chart library', () => {
  it('carries every extreme the record holds', () => {
    // The record's high and low are prices the market actually visited, never
    // interpolated. A conversion that lost one would put a shape on the screen
    // no tick produced, and the chart is the only thing most people will ever
    // see of this market.
    const bars = toBars([candle(0), candle(1, { high: 5_000, low: -5_000 })], instrument);
    expect(bars).toHaveLength(2);
    expect(bars[1]!.high).toBe(displayPrice(5_000, instrument));
    expect(bars[1]!.low).toBe(displayPrice(-5_000, instrument));
    expect(bars[1]!.high).toBeGreaterThan(bars[1]!.low);
  });

  it('converts once, in one direction', () => {
    // Display prices are derived for presentation and never compared against.
    // ADR-0004 publishes and settles the same integer precisely so that no
    // rounded number sits between the generator and the settlement.
    expect(displayPrice(0, instrument)).toBe(instrument.referencePrice);
    expect(displayPrice(1, instrument)).toBeGreaterThan(instrument.referencePrice);
    expect(displayPrice(-1, instrument)).toBeLessThan(instrument.referencePrice);
  });

  it('refuses an unordered series rather than drawing one', () => {
    // Lightweight Charts misdraws an out-of-order series instead of refusing it,
    // which is a silent wrong answer — so the refusal happens here.
    expect(() => toBars([candle(1), candle(0)], instrument)).toThrow(SeriesError);
    expect(() => toBars([candle(0), candle(0)], instrument)).toThrow(/strictly ordered/);
  });

  it('uses the seconds resolution the time axis has', () => {
    const bars = toBars([candle(0)], instrument);
    expect(bars[0]!.time).toBe(Math.floor(ORIGIN / 1000));
  });
});

describe('the live edge of the chart', () => {
  const durationMs = 60_000;

  it('widens the range and never narrows it', () => {
    // A viewer who saw a spike must not watch it disappear because a later tick
    // came back. The open bar is the one place the panel produces a bar rather
    // than reading one, so it is the one place that could.
    const builder = new LiveBarBuilder(durationMs, instrument);
    builder.accept(tick(1, ORIGIN + 1_000, 1_000));
    const spiked = builder.accept(tick(2, ORIGIN + 2_000, 9_000))!;
    const after = builder.accept(tick(3, ORIGIN + 3_000, 1_010))!;
    expect(after.high).toBe(spiked.high);
    expect(after.low).toBeLessThanOrEqual(spiked.low);
    expect(after.close).toBe(displayPrice(1_010, instrument));
    expect(after.open).toBe(displayPrice(1_000, instrument));
  });

  it('opens a new bar on a bucket boundary', () => {
    const builder = new LiveBarBuilder(durationMs, instrument);
    const first = builder.accept(tick(1, ORIGIN + 59_000, 1_000))!;
    const second = builder.accept(tick(2, ORIGIN + 61_000, 1_100))!;
    expect(second.time).toBe(first.time + 60);
    expect(second.open).toBe(second.close);
    expect(second.high).toBe(second.low);
  });

  it('ignores a tick the stream replayed', () => {
    // A reconnecting stream resumes from where the client stopped, and an
    // off-by-one on either side replays. Folding a tick twice would inflate the
    // bar and could widen its range with a price already counted.
    const builder = new LiveBarBuilder(durationMs, instrument);
    builder.accept(tick(1, ORIGIN + 1_000, 1_000));
    builder.accept(tick(2, ORIGIN + 2_000, 5_000));
    expect(builder.accept(tick(2, ORIGIN + 2_000, 5_000))).toBeNull();
    expect(builder.accept(tick(1, ORIGIN + 1_000, 1_000))).toBeNull();
    expect(builder.current()!.high).toBe(displayPrice(5_000, instrument));
  });

  it('leaves the bucket history already owns alone', () => {
    // History and the live stream overlap at the join. The stored bar is the one
    // the record holds and it was folded from every tick in its bucket; a live
    // rebuild would draw that bar out of whichever fragment arrived after the
    // client connected — a different bar, for the same minute, to this viewer
    // only. That is INV-002 broken in the last hop.
    const throughMs = bucketStart(ORIGIN + 120_000, durationMs);
    const builder = new LiveBarBuilder(durationMs, instrument, throughMs);
    expect(builder.accept(tick(1, ORIGIN + 121_000, 1_000))).toBeNull();
    expect(builder.accept(tick(2, ORIGIN + 179_000, 2_000))).toBeNull();
    const fresh = builder.accept(tick(3, ORIGIN + 181_000, 3_000));
    expect(fresh).not.toBeNull();
    expect(fresh!.time).toBe(Math.floor((throughMs + 60_000) / 1000));
  });

  it('leaves the bucket that was already open when the client connected', () => {
    // **Cycle Audit 6, CA6-30.** `historyThroughMs` is the last bar that had
    // been *flushed*; a bucket that began before the client connected but had
    // not been flushed fell between the two, and the builder rebuilt it from
    // whichever ticks arrived after connect. Measured live: a candle whose open
    // was wrong by 30 display units and which was missing the record's high.
    const connectedAt = ORIGIN + 90_000; // 30 seconds into the second minute
    const builder = new LiveBarBuilder(durationMs, instrument, ORIGIN, connectedAt);
    // Ticks in the minute that was already running: not ours to draw.
    expect(builder.accept(tick(1, connectedAt + 1_000, 9_000))).toBeNull();
    expect(builder.accept(tick(2, connectedAt + 20_000, 1_000))).toBeNull();
    // The next minute is.
    const fresh = builder.accept(tick(3, ORIGIN + 121_000, 1_500));
    expect(fresh).not.toBeNull();
    expect(fresh!.time).toBe(Math.floor((ORIGIN + 120_000) / 1000));
  });

  it('draws the running bucket when the stream provably continues the history', () => {
    // The other half of CA6-30, and the reason the panel looked broken on
    // 2026-09-02: the rule above means the newest bar cannot move until the
    // next boundary — up to an hour on the default one-hour chart, with the
    // live price line drifting away from a candle that never follows it.
    //
    // The record keeps the ticks. A client that resumes the stream at
    // `lastSequence + 1` of the newest history bar holds the running bucket
    // from its true first tick, so drawing it invents nothing: the open is the
    // open, and no extreme is missing. That, and only that, is what
    // `gaplessFromHistory` asserts.
    const connectedAt = ORIGIN + 90_000; // 30 seconds into the second minute
    const builder = new LiveBarBuilder(durationMs, instrument, ORIGIN, connectedAt, true);

    // Replayed ticks of the running minute, from its first: ours to draw.
    const first = builder.accept(tick(1, ORIGIN + 61_000, 9_000));
    expect(first).not.toBeNull();
    expect(first!.time).toBe(Math.floor((ORIGIN + 60_000) / 1000));
    expect(first!.open).toBe(displayPrice(9_000, instrument));

    // And the extreme the old path lost is kept, because the tick was replayed
    // rather than missed.
    const high = builder.accept(tick(2, ORIGIN + 70_000, 12_000));
    expect(high!.high).toBe(displayPrice(12_000, instrument));
    const later = builder.accept(tick(3, connectedAt + 20_000, 1_000));
    expect(later!.high).toBe(displayPrice(12_000, instrument));
    expect(later!.low).toBe(displayPrice(1_000, instrument));
    expect(later!.time).toBe(first!.time);

    // The bar already in history is still refused: gapless says nothing about
    // a bucket the record has already closed.
    expect(builder.accept(tick(4, ORIGIN + 30_000, 5_000))).toBeNull();
  });

  it('seeds the forming bucket from the minute bars the record holds', () => {
    // The robust half of the same fix. A resumed stream covers the running
    // bucket only while the feed still remembers it — after a restart it does
    // not, and on an hourly chart that is an hour of a frozen candle again.
    //
    // The record keeps complete *minute* bars for ever: the permanent base
    // tier. Folding those into the forming hour is not a rebuild from a partial
    // view; it is the record, read finer than the chart draws. Only the current
    // minute is then missing, and a stream resumed at the last minute bar's
    // `lastSequence + 1` supplies exactly that.
    const hour = 3_600_000;
    const hourStart = bucketStart(ORIGIN, hour) + hour;
    const minutes: HistoryCandle[] = [
      candle(0, {
        openInstant: hourStart,
        open: 1_000,
        high: 4_000,
        low: 500,
        close: 3_000,
        lastSequence: 20,
      }),
      candle(0, {
        openInstant: hourStart + 60_000,
        open: 3_000,
        high: 9_000,
        low: 2_500,
        close: 8_000,
        firstSequence: 21,
        lastSequence: 30,
      }),
    ];
    const builder = new LiveBarBuilder(hour, instrument, bucketStart(ORIGIN, hour), Date.now());
    builder.seedFrom(minutes, 30);

    const seeded = builder.current();
    expect(seeded!.time).toBe(Math.floor(hourStart / 1000));
    expect(seeded!.open).toBe(displayPrice(1_000, instrument));
    expect(seeded!.high).toBe(displayPrice(9_000, instrument));
    expect(seeded!.low).toBe(displayPrice(500, instrument));

    // A replayed tick already inside the seed is ignored, not folded twice.
    expect(builder.accept(tick(30, hourStart + 119_000, 99_000))).toBeNull();
    // The next one extends the same bar, and the seed's extremes survive.
    const extended = builder.accept(tick(31, hourStart + 121_000, 10_000));
    expect(extended!.time).toBe(seeded!.time);
    expect(extended!.high).toBe(displayPrice(10_000, instrument));
    expect(extended!.low).toBe(displayPrice(500, instrument));
    expect(extended!.open).toBe(displayPrice(1_000, instrument));
  });

  it('refuses a seed that crosses a bucket boundary', () => {
    const hour = 3_600_000;
    const hourStart = bucketStart(ORIGIN, hour) + hour;
    const builder = new LiveBarBuilder(hour, instrument);
    expect(() =>
      builder.seedFrom(
        [candle(0, { openInstant: hourStart }), candle(0, { openInstant: hourStart + hour })],
        2,
      ),
    ).toThrow(SeriesError);
  });

  it('refuses a duration that is not one', () => {
    expect(() => new LiveBarBuilder(0, instrument)).toThrow(SeriesError);
    expect(() => new LiveBarBuilder(-1, instrument)).toThrow(SeriesError);
    expect(() => new LiveBarBuilder(Number.NaN, instrument)).toThrow(SeriesError);
  });
});

describe('the timeframes the panel offers', () => {
  it('is a strictly coarsening ladder', () => {
    for (let i = 1; i < PANEL_TIMEFRAMES.length; i += 1) {
      expect(PANEL_TIMEFRAMES[i]!.durationMs).toBeGreaterThan(PANEL_TIMEFRAMES[i - 1]!.durationMs);
      expect(PANEL_TIMEFRAMES[i]!.defaultSpanMs).toBeGreaterThan(
        PANEL_TIMEFRAMES[i - 1]!.defaultSpanMs,
      );
    }
  });

  it('starts no finer than the history tier can serve', () => {
    // The stored base is one minute. Offering a finer timeframe here would send
    // the panel to an endpoint that correctly refuses it.
    expect(PANEL_TIMEFRAMES[0].durationMs).toBe(60_000);
  });

  it('shows a sane number of bars at every step', () => {
    // Between roughly a hundred and a thousand: fewer and the chart is empty,
    // many more and the browser draws bars narrower than a pixel.
    for (const entry of PANEL_TIMEFRAMES) {
      const bars = entry.defaultSpanMs / entry.durationMs;
      expect(bars, entry.id).toBeGreaterThanOrEqual(90);
      expect(bars, entry.id).toBeLessThanOrEqual(1_000);
    }
  });

  it('reaches the ninety days a new asset is provisioned with', () => {
    const longest = PANEL_TIMEFRAMES[PANEL_TIMEFRAMES.length - 1]!;
    expect(longest.defaultSpanMs).toBe(90 * 86_400_000);
  });

  it('names one it does not have', () => {
    expect(() => panelTimeframe('1s' as never)).toThrow(SeriesError);
  });
});
