'use client';

import type { ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Row, Section } from '../ui/kit.js';
import type { LabState } from './labApi.js';

/**
 * Mercado: el estado interno del motor, con nombres honestos.
 *
 * `price` es el precio mostrado y `latticeLevel` el entero del retículo; los
 * dos van con su nombre (PH-23.5 §6). La dirección del próximo tick es la
 * mitad exacta siempre, y la razón — ADR-0003 — vive en el ⓘ junto con la
 * frase del propio motor.
 */
export function Mercado({ state }: { state: LabState | null }): ReactElement {
  if (state === null) return <Section title={es.lab.tabs.market}>—</Section>;
  const modulators = state.magnitudeState.modulators ?? [];
  const regime = modulators.find((m) => m !== null && 'regime' in m);
  const cascade = modulators.find((m) => m !== null && 'phase' in m);
  const up = (100 * state.direction.up).toFixed(3).replace('.', ',');
  const down = (100 * state.direction.down).toFixed(3).replace('.', ',');
  return (
    <>
      <Section title={es.lab.tabs.market}>
        <Row label={es.lab.market.price} value={state.price} />
        <Row
          label={es.lab.market.lattice}
          value={String(state.latticeLevel)}
          info={es.lab.market.latticeInfo}
        />
        <Row label={es.lab.market.sequence} value={String(state.sequence)} />
        <Row label={es.lab.market.magnitude} value={String(state.previousMagnitude)} />
        <Row label={es.lab.market.interval} value={`${String(state.previousIntervalMs)} ms`} />
        <Row
          label={es.lab.market.net}
          value={es.lab.market.netValue(
            state.netDisplacement?.['1m'] ?? null,
            state.netDisplacement?.['5m'] ?? null,
          )}
          info={es.lab.market.netInfo}
          testId="lab-net-displacement"
        />
        <Row
          label={es.lab.market.regime}
          value={`${regime?.regime ?? '—'}${regime?.remainingMs !== undefined ? ` · ${String(Math.round(regime.remainingMs / 1000))} s` : ''}`}
        />
        <Row
          label={es.lab.market.cascade}
          value={`${cascade?.phase ?? '—'}${cascade?.ageMs !== undefined ? ` · ${String(Math.round(cascade.ageMs / 1000))} s` : ''}`}
        />
        <Row
          label={es.lab.market.direction}
          value={`SUBE ${up} % · BAJA ${down} %`}
          info={
            <>
              <div>{es.lab.market.directionInfo}</div>
              <div style={{ marginTop: 6, opacity: 0.8 }}>{state.direction.why}</div>
            </>
          }
          testId="lab-direction"
        />
      </Section>
      <Section title={es.lab.market.cursors} info={es.lab.market.cursorsInfo} testId="lab-cursors">
        <div style={{ fontSize: 11, color: '#8b93a7', wordBreak: 'break-all', lineHeight: 1.7 }}>
          {Object.entries(state.cursors).map(([name, cursor]) => (
            <div key={name}>
              <span style={{ color: '#5b6377', display: 'inline-block', minWidth: 90 }}>
                {name}
              </span>{' '}
              {cursor}
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
