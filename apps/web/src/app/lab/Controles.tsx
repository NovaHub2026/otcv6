'use client';

import type { ReactElement, ReactNode } from 'react';
import { exp, ln } from '@otc/core/browser';
import { es } from '../../lib/es.js';
import { FIELD, Info, T } from '../ui/kit.js';
import { PUSH_SIZES } from './Empujar.js';
import type {
  BetweenLevels,
  ClosePlan,
  CloseTimeframe,
  Control,
  LabState,
  Pace,
} from './labApi.js';

/**
 * The control column (PH-24.20): two cards, controls and nothing else.
 *
 * **Empuje** — the pace as three windows; a green row, +1 +3 +5 +10 and
 * «sube»; a red row, +1 +3 +5 +10 and «baja». Sube and baja are toggles: one
 * pressed holds the direction (PH-24.16), pressed again lets it go, and with
 * neither pressed the market is free — there is no «libre» button because
 * that is the resting state. **Cierre de vela** — the candle as two windows
 * (vela actual · próxima vela) on the chart's own timeframe, a price box with
 * `=` (the price now), `▲` and `▼` (one unit, PH-24.18), and one button that
 * reads «Fijar cierre» until a close is armed and «×» while it is.
 *
 * No status line, no unit label, no landing announcement: the bar's price and
 * state, and the chart, are the feedback. A refusal is the one thing said, in
 * red, only while it applies.
 */
function Card({
  title,
  info,
  testId,
  children,
}: {
  title: string;
  info: string;
  testId: string;
  children: ReactNode;
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
        {title} <Info text={info} />
      </div>
      {children}
    </section>
  );
}

/** A row of windows: exactly one is open. */
function Windows<K extends string>({
  options,
  value,
  onChange,
  testPrefix,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  testPrefix: string;
}): ReactElement {
  return (
    <div
      role="group"
      style={{
        display: 'flex',
        border: `1px solid ${T.line}`,
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          data-testid={`${testPrefix}-${o.key}`}
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          style={{
            font: 'inherit',
            flex: 1,
            padding: '6px 0',
            background: value === o.key ? T.line : 'transparent',
            color: value === o.key ? T.text : T.muted,
            border: 'none',
            fontSize: 12,
            fontWeight: value === o.key ? 700 : 400,
            cursor: 'pointer',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TONES = {
  up: { border: T.ok, fill: '#1f3a2a' },
  down: { border: T.bad, fill: '#3a1f1f' },
} as const;

/** A push button or a direction toggle, in its side's colour; lit while pressed. */
function Key({
  side,
  testId,
  pressed,
  disabled = false,
  title,
  block = false,
  onClick,
  children,
}: {
  side: 'up' | 'down';
  testId: string;
  pressed?: boolean | undefined;
  disabled?: boolean | undefined;
  title?: string | undefined;
  block?: boolean | undefined;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  const tone = TONES[side];
  const lit = pressed === true;
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        font: 'inherit',
        flex: block ? undefined : pressed === undefined ? 1 : 1.5,
        width: block ? '100%' : undefined,
        padding: '7px 0',
        background: lit ? tone.border : tone.fill,
        border: `1px solid ${tone.border}`,
        color: disabled ? T.faint : lit ? T.bg : T.text,
        fontSize: 12,
        fontWeight: lit ? 700 : 500,
        borderRadius: 3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** A small neutral key beside the price box: = ▲ ▼. */
function Tool({
  testId,
  title,
  disabled = false,
  onClick,
  children,
}: {
  testId: string;
  title: string;
  disabled?: boolean | undefined;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        font: 'inherit',
        width: 32,
        background: T.raised,
        border: `1px solid ${T.line}`,
        color: disabled ? T.faint : T.text,
        fontSize: 12,
        borderRadius: 3,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

const PACES: readonly { key: Pace; label: string }[] = [
  { key: 'normal', label: es.lab.push.pace.normal },
  { key: 'medio', label: es.lab.push.pace.medio },
  { key: 'rapido', label: es.lab.push.pace.rapido },
];

const BUCKETS: readonly { key: 'current' | 'next'; label: string }[] = [
  { key: 'current', label: es.lab.panel.close.current },
  { key: 'next', label: es.lab.panel.close.next },
];

export function Controles({
  state,
  control,
  pushError,
  busy,
  onPush,
  pace,
  onPace,
  onBias,
  closeTimeframe,
  bucket,
  onBucket,
  price,
  onPrice,
  onApply,
  onRelease,
  plan,
  notice,
}: {
  state: LabState | null;
  control: Control | null;
  pushError: string | null;
  busy: string | null;
  onPush: (units: number) => Promise<void>;
  pace: Pace;
  onPace: (pace: Pace) => void;
  onBias: (direction: 'up' | 'down' | 'off') => Promise<void>;
  /** The chart's timeframe when the close can address it; null on 30m and wider. */
  closeTimeframe: CloseTimeframe | null;
  bucket: 'current' | 'next' | 'expiry';
  onBucket: (value: 'current' | 'next') => void;
  price: string;
  onPrice: (value: string) => void;
  /** With a price, fixes there; without one, at the price the market stands at. */
  onApply: (at?: string) => Promise<void>;
  onRelease: () => Promise<void>;
  plan: ClosePlan | null;
  notice: BetweenLevels | string | null;
}): ReactElement {
  const p = es.lab.panel;
  const bias = control?.bias ?? null;
  const pushing = control?.pushing ?? null;
  // Held only by its own act (PH-24.11): never by a quality run, never by an armed close.
  const held = busy === 'push';
  const armedClose = (control?.armed ?? false) && pushing === null;
  const now = state?.price;
  // ▲ ▼ move the box one unit (PH-24.18) from what it holds, or from the price
  // now — along the lattice, with the kernel's own conversions (the same
  // formulas as `fromDisplayPrice` / `toDisplayPrice`, portable `ln` and `exp`),
  // so the box always holds a level that renders back to itself. A price plus a
  // fixed increment lands between two levels two times in three at EUR/USD's
  // grain, and a close asked there is refused.
  const stepped = (direction: 1 | -1): string => {
    const base = price.trim() === '' ? now : price.trim();
    const steps = state?.distance?.unitSteps;
    const lattice = state?.instrument;
    if (base === undefined || steps === undefined || lattice === undefined) return price;
    const from = Number(base);
    if (!Number.isFinite(from) || from <= 0) return price;
    const level = Math.round(ln(from / lattice.referencePrice) / lattice.logQuantum);
    const target = level + direction * steps;
    return (lattice.referencePrice * exp(lattice.logQuantum * target)).toFixed(
      lattice.displayPrecision,
    );
  };
  // A refusal, in one line: a push running, a typed price between two levels
  // (the two named), an unreachable target.
  const refusal =
    typeof notice === 'string'
      ? notice
      : notice !== null
        ? `${es.lab.close.between(notice.message.split(' ')[0] ?? '')} ${notice.below} · ${notice.above}`
        : plan?.impossible !== null && plan?.impossible !== undefined
          ? /parity/.test(plan.impossible)
            ? es.lab.close.parity
            : plan.impossible
          : null;
  return (
    <div
      data-testid="lab-controls"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, overflowY: 'auto' }}
    >
      <Card title={p.cards.push} info={p.pushInfo} testId="lab-card-push">
        <Windows options={PACES} value={pace} onChange={onPace} testPrefix="lab-pace" />
        <div style={{ display: 'flex', gap: 4 }}>
          {PUSH_SIZES.map((n) => (
            <Key
              key={n}
              side="up"
              testId={`lab-push-+${String(n)}`}
              disabled={held}
              onClick={() => void onPush(n)}
            >
              {`+${String(n)}`}
            </Key>
          ))}
          <Key
            side="up"
            testId="lab-direction-up"
            pressed={bias === 1}
            disabled={busy === 'bias'}
            title={es.lab.push.bias.info}
            onClick={() => void onBias(bias === 1 ? 'off' : 'up')}
          >
            {es.lab.push.bias.up}
          </Key>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {PUSH_SIZES.map((n) => (
            <Key
              key={n}
              side="down"
              testId={`lab-push--${String(n)}`}
              disabled={held}
              onClick={() => void onPush(-n)}
            >
              {`+${String(n)}`}
            </Key>
          ))}
          <Key
            side="down"
            testId="lab-direction-down"
            pressed={bias === -1}
            disabled={busy === 'bias'}
            title={es.lab.push.bias.info}
            onClick={() => void onBias(bias === -1 ? 'off' : 'down')}
          >
            {es.lab.push.bias.down}
          </Key>
        </div>
        {pushError !== null && (
          <div data-testid="lab-push-error" style={{ fontSize: 11, color: T.bad }}>
            {pushError}
          </div>
        )}
      </Card>
      <Card title={p.cards.close} info={p.close.info} testId="lab-card-close">
        <Windows
          options={BUCKETS}
          value={bucket === 'expiry' ? 'current' : bucket}
          onChange={onBucket}
          testPrefix="lab-close-bucket"
        />
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            data-testid="lab-close-price"
            value={price}
            onChange={(e) => onPrice(e.target.value)}
            placeholder={now ?? ''}
            aria-label={p.close.price}
            inputMode="decimal"
            style={{ ...FIELD, flex: 1, minWidth: 0 }}
          />
          <Tool
            testId="lab-close-equal"
            title={p.close.equal}
            disabled={now === undefined}
            onClick={() => onPrice(now ?? '')}
          >
            =
          </Tool>
          <Tool testId="lab-close-up" title={p.close.up} onClick={() => onPrice(stepped(1))}>
            ▲
          </Tool>
          <Tool testId="lab-close-down" title={p.close.down} onClick={() => onPrice(stepped(-1))}>
            ▼
          </Tool>
        </div>
        {armedClose ? (
          <Key
            side="down"
            block
            testId="lab-close-release"
            disabled={busy !== null}
            title={p.close.cancel}
            onClick={() => void onRelease()}
          >
            {`× ${p.close.cancel}`}
          </Key>
        ) : (
          <Key
            side="up"
            block
            testId="lab-close-apply"
            disabled={busy !== null || closeTimeframe === null}
            title={closeTimeframe === null ? p.close.noTimeframe : p.close.apply}
            onClick={() => {
              const at = price.trim() === '' ? now : undefined;
              void onApply(at);
            }}
          >
            {p.close.apply}
          </Key>
        )}
        {refusal !== null && (
          <div data-testid="lab-close-error" style={{ fontSize: 11, color: T.bad }}>
            {refusal}
          </div>
        )}
      </Card>
    </div>
  );
}
