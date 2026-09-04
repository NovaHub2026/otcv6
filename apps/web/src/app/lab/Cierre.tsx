'use client';

import type { ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Button, Field, FIELD, Notice, Row, Section, T } from '../ui/kit.js';
import {
  CLOSE_TIMEFRAMES,
  when,
  type BetweenLevels,
  type ClosePlan,
  type CloseTimeframe,
  type Control,
} from './labApi.js';

/**
 * Cierre de vela (§19–§37), sobre una vela real (PH-24.2), en español y con
 * las explicaciones detrás de ⓘ (PH-24.6).
 *
 * Los estados quedan a la vista — ARMADO, EXACTO, FALLÓ, FUERA DEL RANGO —
 * y un precio ofrecido como vecino es un acto: aplicarlo donde pertenece su
 * plan (a la expiración de una posición tras un preset, no a la vela que
 * muestren los selectores).
 */
export function Cierre({
  timeframe,
  onTimeframe,
  bucket,
  onBucket,
  expiryTime,
  onExpiryTime,
  price,
  onPrice,
  onPreview,
  onApply,
  onNeighbour,
  onDelta,
  onRelease,
  busy,
  plan,
  notice,
  control,
  displayPrecision,
}: {
  timeframe: CloseTimeframe;
  onTimeframe: (value: CloseTimeframe) => void;
  bucket: 'current' | 'next' | 'expiry';
  onBucket: (value: 'current' | 'next' | 'expiry') => void;
  expiryTime: string;
  onExpiryTime: (value: string) => void;
  price: string;
  onPrice: (value: string) => void;
  onPreview: () => Promise<void>;
  onApply: () => Promise<void>;
  /** A reachable price the Lab offered: applying it is the act, where the plan belongs. */
  onNeighbour: (level: string) => Promise<void>;
  /** N lattice steps from where the market stands when armed; `apply` false previews. */
  onDelta: (delta: number, apply: boolean) => Promise<void>;
  onRelease: () => Promise<void>;
  busy: string | null;
  plan: ClosePlan | null;
  notice: BetweenLevels | string | null;
  control: Control | null;
  displayPrecision: number;
}): ReactElement {
  const armed = control?.armed ?? false;
  const reasonOf = (p: ClosePlan): string | null => {
    if (p.impossible === null) return null;
    if (/parity/.test(p.impossible)) return es.lab.close.parity;
    const range = /at most (\d+) lattice steps and the target is (\d+) away/.exec(p.impossible);
    if (range) return es.lab.close.range(range[1]!, range[2]!);
    if (/No ticks remain|No tick falls/.test(p.impossible)) return es.lab.close.noTicks;
    return es.lab.close.noneFound;
  };
  return (
    <Section title={es.lab.close.title} info={es.lab.close.info}>
      <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 4 }}>
        <Field label={es.lab.close.timeframe}>
          <select
            data-testid="lab-close-timeframe"
            value={timeframe}
            onChange={(e) => onTimeframe(e.target.value as CloseTimeframe)}
            style={FIELD}
          >
            {CLOSE_TIMEFRAMES.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </Field>
        <Field label={es.lab.close.bucket}>
          <select
            data-testid="lab-close-bucket"
            value={bucket}
            onChange={(e) => onBucket(e.target.value as 'current' | 'next' | 'expiry')}
            style={FIELD}
          >
            <option value="current">{es.lab.close.current}</option>
            <option value="next">{es.lab.close.next}</option>
            <option value="expiry">{es.lab.close.atTime}</option>
          </select>
        </Field>
        {bucket === 'expiry' && (
          <Field label={es.lab.close.expiryTime} info={es.lab.close.expiryInfo} width={110}>
            <input
              data-testid="lab-close-expiry"
              value={expiryTime}
              placeholder="16:45:00"
              onChange={(e) => onExpiryTime(e.target.value)}
              style={FIELD}
            />
          </Field>
        )}
        <Field label={es.lab.close.price} width={170}>
          <input
            data-testid="lab-close-price"
            value={price}
            placeholder={`${String(displayPrecision)} decimales`}
            onChange={(e) => onPrice(e.target.value)}
            style={FIELD}
          />
        </Field>
        <span style={{ display: 'inline-flex', gap: 6, marginBottom: 10 }}>
          <Button
            testId="lab-close-preview"
            disabled={busy !== null}
            onClick={() => void onPreview()}
          >
            {busy === 'preview' ? '…' : es.lab.close.preview}
          </Button>
          <Button
            kind="primary"
            testId="lab-close-apply"
            disabled={busy !== null || price.trim().length === 0}
            onClick={() => void onApply()}
          >
            {busy === 'apply' ? '…' : es.lab.close.apply}
          </Button>
          <Button
            kind="danger"
            testId="lab-close-release"
            disabled={busy !== null || !armed}
            onClick={() => void onRelease()}
            title={es.lab.close.releaseInfo}
          >
            {es.lab.close.release}
          </Button>
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          margin: '2px 0 10px',
          flexWrap: 'wrap',
        }}
        data-testid="lab-close-relative"
      >
        <span style={{ color: T.faint, fontSize: 11 }}>{es.lab.close.relative}</span>
        {[-3, -2, -1].map((d) => (
          <Button
            key={d}
            small
            kind="danger"
            testId={`lab-close-delta-${String(d)}`}
            disabled={busy !== null}
            onClick={() => void onDelta(d, true)}
          >
            {String(d)}
          </Button>
        ))}
        <span style={{ color: T.line }}>|</span>
        {[1, 2, 3].map((d) => (
          <Button
            key={d}
            small
            kind="primary"
            testId={`lab-close-delta-+${String(d)}`}
            disabled={busy !== null}
            onClick={() => void onDelta(d, true)}
          >
            +{String(d)}
          </Button>
        ))}
        <span style={{ color: T.faint, fontSize: 11 }}>{es.lab.close.relativeUnit}</span>
      </div>

      <div data-testid="lab-control" style={{ margin: '6px 0 8px' }}>
        <Row
          label={es.lab.close.source}
          value={armed ? es.lab.close.armed(control?.remaining ?? 0) : es.lab.close.keystream}
          tone={armed ? 'warn' : undefined}
          info={es.lab.close.releaseInfo}
        />
        {control?.lastApplied !== null && control?.lastApplied !== undefined && (
          <Row
            label={es.lab.close.lastApplied}
            tone={
              control.lastApplied.exact === null
                ? undefined
                : control.lastApplied.exact
                  ? 'ok'
                  : 'bad'
            }
            value={
              control.lastApplied.closedPrice === null
                ? es.lab.close.pending(
                    control.lastApplied.targetPrice,
                    when(control.lastApplied.instant),
                  )
                : es.lab.close.outcome(
                    control.lastApplied.targetPrice,
                    control.lastApplied.closedPrice,
                    control.lastApplied.exact === true,
                  )
            }
            info={control.lastApplied.onBoundary === true ? es.lab.close.onBoundary : undefined}
            testId={
              control.lastApplied.onBoundary === true
                ? 'lab-close-on-boundary'
                : 'lab-close-outcome'
            }
          />
        )}
      </div>

      {typeof notice === 'string' && <Notice testId="lab-close-notice">{notice}</Notice>}
      {notice !== null && typeof notice !== 'string' && (
        <Notice testId="lab-close-notice">
          {es.lab.close.between(notice.message.split(' ')[0] ?? '')}{' '}
          {[notice.below, notice.above].map((level) => (
            <Button
              key={level}
              small
              testId="lab-close-neighbour"
              onClick={() => void onNeighbour(level)}
            >
              {level}
            </Button>
          ))}
        </Notice>
      )}

      {plan !== null && (
        <div data-testid="lab-close-plan" style={{ marginTop: 6 }}>
          <Row label={es.lab.close.target} value={plan.price} />
          <Row label={es.lab.close.closesAt} value={when(plan.instant)} />
          <Row label={es.lab.close.ticks} value={String(plan.ticksInWindow)} />
          <Row label={es.lab.close.steps} value={String(plan.delta)} />
          <Row
            label={es.lab.close.reach}
            value={es.lab.close.reachValue[plan.reachability] ?? plan.reachability}
            tone={
              plan.reachability === 'outside-natural-range'
                ? 'bad'
                : plan.reachability === 'easy'
                  ? 'ok'
                  : undefined
            }
          />
          <Row label={es.lab.close.attempts} value={String(plan.attempts)} />
          <Row
            label={es.lab.close.rate}
            value={plan.acceptanceRate === 0 ? '0' : plan.acceptanceRate.toFixed(6)}
            info={es.lab.close.rateInfo}
          />
          <Row
            label="armado"
            value={plan.armed ? es.lab.close.armedYes : es.lab.close.armedNo}
            tone={plan.armed ? 'ok' : undefined}
          />
          {plan.adjusted !== undefined && plan.adjusted !== null && (
            <Notice tone="warn" testId="lab-close-adjusted">
              {es.lab.close.adjusted(plan.adjusted.requested, plan.adjusted.applied)}
            </Notice>
          )}
          {plan.impossible !== null && (
            <Notice tone="warn" detail={plan.impossible}>
              {reasonOf(plan)}{' '}
              {plan.reachableNeighbours !== null &&
                plan.reachableNeighbours.map((level) => (
                  <Button
                    key={level}
                    small
                    testId="lab-close-neighbour"
                    onClick={() => void onNeighbour(level)}
                  >
                    {level}
                  </Button>
                ))}
            </Notice>
          )}
        </div>
      )}
      <div style={{ color: T.faint, fontSize: 10, marginTop: 8 }}>ADR-0017 · PH-24.2</div>
    </Section>
  );
}
