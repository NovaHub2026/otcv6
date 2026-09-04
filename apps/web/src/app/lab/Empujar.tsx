'use client';

import type { ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Badge, Button, Info, Notice, T } from '../ui/kit.js';
import { formatCountdown } from '../../lib/countdown.js';
import type { Control, LabState, Pace, PushResult } from './labApi.js';

export const PUSH_SIZES = [1, 3, 5, 10] as const;

/**
 * Empujar (PH-24.10): la tira que está en todas las pestañas.
 *
 * Ocho botones, el estado del empuje en curso y, tras un clic, el precio al
 * que llegará el mercado — calculado por el motor sobre una copia, con sus
 * propias magnitudes, porque el Lab elige la dirección y nada más.
 *
 * PH-24.20: la tira vive solo en /lab/avanzado; el panel tiene sus propias
 * teclas (`Controles.tsx`) y comparte con ella `PUSH_SIZES`.
 */
export function Empujar({
  control,
  last,
  error,
  busy,
  onPush,
  pace,
  onPace,
  onBias,
  state,
}: {
  control: Control | null;
  last: PushResult | null;
  error: string | null;
  busy: string | null;
  onPush: (ticks: number) => Promise<void>;
  /** PH-24.15: the pace the next pushes play. */
  pace: Pace;
  onPace: (pace: Pace) => void;
  /** PH-24.16: sube / baja. */
  onBias: (direction: 'up' | 'down' | 'off') => Promise<void>;
  /** PH-24.18: the market's distance unit, for the strip's label. */
  state: LabState | null;
}): ReactElement {
  const p = es.lab.push;
  const pushing = control?.pushing ?? null;
  // Held only by its own act (PH-24.11): never by a quality run, never by an armed close.
  const held = busy === 'push';
  const bias = control?.bias ?? null;
  // PH-24.24: the same countdown the panel's toggles carry — the ⓘ promises it
  // on the button, and this screen has the same buttons.
  const msLeft = control?.biasMsLeft;
  const biasLeft =
    bias === null || typeof msLeft !== 'number' || msLeft <= 0 ? null : formatCountdown(msLeft);
  return (
    <div
      data-testid="lab-push"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        borderBottom: `1px solid ${T.line}`,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      {
        <span style={{ color: T.text, fontSize: 13, fontWeight: 600 }}>
          {p.title} <Info text={p.info} />
        </span>
      }
      <span style={{ color: T.faint, fontSize: 11 }}>{p.down}</span>
      {[...PUSH_SIZES].reverse().map((n) => (
        <Button
          key={`-${String(n)}`}
          kind="danger"
          small
          testId={`lab-push--${String(n)}`}
          disabled={held}
          onClick={() => void onPush(-n)}
        >
          {`−${String(n)}`}
        </Button>
      ))}
      <span style={{ width: 10 }} />
      {PUSH_SIZES.map((n) => (
        <Button
          key={`+${String(n)}`}
          kind="primary"
          small
          testId={`lab-push-+${String(n)}`}
          disabled={held}
          onClick={() => void onPush(n)}
        >
          {`+${String(n)}`}
        </Button>
      ))}
      <span style={{ color: T.faint, fontSize: 11 }}>{p.up}</span>
      {state?.distance !== undefined && (
        <span data-testid="lab-push-unit" style={{ color: T.faint, fontSize: 11, marginLeft: 4 }}>
          {p.unitLabel(state.distance.unitPrice)}{' '}
          <Info
            text={p.unitInfo(
              state.distance.unitPrice,
              (Number(state.distance.unitPrice) * 4).toFixed(
                state.distance.unitPrice.split('.')[1]?.length ?? 0,
              ),
            )}
          />
        </span>
      )}
      {
        <span style={{ color: T.faint, fontSize: 11, marginLeft: 6 }}>
          {p.pace.label} <Info text={p.pace.info} />
        </span>
      }
      {(['normal', 'medio', 'rapido'] as const).map((key) => (
        <button
          key={key}
          type="button"
          data-testid={`lab-push-pace-${key}`}
          onClick={() => onPace(key)}
          style={{
            padding: '2px 8px',
            background: pace === key ? T.line : 'transparent',
            color: pace === key ? T.text : T.muted,
            border: `1px solid ${T.line}`,
            borderRadius: 3,
            font: 'inherit',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {p.pace[key]}
        </button>
      ))}
      {
        <span style={{ color: T.faint, fontSize: 11, marginLeft: 6 }}>
          <Info text={p.bias.info} />
        </span>
      }
      {
        <Button
          kind={bias === 1 ? 'primary' : 'ghost'}
          small
          testId="lab-bias-up"
          disabled={busy === 'bias'}
          onClick={() => void onBias(bias === 1 ? 'off' : 'up')}
        >
          <span data-testid={bias === 1 && biasLeft !== null ? 'lab-direction-left' : undefined}>
            {bias === 1 && biasLeft !== null ? `${p.bias.up} ${biasLeft}` : p.bias.up}
          </span>
        </Button>
      }
      {
        <Button
          kind={bias === -1 ? 'danger' : 'ghost'}
          small
          testId="lab-bias-down"
          disabled={busy === 'bias'}
          onClick={() => void onBias(bias === -1 ? 'off' : 'down')}
        >
          <span data-testid={bias === -1 && biasLeft !== null ? 'lab-direction-left' : undefined}>
            {bias === -1 && biasLeft !== null ? `${p.bias.down} ${biasLeft}` : p.bias.down}
          </span>
        </Button>
      }
      <Badge tone={pushing !== null || bias !== null ? 'lab' : 'muted'} testId="lab-push-state">
        {pushing !== null
          ? p.running(pushing.direction === 1 ? 'up' : 'down', pushing.remaining)
          : bias !== null
            ? p.bias.active(bias === 1 ? 'up' : 'down')
            : p.idle}
      </Badge>
      {/* The last act's announcement stays: a burst lands before the strip's next poll (PH-24.13). */}
      {last !== null && (
        <span data-testid="lab-push-landing" style={{ fontSize: 12, color: T.muted }}>
          {last.distance !== undefined && last.distance !== null
            ? p.landingUnits(last.landing.price, last.distance.units, last.landing.afterTicks)
            : p.landing(last.landing.price, last.landing.afterTicks)}
          {last.pace !== undefined ? ` · ${p.pace[last.pace]}` : ''}
          {last.extended ? ` · ${p.extended}` : ''}
        </span>
      )}
      {pushing === null &&
        control?.lastPush !== undefined &&
        control.lastPush !== null &&
        control.lastPush.landedPrice !== null && (
          <span
            data-testid="lab-push-outcome"
            style={{ fontSize: 12, color: control.lastPush.exact === true ? T.ok : T.bad }}
          >
            {p.landed(
              control.lastPush.direction === 1 ? 'up' : 'down',
              control.lastPush.ticks,
              control.lastPush.landedPrice,
              control.lastPush.exact === true,
            )}
          </span>
        )}
      {last !== null && last.released !== null && (
        <span data-testid="lab-push-released" style={{ fontSize: 12, color: T.warn }}>
          {p.released(last.released.discarded)}
        </span>
      )}
      {error !== null && (
        <Notice tone="bad" testId="lab-push-error">
          {error}
        </Notice>
      )}
    </div>
  );
}
