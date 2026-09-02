'use client';

import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Tick } from '@otc/core/browser';
import { fetchHistory, type CatalogueEntry } from '../../lib/api.js';
import {
  bucketStart,
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
 * whose bar the join belongs to — is in `series.ts`, framework-free and tested.
 * What is left here is mounting a chart, fetching a window, and forwarding ticks.
 *
 * ## The join
 *
 * History ends at whatever bar was last flushed; the stream starts at whatever
 * tick arrives after the socket opens. The overlap is real and the rule is that
 * **the record's bar wins**: a bucket history already has is never rebuilt from
 * the fragment of it that arrived live, because that would give this viewer a
 * different bar for the same minute than everyone else has (INV-002).
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

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const created = createChart(element, {
      layout: { background: { color: '#0b0e14' }, textColor: '#8b93a7' },
      grid: {
        vertLines: { color: '#161b26' },
        horzLines: { color: '#161b26' },
      },
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
  }, [asset.displayPrecision]);

  useEffect(() => {
    const target = series.current;
    if (target === null) return;
    const frame = panelTimeframe(timeframeId);
    const controller = new AbortController();
    let stream: EventSource | null = null;
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

      const last = history.candles[history.candles.length - 1];
      const builder = new LiveBarBuilder(
        frame.durationMs,
        asset,
        last === undefined ? null : bucketStart(last.openInstant, frame.durationMs),
        // The instant this client's view begins. A bucket already in progress
        // belongs to the record even when it has not been flushed yet
        // (CA6-30).
        Date.now(),
      );

      setStatus(asset.live ? 'live' : 'history only — this market is not hosted');
      if (!asset.live) return;

      stream = new EventSource(`${apiBase}/markets/${asset.id}/stream`);
      stream.onmessage = (event: MessageEvent<string>): void => {
        const tick = JSON.parse(event.data) as Tick;
        const bar = builder.accept(tick);
        if (bar === null) return;
        target.update({ ...bar, time: bar.time as UTCTimestamp });
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
    };
  }, [apiBase, asset, timeframeId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div ref={container} style={{ flex: 1, minHeight: 0 }} />
      <div
        style={{
          padding: '6px 10px',
          fontSize: 12,
          color: '#8b93a7',
          borderTop: '1px solid #242c3d',
          display: 'flex',
          gap: 16,
        }}
      >
        <span>{status}</span>
        <span>{bars.toLocaleString()} bars</span>
        <span>quantum {asset.logQuantum.toExponential(3)}</span>
        <span>tie rate {(100 * asset.tieRate).toFixed(2)}%</span>
        <span>quarterly spread {(100 * asset.dispersion.quarterlyPercent).toFixed(1)}%</span>
      </div>
    </div>
  );
}
