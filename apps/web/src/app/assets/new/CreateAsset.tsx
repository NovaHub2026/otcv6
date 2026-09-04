'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  ApiError,
  createAsset,
  fetchArchetypes,
  fetchRegistration,
  type ArchetypeEntry,
  type RegistrationJobView,
} from '../../../lib/api.js';
import { es } from '../../../lib/es.js';
import { Button, Field, FIELD, Info, Notice, Section, T } from '../../ui/kit.js';

/**
 * Crear un activo: un formulario breve y una espera (PH-20.2, rediseñado en
 * PH-24.6).
 *
 * El formulario es pequeño porque el encargo es pequeño; el informe es grande
 * porque **los rechazos son el producto**: cada etapa se nombra y un rechazo
 * dice por qué con sus propias palabras (a6-06). Lo que no está aquí: un camino
 * de precios, una deriva, un objetivo, un pago — la única cantidad que describe
 * movimiento es la dispersión trimestral, cuánto recorre y nunca hacia dónde
 * (INV-001, INV-006).
 */
const STAGES = [
  'identity',
  'safety',
  'authoring',
  'dispersion',
  'calibration',
  'differentiation',
] as const;

export function CreateAsset({ apiBase }: { apiBase: string }): ReactElement {
  const [archetypes, setArchetypes] = useState<ArchetypeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<RegistrationJobView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [archetypeId, setArchetypeId] = useState('');
  const [referencePrice, setReferencePrice] = useState('100');
  const [dispersion, setDispersion] = useState('');
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchArchetypes(apiBase, controller.signal)
      .then((entries) => {
        setArchetypes(entries);
        setArchetypeId((current) => (current === '' ? (entries[0]?.id ?? '') : current));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError((cause as Error).message);
      });
    return () => {
      controller.abort();
    };
  }, [apiBase]);

  useEffect(
    () => () => {
      if (polling.current !== null) clearInterval(polling.current);
    },
    [],
  );

  const chosen = archetypes?.find((entry) => entry.id === archetypeId) ?? null;

  const submit = async (): Promise<void> => {
    setError(null);
    // Refused here, in the operator's own words, before anything is sent (a6-07).
    const price = numberField(es.create.referencePrice, referencePrice);
    if (price.error !== null) {
      setError(price.error);
      return;
    }
    const budget = dispersion.trim() === '' ? null : numberField(es.create.dispersion, dispersion);
    if (budget !== null && budget.error !== null) {
      setError(budget.error);
      return;
    }
    setSubmitting(true);
    try {
      const started = await createAsset(apiBase, {
        id: id.trim(),
        archetypeId,
        displayName: displayName.trim(),
        referencePrice: price.value,
        ...(budget === null ? {} : { dispersion: budget.value }),
      });
      if (polling.current !== null) clearInterval(polling.current);
      const stop = (): void => {
        if (polling.current !== null) clearInterval(polling.current);
        polling.current = null;
      };
      polling.current = setInterval(() => {
        fetchRegistration(apiBase, started.job)
          .then((view) => {
            setJob(view);
            if (view.state !== 'queued' && view.state !== 'running') stop();
          })
          .catch((cause: unknown) => {
            if (cause instanceof ApiError && cause.status === 404) {
              // The engine restarted and forgot the job (a6-10).
              stop();
              setJob((current) =>
                current === null
                  ? null
                  : { ...current, state: 'failed', stage: null, reason: null },
              );
              setError(es.create.forgot(started.job));
            }
          });
      }, 1_000);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const running = job !== null && (job.state === 'queued' || job.state === 'running');

  return (
    <div style={{ padding: 20, overflowY: 'auto', maxWidth: 720 }}>
      <h1
        style={{
          fontSize: 16,
          fontWeight: 500,
          margin: '0 0 14px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {es.create.title}
        <Info text={es.create.intro} />
      </h1>

      {error !== null && (
        <Notice tone="bad" testId="create-error">
          {error}
        </Notice>
      )}

      <Section title={es.create.title}>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          <Field label={es.create.id} info={es.create.idInfo} width={180}>
            <input
              data-testid="field-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="eurchf"
              style={FIELD}
            />
          </Field>
          <Field label={es.create.displayName} info={es.create.displayNameInfo} width={220}>
            <input
              data-testid="field-displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="EUR/CHF"
              style={FIELD}
            />
          </Field>
          <Field label={es.create.family} info={es.create.familyInfo} width={220}>
            <select
              data-testid="field-archetype"
              value={archetypeId}
              onChange={(e) => setArchetypeId(e.target.value)}
              style={FIELD}
            >
              {(archetypes ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={es.create.referencePrice} info={es.create.referencePriceInfo} width={160}>
            <input
              data-testid="field-referencePrice"
              value={referencePrice}
              onChange={(e) => setReferencePrice(e.target.value)}
              style={FIELD}
            />
          </Field>
          <Field label={es.create.dispersion} info={es.create.dispersionInfo} width={220}>
            <input
              data-testid="field-dispersion"
              value={dispersion}
              onChange={(e) => setDispersion(e.target.value)}
              placeholder={chosen === null ? '' : chosen.dispersion.min.toFixed(3)}
              style={FIELD}
            />
          </Field>
        </div>
        {chosen !== null && (
          <div style={{ color: T.muted, fontSize: 11, margin: '4px 0 10px' }}>
            {chosen.character}
            {' · '}
            {es.create.familyRange(
              (100 * chosen.dispersion.minPercent).toFixed(0),
              (100 * chosen.dispersion.maxPercent).toFixed(0),
            )}
          </div>
        )}
        <Button
          kind="primary"
          testId="create-submit"
          disabled={submitting || running}
          onClick={() => void submit()}
        >
          {running ? es.create.submitting : es.create.submit}
        </Button>
      </Section>

      {job !== null && <JobReport job={job} />}
    </div>
  );
}

function JobReport({ job }: { job: RegistrationJobView }): ReactElement {
  const tone =
    job.state === 'registered'
      ? 'ok'
      : job.state === 'running' || job.state === 'queued'
        ? 'warn'
        : 'bad';
  return (
    <Section title={es.create.state[job.state]} info={es.create.stagesInfo} testId="job-report">
      <div data-testid="job-state" style={{ color: T[tone], marginBottom: 8, fontSize: 13 }}>
        {es.create.state[job.state]}
        {job.assetId === null ? '' : ` — ${job.assetId}`}
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', lineHeight: 1.9, fontSize: 12 }}>
        {STAGES.map((stage) => {
          const refused =
            job.stage === stage && (job.state === 'refused' || job.state === 'failed');
          const done = job.state === 'registered';
          return (
            <li key={stage} style={{ color: refused ? T.bad : done ? T.ok : T.muted }}>
              {refused ? '✕' : done ? '✓' : '·'} {es.create.stages[stage]}
            </li>
          );
        })}
      </ol>
      {job.reason !== null && (
        // Verbatim: the pipeline's own words are the whole value of a refusal.
        <p
          data-testid="job-reason"
          style={{
            color: T.bad,
            lineHeight: 1.6,
            marginTop: 10,
            whiteSpace: 'pre-wrap',
            fontSize: 12,
          }}
        >
          {job.reason}
        </p>
      )}
      {job.state === 'registered' && (
        <p style={{ marginTop: 10 }}>
          <a href="/preview" style={{ color: T.ok }}>
            {es.create.watch}
          </a>
        </p>
      )}
    </Section>
  );
}

/** A typed number, or the reason it is not one — `Number('0,25')` is NaN (a6-07). */
function numberField(
  label: string,
  raw: string,
): { value: number; error: null } | { value: null; error: string } {
  const text = raw.trim();
  const value = Number(text);
  if (text === '' || !Number.isFinite(value) || value <= 0)
    return { value: null, error: es.create.number(label, raw) };
  return { value, error: null };
}
