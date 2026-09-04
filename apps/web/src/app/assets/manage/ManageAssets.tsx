'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { fetchCatalogue, renameAsset, retireAsset, type CatalogueEntry } from '../../../lib/api.js';
import { filterCatalogue } from '../../../lib/catalogueView.js';
import { es } from '../../../lib/es.js';
import { Badge, Button, FIELD, Info, Notice, T } from '../../ui/kit.js';

/**
 * Renombrar y retirar (PH-20.3, rediseñado en PH-24.6).
 *
 * Un id deriva su keystream (ADR-0002), un cuanto decide cada liquidación
 * (ADR-0004), un precio de referencia convierte los enteros, una personalidad
 * *es* el mercado: nada de eso se edita, porque decidió lo que ya pasó. Queda
 * un rótulo y la decisión de parar — y retirar no se deshace.
 */
export function ManageAssets({ apiBase }: { apiBase: string }): ReactElement {
  const [catalogue, setCatalogue] = useState<CatalogueEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const reload = useCallback(async (): Promise<void> => {
    try {
      setCatalogue(await fetchCatalogue(apiBase));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [apiBase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (id: string, run: () => Promise<void>): Promise<void> => {
    setError(null);
    setBusy(id);
    try {
      await run();
      await reload();
    } catch (cause) {
      setError((cause as Error).message); // verbatim: the engine names the field and the reason
    } finally {
      setBusy(null);
      setEditing(null);
      setConfirming(null);
    }
  };

  if (error !== null && catalogue === null)
    return <div style={{ padding: 20, color: T.muted }}>{error}</div>;
  if (catalogue === null)
    return <div style={{ padding: 20, color: T.muted }}>{es.manage.loading}</div>;

  const stateOf = (entry: CatalogueEntry): { label: string; tone: 'ok' | 'muted' | 'bad' } =>
    entry.retired === true
      ? { label: es.manage.state.retired, tone: 'bad' }
      : entry.live
        ? { label: es.manage.state.hosted, tone: 'ok' }
        : { label: es.manage.state.idle, tone: 'muted' };

  return (
    <div style={{ padding: 20, overflowY: 'auto', maxWidth: 900 }}>
      <h1
        style={{
          fontSize: 16,
          fontWeight: 500,
          margin: '0 0 14px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {es.manage.title}
        <Info text={es.manage.intro} />
      </h1>
      {error !== null && (
        <Notice tone="bad" testId="manage-error">
          {error}
        </Notice>
      )}
      <input
        data-testid="manage-filter"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={es.manage.filter}
        style={{ ...FIELD, width: '100%', maxWidth: 320, marginBottom: 12 }}
      />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {filterCatalogue(catalogue, query).map((entry) => {
            const state = stateOf(entry);
            return (
              <tr
                key={entry.id}
                data-testid={`row-${entry.id}`}
                style={{ borderBottom: `1px solid ${T.line}` }}
              >
                <td style={{ padding: '9px 8px 9px 0', width: '40%' }}>
                  {editing === entry.id ? (
                    <input
                      data-testid={`rename-input-${entry.id}`}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      style={{ ...FIELD, width: '100%', border: `1px solid ${T.ok}` }}
                    />
                  ) : (
                    <span data-testid={`name-${entry.id}`}>{entry.displayName}</span>
                  )}
                  <div style={{ color: T.faint, fontSize: 11, marginTop: 3 }}>
                    {entry.id} · {entry.family}
                  </div>
                </td>
                <td style={{ padding: '9px 8px', width: '20%' }}>
                  <Badge tone={state.tone}>
                    <span data-testid={`state-${entry.id}`}>{state.label}</span>
                  </Badge>
                </td>
                <td style={{ padding: '9px 0', textAlign: 'right' }}>
                  {editing === entry.id ? (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <Button
                        small
                        testId={`rename-save-${entry.id}`}
                        disabled={busy !== null}
                        onClick={() =>
                          void act(entry.id, () => renameAsset(apiBase, entry.id, draft))
                        }
                      >
                        {es.manage.save}
                      </Button>
                      <Button
                        small
                        kind="ghost"
                        testId={`rename-cancel-${entry.id}`}
                        onClick={() => setEditing(null)}
                      >
                        {es.manage.cancel}
                      </Button>
                    </span>
                  ) : confirming === entry.id ? (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ color: T.bad }}>{es.manage.confirm(entry.id)}</span>
                      <Button
                        small
                        kind="danger"
                        testId={`retire-confirm-${entry.id}`}
                        disabled={busy !== null}
                        onClick={() => void act(entry.id, () => retireAsset(apiBase, entry.id))}
                      >
                        {es.manage.retire}
                      </Button>
                      <Button
                        small
                        kind="ghost"
                        testId={`retire-cancel-${entry.id}`}
                        onClick={() => setConfirming(null)}
                      >
                        {es.manage.cancel}
                      </Button>
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <Button
                        small
                        testId={`rename-${entry.id}`}
                        disabled={busy !== null}
                        onClick={() => {
                          setDraft(entry.displayName);
                          setEditing(entry.id);
                        }}
                      >
                        {es.manage.rename}
                      </Button>
                      {entry.retired !== true && (
                        <Button
                          small
                          kind="ghost"
                          testId={`retire-${entry.id}`}
                          disabled={busy !== null}
                          onClick={() => setConfirming(entry.id)}
                        >
                          {es.manage.retire}
                        </Button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
