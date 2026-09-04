'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
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
  CLOSE_TIMEFRAMES,
  type CloseCondition,
  type CloseTimeframe,
  type Control,
  type ControlAll,
  type Pace,
  type PushResult,
  type LabMarket,
  type MarketControl,
  type LabPositionView,
  type LabState,
  type PositionsView,
  type Quality,
  type ScenarioPlan,
  type ScenarioView,
  type Session,
  isControl,
  LAB_POLL_TIMEOUT_MS,
} from './labApi.js';
import { Mercado } from './Mercado.js';
import { Cierre } from './Cierre.js';
import { Empujar } from './Empujar.js';
import { Controles } from './Controles.js';
import { nearestLevelPrice } from './lattice.js';
import { createPollGate } from './poll.js';
import { PreviewChart } from '../preview/PreviewChart.js';
import { PANEL_TIMEFRAMES, type PanelTimeframeId } from '@otc/chart';
import { fetchCatalogue, type CatalogueEntry } from '../../lib/api.js';
import { Posiciones } from './Posiciones.js';
import { Escenarios } from './Escenarios.js';
import { QualityPanel } from './Calidad.js';
import { Sesion } from './Sesion.js';
import { Tablero } from './Tablero.js';

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
type Tab =
  'board' | 'replay' | 'market' | 'close' | 'positions' | 'scenarios' | 'quality' | 'session';

/**
 * Cada segundo (PH-24.13): un empuje aterriza en dos o tres, y la tira debe
 * decirlo mientras ocurre.
 */
const POLL_INTERVAL_MS = 1_000;

export function Lab({ mode = 'control' }: { mode?: 'control' | 'avanzado' }): ReactElement {
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
  // PH-24.21: where the close must end relative to the mark — the panel's = ▲ ▼.
  const [closeCondition, setCloseCondition] = useState<CloseCondition>('exact');
  const [plan, setPlan] = useState<ClosePlan | null>(null);
  const [notice, setNotice] = useState<BetweenLevels | string | null>(null);
  const [planExpiry, setPlanExpiry] = useState<number | null>(null);
  const [control, setControl] = useState<Control | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [closes, setCloses] = useState<ClosesView | null>(null);
  const [positionsView, setPositionsView] = useState<PositionsView | null>(null);
  const [all, setAll] = useState<ControlAll | null>(null);
  const [lastPush, setLastPush] = useState<PushResult | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pace, setPace] = useState<Pace>('rapido');
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [chartTf, setChartTf] = useState<PanelTimeframeId>('1m');
  const [positions, setPositions] = useState<LabPositionView[]>([]);
  const [positionNotice, setPositionNotice] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioView[]>([]);
  const [scenarioPlan, setScenarioPlan] = useState<ScenarioPlan | null>(null);
  const [scenarioNotice, setScenarioNotice] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);

  useEffect(() => {
    // The chart's catalogue from the Lab's own engine routes (PH-24.12): never /engine.
    fetchCatalogue('/labengine')
      .then(setCatalogue)
      .catch(() => setCatalogue([]));
  }, []);

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

  // PH-24.24: which market the screen is on, read after every await. A poll for
  // the market just left can answer after the switch, and its control would then
  // be rendered under the new market's name — a countdown for somebody else.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  // Cycle Audit 8 (a4): and which refresh is the newest, because the market
  // does not have to change for two answers to arrive out of order. The asset
  // check above saw only a switch — the one case where the two answers look
  // different — so two refreshes of the *same* market raced, and whichever the
  // network returned last won, however old it was.
  const pollRef = useRef(createPollGate());

  const refreshState = useCallback(async (asset: string) => {
    const gate = pollRef.current;
    const ticket = gate.begin();
    /** Whether this answer may still be written to the screen. */
    const stale = (): boolean => !gate.isCurrent(ticket) || selectedRef.current !== asset;
    try {
      const body = await labGet<LabState>(`markets/${asset}/state`, LAB_POLL_TIMEOUT_MS);
      if (stale()) return;
      if (isUnavailable(body)) {
        setUnavailable(body.reason);
        setState(null);
        return;
      }
      setUnavailable(null);
      setState(body);
      const [ctl, timelines, open, diagnostic, settled, everyMarket] = await Promise.all([
        labGet<Control>(`markets/${asset}/control`, LAB_POLL_TIMEOUT_MS),
        labGet<Session>('session', LAB_POLL_TIMEOUT_MS),
        labGet<{ positions: LabPositionView[] }>(`markets/${asset}/positions`, LAB_POLL_TIMEOUT_MS),
        labGet<ClosesView>('session/closes', LAB_POLL_TIMEOUT_MS),
        labGet<PositionsView>('session/positions', LAB_POLL_TIMEOUT_MS),
        labGet<ControlAll>('control', LAB_POLL_TIMEOUT_MS),
      ]);
      if (stale()) return;
      if (!isUnavailable(settled)) setPositionsView(settled);
      if (!isUnavailable(everyMarket)) setAll(everyMarket);
      // An error body is not a control: storing one would read as "nothing running".
      if (isControl(ctl)) setControl(ctl);
      if (!isUnavailable(timelines)) setSession(timelines);
      if (!isUnavailable(open)) setPositions(open.positions);
      if (!isUnavailable(diagnostic)) setCloses(diagnostic);
    } finally {
      gate.end(ticket);
    }
  }, []);

  useEffect(() => {
    if (selected === null) return;
    void refreshState(selected);
    const timer = setInterval(() => {
      // A tick that finds the previous refresh still out is skipped rather than
      // stacked on it (a4): each refresh is seven requests, and against a Lab
      // that had stopped answering the interval queued seven more every second
      // for the whole outage — then resolved the lot, in the network's order.
      if (pollRef.current.busy()) return;
      void refreshState(selected);
    }, POLL_INTERVAL_MS);
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
  // PH-24.20: on the panel the close addresses the chart's own candle — a
  // selector of its own would be redundant. The chart has no 30s and the close
  // nothing wider than 15m, so outside the shared three the panel's fijar is
  // disabled and says why.
  const panelCloseTf: CloseTimeframe | null = (CLOSE_TIMEFRAMES as readonly string[]).includes(
    chartTf,
  )
    ? (chartTf as CloseTimeframe)
    : null;
  const closeTf: CloseTimeframe = mode === 'control' ? (panelCloseTf ?? tf) : tf;
  const addressing = (): string => {
    if (bucket === 'expiry') {
      const at = expiryInstant();
      return at === null ? `bucket=current&timeframe=${closeTf}` : `expiry=${String(at)}`;
    }
    return `bucket=${bucket}&timeframe=${closeTf}`;
  };
  const closeQuery = (at = price): string =>
    `price=${encodeURIComponent(at.trim())}&${addressing()}` +
    (mode === 'control' && closeCondition !== 'exact' ? `&condition=${closeCondition}` : '');
  // PH-24.21: a click on the chart names a price; the box takes the nearest
  // lattice level, and whatever the box holds is marked on the chart.
  const pickPrice = (picked: number): void => {
    const lattice = state?.instrument;
    if (lattice === undefined) return;
    const snapped = nearestLevelPrice(lattice, picked);
    if (snapped !== null) setPrice(snapped);
  };
  const marked =
    mode === 'control' && price.trim() !== '' && Number.isFinite(Number(price))
      ? { price: Number(price), title: es.lab.panel.close.mark }
      : null;

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
    const message = typeof body.message === 'string' ? body.message : 'El Lab rechazó la petición.';
    // PH-24.10: a close refused because a push is running, in the operator's words.
    setNotice(/PUSH_RUNNING/.test(message) ? es.lab.push.refusedPush : message);
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

  // PH-24.20: the panel's fijar with an empty box fixes the price the market stands at.
  const applyClose = async (at?: string): Promise<void> => {
    if (selected === null) return;
    if (at !== undefined) setPrice(at);
    setPlanExpiry(null);
    setBusy('apply');
    settle(await labPost<ClosePlan | BetweenLevels>(`markets/${selected}/close?${closeQuery(at)}`));
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

  const push = async (ticks: number): Promise<void> => {
    if (selected === null) return;
    setBusy('push');
    setPushError(null);
    try {
      const body = await labPost<PushResult>(
        // PH-24.18: the buttons are distances in the market's own unit, not ticks.
        `markets/${selected}/push?distance=${String(ticks)}&pace=${pace}`,
      );
      if (isUnavailable(body)) {
        // A failed push is said on the strip; the screen and its buttons stay.
        setPushError(es.lab.push.failed(body.reason));
        return;
      }
      setLastPush(body);
      void refreshState(selected);
    } finally {
      // PH-24.11: whatever happened, the strip is never left held.
      setBusy(null);
    }
  };

  const setBias = async (direction: 'up' | 'down' | 'off'): Promise<void> => {
    if (selected === null) return;
    setBusy('bias');
    try {
      const body = await labPost<Control>(`markets/${selected}/bias?direction=${direction}`);
      if (isUnavailable(body)) {
        setPushError(es.lab.push.failed(body.reason));
        return;
      }
      setControl(body);
      void refreshState(selected);
    } finally {
      setBusy(null);
    }
  };

  const releaseAll = async (): Promise<void> => {
    setBusy('release-all');
    const body = await labPost<{ released: unknown[] }>('release-all');
    setBusy(null);
    if (isUnavailable(body)) {
      setUnavailable(body.reason);
      return;
    }
    setPlan(null);
    if (selected !== null) void refreshState(selected);
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
  /**
   * La unidad de distancia del mercado (PH-24.18), o nada.
   *
   * Cycle Audit 8 (a4): aquí estaba `state?.distance?.unitSteps ?? 1`, y un 1
   * no es «no lo sé» — es el paso de la red. Entre el montaje y la primera
   * respuesta, y mientras el Lab no conteste, «+3» armaba un cierre a tres
   * pasos (unas 0,0000008 en EUR/USD, invisibles a la precisión que se muestra)
   * en lugar de a las tres unidades que dice el botón, y nada en la pantalla
   * decía que la unidad había cambiado. Las dos pestañas cuyos campos se piden
   * en unidades esperan a saber cuánto vale una.
   */
  const distanceUnit = state?.distance ?? null;
  return (
    <div data-testid="lab" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Banner />
      {unavailable !== null && <NotRunning reason={unavailable} />}
      {mode === 'control' ? (
        // PH-24.19: the control panel — the market's bar, the chart at three
        // quarters, the controls at one quarter (two cards, PH-24.20). The
        // instrument is /lab/avanzado.
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <TopBar
            assets={assets}
            selected={selected}
            onSelect={setSelected}
            all={all}
            state={state}
            regime={regime}
            control={control}
          />
          <div
            data-testid="lab-panel"
            style={{
              display: 'grid',
              gridTemplateColumns: '3fr 1fr',
              flex: 1,
              minHeight: 0,
            }}
          >
            <LabChart
              entry={catalogue.find((c) => c.id === selected) ?? null}
              timeframe={chartTf}
              onTimeframe={setChartTf}
              onPick={pickPrice}
              mark={marked}
              fill
            />
            <Controles
              state={state}
              control={control}
              pushError={pushError}
              busy={busy}
              onPush={push}
              pace={pace}
              onPace={setPace}
              onBias={setBias}
              closeTimeframe={panelCloseTf}
              bucket={bucket}
              onBucket={setBucket}
              price={price}
              onPrice={setPrice}
              onApply={applyClose}
              onRelease={releaseMarket}
              condition={closeCondition}
              onCondition={setCloseCondition}
              plan={plan}
              notice={notice}
            />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0 }}>
          <AssetList assets={assets} selected={selected} onSelect={setSelected} all={all} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <HeaderStrip state={state} regime={regime} control={control} />
            <Empujar
              control={control}
              last={lastPush}
              error={pushError}
              busy={busy}
              onPush={push}
              pace={pace}
              onPace={setPace}
              onBias={setBias}
              state={state}
            />
            <LabChart
              entry={catalogue.find((c) => c.id === selected) ?? null}
              timeframe={chartTf}
              onTimeframe={setChartTf}
            />
            <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '0 16px 16px' }}>
              <Tabs<Tab>
                tabs={[
                  { key: 'close', label: es.lab.tabs.close },
                  { key: 'board', label: es.lab.tabs.board },
                  { key: 'market', label: es.lab.tabs.market },
                  { key: 'positions', label: es.lab.tabs.positions },
                  { key: 'scenarios', label: es.lab.tabs.scenarios },
                  { key: 'quality', label: es.lab.tabs.quality },
                  { key: 'session', label: es.lab.tabs.session },
                ]}
                active={tab}
                onChange={setTab}
              />
              <div hidden={tab !== 'board'}>
                <Tablero
                  all={all}
                  busy={busy}
                  onReleaseAll={releaseAll}
                  onSelect={(id) => {
                    setSelected(id);
                    setTab('close');
                  }}
                />
              </div>
              <div hidden={tab !== 'market'}>
                <Mercado state={state} />
              </div>
              <div hidden={tab !== 'close'}>
                {distanceUnit === null ? (
                  <UnitUnknown />
                ) : (
                  <Cierre
                    timeframe={tf}
                    onTimeframe={setTf}
                    bucket={bucket}
                    onBucket={setBucket}
                    expiryTime={expiryTime}
                    onExpiryTime={setExpiryTime}
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
                    unitSteps={distanceUnit.unitSteps}
                  />
                )}
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
                {distanceUnit === null ? (
                  <UnitUnknown />
                ) : (
                  <Escenarios
                    scenarios={scenarios}
                    plan={scenarioPlan}
                    notice={scenarioNotice}
                    busy={busy}
                    onRun={runScenario}
                    onTarget={runScenario}
                    targetPlan={scenarioPlan}
                    unitSteps={distanceUnit.unitSteps}
                    unitPrice={distanceUnit.unitPrice}
                  />
                )}
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
      )}
    </div>
  );
}

/**
 * The control panel's bar (PH-24.19): the markets as pills, and — for the
 * selected one only — its price, regime and state. Plus the small door to the
 * instrument.
 */
function TopBar({
  assets,
  selected,
  onSelect,
  all,
  state,
  regime,
  control,
}: {
  assets: readonly LabMarket[];
  selected: string | null;
  onSelect: (id: string) => void;
  all: ControlAll | null;
  state: LabState | null;
  regime: string | null;
  control: Control | null;
}): ReactElement {
  const armed = control?.armed ?? false;
  const last = control?.lastApplied ?? null;
  return (
    <div
      data-testid="lab-topbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 14px',
        borderBottom: `1px solid ${T.line}`,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {assets.map((asset) => {
          const market = all?.markets.find((m) => m.id === asset.id) ?? null;
          return (
            <button
              key={asset.id}
              type="button"
              data-testid={`lab-asset-${asset.id}`}
              onClick={() => onSelect(asset.id)}
              style={{
                padding: '4px 10px',
                background: selected === asset.id ? T.line : 'transparent',
                color: selected === asset.id ? T.text : T.muted,
                border: `1px solid ${selected === asset.id ? T.lab : T.line}`,
                borderRadius: 14,
                font: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {asset.displayName}
              {market !== null && market.armed ? ' ·' : ''}
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 22, color: T.text }} data-testid="lab-header-price">
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
      {last !== null && last.closedPrice !== null && (
        <span
          data-testid="lab-header-outcome"
          style={{ fontSize: 12, color: last.exact ? T.ok : T.bad }}
        >
          {`${last.targetPrice} → ${last.closedPrice} ${last.exact ? 'EXACTO' : 'FALLÓ'}`}
        </span>
      )}
      <a
        href="/lab/avanzado"
        data-testid="lab-advanced-link"
        style={{ marginLeft: 'auto', color: T.muted, fontSize: 11, textDecoration: 'none' }}
      >
        {es.lab.panel.advanced} <Info text={es.lab.panel.advancedInfo} />
      </a>
    </div>
  );
}

/** The banner, in the frame rather than in the content (§3). */
/**
 * The selected market's candles, from the Lab's engine (PH-24.12, ADR-0018 §4).
 *
 * The same `PreviewChart` Vista uses, fed through `/labengine`: what a push or
 * a close does is seen where it happens. With one engine per deployment these
 * are Vista's candles; with two they are still the Lab's, never production's.
 */
function LabChart({
  entry,
  timeframe,
  onTimeframe,
  onPick,
  mark = null,
  fill = false,
}: {
  entry: CatalogueEntry | null;
  timeframe: PanelTimeframeId;
  onTimeframe: (id: PanelTimeframeId) => void;
  /** PH-24.21: a click on the chart names the price at that height; the mark is the close asked. */
  onPick?: ((price: number) => void) | undefined;
  mark?: { readonly price: number; readonly title: string } | null;
  /** PH-24.19: the control panel gives the chart the whole column. */
  fill?: boolean;
}): ReactElement {
  return (
    <div
      data-testid="lab-chart"
      style={
        fill
          ? {
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              borderRight: `1px solid ${T.line}`,
            }
          : { borderBottom: `1px solid ${T.line}`, flexShrink: 0 }
      }
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 16px' }}>
        <span style={{ color: T.text, fontSize: 12, fontWeight: 600 }}>
          {es.lab.chart.title} <Info text={es.lab.chart.info} />
        </span>
        {PANEL_TIMEFRAMES.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`lab-chart-tf-${t.id}`}
            onClick={() => onTimeframe(t.id)}
            style={{
              padding: '2px 8px',
              background: timeframe === t.id ? T.line : 'transparent',
              color: timeframe === t.id ? T.text : T.muted,
              border: `1px solid ${T.line}`,
              borderRadius: 3,
              font: 'inherit',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {t.id}
          </button>
        ))}
      </div>
      <div
        style={
          fill
            ? { flex: 1, minHeight: 0, position: 'relative' }
            : { height: 260, position: 'relative' }
        }
      >
        {entry === null ? (
          <div style={{ color: T.faint, fontSize: 11, padding: '0 16px' }}>—</div>
        ) : (
          <PreviewChart
            key={entry.id}
            apiBase="/labengine"
            asset={entry}
            timeframeId={timeframe}
            onPick={onPick}
            mark={mark}
          />
        )}
      </div>
    </div>
  );
}

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
      {/* PH-24.14: "not configured" only when the proxy says so; a transport failure is said as one. */}
      <strong data-testid="lab-not-running-title">
        {/OTC_LAB_BASE|not configured|no configurado/i.test(reason)
          ? es.lab.notRunning
          : es.lab.unreachable}
      </strong>
      <Info text={reason} />
    </div>
  );
}

/**
 * Cycle Audit 8 (a4): un control de distancia sin unidad no se muestra.
 *
 * No es un error: es el estado normal durante el primer segundo, y el estado
 * permanente mientras el Lab no conteste. Lo que no puede pasar es que los
 * botones sigan ahí midiendo en otra cosa sin decirlo.
 */
const UNIT_UNKNOWN_NOTE =
  'Cierre y Escenarios piden las distancias en unidades del mercado, y el Lab ' +
  'todavía no ha dicho cuánto vale una aquí. Un paso de la red no es una ' +
  'unidad: en EUR/USD son unas 0,0000008, invisibles a la precisión que se ' +
  'muestra, así que estos controles esperan en lugar de suponerla.';

function UnitUnknown(): ReactElement {
  return (
    <div
      data-testid="lab-unit-unknown"
      style={{
        margin: '12px 0',
        padding: 12,
        border: `1px solid ${T.line}`,
        color: T.muted,
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <strong>Esperando la unidad de este mercado.</strong>
      <Info text={UNIT_UNKNOWN_NOTE} />
    </div>
  );
}

function AssetList({
  assets,
  selected,
  onSelect,
  all,
}: {
  assets: readonly LabMarket[];
  selected: string | null;
  onSelect: (id: string) => void;
  all: ControlAll | null;
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
          <MarketBadge market={all?.markets.find((m) => m.id === asset.id) ?? null} />
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

/** A market's state in one word on the asset list (PH-24.9): armed, or how its last close ended. */
function MarketBadge({ market }: { market: MarketControl | null }): ReactElement | null {
  if (market === null) return null;
  if (market.armed) {
    const push = market.pushing ?? null;
    return (
      <Badge tone="lab" testId={`lab-asset-badge-${market.id}`}>
        {push !== null
          ? `${push.direction === 1 ? '↑' : '↓'} ${String(push.remaining)}`
          : `${es.lab.header.armed} · ${String(market.remaining)}`}
      </Badge>
    );
  }
  const last = market.lastApplied;
  if (last === null || last.closedPrice === null) return null;
  return (
    <Badge tone={last.exact === true ? 'ok' : 'bad'} testId={`lab-asset-badge-${market.id}`}>
      {last.exact === true ? 'EXACTO' : 'FALLÓ'}
    </Badge>
  );
}
