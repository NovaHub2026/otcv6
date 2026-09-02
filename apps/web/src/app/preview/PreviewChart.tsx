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
import {
  bucketStart,
  displayPrice,
  LiveBarBuilder,
  panelTimeframe,
  toBars,
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
 * ## The `data-testid` attributes
 *
 * There are three, and they exist because the first browser test selected the
 * price by its colour. A panel that can only be tested by matching a hex code
 * is a panel whose tests break when someone changes a theme — and the whole
 * reason this layer is being covered at all is that nothing else could see it.
 */
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
      priceFormat: { type: 'price', precision: asset.displayPrecision, minMove: 1e-8 },
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
    let cancelled = false;

    const run = async (): Promise<void> => {
      setStatus('loading history');
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

      const newest = history.candles[history.candles.length - 1];
      const builder = new LiveBarBuilder(
        frame.durationMs,
        asset,
        newest === undefined ? null : bucketStart(newest.openInstant, frame.durationMs),
        Date.now(),
      );

      if (!asset.live) {
        setStatus('history only — this market is not hosted');
        return;
      }
      setStatus('live');

      stream = new EventSource(`${apiBase}/markets/${asset.id}/stream`);
      stream.onmessage = (event: MessageEvent<string>): void => {
        const tick = JSON.parse(event.data) as Tick;
        const price = displayPrice(tick.price, asset);
        setLast({ price, at: tick.instant });

        // The live price, on every tick, at every timeframe. This is the last
        // integer the record holds, converted once, and nothing else.
        if (priceLine === null) {
          priceLine = target.createPriceLine({
            price,
            color: '#e3b341',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'last',
          });
        } else {
          priceLine.applyOptions({ price });
        }

        // And a candle only for a bucket this client watched from its start.
        const bar = builder.accept(tick);
        if (bar !== null) target.update({ ...bar, time: bar.time as UTCTimestamp });
      };
      stream.onerror = (): void => {
        setStatus('stream interrupted — reconnecting');
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
          style={{ color: status === 'live' ? '#3fb950' : '#8b93a7' }}
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
