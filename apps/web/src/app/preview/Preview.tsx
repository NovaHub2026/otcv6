'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { fetchCatalogue, type CatalogueEntry } from '../../lib/api.js';
import { PANEL_TIMEFRAMES, type PanelTimeframeId } from '@otc/chart';
import { PreviewChart } from './PreviewChart.js';

/**
 * The Preview submenu: pick an asset, pick a timeframe, watch.
 *
 * **One asset per screen.** The first version put several side by side in a
 * grid, reasoning that the operator's question is comparative. The Human Owner's
 * answer was that it is not: selecting an asset should *change* the screen. That
 * is also the honest shape for a chart — two markets at half width each are two
 * charts nobody can read, and a market this project spends millions of ticks
 * making plausible deserves the whole width.
 */
export function Preview({ apiBase }: { apiBase: string }): ReactElement {
  const [catalogue, setCatalogue] = useState<CatalogueEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<PanelTimeframeId>('1h');

  useEffect(() => {
    const controller = new AbortController();
    fetchCatalogue(apiBase, controller.signal)
      .then((entries) => {
        setCatalogue(entries);
        setSelected(entries[0]?.id ?? null);
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

  const shown = catalogue.find((entry) => entry.id === selected) ?? null;

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
            data-testid={`asset-${entry.id}`}
            onClick={() => {
              setSelected(entry.id);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 14px',
              background: selected === entry.id ? '#161b26' : 'transparent',
              border: 'none',
              borderLeft: `3px solid ${selected === entry.id ? '#3fb950' : 'transparent'}`,
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

      <main
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}
      >
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '8px 12px',
            borderBottom: '1px solid #242c3d',
            alignItems: 'center',
            flexShrink: 0,
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
          {shown !== null && (
            <>
              <span style={{ marginLeft: 12, color: '#d7dce5', fontSize: 12 }}>
                {shown.displayName}
              </span>
              <span style={{ color: '#5b6377', fontSize: 12 }}>{shown.id}</span>
              {/*
                Sub-minute is served live rather than from storage: a stored
                one-second bar of last March would be a shape no tick made.
              */}
              <a
                href={`/preview/ticks/${shown.id}`}
                style={{
                  marginLeft: 'auto',
                  color: '#8b93a7',
                  textDecoration: 'none',
                  fontSize: 12,
                }}
              >
                ticks →
              </a>
            </>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          {shown === null ? (
            <Message text="Select an asset." />
          ) : (
            // Keyed on the asset, so a switch remounts the chart instead of
            // reusing one that still holds the previous market's series.
            <PreviewChart key={shown.id} apiBase={apiBase} asset={shown} timeframeId={timeframe} />
          )}
        </div>
      </main>
    </div>
  );
}

function Message({ text }: { text: string }): ReactElement {
  return <div style={{ padding: 24, color: '#8b93a7' }}>{text}</div>;
}
