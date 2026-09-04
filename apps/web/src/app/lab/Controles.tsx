'use client';

import type { ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Badge, Button, Field, FIELD, Info, T } from '../ui/kit.js';
import { Empujar } from './Empujar.js';
import {
  CLOSE_TIMEFRAMES,
  when,
  type BetweenLevels,
  type ClosePlan,
  type CloseTimeframe,
  type Control,
  type LabState,
  type Pace,
  type PushResult,
} from './labApi.js';

/**
 * The control column (PH-24.19): four cards, one act each, one status line
 * each. The instrument — plans, boards, timelines — lives on /lab/avanzado.
 */
function Card({
  title,
  info,
  testId,
  children,
}: {
  title: string;
  info?: string | undefined;
  testId: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <section
      data-testid={testId}
      style={{
        border: `1px solid ${T.line}`,
        borderRadius: 6,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ color: T.text, fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>
        {title} {info !== undefined && <Info text={info} />}
      </div>
      {children}
    </section>
  );
}

export function Controles({
  state,
  control,
  lastPush,
  pushError,
  busy,
  onPush,
  pace,
  onPace,
  onBias,
  timeframe,
  onTimeframe,
  bucket,
  onBucket,
  price,
  onPrice,
  onApply,
  onDelta,
  onNeighbour,
  onRelease,
  plan,
  notice,
  unitSteps,
}: {
  state: LabState | null;
  control: Control | null;
  lastPush: PushResult | null;
  pushError: string | null;
  busy: string | null;
  onPush: (units: number) => Promise<void>;
  pace: Pace;
  onPace: (pace: Pace) => void;
  onBias: (direction: 'up' | 'down' | 'off') => Promise<void>;
  timeframe: CloseTimeframe;
  onTimeframe: (value: CloseTimeframe) => void;
  bucket: 'current' | 'next' | 'expiry';
  onBucket: (value: 'current' | 'next' | 'expiry') => void;
  price: string;
  onPrice: (value: string) => void;
  onApply: () => Promise<void>;
  onDelta: (delta: number, apply: boolean) => Promise<void>;
  onNeighbour: (level: string) => Promise<void>;
  onRelease: () => Promise<void>;
  plan: ClosePlan | null;
  notice: BetweenLevels | string | null;
  unitSteps: number;
}): ReactElement {
  const p = es.lab.panel;
  const bias = control?.bias ?? null;
  const pushing = control?.pushing ?? null;
  const last = control?.lastApplied ?? null;
  const armedClose = (control?.armed ?? false) && pushing === null;
  const closeStatus =
    armedClose && last !== null && last.closedPrice === null
      ? p.close.armed(last.targetPrice, when(last.instant))
      : last !== null && last.closedPrice !== null
        ? last.exact === true
          ? p.close.exact(last.closedPrice)
          : p.close.failed(last.targetPrice, last.closedPrice)
        : p.close.none;
  return (
    <div
      data-testid="lab-controls"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, overflowY: 'auto' }}
    >
      <Card title={p.cards.push} info={es.lab.push.info} testId="lab-card-push">
        <Empujar
          control={control}
          last={lastPush}
          error={pushError}
          busy={busy}
          onPush={onPush}
          pace={pace}
          onPace={onPace}
          onBias={onBias}
          state={state}
          layout="column"
        />
      </Card>
      <Card title={p.cards.pace} info={es.lab.push.pace.info} testId="lab-card-pace">
        <div style={{ display: 'flex', gap: 4 }}>
          {(['normal', 'medio', 'rapido'] as const).map((key) => (
            <Button
              key={key}
              kind={pace === key ? 'primary' : 'ghost'}
              small
              testId={`lab-pace-${key}`}
              onClick={() => onPace(key)}
            >
              {es.lab.push.pace[key]}
            </Button>
          ))}
        </div>
      </Card>
      <Card title={p.cards.direction} info={p.direction.info} testId="lab-card-direction">
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            kind={bias === 1 ? 'primary' : 'ghost'}
            small
            testId="lab-direction-up"
            disabled={busy === 'bias'}
            onClick={() => void onBias('up')}
          >
            {es.lab.push.bias.up}
          </Button>
          <Button
            kind={bias === -1 ? 'danger' : 'ghost'}
            small
            testId="lab-direction-down"
            disabled={busy === 'bias'}
            onClick={() => void onBias('down')}
          >
            {es.lab.push.bias.down}
          </Button>
          <Button
            kind={bias === null ? 'neutral' : 'ghost'}
            small
            testId="lab-direction-free"
            disabled={busy === 'bias'}
            onClick={() => void onBias('off')}
          >
            {p.direction.free}
          </Button>
        </div>
        <Badge tone={bias !== null ? 'lab' : 'muted'} testId="lab-direction-state">
          {bias !== null ? es.lab.push.bias.active(bias === 1 ? 'up' : 'down') : p.free}
        </Badge>
      </Card>
      <Card title={p.cards.close} info={p.close.info} testId="lab-card-close">
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label={es.lab.close.timeframe} width={70}>
            <select
              data-testid="lab-close-timeframe"
              value={timeframe}
              onChange={(e) => onTimeframe(e.target.value as CloseTimeframe)}
              style={FIELD}
            >
              {CLOSE_TIMEFRAMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label={es.lab.close.bucket} width={110}>
            <select
              data-testid="lab-close-bucket"
              value={bucket === 'expiry' ? 'current' : bucket}
              onChange={(e) => onBucket(e.target.value as 'current' | 'next')}
              style={FIELD}
            >
              <option value="current">{es.lab.close.current}</option>
              <option value="next">{es.lab.close.next}</option>
            </select>
          </Field>
        </div>
        <Field label={p.close.price} width={160}>
          <input
            data-testid="lab-close-price"
            value={price}
            onChange={(e) => onPrice(e.target.value)}
            placeholder={state?.price ?? ''}
            style={FIELD}
          />
        </Field>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {[-3, -2, -1].map((d) => (
            <Button
              key={d}
              kind="danger"
              small
              testId={`lab-close-delta-${String(d)}`}
              disabled={busy !== null}
              onClick={() => void onDelta(d * unitSteps, true)}
            >
              {String(d)}
            </Button>
          ))}
          {[1, 2, 3].map((d) => (
            <Button
              key={d}
              kind="primary"
              small
              testId={`lab-close-delta-+${String(d)}`}
              disabled={busy !== null}
              onClick={() => void onDelta(d * unitSteps, true)}
            >
              {`+${String(d)}`}
            </Button>
          ))}
          <span style={{ color: T.faint, fontSize: 10 }}>{es.lab.close.relativeUnit}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button
            kind="primary"
            small
            testId="lab-close-apply"
            disabled={busy !== null || price.trim() === ''}
            onClick={() => void onApply()}
          >
            {p.close.apply}
          </Button>
          <Button
            kind="danger"
            small
            testId="lab-close-release"
            disabled={busy !== null || !(control?.armed ?? false)}
            onClick={() => void onRelease()}
          >
            {p.close.release}
          </Button>
        </div>
        <div
          data-testid="lab-close-status"
          style={{
            fontSize: 12,
            color: last?.exact === false ? T.bad : armedClose ? T.lab : T.muted,
          }}
        >
          {closeStatus}
        </div>
        {plan?.adjusted !== undefined && plan.adjusted !== null && (
          <div data-testid="lab-close-adjusted" style={{ fontSize: 11, color: T.warn }}>
            {es.lab.close.adjusted(plan.adjusted.requested, plan.adjusted.applied)}
          </div>
        )}
        {plan?.impossible !== null && plan?.impossible !== undefined && (
          <div style={{ fontSize: 11, color: T.warn, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {/parity/.test(plan.impossible) ? es.lab.close.parity : plan.impossible}
            {(plan.reachableNeighbours ?? []).map((level) => (
              <Button
                key={level}
                small
                testId="lab-close-neighbour"
                onClick={() => void onNeighbour(level)}
              >
                {level}
              </Button>
            ))}
          </div>
        )}
        {typeof notice === 'string' && <div style={{ fontSize: 11, color: T.warn }}>{notice}</div>}
      </Card>
    </div>
  );
}
