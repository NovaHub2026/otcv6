'use client';

import type { ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Button, Info, Row, Section, T } from '../ui/kit.js';
import type { Quality } from './labApi.js';

/**
 * Calidad (§52–§68): el laboratorio que llevaba ocho fases corriendo sin
 * ventana, con la resolución y la cuenta junto al veredicto.
 *
 * Ninguna de las tres palabras es «limpio» a secas: «limpio» y «limpio a una
 * resolución declarada» son afirmaciones distintas y solo la segunda se puede
 * usar (`VALIDATION.md`; CA7-05). El realismo es una lectura en este fork, no
 * un veredicto: tres forks del mismo mercado midieron 14/15, 15/15, 15/15.
 */
const VERDICT: Record<Quality['predictability']['verdict'], string> = es.lab.quality.verdict;

export function QualityPanel({
  quality,
  busy,
  onRun,
}: {
  quality: Quality | null;
  busy: boolean;
  onRun: () => Promise<void>;
}): ReactElement {
  return (
    <Section
      title={es.lab.quality.title}
      right={
        <Button testId="lab-quality" disabled={busy} onClick={() => void onRun()} small>
          {busy ? es.lab.quality.running : es.lab.quality.run}
        </Button>
      }
    >
      {quality === null ? (
        <div style={{ color: T.faint, fontSize: 12 }}>—</div>
      ) : (
        <div data-testid="lab-quality-result">
          <Row
            label={es.lab.quality.realism}
            value={es.lab.quality.realismValue(quality.realism.passed, quality.realism.of)}
            tone={quality.realism.failed.length === 0 ? 'ok' : 'warn'}
            info={
              <span data-testid="lab-realism-note">
                <div>{es.lab.quality.realismInfo}</div>
                <div style={{ marginTop: 6, opacity: 0.7 }}>{quality.realism.note}</div>
              </span>
            }
          />
          {quality.realism.failed.length > 0 && (
            <Row label="fuera de banda" value={quality.realism.failed.join(', ')} tone="warn" />
          )}
          <Row
            label={es.lab.quality.predictability}
            value={VERDICT[quality.predictability.verdict]}
            tone={
              quality.predictability.verdict === 'exploitable'
                ? 'bad'
                : quality.predictability.verdict === 'inconclusive'
                  ? 'warn'
                  : 'ok'
            }
          />
          <Row
            label={es.lab.quality.resolution}
            value={es.lab.quality.resolutionValue(
              quality.predictability.resolutionPoints.toFixed(2).replace('.', ','),
            )}
            info={es.lab.quality.resolutionInfo}
          />
          <Row
            label={es.lab.quality.hypotheses}
            value={es.lab.quality.hypothesesValue(
              quality.predictability.hypothesesTested,
              quality.predictability.minimumHypotheses,
            )}
            info={es.lab.quality.hypothesesInfo}
          />
          <Row
            label={es.lab.quality.sample}
            value={String(quality.sampledTicks)}
            info={
              <span data-testid="lab-quality-caveat">
                <div>{es.lab.quality.sampleInfo}</div>
                <div style={{ marginTop: 6, opacity: 0.7 }}>{quality.bounded}</div>
              </span>
            }
          />
          <div
            style={{
              marginTop: 6,
              display: 'flex',
              alignItems: 'center',
              color: T.faint,
              fontSize: 11,
            }}
          >
            {es.lab.quality.notes}
            <Info
              text={
                <ul data-testid="lab-quality-notes" style={{ margin: 0, paddingLeft: 14 }}>
                  {quality.predictability.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              }
            />
          </div>
        </div>
      )}
    </Section>
  );
}
