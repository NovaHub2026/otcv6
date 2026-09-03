'use client';

import { useId, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';

/**
 * El kit del panel (PH-24.6).
 *
 * Un solo conjunto de piezas para todas las pantallas, de modo que el panel se
 * lea como un producto y no como cinco pruebas. Las explicaciones van detrás
 * de `Info`; en la superficie quedan los estados y los números que deciden.
 */
export const T = {
  bg: '#0b0e14',
  panel: '#11151d',
  raised: '#161b26',
  line: '#242c3d',
  text: '#d7dce5',
  muted: '#8b93a7',
  faint: '#5b6377',
  ok: '#3fb950',
  warn: '#e3b341',
  bad: '#f85149',
  accent: '#58a6ff',
  lab: '#f85149',
} as const;

/** Un icono ⓘ que muestra su texto al pasar, al enfocar o al tocar. */
export function Info({
  text,
  label = 'Más información',
}: {
  text: ReactNode;
  label?: string | undefined;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        marginLeft: 6,
        verticalAlign: 'middle',
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        data-testid="info"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          border: `1px solid ${T.faint}`,
          background: 'transparent',
          color: T.muted,
          fontSize: 10,
          lineHeight: '14px',
          padding: 0,
          cursor: 'help',
          font: 'inherit',
        }}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          data-testid="info-text"
          style={{
            position: 'absolute',
            zIndex: 20,
            top: 20,
            left: 0,
            width: 300,
            background: T.raised,
            border: `1px solid ${T.line}`,
            color: T.text,
            padding: '8px 10px',
            fontSize: 11,
            lineHeight: 1.6,
            boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
            whiteSpace: 'normal',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/** Un bloque con título en mayúsculas pequeñas y, si hace falta, su ⓘ. */
export function Section({
  title,
  info,
  right,
  children,
  testId,
}: {
  title: string;
  info?: ReactNode | undefined;
  right?: ReactNode | undefined;
  children: ReactNode;
  testId?: string | undefined;
}): ReactElement {
  return (
    <section
      data-testid={testId}
      style={{
        marginBottom: 14,
        border: `1px solid ${T.line}`,
        background: T.panel,
        borderRadius: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: `1px solid ${T.line}`,
          color: T.muted,
          fontSize: 10,
          letterSpacing: 1,
        }}
      >
        <span>{title.toUpperCase()}</span>
        {info !== undefined && <Info text={info} />}
        <span style={{ flex: 1 }} />
        {right}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </section>
  );
}

/** Etiqueta a la izquierda, valor a la derecha; la explicación, si la hay, en ⓘ. */
export function Row({
  label,
  value,
  info,
  testId,
  tone,
}: {
  label: string;
  value: ReactNode;
  info?: ReactNode | undefined;
  testId?: string | undefined;
  tone?: 'ok' | 'warn' | 'bad' | undefined;
}): ReactElement {
  return (
    <div
      style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '3px 0', fontSize: 12 }}
    >
      <span style={{ color: T.faint, minWidth: 150, display: 'inline-flex', alignItems: 'center' }}>
        {label}
        {info !== undefined && <Info text={info} />}
      </span>
      <span
        data-testid={testId}
        style={{ color: tone === undefined ? T.text : T[tone], wordBreak: 'break-word' }}
      >
        {value}
      </span>
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled = false,
  kind = 'neutral',
  testId,
  title,
  small = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean | undefined;
  kind?: 'neutral' | 'primary' | 'danger' | 'ghost' | undefined;
  testId?: string | undefined;
  title?: string | undefined;
  small?: boolean | undefined;
}): ReactElement {
  const border = kind === 'primary' ? T.ok : kind === 'danger' ? T.bad : T.line;
  const background =
    kind === 'primary'
      ? '#1f3a2a'
      : kind === 'danger'
        ? '#3a1f1f'
        : kind === 'ghost'
          ? 'transparent'
          : T.raised;
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        background,
        border: `1px solid ${border}`,
        color: disabled ? T.faint : T.text,
        padding: small ? '2px 8px' : '5px 12px',
        fontSize: small ? 11 : 12,
        borderRadius: 3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        font: 'inherit',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}

export const FIELD: CSSProperties = {
  background: T.bg,
  border: `1px solid ${T.line}`,
  color: T.text,
  padding: '5px 8px',
  fontSize: 12,
  borderRadius: 3,
  font: 'inherit',
};

/** Un campo con etiqueta y, si hace falta, su ⓘ — nunca una línea de ayuda debajo. */
export function Field({
  label,
  info,
  children,
  width,
}: {
  label: string;
  info?: ReactNode | undefined;
  children: ReactNode;
  width?: number | string | undefined;
}): ReactElement {
  return (
    <label
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 4,
        width,
        marginRight: 12,
        marginBottom: 10,
      }}
    >
      <span style={{ color: T.faint, fontSize: 11, display: 'inline-flex', alignItems: 'center' }}>
        {label}
        {info !== undefined && <Info text={info} />}
      </span>
      {children}
    </label>
  );
}

/** Un estado, en una palabra y un color. */
export function Badge({
  children,
  tone = 'muted',
  testId,
}: {
  children: ReactNode;
  tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'lab' | undefined;
  testId?: string | undefined;
}): ReactElement {
  const colour = tone === 'muted' ? T.muted : T[tone];
  return (
    <span
      data-testid={testId}
      style={{
        display: 'inline-block',
        border: `1px solid ${colour}`,
        color: colour,
        padding: '1px 7px',
        fontSize: 10,
        letterSpacing: 0.5,
        borderRadius: 3,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </span>
  );
}

/** Pestañas: una pregunta por pantalla. */
export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { key: K; label: string; testId?: string }[];
  active: K;
  onChange: (key: K) => void;
}): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${T.line}`, marginBottom: 14 }}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          data-testid={tab.testId ?? `tab-${tab.key}`}
          onClick={() => onChange(tab.key)}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: `2px solid ${active === tab.key ? T.accent : 'transparent'}`,
            color: active === tab.key ? T.text : T.muted,
            padding: '8px 14px',
            fontSize: 12,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Un aviso breve, amarillo o rojo, con el detalle en ⓘ si es largo. */
export function Notice({
  children,
  tone = 'warn',
  detail,
  testId,
}: {
  children: ReactNode;
  tone?: 'warn' | 'bad' | 'ok' | undefined;
  detail?: ReactNode | undefined;
  testId?: string | undefined;
}): ReactElement {
  return (
    <div
      data-testid={testId}
      style={{
        color: T[tone],
        fontSize: 12,
        padding: '6px 10px',
        border: `1px solid ${T[tone]}`,
        borderRadius: 3,
        margin: '6px 0',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <span>{children}</span>
      {detail !== undefined && <Info text={detail} />}
    </div>
  );
}
