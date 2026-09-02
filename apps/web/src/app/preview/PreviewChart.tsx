'use client';

import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Tick } from '@otc/core/browser';
import { fetchHistory, type CatalogueEntry } from '../../lib/api.js';
import { priceFormatFor, toDisplayedPrice } from '../../lib/priceFormat.js';
import {
  bucketStart,
  displayPrice,
  LiveBarBuilder,
  panelTimeframe,
  toBars,
  type HistoryCandle,
  type PanelTimeframeId,
} from '@otc/chart';

/**
 * One asset, one timeframe: stored history, then the live edge.
 *
 * The component does as little as a component can. Every decision that could be
 * silently wrong — which bucket a tick belongs to, whether a bar may narrow,
 * whose bar the join belongs to — is in the bar bridge, framework-free and
 * tested. What is left here is mounting a chart, fetching a window, and
 * forwarding ticks.
 *
 * ## The join, and what it costs a viewer
 *
 * A bucket that had already begun when this client connected belongs to the
 * record, not to us: rebuilding it from the fragment that arrived afterwards
 * would draw a different bar, for the same minute, to this viewer only
 * (INV-002, Cycle Audit 6 CA6-30).
 *
 * Held strictly, that leaves a **one-hour chart motionless for up to an hour**,
 * which is what the Human Owner saw and reported. So the candles stay truthful
 * and the movement is shown where it is honest: a **price line at the last
 * published tick**, updated on every one. Nothing there is invented — it is the
 * last integer the record holds, converted once — and no candle is ever drawn
 * from a fragment.
 *
 * ## When the stream breaks (a6-11)
 *
 * The first version handed reconnection to the browser's `EventSource`, which
 * retries with `Last-Event-ID`. After the replay window has moved on the engine
 * answers that with a 400, and the `EventSource` algorithm closes for good on
 * any non-200: the status read "reconnecting" for ever over stale candles. So
 * the component reconnects itself, and it does so the only honest way — it
 * **refetches the history and opens a new stream from now**, with backoff. The
 * bars are the record's again, the builder starts at the new join, and the
 * status says the view was reconnected after a gap.
 *
 * ## When the stream is silent (a6-18)
 *
 * A stalled market keeps its stream open and sends nothing, so `live` was true
 * of the socket and false of the market. Now the status flips when no tick has
 * arrived for {@link STALL_MULTIPLE} times this asset's mean interval, and
 * flips back on the next tick. The shell's health line carries the venue's own
 * reason.
 *
 * ## The `data-testid` attributes
 *
 * There are three, and they exist because the first browser test selected the
 * price by its colour. A panel that can only be tested by matching a hex code
 * is a panel whose tests break when someone changes a theme — and the whole
 * reason this layer is being covered at all is that nothing else could see it.
 */

/** Quiet for this many mean intervals and the status stops saying `live`. */
export const STALL_MULTIPLE = 3;
/** Delay before the first reconnect; doubles per consecutive failure. */
/** One minute, the record's permanent base tier. */
const MINUTE_MS = 60_000;

const RECONNECT_BACKOFF_MS = 1_000;
const MAX_RECONNECT_BACKOFF_MS = 30_000;

export function PreviewChart({
  apiBase,
  asset,
  timeframeId,
}: {
  apiBase: string;
  asset: CatalogueEntry;
  timeframeId: PanelTimeframeId;
}): ReactElement {
  const container = useRef<HTMLDivElement | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [status, setStatus] = useState<string>('loading');
  const [bars, setBars] = useState<number>(0);
  const [last, setLast] = useState<{ price: number; at: number } | null>(null);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const created = createChart(element, {
      layout: { background: { color: '#0b0e14' }, textColor: '#8b93a7' },
      grid: { vertLines: { color: '#161b26' }, horzLines: { color: '#161b26' } },
      rightPriceScale: { borderColor: '#242c3d' },
      timeScale: { borderColor: '#242c3d', timeVisible: true, secondsVisible: false },
      autoSize: true,
    });
    chart.current = created;
    series.current = created.addSeries(CandlestickSeries, {
      upColor: '#3fb950',
      downColor: '#f85149',
      borderVisible: false,
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
      // Derived, never chosen. A hard-coded `minMove: 1e-8` against a precision
      // of 7 printed `1.91146.5` on the axis — two decimal points, from the
      // library left-padding a non-integer to seven characters and slicing
      // through its own decimal point (`../../lib/priceFormat.ts`).
      priceFormat: priceFormatFor(asset),
      // One price on the axis, and it is the live one.
      //
      // The series drew its own last-value label as well: the close of the last
      // *complete* candle, which stands still while the live line moves, because
      // a bar is only updated for a bucket this client watched from its start.
      // Both were correct and neither was labelled, which reads as a
      // contradiction — reported as one on 2026-09-02.
      lastValueVisible: false,
      priceLineVisible: false,
    });
    return () => {
      created.remove();
      chart.current = null;
      series.current = null;
    };
    // Keyed on the asset, not on its display precision. Four of the five assets
    // in the catalogue share a precision, so keying on that kept the chart
    // across a switch — carrying the previous asset's price format and data
    // until the next fetch returned.
  }, [asset.id, asset.displayPrecision]);

  useEffect(() => {
    const target = series.current;
    if (target === null) return;
    const frame = panelTimeframe(timeframeId);
    const controller = new AbortController();
    let stream: EventSource | null = null;
    let priceLine: IPriceLine | null = null;
    let resumeRefused = false;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    /** Consecutive failures since the last open; the backoff exponent. */
    let failures = 0;
    /** Whether this view has been through a reconnect. */
    let afterGap = false;

    const liveStatus = (): string => (afterGap ? 'live — reconnected after a gap' : 'live');

    const armStall = (): void => {
      if (stallTimer !== null) clearTimeout(stallTimer);
      const quietMs = STALL_MULTIPLE * asset.meanIntervalMs;
      stallTimer = setTimeout(() => {
        if (cancelled) return;
        setStatus(
          `no tick for ${(quietMs / 1000).toFixed(0)}s — ${STALL_MULTIPLE}× this market's ` +
            `mean interval; check the engine's health`,
        );
      }, quietMs);
    };

    const retryLater = (why: string): void => {
      if (cancelled) return;
      failures += 1;
      afterGap = true;
      const inMs = Math.min(RECONNECT_BACKOFF_MS * 2 ** (failures - 1), MAX_RECONNECT_BACKOFF_MS);
      setStatus(`${why} — reconnecting in ${(inMs / 1000).toFixed(0)}s (attempt ${failures})`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void run().catch((error: unknown) => {
          retryLater((error as Error).message);
        });
      }, inMs);
    };

    const run = async (): Promise<void> => {
      setStatus(afterGap ? 'reloading history after a gap' : 'loading history');
      const to = Date.now();
      const from = to - frame.defaultSpanMs;
      const history = await fetchHistory(
        apiBase,
        asset.id,
        timeframeId,
        from,
        to,
        controller.signal,
      );
      if (cancelled) return;

      const drawn = toBars(history.candles, asset);
      target.setData(drawn.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })));
      setBars(drawn.length);
      chart.current?.timeScale().fitContent();

      // Resume the stream exactly where the history stops, so the bucket now
      // forming is one this client holds from its first tick.
      //
      // Without it the newest bar cannot move until the next boundary — up to
      // a full hour on the default one-hour chart — while the live price line
      // drifts away from a candle that never follows it. Reported on
      // 2026-09-02 as "the price moves and the candle stands still", which was
      // two correct rules producing a wrong screen: CA6-30 forbids rebuilding a
      // bucket from a partial view, and a resumed stream is not partial.
      //
      // `resumeRefused` is set when a previous attempt asked for a sequence the
      // feed had already evicted. An `EventSource` cannot read a status code,
      // so the refusal is observed as an error before `onopen`; the next
      // attempt goes without a resume point and the builder falls back to the
      // conservative rule.
      const newest = history.candles[history.candles.length - 1];

      // What this client can prove it holds of the bucket now forming.
      //
      // Two correct rules used to produce a wrong screen: CA6-30 forbids
      // rebuilding a bucket from a partial view, so the newest bar could not
      // move until the next boundary — up to a full hour on the default
      // one-hour chart, while the live price line drifted away from a candle
      // that never followed it (reported 2026-09-02).
      //
      // Neither rule has to give. The record *has* the bucket: as complete
      // minute bars, its permanent base tier. Folding those in is the record
      // read finer than the chart draws, and resuming the stream at the tick
      // after the last of them supplies the rest exactly — so the feed need
      // only remember one minute rather than one hour, which is what makes
      // this survive an engine restart.
      let seed: readonly HistoryCandle[] = [];
      let resumeFrom: number | null = null;
      if (!resumeRefused) {
        if (frame.durationMs > MINUTE_MS) {
          const bucketNow = bucketStart(Date.now(), frame.durationMs);
          const minutes = await fetchHistory(
            apiBase,
            asset.id,
            '1m',
            bucketNow,
            Date.now(),
            controller.signal,
          );
          if (cancelled) return;
          seed = minutes.candles.filter(
            (bar) => bucketStart(bar.openInstant, frame.durationMs) === bucketNow,
          );
          const lastMinute = seed[seed.length - 1];
          if (lastMinute !== undefined) resumeFrom = lastMinute.lastSequence + 1;
        }
        // A one-minute chart needs no seed: the bucket after the newest history
        // bar begins at the tick the resume starts from.
        if (resumeFrom === null && newest !== undefined) resumeFrom = newest.lastSequence + 1;
      }

      const builder = new LiveBarBuilder(
        frame.durationMs,
        asset,
        newest === undefined ? null : bucketStart(newest.openInstant, frame.durationMs),
        Date.now(),
        resumeFrom !== null,
      );
      const lastSeeded = seed[seed.length - 1];
      if (lastSeeded !== undefined) {
        builder.seedFrom(seed, lastSeeded.lastSequence);
        const forming = builder.current();
        if (forming !== null) {
          target.update({ ...forming, time: forming.time as UTCTimestamp });
        }
      }

      if (!asset.live) {
        setStatus('history only — this market is not hosted');
        return;
      }

      // A new stream from now, never a resume: the history was just refetched,
      // so the record is current and the builder's join is this connection's.
      const opened = new EventSource(
        resumeFrom === null
          ? `${apiBase}/markets/${asset.id}/stream`
          : `${apiBase}/markets/${asset.id}/stream?from=${resumeFrom}`,
      );
      stream = opened;
      let everOpened = false;
      opened.onopen = (): void => {
        everOpened = true;
        resumeRefused = false;
        failures = 0;
        setStatus(liveStatus());
        armStall();
      };
      opened.onmessage = (event: MessageEvent<string>): void => {
        const tick = JSON.parse(event.data) as Tick;
        // Rounded to the digits this asset settles on: the conversion is a
        // full-precision float, and a digit past `displayPrecision` is a
        // movement no contract can settle against.
        const price = toDisplayedPrice(displayPrice(tick.price, asset), asset.displayPrecision);
        setLast({ price, at: tick.instant });
        setStatus(liveStatus());
        armStall();

        // The live price, on every tick, at every timeframe. This is the last
        // integer the record holds, converted once, and nothing else.
        if (priceLine === null) {
          priceLine = target.createPriceLine({
            price,
            color: '#e3b341',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'live',
          });
        } else {
          priceLine.applyOptions({ price });
        }

        // And a candle only for a bucket this client watched from its start.
        const bar = builder.accept(tick);
        if (bar !== null) target.update({ ...bar, time: bar.time as UTCTimestamp });
      };
      opened.onerror = (): void => {
        // Ours to handle, not the browser's: its own retry would carry a
        // `Last-Event-ID` the engine may refuse, and then stop for good.
        opened.close();
        if (stream !== opened) return;
        stream = null;
        // Never opened, and we had asked to resume: the engine refused the
        // sequence. Ask for the live edge next time.
        if (!everOpened && resumeFrom !== null) resumeRefused = true;
        if (stallTimer !== null) clearTimeout(stallTimer);
        retryLater('stream interrupted');
      };
    };

    void run().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setStatus((error as Error).message);
    });

    return () => {
      cancelled = true;
      controller.abort();
      stream?.close();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (stallTimer !== null) clearTimeout(stallTimer);
      if (priceLine !== null) target.removePriceLine(priceLine);
    };
  }, [apiBase, asset, timeframeId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/*
        The chart is mounted into an absolutely positioned box inside a
        relatively positioned one. A chart container has no intrinsic height, so
        anything that sizes to its content collapses it to zero — which is
        exactly what happened: the panel drew an asset list beside an empty
        rectangle while the candles arrived over the network. `inset: 0` takes
        the question away from the layout entirely.
      */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div data-testid="chart" ref={container} style={{ position: 'absolute', inset: 0 }} />
      </div>
      <div
        style={{
          padding: '6px 10px',
          fontSize: 12,
          color: '#8b93a7',
          borderTop: '1px solid #242c3d',
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <span
          data-testid="stream-status"
          style={{ color: status.startsWith('live') ? '#3fb950' : '#8b93a7' }}
        >
          {status}
        </span>
        {last !== null && (
          <span style={{ color: '#e3b341' }}>
            {/*
              The price and the clock are separate elements, and that is a test
              interface decision as much as a layout one. When they shared one,
              a browser assertion that "the price changes" passed against a
              **frozen price**, because the second was ticking inside the same
              text node. The plant that proved it is in PH-20.1.
            */}
            <span data-testid="last-price">{last.price.toFixed(asset.displayPrecision)}</span>{' '}
            <span data-testid="last-price-at" style={{ color: '#5b6377' }}>
              {new Date(last.at).toLocaleTimeString(undefined, { hour12: false })}
            </span>
          </span>
        )}
        <span data-testid="bar-count">{bars.toLocaleString()} bars</span>
        <span>quantum {asset.logQuantum.toExponential(3)}</span>
        <span>tie rate {(100 * asset.tieRate).toFixed(2)}%</span>
        <span>quarterly spread {(100 * asset.dispersion.quarterlyPercent).toFixed(1)}%</span>
      </div>
    </div>
  );
}
