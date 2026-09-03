'use client';

import type { ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Info, Row, Section, T } from '../ui/kit.js';
import { describeEvent, when, type ClosesView, type Session } from './labApi.js';

/**
 * Sesión: dos cronologías, nunca mezcladas (§72–§73), y el diagnóstico §70
 * sobre los cierres del operador (PH-24.5).
 */
export function Sesion({
  session,
  closes,
}: {
  session: Session | null;
  closes: ClosesView | null;
}): ReactElement {
  const hhmmss = (instant: number): string => when(instant).slice(0, 8);
  return (
    <>
      <Section title={es.lab.session.title} info={es.lab.session.info}>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }} data-testid="lab-session-engine">
            <div style={{ color: T.muted, fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>
              {es.lab.session.engine}
            </div>
            {session === null || session.engine.length === 0 ? (
              <div style={{ color: T.faint, fontSize: 11 }}>{es.lab.session.engineEmpty}</div>
            ) : (
              [...session.engine].reverse().map((event, i) => (
                <div key={i} style={{ fontSize: 11, color: T.text, lineHeight: 1.6 }}>
                  {hhmmss(event.at)} · {event.asset} · {describeEvent(event.detail)}
                </div>
              ))
            )}
          </div>
          <div style={{ flex: 1 }} data-testid="lab-session-lab">
            <div style={{ color: T.lab, fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>
              {es.lab.session.lab}
            </div>
            {session === null || session.lab.length === 0 ? (
              <div style={{ color: T.faint, fontSize: 11 }}>{es.lab.session.labEmpty}</div>
            ) : (
              [...session.lab].reverse().map((action, i) => (
                <div key={i} style={{ fontSize: 11, color: T.text, lineHeight: 1.6 }}>
                  {hhmmss(action.at)} · {action.asset} ·{' '}
                  <strong>{es.lab.acts[action.action] ?? action.action}</strong>{' '}
                  {action.succeeded ? '✓' : '✗'}{' '}
                  <span style={{ color: T.faint }}>
                    {Object.entries(action.parameters)
                      .filter(([, v]) => v !== null && typeof v !== 'object')
                      .map(([k, v]) => `${k}=${String(v)}`)
                      .join(' ')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </Section>
      <Section title={es.lab.session.closes} info={es.lab.session.closesInfo}>
        <div data-testid="lab-closes">
          {closes === null ? (
            <div style={{ color: T.faint, fontSize: 11 }}>—</div>
          ) : (
            <>
              <Row
                label={es.lab.session.controlled}
                value={es.lab.session.controlledValue(closes.controlled, closes.minimumForVerdict)}
              />
              <Row
                label={es.lab.session.oneStep}
                value={
                  closes.oneStepFraction === null
                    ? '—'
                    : `${String(Math.round(closes.oneStepFraction * 100))} %`
                }
              />
              <Row
                label={es.lab.session.distances}
                value={
                  Object.keys(closes.distances).length === 0
                    ? '—'
                    : Object.entries(closes.distances)
                        .map(([d, n]) => `${d}: ${String(n)}`)
                        .join(' · ')
                }
              />
              <div
                data-testid="lab-closes-verdict"
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color:
                    closes.verdict === 'too-few-to-say'
                      ? T.muted
                      : closes.verdict === 'one-sided'
                        ? T.warn
                        : T.ok,
                }}
              >
                <strong>{es.lab.session.verdict[closes.verdict] ?? closes.verdict}</strong>
                <Info text={<span data-testid="lab-closes-note">{closes.note}</span>} />
              </div>
            </>
          )}
        </div>
      </Section>
    </>
  );
}
