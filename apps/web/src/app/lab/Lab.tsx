'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Badge, Info, T, Tabs } from '../ui/kit.js';
import {
  isBetween,
  isUnavailable,
  labGet,
  labPost,
  type BetweenLevels,
  type ClosePlan,
  type ClosesView,
  type CloseTimeframe,
  type Control,
  type LabMarket,
  type LabPositionView,
  type LabState,
  type PositionsView,
  type Quality,
  type ScenarioPlan,
  type ScenarioView,
  type Session,
} from './labApi.js';
import { Mercado } from './Mercado.js';
import { Cierre } from './Cierre.js';
import { Posiciones } from './Posiciones.js';
import { Escenarios } from './Escenarios.js';
import { QualityPanel } from './Calidad.js';
import { Sesion } from './Sesion.js';

/**
 * El OTC Lab, en el panel (PH-23.5), rediseñado en PH-24.6.
 *
 * ## Por qué toda la pantalla lleva el rótulo
 *
 * §3 de la especificación exige `OTC LAB` y `SIMULATION ENVIRONMENT` de forma
 * permanente, y no es decoración: esta pantalla muestra el estado latente del
 * motor y los cursores del keystream, que INV-010 prohíbe publicar, y puede
 * elegir entre futuros. Una captura no puede confundirse con una del mercado,
 * así que el rótulo va en el marco y no en el contenido, y `labScreen.test.ts`
 * lo afirma.
 *
 * ## Una pregunta por pestaña
 *
 * Arriba, lo que decide: mercado, precio, régimen, si hay algo armado y cómo
 * acabó lo último. Debajo, una pestaña por pregunta — Mercado, Cierre,
 * Posiciones, Escenarios, Calidad, Sesión — con los controles primero y las
 * lecturas después. Cada explicación vive detrás de un ⓘ.
 *
 * ## Por qué puede estar vacía
 *
 * El Lab es un proceso aparte y esto apunta a él solo si `OTC_LAB_BASE` lo
 * nombra. Sin Lab la pantalla lo dice, y dice cómo arrancar uno (ADR-0015 §3).
 */
type Tab = 'market' | 'close' | 'positions' | 'scenarios' | 'quality' | 'session';

export function Lab(): ReactElement {
  const [assets, setAssets] = useState<LabMarket[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<LabState | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('close');
  const [busy, setBusy] = useState<string | null>(null);

  const [tf, setTf] = useState<CloseTimeframe>('1m');
  const [bucket, setBucket] = useState<'current' | 'next' | 'expiry'>('current');
  const [expiryTime, setExpiryTime] = useState('');
  const [price, setPrice] = useState('');
  const [plan, setPlan] = useState<ClosePlan | null>(null);
  const [notice, setNotice] = useState<BetweenLevels | string | null>(null);
  const [planExpiry, setPlanExpiry] = useState<number | null>(null);
  const [control, setControl] = useState<Control | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [closes, setCloses] = useState<ClosesView | null>(null);
  const [positionsView, setPositionsView] = useState<PositionsView | null>(null);
  const [positions, setPositions] = useState<LabPositionView[]>([]);
  const [positionNotice, setPositionNotice] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioView[]>([]);
  const [scenarioPlan, setScenarioPlan] = useState<ScenarioPlan | null>(null);
  const [scenarioNotice, setScenarioNotice] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);

  useEffect(() => {
    void labGet<{ scenarios: ScenarioView[] }>('scenarios').then((body) => {
      if (!isUnavailable(body)) setScenarios(body.scenarios);
    });
    // The Lab's own markets, never production's (§3): the screen cannot name a
    // production asset because it never learns one.
    void labGet<{ markets: LabMarket[] }>('markets').then((body) => {
      if (isUnavailable(body)) {
        setUnavailable(body.reason);
        setAssets([]);
        return;
      }
      setUnavailable(null);
      setAssets(body.markets);
      setSelected((current) => current ?? body.markets[0]?.id ?? null);
    });
  }, []);

  const refreshState = useCallback(async (asset: string) => {
    const body = await labGet<LabState>(`markets/${asset}/state`);
    if (isUnavailable(body)) {
      setUnavailable(body.reason);
      setState(null);
      return;
    }
    setUnavailable(null);
    setState(body);
    const [ctl, timelines, open, diagnostic, settled] = await Promise.all([
      labGet<Control>(`markets/${asset}/control`),
      labGet<Session>('session'),
      labGet<{ positions: LabPositionView[] }>(`markets/${asset}/positions`),
      labGet<ClosesView>('session/closes'),
      labGet<PositionsView>('session/positions'),
    ]);
    if (!isUnavailable(settled)) setPositionsView(settled);
    if (!isUnavailable(ctl)) setControl(ctl);
    if (!isUnavailable(timelines)) setSession(timelines);
    if (!isUnavailable(open)) setPositions(open.positions);
    if (!isUnavailable(diagnostic)) setCloses(diagnostic);
  }, []);

  useEffect(() => {
    if (selected === null) return;
    void refreshState(selected);
    const timer = setInterval(() => {
      void refreshState(selected);
    }, 2_000);
    return () => {
      clearInterval(timer);
    };
  }, [selected, refreshState]);

  // A typed UTC time (HH:MM[:SS], today) as an instant; tomorrow's if it has passed.
  const expiryInstant = (): number | null => {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(expiryTime.trim());
    if (m === null) return null;
    const now = new Date();
    let at = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      Number(m[1]),
      Number(m[2]),
      Number(m[3] ?? '0'),
    );
    if (at <= Date.now()) at += 86_400_000;
    return at;
  };
  const addressing = (): string => {
    if (bucket === 'expiry') {
      const at = expiryInstant();
      return at === null ? `bucket=current&timeframe=${tf}` : `expiry=${String(at)}`;
    }
    return `bucket=${bucket}&timeframe=${tf}`;
  };
  const closeQuery = (): string => `price=${encodeURIComponent(price.trim())}&${addressing()}`;

  const settle = (
    body: ClosePlan | BetweenLevels | { running: false; reason: string } | { message?: string },
  ): void => {
    if (isUnavailable(body)) {
      setUnavailable(body.reason);
      return;
    }
    if (isBetween(body)) {
      setPlan(null);
      setNotice(body);
      return;
    }
    if ('reachability' in body) {
      setNotice(null);
      setPlan(body);
      return;
    }
    setPlan(null);
    setNotice(typeof body.message === 'string' ? body.message : 'El Lab rechazó la petición.');
  };

  const previewClose = async (): Promise<void> => {
    if (selected === null) return;
    setPlanExpiry(null);
    setBusy('preview');
    settle(
      await labGet<ClosePlan | BetweenLevels>(`markets/${selected}/close/preview?${closeQuery()}`),
    );
    setBusy(null);
  };

  const applyClose = async (): Promise<void> => {
    if (selected === null) return;
    setPlanExpiry(null);
    setBusy('apply');
    settle(await labPost<ClosePlan | BetweenLevels>(`markets/${selected}/close?${closeQuery()}`));
    setBusy(null);
    void refreshState(selected);
  };

  // A neighbour is the act, applied where its plan belongs: at a position's
  // expiry after a preset, not at whatever candle the selectors show.
  const applyNeighbour = async (level: string): Promise<void> => {
    if (selected === null) return;
    setPrice(level);
    setBusy('apply');
    const query =
      planExpiry === null
        ? `price=${encodeURIComponent(level)}&${addressing()}`
        : `price=${encodeURIComponent(level)}&expiry=${String(planExpiry)}`;
    settle(await labPost<ClosePlan | BetweenLevels>(`markets/${selected}/close?${query}`));
    setBusy(null);
    void refreshState(selected);
  };

  // A relative close: N lattice steps from the price the market stands at when
  // armed — the operator's natural question, and what the presets already ask
  // about an entry. `delta=` lets the server compute the target on the fork.
  const applyDelta = async (delta: number, apply: boolean): Promise<void> => {
    if (selected === null) return;
    setPlanExpiry(null);
    setBusy(apply ? 'apply' : 'preview');
    const query = `delta=${String(delta)}&${addressing()}`;
    settle(
      apply
        ? await labPost<ClosePlan | BetweenLevels>(`markets/${selected}/close?${query}`)
        : await labGet<ClosePlan | BetweenLevels>(`markets/${selected}/close/preview?${query}`),
    );
    setBusy(null);
    if (apply) void refreshState(selected);
  };

  const releaseMarket = async (): Promise<void> => {
    if (selected === null) return;
    setBusy('release');
    const body = await labPost<Control>(`markets/${selected}/release`);
    setBusy(null);
    if (isUnavailable(body)) {
      setUnavailable(body.reason);
      return;
    }
    setPlan(null);
    void refreshState(selected);
  };

  const openPosition = async (
    direction: 'up' | 'down',
    stake: number,
    horizonMs: number,
  ): Promise<void> => {
    if (selected === null) return;
    setBusy('position');
    const body = await labPost<{ position: LabPositionView } | { message?: string }>(
      `markets/${selected}/positions?direction=${direction}&stake=${String(stake)}&horizonMs=${String(horizonMs)}`,
    );
    setBusy(null);
    if (isUnavailable(body)) {
      setUnavailable(body.reason);
      return;
    }
    setPositionNotice('position' in body ? null : (body.message ?? 'El Lab rechazó la posición.'));
    void refreshState(selected);
  };

  const applyPreset = async (id: string, name: string): Promise<void> => {
    if (selected === null) return;
    setPlanExpiry(positions.find((p) => p.id === id)?.expiryInstant ?? null);
    setBusy('preset');
    settle(
      await labPost<ClosePlan | BetweenLevels>(
        `markets/${selected}/positions/${id}/preset?name=${name}`,
      ),
    );
    setBusy(null);
    setTab('close');
    void refreshState(selected);
  };

  const runScenario = async (
    name: string,
    windowMs: number,
    params: Record<string, number | string>,
    apply: boolean,
  ): Promise<void> => {
    if (selected === null) return;
    setBusy(apply ? 'scenario-apply' : 'scenario-preview');
    const query = [`name=${name}`, `window=${String(windowMs)}`]
      .concat(Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`))
      .join('&');
    const body = apply
      ? await labPost<ScenarioPlan | { message?: string }>(`markets/${selected}/scenario?${query}`)
      : await labGet<ScenarioPlan | { message?: string }>(
          `markets/${selected}/scenario/preview?${query}`,
        );
    setBusy(null);
    if (isUnavailable(body)) {
      setUnavailable(body.reason);
      return;
    }
    if ('attempts' in body) {
      setScenarioNotice(null);
      setScenarioPlan(body);
    } else {
      setScenarioPlan(null);
      setScenarioNotice(body.message ?? 'El Lab rechazó el escenario.');
    }
    if (apply) void refreshState(selected);
  };

  const runQuality = async (): Promise<void> => {
    if (selected === null) return;
    setBusy('quality');
    const body = await labGet<Quality>(`markets/${selected}/quality`);
    setBusy(null);
    if (isUnavailable(body)) {
      setUnavailable(body.reason);
      return;
    }
    setQuality(body);
  };

  const regime =
    state?.magnitudeState.modulators?.find((m) => m !== null && 'regime' in m)?.regime ?? null;
  return (
    <div data-testid="lab" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Banner />
      {unavailable !== null && <NotRunning reason={unavailable} />}
      <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0 }}>
        <AssetList assets={assets} selected={selected} onSelect={setSelected} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <HeaderStrip state={state} regime={regime} control={control} />
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '0 16px 16px' }}>
            <Tabs<Tab>
              tabs={[
                { key: 'market', label: es.lab.tabs.market },
                { key: 'close', label: es.lab.tabs.close },
                { key: 'positions', label: es.lab.tabs.positions },
                { key: 'scenarios', label: es.lab.tabs.scenarios },
                { key: 'quality', label: es.lab.tabs.quality },
                { key: 'session', label: es.lab.tabs.session },
              ]}
              active={tab}
              onChange={setTab}
            />
            <div hidden={tab !== 'market'}>
              <Mercado state={state} />
            </div>
            <div hidden={tab !== 'close'}>
              <Cierre
                timeframe={tf}
                onTimeframe={setTf}
                bucket={bucket}
                onBucket={setBucket}
                expiryTime={expiryTime}
                onExpiryTime={setExpiryTime}
                onTarget={runScenario}
                targetPlan={scenarioPlan}
                price={price}
                onPrice={setPrice}
                onPreview={previewClose}
                onApply={applyClose}
                onNeighbour={applyNeighbour}
                onDelta={applyDelta}
                onRelease={releaseMarket}
                busy={busy}
                plan={plan}
                notice={notice}
                control={control}
                displayPrecision={state === null ? 7 : (state.price.split('.')[1] ?? '').length}
              />
            </div>
            <div hidden={tab !== 'positions'}>
              <Posiciones
                positions={positions}
                onOpen={openPosition}
                onPreset={applyPreset}
                busy={busy}
                notice={positionNotice}
              />
            </div>
            <div hidden={tab !== 'scenarios'}>
              <Escenarios
                scenarios={scenarios}
                plan={scenarioPlan}
                notice={scenarioNotice}
                busy={busy}
                onRun={runScenario}
              />
            </div>
            <div hidden={tab !== 'quality'}>
              <QualityPanel quality={quality} busy={busy === 'quality'} onRun={runQuality} />
            </div>
            <div hidden={tab !== 'session'}>
              <Sesion session={session} closes={closes} positions={positionsView} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The banner, in the frame rather than in the content (§3). */
function Banner(): ReactElement {
  return (
    <div
      data-testid="lab-banner"
      style={{
        background: '#3a1f1f',
        borderBottom: `2px solid ${T.lab}`,
        color: '#ffd7d7',
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexShrink: 0,
      }}
    >
      <strong style={{ letterSpacing: 2, fontSize: 13 }}>{es.lab.banner.title}</strong>
      <span style={{ letterSpacing: 1, fontSize: 11 }}>{es.lab.banner.subtitle}</span>
      <span style={{ fontSize: 11, color: '#f0b0b0' }}>{es.lab.banner.line}</span>
    </div>
  );
}

function NotRunning({ reason }: { reason: string }): ReactElement {
  return (
    <div
      data-testid="lab-not-running"
      style={{
        margin: 16,
        padding: 14,
        border: `1px solid ${T.warn}`,
        color: T.warn,
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <strong>{es.lab.notRunning}</strong>
      <Info text={reason} />
    </div>
  );
}

function AssetList({
  assets,
  selected,
  onSelect,
}: {
  assets: readonly LabMarket[];
  selected: string | null;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <aside
      style={{
        width: 170,
        borderRight: `1px solid ${T.line}`,
        overflowY: 'auto',
        flexShrink: 0,
        background: T.panel,
      }}
    >
      {assets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          data-testid={`lab-asset-${asset.id}`}
          onClick={() => onSelect(asset.id)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '9px 14px',
            background: selected === asset.id ? T.raised : 'transparent',
            border: 'none',
            borderLeft: `3px solid ${selected === asset.id ? T.lab : 'transparent'}`,
            color: T.text,
            font: 'inherit',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <div>{asset.displayName}</div>
          <div style={{ fontSize: 10, color: T.faint }}>
            {asset.id} · {asset.family}
          </div>
        </button>
      ))}
    </aside>
  );
}

/** What decides, always visible: price, regime, armed state, last outcome. */
function HeaderStrip({
  state,
  regime,
  control,
}: {
  state: LabState | null;
  regime: string | null;
  control: Control | null;
}): ReactElement {
  const armed = control?.armed ?? false;
  const last = control?.lastApplied ?? null;
  return (
    <div
      data-testid="lab-header"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 22,
        padding: '12px 16px',
        borderBottom: `1px solid ${T.line}`,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 26, color: T.text }} data-testid="lab-header-price">
        {state?.price ?? '—'}
      </span>
      <span style={{ color: T.muted, fontSize: 12 }}>
        {es.lab.header.regime}: <span style={{ color: T.text }}>{regime ?? '—'}</span>
      </span>
      <Badge tone={armed ? 'lab' : 'muted'} testId="lab-header-armed">
        {armed
          ? `${es.lab.header.armed} · ${es.lab.header.remaining(control?.remaining ?? 0)}`
          : es.lab.header.keystream}
      </Badge>
      {last !== null && (
        <span
          data-testid="lab-header-outcome"
          style={{ fontSize: 12, color: last.exact === null ? T.muted : last.exact ? T.ok : T.bad }}
        >
          {last.closedPrice === null
            ? `→ ${last.targetPrice}`
            : `${last.targetPrice} → ${last.closedPrice} ${last.exact ? 'EXACTO' : 'FALLÓ'}`}
        </span>
      )}
    </div>
  );
}
