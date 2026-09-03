'use client';

import { useState, type ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Badge, Button, Field, FIELD, Notice, Section, T } from '../ui/kit.js';
import { when, type LabPositionView } from './labApi.js';

/** Every preset the specification names (§41), by its API name. */
const PRESETS = [
  { name: 'win-minimum' },
  { name: 'loss-minimum' },
  { name: 'tie' },
  { name: 'entry-plus-tick' },
  { name: 'entry-minus-tick' },
  { name: 'exact-entry' },
] as const;

/**
 * Posiciones simuladas (§38–§45) y los presets que deciden cómo acaban (§41).
 *
 * Cada fila muestra dos resultados: el esperado — según el objetivo armado para
 * esa expiración o, si no hay ninguno, según el precio actual, y dice cuál — y
 * el real, la liquidación de producción contra el registro de este Lab. Tienen
 * que coincidir; una fila que no coincide es un hallazgo y se marca como tal.
 */
export function Posiciones({
  positions,
  onOpen,
  onPreset,
  busy,
  notice,
}: {
  positions: readonly LabPositionView[];
  onOpen: (direction: 'up' | 'down', stake: number, horizonMs: number) => Promise<void>;
  onPreset: (id: string, name: string) => Promise<void>;
  busy: string | null;
  notice: string | null;
}): ReactElement {
  const [stake, setStake] = useState('100');
  const [horizon, setHorizon] = useState('60');
  return (
    <Section title={es.lab.positions.title} info={es.lab.positions.info}>
      <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 4 }}>
        <Field label={es.lab.positions.stake} width={90}>
          <input
            data-testid="lab-position-stake"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            style={FIELD}
          />
        </Field>
        <Field label={es.lab.positions.horizon} width={90}>
          <input
            data-testid="lab-position-horizon"
            value={horizon}
            onChange={(e) => setHorizon(e.target.value)}
            style={FIELD}
          />
        </Field>
        <span style={{ display: 'inline-flex', gap: 6, marginBottom: 10 }}>
          <Button
            kind="primary"
            testId="lab-position-call"
            disabled={busy !== null}
            onClick={() => void onOpen('up', Number(stake), Number(horizon) * 1000)}
          >
            {es.lab.positions.call}
          </Button>
          <Button
            kind="danger"
            testId="lab-position-put"
            disabled={busy !== null}
            onClick={() => void onOpen('down', Number(stake), Number(horizon) * 1000)}
          >
            {es.lab.positions.put}
          </Button>
        </span>
      </div>
      {notice !== null && <Notice testId="lab-position-notice">{notice}</Notice>}
      <div data-testid="lab-positions">
        {positions.length === 0 && (
          <div style={{ color: T.faint, fontSize: 12 }}>{es.lab.positions.none}</div>
        )}
        {positions.map((p) => (
          <div
            key={p.id}
            data-testid={`lab-position-${p.id}`}
            style={{
              borderTop: `1px solid ${T.line}`,
              padding: '8px 0',
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{p.id}</strong>
              <Badge tone={p.direction === 'up' ? 'ok' : 'bad'}>
                {p.direction === 'up' ? 'CALL' : 'PUT'}
              </Badge>
              <span style={{ color: T.muted }}>
                {es.lab.positions.stake} {String(p.stake)} · {es.lab.positions.entry}{' '}
                {p.entryDisplay} · {es.lab.positions.expires} {when(p.expiryInstant)}
              </span>
            </div>
            <div style={{ color: T.muted }}>
              {es.lab.positions.expected}{' '}
              <strong style={{ color: T.text }}>
                {es.lab.positions.outcome[p.expected.outcome] ?? p.expected.outcome}
              </strong>{' '}
              {p.expected.closeDisplay}{' '}
              <span style={{ color: T.faint }}>
                ({es.lab.positions.basis[p.expected.basis] ?? p.expected.basis})
              </span>
              {' · '}
              {es.lab.positions.actual}{' '}
              {p.actual === null ? (
                <span style={{ color: T.faint }}>{es.lab.positions.notExpired}</span>
              ) : (
                <span
                  data-testid={`lab-position-${p.id}-actual`}
                  style={{ color: p.actual.agrees ? T.ok : T.bad }}
                >
                  <strong>{es.lab.positions.outcome[p.actual.outcome] ?? p.actual.outcome}</strong>{' '}
                  {p.actual.expiryDisplay} · {es.lab.positions.net} {String(p.actual.net)} —{' '}
                  {p.actual.agrees ? es.lab.positions.agrees : es.lab.positions.disagrees}
                </span>
              )}
            </div>
            {p.actual === null && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.name}
                    small
                    testId={`lab-preset-${p.id}-${preset.name}`}
                    disabled={busy !== null}
                    onClick={() => void onPreset(p.id, preset.name)}
                  >
                    {es.lab.positions.presets[preset.name] ?? preset.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
