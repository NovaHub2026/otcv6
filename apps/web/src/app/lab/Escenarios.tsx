'use client';

import { useState, type ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Button, Field, FIELD, Info, Notice, Row, Section, T } from '../ui/kit.js';
import { when, type ScenarioPlan, type ScenarioView } from './labApi.js';

/**
 * Escenarios (§48–§49, P1–P16), como criterios de selección sobre la ventana.
 *
 * «El Lab define el escenario; el motor genera el camino» — literalmente: cada
 * candidato es una continuación del propio motor y el Lab se queda con una cuya
 * forma encaja. Los dos escenarios que los signos no pueden expresar aparecen
 * apagados, con la razón en ⓘ y no con un botón. La previsualización muestra la
 * forma elegida y lo rara que fue antes de armar nada.
 */
export function Escenarios({
  scenarios,
  plan,
  notice,
  busy,
  onRun,
}: {
  scenarios: readonly ScenarioView[];
  plan: ScenarioPlan | null;
  notice: string | null;
  busy: string | null;
  onRun: (
    name: string,
    windowMs: number,
    params: Record<string, number | string>,
    apply: boolean,
  ) => Promise<void>;
}): ReactElement {
  const [windowSeconds, setWindowSeconds] = useState('60');
  const [shockSize, setShockSize] = useState('40');
  const [shockDirection, setShockDirection] = useState<'1' | '-1'>('1');
  const [chosen, setChosen] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const scenario = scenarios.find((s) => s.name === chosen) ?? null;
  const numbers = (): Record<string, number> =>
    Object.fromEntries(
      (scenario?.parameters ?? []).map((p) => [
        p.name,
        Number(params[p.name] ?? String(p.default)),
      ]),
    );
  return (
    <Section title={es.lab.scenarios.title} info={es.lab.scenarios.info}>
      <div
        data-testid="lab-scenarios"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: 6,
          marginBottom: 10,
        }}
      >
        {scenarios.map((s) => (
          <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <button
              type="button"
              data-testid={`lab-scenario-${s.name}`}
              disabled={!s.selectable || busy !== null}
              onClick={() => {
                setChosen(s.name);
                setParams({});
              }}
              style={{
                flex: 1,
                textAlign: 'left',
                background: chosen === s.name ? '#1f2a3a' : T.raised,
                border: `1px solid ${s.selectable ? (chosen === s.name ? T.accent : T.line) : '#2a2a2a'}`,
                color: s.selectable ? T.text : T.faint,
                padding: '5px 9px',
                fontSize: 11,
                borderRadius: 3,
                cursor: s.selectable ? 'pointer' : 'not-allowed',
                textDecoration: s.selectable ? 'none' : 'line-through',
                font: 'inherit',
              }}
            >
              {es.lab.scenarios.labels[s.name] ?? s.label}
            </button>
            {!s.selectable && (
              <span data-testid={`lab-scenario-why-${s.name}`}>
                <Info
                  label={es.lab.scenarios.whyTitle}
                  text={
                    <>
                      <div>{es.lab.scenarios.why[s.name] ?? s.why}</div>
                      {s.why !== null && <div style={{ marginTop: 6, opacity: 0.7 }}>{s.why}</div>}
                    </>
                  }
                />
              </span>
            )}
          </span>
        ))}
      </div>
      {scenario !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: 4,
            margin: '6px 0',
          }}
        >
          <Field label={es.lab.scenarios.window} width={80}>
            <input
              data-testid="lab-scenario-window"
              value={windowSeconds}
              onChange={(e) => setWindowSeconds(e.target.value)}
              style={FIELD}
            />
          </Field>
          {scenario.parameters.map((p) => (
            <Field key={p.name} label={es.lab.scenarios.params[p.name] ?? p.label} width={150}>
              <input
                data-testid={`lab-scenario-param-${p.name}`}
                value={params[p.name] ?? String(p.default)}
                onChange={(e) => setParams({ ...params, [p.name]: e.target.value })}
                style={FIELD}
              />
            </Field>
          ))}
          <span style={{ display: 'inline-flex', gap: 6, marginBottom: 10 }}>
            <Button
              testId="lab-scenario-preview"
              disabled={busy !== null}
              onClick={() =>
                void onRun(scenario.name, Number(windowSeconds) * 1000, numbers(), false)
              }
            >
              {es.lab.scenarios.preview}
            </Button>
            <Button
              kind="primary"
              testId="lab-scenario-apply"
              disabled={busy !== null}
              onClick={() =>
                void onRun(scenario.name, Number(windowSeconds) * 1000, numbers(), true)
              }
            >
              {es.lab.scenarios.apply}
            </Button>
          </span>
        </div>
      )}
      <div
        data-testid="lab-shock"
        style={{ margin: '10px 0', borderTop: `1px solid ${T.line}`, paddingTop: 8 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            color: T.muted,
            fontSize: 10,
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          {es.lab.scenarios.shock.title.toUpperCase()}
          <Info text={es.lab.scenarios.shock.info} />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 4 }}>
          <Field label={es.lab.scenarios.shock.size} width={110}>
            <input
              data-testid="lab-shock-size"
              value={shockSize}
              onChange={(e) => setShockSize(e.target.value)}
              style={FIELD}
            />
          </Field>
          <Field label={es.lab.scenarios.shock.direction} width={90}>
            <select
              data-testid="lab-shock-direction"
              value={shockDirection}
              onChange={(e) => setShockDirection(e.target.value as '1' | '-1')}
              style={FIELD}
            >
              <option value="1">{es.lab.scenarios.shock.up}</option>
              <option value="-1">{es.lab.scenarios.shock.down}</option>
            </select>
          </Field>
          <Field label={es.lab.scenarios.window} width={80}>
            <input
              data-testid="lab-shock-window"
              value={windowSeconds}
              onChange={(e) => setWindowSeconds(e.target.value)}
              style={FIELD}
            />
          </Field>
          <span style={{ display: 'inline-flex', gap: 6, marginBottom: 10 }}>
            <Button
              testId="lab-shock-preview"
              disabled={busy !== null}
              onClick={() =>
                void onRun(
                  'shock',
                  Number(windowSeconds) * 1000,
                  { size: Number(shockSize), direction: Number(shockDirection) },
                  false,
                )
              }
            >
              {es.lab.scenarios.shock.preview}
            </Button>
            <Button
              kind="primary"
              testId="lab-shock-apply"
              disabled={busy !== null}
              onClick={() =>
                void onRun(
                  'shock',
                  Number(windowSeconds) * 1000,
                  { size: Number(shockSize), direction: Number(shockDirection) },
                  true,
                )
              }
            >
              {es.lab.scenarios.shock.apply}
            </Button>
          </span>
        </div>
      </div>
      {notice !== null && <Notice testId="lab-scenario-notice">{notice}</Notice>}
      {plan !== null && (
        <div data-testid="lab-scenario-plan">
          <Row
            label={es.lab.scenarios.title.toLowerCase()}
            value={
              plan.scenario === 'shock'
                ? 'shock'
                : (es.lab.scenarios.labels[plan.scenario] ?? plan.scenario)
            }
          />
          {plan.scenario === 'shock' && (
            <Row
              label="shock"
              value={
                plan.shockAt === null || plan.shockAt === undefined
                  ? es.lab.scenarios.shock.none
                  : es.lab.scenarios.shock.at(plan.shockAt + 1)
              }
              tone={plan.shockAt === null || plan.shockAt === undefined ? 'warn' : 'ok'}
              testId="lab-shock-at"
            />
          )}
          <Row
            label={es.lab.scenarios.windowRow}
            value={es.lab.scenarios.windowValue(plan.ticksInWindow, when(plan.instant))}
          />
          <Row label={es.lab.close.attempts} value={String(plan.attempts)} />
          <Row
            label={es.lab.close.rate}
            value={plan.acceptanceRate === 0 ? '0' : plan.acceptanceRate.toFixed(6)}
            info={es.lab.close.rateInfo}
          />
          {plan.shape !== null && (
            <Row
              label={es.lab.scenarios.shape}
              value={es.lab.scenarios.shapeValue(
                plan.shape.net,
                plan.shape.high,
                plan.shape.low,
                plan.shape.range,
                plan.shape.directionChanges,
              )}
            />
          )}
          <Row
            label="armado"
            value={plan.armed ? es.lab.scenarios.armedYes : es.lab.close.armedNo}
            tone={plan.armed ? 'ok' : undefined}
          />
          {plan.impossible !== null && (
            <Notice tone="warn" detail={plan.impossible}>
              {es.lab.scenarios.noneFound}
            </Notice>
          )}
        </div>
      )}
    </Section>
  );
}
