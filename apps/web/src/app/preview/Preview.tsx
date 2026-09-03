'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { fetchCatalogue, type CatalogueEntry } from '../../lib/api.js';
import { filterCatalogue, groupByFamily } from '../../lib/catalogueView.js';
import { es } from '../../lib/es.js';
import { PANEL_TIMEFRAMES, type PanelTimeframeId } from '@otc/chart';
import { Badge, FIELD, Info, T } from '../ui/kit.js';
import { PreviewChart } from './PreviewChart.js';

/**
 * Vista: elige un activo, elige un marco, mira (PH-20, rediseñada en PH-24.6).
 *
 * Un activo por pantalla: seleccionar cambia la pantalla entera. Un mercado en
 * el que este proyecto gasta millones de ticks haciéndolo plausible merece el
 * ancho completo.
 */
export function Preview({ apiBase }: { apiBase: string }): ReactElement {
  const [catalogue, setCatalogue] = useState<CatalogueEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<PanelTimeframeId>('1h');
  const [query, setQuery] = useState('');

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

  if (error !== null) return <Message text={es.preview.unreachable(error)} />;
  if (catalogue === null) return <Message text={es.preview.loading} />;
  if (catalogue.length === 0) return <Message text={es.preview.empty} />;

  const shown = catalogue.find((entry) => entry.id === selected) ?? null;
  const groups = groupByFamily(filterCatalogue(catalogue, query));
  const matched = groups.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <aside
        style={{
          width: 250,
          borderRight: `1px solid ${T.line}`,
          overflowY: 'auto',
          flexShrink: 0,
          background: T.panel,
        }}
      >
        <div
          style={{
            padding: '12px 14px 6px',
            fontSize: 11,
            color: T.muted,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {es.preview.registered(catalogue.length, catalogue.filter((entry) => entry.live).length)}
          {query.trim() === '' ? '' : ` · ${es.preview.shown(matched)}`}
          <Info text={es.preview.characterInfo} />
        </div>
        <div style={{ padding: '0 14px 10px' }}>
          <input
            data-testid="asset-filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={es.preview.filter}
            style={{ ...FIELD, width: '100%' }}
          />
        </div>
        {matched === 0 && (
          <div
            data-testid="no-matches"
            style={{ padding: '8px 14px', color: T.faint, fontSize: 12 }}
          >
            {es.preview.noMatches(query)}
          </div>
        )}
        {groups.map((group) => (
          <div key={group.family}>
            <div
              style={{
                padding: '10px 14px 4px',
                fontSize: 10,
                color: T.faint,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              {group.family} · {group.entries.length}
            </div>
            {group.entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-testid={`asset-${entry.id}`}
                onClick={() => setSelected(entry.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 14px',
                  background: selected === entry.id ? T.raised : 'transparent',
                  border: 'none',
                  borderLeft: `3px solid ${selected === entry.id ? T.ok : 'transparent'}`,
                  color: T.text,
                  font: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>{entry.displayName}</span>
                  <Badge tone={entry.live ? 'ok' : 'muted'}>
                    {entry.live ? es.preview.hosted : es.preview.idle}
                  </Badge>
                </div>
                <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>
                  {es.preview.character(
                    (100 * entry.dispersion.quarterlyPercent).toFixed(1),
                    (entry.meanIntervalMs / 1000).toFixed(1),
                  )}
                </div>
              </button>
            ))}
          </div>
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
            borderBottom: `1px solid ${T.line}`,
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {PANEL_TIMEFRAMES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTimeframe(entry.id)}
              style={{
                padding: '4px 10px',
                background: timeframe === entry.id ? T.line : 'transparent',
                color: timeframe === entry.id ? T.text : T.muted,
                border: `1px solid ${T.line}`,
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
              <span style={{ marginLeft: 12, color: T.text, fontSize: 13 }}>
                {shown.displayName}
              </span>
              <span style={{ color: T.faint, fontSize: 11 }}>{shown.id}</span>
              <a
                href={`/preview/ticks/${shown.id}`}
                style={{ marginLeft: 'auto', color: T.muted, textDecoration: 'none', fontSize: 12 }}
              >
                {es.preview.ticks}
              </a>
            </>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {shown === null ? (
            <Message text={es.preview.select} />
          ) : (
            <PreviewChart key={shown.id} apiBase={apiBase} asset={shown} timeframeId={timeframe} />
          )}
        </div>
      </main>
    </div>
  );
}

function Message({ text }: { text: string }): ReactElement {
  return <div style={{ padding: 24, color: T.muted }}>{text}</div>;
}
