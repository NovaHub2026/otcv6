'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  createAsset,
  fetchArchetypes,
  fetchRegistration,
  type ArchetypeEntry,
  type RegistrationJobView,
} from '../../../lib/api.js';

/**
 * Creating an asset: a brief, and then a wait.
 *
 * ## Why this screen is mostly a progress report
 *
 * Registration is a job with six stages, four of them simulation, running for
 * seconds to tens of seconds depending on the family. The form is small because
 * the brief is small; the screen is large because **the refusals are the
 * product**. Each stage names itself, and an operator who is told "the
 * personality solve could not reach the target tail weight from this ladder" can
 * act, where one told "rejected" cannot.
 *
 * ## What is not on this form
 *
 * A price path. A drift. A target. A payout. The only quantity here that
 * describes movement is a **quarterly dispersion budget** — how far the market
 * travels, never which way — and the process is a martingale, so there is
 * nothing for a direction to attach to (INV-001, INV-006).
 *
 * The personality is drawn from the family's region rather than typed, which is
 * also a product decision rather than a convenience: twenty hand-authored
 * near-identical markets are one market with twenty names, and INV-007 says
 * assets have genuinely distinct statistical personalities.
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
    setSubmitting(true);
    try {
      const started = await createAsset(apiBase, {
        id: id.trim(),
        archetypeId,
        displayName: displayName.trim(),
        referencePrice: Number(referencePrice),
        ...(dispersion.trim() === '' ? {} : { dispersion: Number(dispersion) }),
      });
      // Poll rather than stream: a registration reports six discrete stages over
      // seconds to tens of seconds, and a second-resolution poll shows them. An
      // event stream would be a second transport for one screen's benefit.
      if (polling.current !== null) clearInterval(polling.current);
      polling.current = setInterval(() => {
        fetchRegistration(apiBase, started.job)
          .then((view) => {
            setJob(view);
            if (view.state !== 'queued' && view.state !== 'running' && polling.current !== null) {
              clearInterval(polling.current);
              polling.current = null;
            }
          })
          .catch(() => {
            /* a poll that fails is retried by the next one */
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
    <div style={{ padding: 24, overflowY: 'auto', maxWidth: 760 }}>
      <h1 style={{ fontSize: 16, fontWeight: 500, margin: '0 0 4px' }}>Create an asset</h1>
      <p style={{ color: '#8b93a7', margin: '0 0 20px', lineHeight: 1.6 }}>
        A registration is a job, not an insert: six stages, four of them simulation, seconds to tens
        of seconds depending on the family. Each stage can refuse, and says so by name.
      </p>

      {error !== null && (
        <div
          data-testid="create-error"
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

      <Field label="Id" hint="lowercase, becomes a filename and a key-derivation label">
        <input
          data-testid="field-id"
          value={id}
          onChange={(event) => {
            setId(event.target.value);
          }}
          placeholder="eurchf"
          style={INPUT}
        />
      </Field>

      <Field label="Display name" hint="shown on the chart; never compared against">
        <input
          data-testid="field-displayName"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
          placeholder="EUR/CHF"
          style={INPUT}
        />
      </Field>

      <Field label="Family" hint="the region the personality is drawn from">
        <select
          data-testid="field-archetype"
          value={archetypeId}
          onChange={(event) => {
            setArchetypeId(event.target.value);
          }}
          style={INPUT}
        >
          {(archetypes ?? []).map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        {chosen !== null && (
          <div style={{ color: '#8b93a7', marginTop: 6, lineHeight: 1.5 }}>
            {chosen.character} · a quarter spans {(100 * chosen.dispersion.minPercent).toFixed(0)}–
            {(100 * chosen.dispersion.maxPercent).toFixed(0)}% unless you set one below
          </div>
        )}
      </Field>

      <Field label="Reference price" hint="the display price at the lattice origin">
        <input
          data-testid="field-referencePrice"
          value={referencePrice}
          onChange={(event) => {
            setReferencePrice(event.target.value);
          }}
          style={INPUT}
        />
      </Field>

      <Field
        label="Quarterly dispersion (optional)"
        hint="σ of the log return over 90 days — how far it travels, never which way"
      >
        <input
          data-testid="field-dispersion"
          value={dispersion}
          onChange={(event) => {
            setDispersion(event.target.value);
          }}
          placeholder={chosen === null ? '' : chosen.dispersion.min.toFixed(3)}
          style={INPUT}
        />
      </Field>

      <button
        type="button"
        data-testid="create-submit"
        disabled={submitting || running}
        onClick={() => {
          void submit();
        }}
        style={{
          marginTop: 8,
          padding: '8px 16px',
          background: submitting || running ? '#242c3d' : '#3fb950',
          color: submitting || running ? '#8b93a7' : '#0b0e14',
          border: 'none',
          font: 'inherit',
          cursor: submitting || running ? 'default' : 'pointer',
        }}
      >
        {running ? 'Registering…' : 'Register'}
      </button>

      {job !== null && <JobReport job={job} />}
    </div>
  );
}

function JobReport({ job }: { job: RegistrationJobView }): ReactElement {
  const colour =
    job.state === 'registered' ? '#3fb950' : job.state === 'running' ? '#e3b341' : '#f85149';
  return (
    <div
      data-testid="job-report"
      style={{ marginTop: 24, borderTop: '1px solid #242c3d', paddingTop: 16 }}
    >
      <div data-testid="job-state" style={{ color: colour, marginBottom: 10 }}>
        {job.state}
        {job.assetId === null ? '' : ` — ${job.assetId}`}
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', lineHeight: 1.9 }}>
        {STAGES.map((stage) => {
          const refused =
            job.stage === stage && (job.state === 'refused' || job.state === 'failed');
          const done = job.state === 'registered';
          return (
            <li key={stage} style={{ color: refused ? '#f85149' : done ? '#3fb950' : '#8b93a7' }}>
              {refused ? '✕' : done ? '✓' : '·'} {stage}
            </li>
          );
        })}
      </ol>
      {job.reason !== null && (
        // Verbatim. The pipeline's own words are the whole value of a refusal,
        // and a screen that summarised them would be discarding the reason it
        // asked for one.
        <p
          data-testid="job-reason"
          style={{ color: '#f85149', lineHeight: 1.6, marginTop: 12, whiteSpace: 'pre-wrap' }}
        >
          {job.reason}
        </p>
      )}
      {job.state === 'registered' && (
        <p style={{ marginTop: 12 }}>
          <a href="/preview" style={{ color: '#3fb950' }}>
            watch it →
          </a>
        </p>
      )}
    </div>
  );
}

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  background: '#0b0e14',
  border: '1px solid #242c3d',
  color: '#d7dce5',
  font: 'inherit',
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <label style={{ display: 'block', marginBottom: 16 }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ color: '#5b6377', marginBottom: 6, fontSize: 12 }}>{hint}</div>
      {children}
    </label>
  );
}
