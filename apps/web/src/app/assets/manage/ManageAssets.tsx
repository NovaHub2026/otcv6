'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { fetchCatalogue, renameAsset, retireAsset, type CatalogueEntry } from '../../../lib/api.js';

/**
 * Editing and retiring, and a screen that says what it cannot do.
 *
 * ## Two controls, and a list of refusals
 *
 * A market's id derives its keystream (ADR-0002). Its quantum decides every
 * settlement (ADR-0004). Its reference price maps those integers to the numbers
 * a viewer read. Its personality *is* the market. Editing any of them would
 * rewrite what already happened — a chart of last month drawn against a lattice
 * that did not exist then — so none of them is on this screen, and the engine
 * refuses each **by name** if something else asks.
 *
 * What is left is a label and a decision to stop.
 *
 * ## Retirement is final
 *
 * A market resumed after a gap either invents the interval nobody generated,
 * which this runtime refuses outright, or takes a seam in a published record —
 * which an operator would be *choosing* to put into a market that had already
 * printed prices. So there is no un-retire, and the confirmation says so rather
 * than implying an undo that does not exist. Everything the market published
 * stays readable for ever.
 */
export function ManageAssets({ apiBase }: { apiBase: string }): ReactElement {
  const [catalogue, setCatalogue] = useState<CatalogueEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

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
      // Verbatim. The engine's refusal names the field and the reason, and that
      // is the only part of it worth reading.
      setError((cause as Error).message);
    } finally {
      setBusy(null);
      setEditing(null);
      setConfirming(null);
    }
  };

  if (error !== null && catalogue === null) return <Message text={error} />;
  if (catalogue === null) return <Message text="Loading the catalogue…" />;

  return (
    <div style={{ padding: 24, overflowY: 'auto', maxWidth: 900 }}>
      <h1 style={{ fontSize: 16, fontWeight: 500, margin: '0 0 4px' }}>Assets</h1>
      <p style={{ color: '#8b93a7', margin: '0 0 20px', lineHeight: 1.6 }}>
        A display name can change. An id, a lattice, a reference price and a personality cannot:
        they decided what already happened. Retiring stops a market and keeps everything it
        published — it cannot be undone.
      </p>

      {error !== null && (
        <div
          data-testid="manage-error"
          style={{
            border: '1px solid #f85149',
            color: '#f85149',
            padding: '10px 12px',
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {catalogue.map((entry) => (
            <tr
              key={entry.id}
              data-testid={`row-${entry.id}`}
              style={{ borderBottom: '1px solid #242c3d' }}
            >
              <td style={{ padding: '10px 8px 10px 0', width: '40%' }}>
                {editing === entry.id ? (
                  <input
                    data-testid={`rename-input-${entry.id}`}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                    }}
                    style={{
                      width: '100%',
                      padding: '5px 7px',
                      background: '#0b0e14',
                      border: '1px solid #3fb950',
                      color: '#d7dce5',
                      font: 'inherit',
                    }}
                  />
                ) : (
                  <span data-testid={`name-${entry.id}`}>{entry.displayName}</span>
                )}
                <div style={{ color: '#5b6377', fontSize: 11, marginTop: 3 }}>
                  {entry.id} · {entry.family}
                </div>
              </td>
              <td style={{ padding: '10px 8px', color: '#8b93a7', width: '25%' }}>
                <span data-testid={`state-${entry.id}`}>
                  {entry.retired === true ? 'retired' : entry.live ? 'hosted' : 'idle'}
                </span>
              </td>
              <td style={{ padding: '10px 0', textAlign: 'right' }}>
                {editing === entry.id ? (
                  <>
                    <Action
                      testId={`rename-save-${entry.id}`}
                      label="save"
                      disabled={busy !== null}
                      onClick={() => {
                        void act(entry.id, () => renameAsset(apiBase, entry.id, draft));
                      }}
                    />
                    <Action
                      testId={`rename-cancel-${entry.id}`}
                      label="cancel"
                      disabled={false}
                      onClick={() => {
                        setEditing(null);
                      }}
                    />
                  </>
                ) : confirming === entry.id ? (
                  <>
                    <span style={{ color: '#f85149', marginRight: 10 }}>
                      retire {entry.id} for good?
                    </span>
                    <Action
                      testId={`retire-confirm-${entry.id}`}
                      label="retire"
                      danger
                      disabled={busy !== null}
                      onClick={() => {
                        void act(entry.id, () => retireAsset(apiBase, entry.id));
                      }}
                    />
                    <Action
                      testId={`retire-cancel-${entry.id}`}
                      label="cancel"
                      disabled={false}
                      onClick={() => {
                        setConfirming(null);
                      }}
                    />
                  </>
                ) : (
                  <>
                    <Action
                      testId={`rename-${entry.id}`}
                      label="rename"
                      disabled={busy !== null}
                      onClick={() => {
                        setDraft(entry.displayName);
                        setEditing(entry.id);
                      }}
                    />
                    {entry.retired !== true && (
                      <Action
                        testId={`retire-${entry.id}`}
                        label="retire"
                        disabled={busy !== null}
                        onClick={() => {
                          setConfirming(entry.id);
                        }}
                      />
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Action({
  testId,
  label,
  onClick,
  disabled,
  danger = false,
}: {
  testId: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        marginLeft: 8,
        padding: '4px 10px',
        background: 'transparent',
        border: `1px solid ${danger ? '#f85149' : '#242c3d'}`,
        color: danger ? '#f85149' : '#8b93a7',
        font: 'inherit',
        fontSize: 12,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Message({ text }: { text: string }): ReactElement {
  return <div style={{ padding: 24, color: '#8b93a7' }}>{text}</div>;
}
