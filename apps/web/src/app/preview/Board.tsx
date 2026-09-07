'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { TickWindow } from '@otc/chart';
import type { CatalogueEntry } from '../../lib/api.js';
import { es } from '../../lib/es.js';
import { columnsFor, streamMarkets, type MarketNotice } from '../../lib/marketStream.js';
import { displayPriceText } from '../../lib/priceFormat.js';
import { T } from '../ui/kit.js';

const CAPACITY = 5_000;
const SPAN_MS = 60_000;

interface Card {
  /**
   * The canonical integer the record holds, never a price. It is converted for
   * the screen at the point of rendering, where the card's instrument is in
   * scope — see `displayPriceText` and Cycle Audit 10 (a8-04), which found this
   * number printed raw: `-65` under the market's name where the chart beside
   * it read `69992.0`.
   */
  readonly price: number | null;
  readonly status: string;
  readonly points: readonly number[];
}

function describe(notice: MarketNotice): string {
  switch (notice.kind) {
    case 'live':
      return notice.afterGap ? es.preview.status.liveAfterGap : es.preview.status.live;
    case 'reconnecting':
      return es.preview.status.reconnecting;
    case 'gap':
      return `${es.preview.status.interrupted}: ${notice.reason}`;
    case 'hole':
      return es.preview.status.holeBounded(notice.from, notice.to);
    case 'retired':
      return es.preview.status.retired;
  }
}

/**
 * Several markets, one stream (PH-30.2, Issue #16): a card per market, every
 * card fed by the page's single multiplexed connection. A told hole reads as
 * a hole with its bounds; a retired market says so and stops.
 */
export function Board({
  apiBase,
  entries,
}: {
  apiBase: string;
  entries: readonly CatalogueEntry[];
}): ReactElement {
  const [cards, setCards] = useState<ReadonlyMap<string, Card>>(
    () =>
      new Map(
        entries.map((e) => [e.id, { price: null, status: es.preview.status.loading, points: [] }]),
      ),
  );
  const ids = entries.map((e) => e.id).join(',');

  useEffect(() => {
    const assetIds = ids.length === 0 ? [] : ids.split(',');
    if (assetIds.length === 0) return undefined;
    const handle = streamMarkets(
      apiBase,
      assetIds,
      () => new TickWindow({ capacity: CAPACITY }),
      (assetId, window) => {
        const columns = columnsFor(window, 60, SPAN_MS);
        setCards((previous) => {
          const next = new Map(previous);
          const current = next.get(assetId);
          next.set(assetId, {
            price: window.latest?.price ?? null,
            status: current?.status ?? es.preview.status.live,
            points: columns.map((c) => c.close),
          });
          return next;
        });
      },
      (assetId, notice) => {
        if (assetId === null) return;
        setCards((previous) => {
          const next = new Map(previous);
          const current = next.get(assetId) ?? { price: null, status: '', points: [] };
          next.set(assetId, { ...current, status: describe(notice) });
          return next;
        });
      },
    );
    return () => {
      handle.close();
    };
  }, [apiBase, ids]);

  if (entries.length === 0)
    return <p style={{ padding: 24, color: T.muted }}>{es.preview.board.empty}</p>;

  return (
    <section data-testid="board" style={{ padding: 16 }}>
      <h2 style={{ fontSize: 13, fontWeight: 500, color: T.muted, margin: '0 0 12px' }}>
        {es.preview.board.title(entries.length)}
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {entries.map((entry) => {
          const card = cards.get(entry.id) ?? { price: null, status: '', points: [] };
          const high = card.points.length === 0 ? 1 : Math.max(...card.points);
          const low = card.points.length === 0 ? 0 : Math.min(...card.points);
          const span = Math.max(1, high - low);
          const width = 260;
          const height = 60;
          const path = card.points
            .map((p, i) => {
              const x = (i / Math.max(1, card.points.length - 1)) * width;
              const y = height - ((p - low) / span) * height;
              return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
          return (
            <article
              key={entry.id}
              data-testid={`board-card-${entry.id}`}
              style={{
                border: `1px solid ${T.line}`,
                borderRadius: 6,
                padding: 10,
                background: T.panel,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <strong>{entry.displayName}</strong>
                <span data-testid={`board-price-${entry.id}`}>
                  {card.price === null ? '—' : displayPriceText(card.price, entry)}
                </span>
              </div>
              <svg width={width} height={height} role="img" aria-label={`${entry.id} sparkline`}>
                {path.length > 0 && <path d={path} fill="none" stroke={T.ok} strokeWidth={1} />}
              </svg>
              <div
                data-testid={`board-status-${entry.id}`}
                style={{ fontSize: 11, color: T.faint }}
              >
                {card.status}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
