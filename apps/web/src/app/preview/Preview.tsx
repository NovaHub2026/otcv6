'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { fetchCatalogue, type CatalogueEntry } from '../../lib/api.js';
import { PANEL_TIMEFRAMES, type PanelTimeframeId } from '../../lib/series.js';
import { PreviewChart } from './PreviewChart.js';

/**
 * The Preview submenu: pick assets, pick a timeframe, watch.
 *
 * Multi-select rather than one at a time, because the question an operator
 * actually has is comparative — whether a new alt-coin reads differently from
 * the major it was drawn beside, whether two siblings from one family look like
 * two markets. One chart at a time answers that badly.
 *
 * Switching timeframe re-reads a view. It never refetches ticks, never resamples
 * the underlying record, and never changes a price: INV-004 as a viewer
 * experiences it.
 */
export function Preview({ apiBase }: { apiBase: string }): ReactElement {
  const [catalogue, setCatalogue] = useState<CatalogueEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [timeframe, setTimeframe] = useState<PanelTimeframeId>('1h');

  useEffect(() => {
    const controller = new AbortController();
    fetchCatalogue(apiBase, controller.signal)
      .then((entries) => {
        setCatalogue(entries);
        setSelected(entries.slice(0, 1).map((entry) => entry.id));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError((cause as Error).message);
      });
    return () => {
      controller.abort();
    };
  }, [apiBase]);

  if (error !== null) return <Message text={`Cannot reach the engine: ${error}`} />;
  if (catalogue === null) return <Message text="Loading the catalogue…" />;
  if (catalogue.length === 0) return <Message text="The catalogue is empty." />;

  const shown = catalogue.filter((entry) => selected.includes(entry.id));

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <aside
        style={{
          width: 260,
          borderRight: '1px solid #242c3d',
          overflowY: 'auto',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '12px 14px', fontSize: 12, color: '#8b93a7' }}>
          {catalogue.length} registered · {catalogue.filter((entry) => entry.live).length} hosted
        </div>
        {catalogue.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setSelected((current) =>
                current.includes(entry.id)
                  ? current.filter((id) => id !== entry.id)
                  : [...current, entry.id],
              );
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 14px',
              background: selected.includes(entry.id) ? '#161b26' : 'transparent',
              border: 'none',
              borderLeft: `3px solid ${selected.includes(entry.id) ? '#3fb950' : 'transparent'}`,
              color: '#d7dce5',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{entry.displayName}</span>
              <span style={{ color: entry.live ? '#3fb950' : '#5b6377', fontSize: 11 }}>
                {entry.live ? 'hosted' : 'idle'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#8b93a7', marginTop: 2 }}>
              {entry.family} · {(100 * entry.dispersion.quarterlyPercent).toFixed(1)}% a quarter ·{' '}
              {(entry.meanIntervalMs / 1000).toFixed(1)}s a tick
            </div>
          </button>
        ))}
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '8px 12px',
            borderBottom: '1px solid #242c3d',
            alignItems: 'center',
          }}
        >
          {PANEL_TIMEFRAMES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                setTimeframe(entry.id);
              }}
              style={{
                padding: '4px 10px',
                background: timeframe === entry.id ? '#242c3d' : 'transparent',
                color: timeframe === entry.id ? '#d7dce5' : '#8b93a7',
                border: '1px solid #242c3d',
                borderRadius: 3,
                font: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {entry.id}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8b93a7' }}>
            {shown.length === 0 ? 'select an asset' : `${shown.length} selected`}
          </span>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: shown.length > 1 ? '1fr 1fr' : '1fr',
          }}
        >
          {shown.map((entry) => (
            <section
              key={entry.id}
              style={{
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid #242c3d',
                borderBottom: '1px solid #242c3d',
              }}
            >
              <header
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  color: '#d7dce5',
                  display: 'flex',
                  gap: 10,
                }}
              >
                <span>{entry.displayName}</span>
                <span style={{ color: '#5b6377' }}>
                  {entry.id} · {timeframe}
                </span>
                {/* Sub-minute is served live rather than from storage: a stored
                    one-second bar of last March would be a shape no tick made. */}
                <a
                  href={`/preview/ticks/${entry.id}`}
                  style={{ marginLeft: 'auto', color: '#8b93a7', textDecoration: 'none' }}
                >
                  ticks →
                </a>
              </header>
              <div style={{ flex: 1, minHeight: 0 }}>
                <PreviewChart apiBase={apiBase} asset={entry} timeframeId={timeframe} />
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

function Message({ text }: { text: string }): ReactElement {
  return <div style={{ padding: 24, color: '#8b93a7' }}>{text}</div>;
}
