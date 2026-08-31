'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { TickWindow, type Column } from '@otc/chart';
import { columnsFor, streamMarket } from '../lib/marketStream';

/**
 * The chart draws columns and nothing else.
 *
 * Every value it renders came out of `reduceToColumns`, which is constrained to
 * emit only prices that were actually observed. There is deliberately no
 * smoothing, no curve fitting and no animated transition between values: each of
 * those would draw a price the market never traded, and a binary option settles
 * on whether a level was crossed.
 *
 * An empty period produces no column, so the chart shows a gap where the market
 * was quiet — which is the truth, rather than a flat line asserting trades that
 * did not happen.
 */
export function Chart({ apiBase, assetId }: { apiBase: string; assetId: string }): ReactElement {
  const [columns, setColumns] = useState<Column[]>([]);
  const [latest, setLatest] = useState<number | null>(null);
  const [status, setStatus] = useState('connecting');
  const windowRef = useRef(new TickWindow({ capacity: 50_000 }));

  useEffect(() => {
    const window = windowRef.current;
    const handle = streamMarket(apiBase, assetId, window, (updated) => {
      setStatus('live');
      setLatest(updated.latest?.price ?? null);
      setColumns(columnsFor(updated, 240));
    });
    return () => {
      handle.close();
    };
  }, [apiBase, assetId]);

  if (columns.length === 0) {
    return <p style={{ padding: 24 }}>{status}…</p>;
  }

  const high = Math.max(...columns.map((c) => c.high));
  const low = Math.min(...columns.map((c) => c.low));
  const span = Math.max(1, high - low);
  const width = 960;
  const height = 360;
  const columnWidth = width / columns.length;
  const y = (price: number): number => height - ((price - low) / span) * height;

  return (
    <section style={{ padding: 24 }}>
      <h1 style={{ fontSize: 16, fontWeight: 500 }}>
        {assetId} <span style={{ opacity: 0.6 }}>· {status}</span>{' '}
        {latest !== null && <span style={{ opacity: 0.6 }}>· {latest}</span>}
      </h1>
      <svg width={width} height={height} role="img" aria-label={`${assetId} price`}>
        {columns.map((column, index) => {
          const x = index * columnWidth + columnWidth / 2;
          const rising = column.close >= column.open;
          return (
            <g key={`${column.fromInstant}`} stroke={rising ? '#4ec9a8' : '#e06c75'}>
              {/* High-low wick: the extremes are drawn because the reduction
                  preserved them, not because they were sampled. */}
              <line x1={x} x2={x} y1={y(column.high)} y2={y(column.low)} strokeWidth={1} />
              <line
                x1={x}
                x2={x}
                y1={y(column.open)}
                y2={y(column.close)}
                strokeWidth={Math.max(1, columnWidth * 0.6)}
              />
            </g>
          );
        })}
      </svg>
      <p style={{ opacity: 0.6, fontSize: 12 }}>
        {columns.length} columns · {columns.reduce((n, c) => n + c.tickCount, 0)} ticks · gaps are
        periods with no trades, not flat prices
      </p>
    </section>
  );
}
