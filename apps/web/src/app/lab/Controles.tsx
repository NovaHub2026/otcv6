'use client';

import type { ReactElement, ReactNode } from 'react';
import { es } from '../../lib/es.js';
import { formatCountdown } from '../../lib/countdown.js';
import { FIELD, Info, T } from '../ui/kit.js';
import { PUSH_SIZES } from './Empujar.js';
import type {
  BetweenLevels,
  CloseCondition,
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
 * typed or picked with a click on the chart (PH-24.21, marked there), the
 * condition as three windows — `=` exactly at the mark, `▲` any price above,
 * `▼` any price below — and one button that reads «Fijar cierre» until a close
 * is armed and «×» while it is.
 *
 * No status line, no unit label, no landing announcement: the bar's price and
 * state, and the chart, are the feedback. Two exceptions, both state rather
 * than data: SUBIENDO / BAJANDO on the push card while a push or a held
 * direction is in force (PH-24.21), and a refusal, in red, while it applies.
 */
function Card({
  title,
  info,
  testId,
  aside,
  children,
}: {
  title: string;
  info: string;
  testId: string;
  /** PH-24.21: a state beside the title — SUBIENDO / BAJANDO. */
  aside?: ReactNode;
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
      <div
        style={{
          color: T.text,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.5,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>
          {title} <Info text={info} />
        </span>
        {aside}
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
  options: readonly { key: K; label: string; title?: string }[];
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
          title={o.title}
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

const PACES: readonly { key: Pace; label: string }[] = [
  { key: 'normal', label: es.lab.push.pace.normal },
  { key: 'medio', label: es.lab.push.pace.medio },
  { key: 'rapido', label: es.lab.push.pace.rapido },
];

const BUCKETS: readonly { key: 'current' | 'next'; label: string }[] = [
  { key: 'current', label: es.lab.panel.close.current },
  { key: 'next', label: es.lab.panel.close.next },
];

/** PH-24.21: where the candle must end relative to the mark. */
const CONDITIONS: readonly { key: CloseCondition; label: string; title: string }[] = [
  { key: 'exact', label: '=', title: es.lab.panel.close.conditions.exact },
  { key: 'above', label: '▲', title: es.lab.panel.close.conditions.above },
  { key: 'below', label: '▼', title: es.lab.panel.close.conditions.below },
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
  condition,
  onCondition,
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
  /** PH-24.21: = ▲ ▼ — where the candle must end relative to the mark. */
  condition: CloseCondition;
  onCondition: (value: CloseCondition) => void;
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
  // PH-24.21: the direction in force — a push playing, or sube / baja held.
  const direction: 1 | -1 | null = pushing?.direction ?? bias;
  // PH-24.24: a sustained direction always ends, and says when. The toggle
  // carries what is left of it, so the operator never has to remember.
  // Only when the Lab actually said how long is left: rendering a missing field
  // as «sube 0:00» would be a claim about a bias that is still running.
  const msLeft = control?.biasMsLeft;
  const biasLeft =
    bias === null || typeof msLeft !== 'number' || msLeft <= 0 ? null : formatCountdown(msLeft);
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
      <Card
        title={p.cards.push}
        info={p.pushInfo}
        testId="lab-card-push"
        aside={
          direction !== null && (
            <span
              data-testid="lab-push-direction"
              style={{ color: direction === 1 ? T.ok : T.bad, fontSize: 11, letterSpacing: 1 }}
            >
              {direction === 1 ? p.rising : p.falling}
            </span>
          )
        }
      >
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
            {bias === 1 && biasLeft !== null ? (
              <span data-testid="lab-direction-left">{`${es.lab.push.bias.up} ${biasLeft}`}</span>
            ) : (
              es.lab.push.bias.up
            )}
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
            {bias === -1 && biasLeft !== null ? (
              <span data-testid="lab-direction-left">{`${es.lab.push.bias.down} ${biasLeft}`}</span>
            ) : (
              es.lab.push.bias.down
            )}
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
        <input
          data-testid="lab-close-price"
          value={price}
          onChange={(e) => onPrice(e.target.value)}
          placeholder={now ?? ''}
          aria-label={p.close.price}
          title={p.close.pick}
          inputMode="decimal"
          style={{ ...FIELD, width: '100%', boxSizing: 'border-box' }}
        />
        <Windows
          options={CONDITIONS}
          value={condition}
          onChange={onCondition}
          testPrefix="lab-close-condition"
        />
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
