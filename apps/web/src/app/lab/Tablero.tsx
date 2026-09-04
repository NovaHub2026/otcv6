'use client';

import type { ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Badge, Button, Section, T } from '../ui/kit.js';
import { formatCountdown } from '../../lib/countdown.js';
import { when, type ControlAll } from './labApi.js';

/**
 * Tablero (PH-24.9): every market this Lab hosts, in one table, so a session
 * across markets reads as one thing — price, regime, what is armed and how much
 * remains, the last target and how it ended, the positions still open. An act
 * is per market; only release is batched, because it only returns markets to
 * their keystreams.
 */
export function Tablero({
  all,
  busy,
  onReleaseAll,
  onSelect,
}: {
  all: ControlAll | null;
  busy: string | null;
  onReleaseAll: () => Promise<void>;
  onSelect: (id: string) => void;
}): ReactElement {
  // PH-24.24: a sustained direction is something running, and something to
  // release. Counting only `armed` — which means a script — left «Liberar
  // todos» disabled on a market carrying exactly the act the operator most
  // wants off, and the row read «keystream» while the market was being pushed.
  const running = all?.markets.filter((m) => m.armed || (m.bias ?? null) !== null).length ?? 0;
  const cell = { padding: '7px 8px 7px 0' } as const;
  return (
    <Section
      title={es.lab.board.title}
      info={es.lab.board.info}
      right={
        <Button
          kind="danger"
          small
          testId="lab-release-all"
          disabled={busy !== null || running === 0}
          onClick={() => void onReleaseAll()}
        >
          {es.lab.board.releaseAll}
          {running > 0 ? ` (${String(running)})` : ''}
        </Button>
      }
    >
      <table
        data-testid="lab-board"
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
      >
        <thead>
          <tr style={{ color: T.faint, fontSize: 10, letterSpacing: 1, textAlign: 'left' }}>
            <th style={cell}>{es.lab.board.market.toUpperCase()}</th>
            <th style={cell}>{es.lab.board.price.toUpperCase()}</th>
            <th style={cell}>{es.lab.board.regime.toUpperCase()}</th>
            <th style={cell}>{es.lab.board.state.toUpperCase()}</th>
            <th style={cell}>{es.lab.board.last.toUpperCase()}</th>
            <th style={{ padding: '4px 0 6px 0' }}>{es.lab.board.positions.toUpperCase()}</th>
          </tr>
        </thead>
        <tbody>
          {(all?.markets ?? []).map((m) => (
            <tr
              key={m.id}
              data-testid={`lab-board-${m.id}`}
              style={{ borderTop: `1px solid ${T.line}` }}
            >
              <td style={cell}>
                <button
                  type="button"
                  onClick={() => onSelect(m.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: T.text,
                    font: 'inherit',
                    cursor: 'pointer',
                    padding: 0,
                    textAlign: 'left',
                  }}
                >
                  <div>{m.displayName}</div>
                  <div style={{ fontSize: 10, color: T.faint }}>{m.id}</div>
                </button>
              </td>
              <td style={{ ...cell, color: T.text }}>{m.price ?? '—'}</td>
              <td style={{ ...cell, color: T.muted }}>{m.regime ?? '—'}</td>
              <td style={cell} data-testid={`lab-board-state-${m.id}`}>
                {m.armed ? (
                  <Badge tone="lab">{`${es.lab.header.armed} · ${String(m.remaining)}`}</Badge>
                ) : (m.bias ?? null) !== null ? (
                  <Badge tone="lab">
                    {`${m.bias === 1 ? es.lab.push.bias.up : es.lab.push.bias.down} ${formatCountdown(m.biasMsLeft ?? 0)}`}
                  </Badge>
                ) : (
                  <Badge tone="muted">{es.lab.header.keystream}</Badge>
                )}
              </td>
              <td
                style={{
                  ...cell,
                  color:
                    m.lastApplied === null || m.lastApplied.exact === null
                      ? T.muted
                      : m.lastApplied.exact
                        ? T.ok
                        : T.bad,
                }}
              >
                {m.lastApplied === null
                  ? '—'
                  : m.lastApplied.closedPrice === null
                    ? `→ ${m.lastApplied.targetPrice} · ${when(m.lastApplied.instant)}`
                    : `${m.lastApplied.targetPrice} → ${m.lastApplied.closedPrice} ${m.lastApplied.exact ? 'EXACTO' : 'FALLÓ'}`}
              </td>
              <td style={{ padding: '7px 0', color: T.muted }}>{String(m.openPositions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {all !== null && running === 0 && (
        <div style={{ color: T.faint, fontSize: 11, marginTop: 6 }}>{es.lab.board.nothing}</div>
      )}
    </Section>
  );
}
