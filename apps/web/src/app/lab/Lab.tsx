'use client';

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * The OTC Lab, in the panel.
 *
 * ## Why the whole screen is marked
 *
 * §3 of the specification requires `OTC LAB` and `SIMULATION ENVIRONMENT` to be
 * permanently displayed, and it is not decoration. This screen shows the
 * engine's latent state and its **keystream cursors**, which INV-010 forbids
 * publishing, and it can select among futures. A screenshot of it must not be
 * mistakable for a screenshot of the market, so the banner is part of the frame
 * rather than a line inside the content, and `labScreen.test.ts` asserts it.
 *
 * ## Why it can be empty
 *
 * The Lab is a separate process and this points at one only when `OTC_LAB_BASE`
 * names it. With no Lab running the screen says so, and says how to start one —
 * which is the honest state, not an error. Absence by default is the boundary
 * (ADR-0015 §3), and a screen that hid it would be arguing against it.
 */

interface LabMarket {
  readonly id: string;
  readonly displayName: string;
  readonly family: string;
}

interface LabState {
  readonly environment: string;
  readonly sequence: number;
  /** Rendered to the asset's display precision. The lattice level is beside it. */
  readonly price: string;
  readonly latticeLevel: number;
  readonly previousMagnitude: number;
  readonly previousIntervalMs: number;
  readonly cursors: Readonly<Record<string, string>>;
  readonly direction: { readonly up: number; readonly down: number; readonly why: string };
}

/** What the Lab answers to a preview or an apply (PH-24.2). */
interface ClosePlan {
  readonly price: string;
  readonly target: number;
  readonly instant: number;
  readonly fromPrice: number;
  readonly ticksInWindow: number;
  readonly delta: number;
  readonly attempts: number;
  readonly acceptanceRate: number;
  readonly reachability: string;
  readonly impossible: string | null;
  readonly reachableNeighbours: readonly string[] | null;
  readonly armed: boolean;
}

/** A price between two lattice levels: the Lab names both and arms nothing. */
interface BetweenLevels {
  readonly message: string;
  readonly below: string;
  readonly above: string;
}

interface Control {
  readonly armed: boolean;
  readonly remaining: number;
  readonly lastApplied: {
    readonly instant: number;
    readonly target: number;
    readonly targetPrice: string;
    readonly closed: number | null;
    readonly closedPrice: string | null;
    readonly exact: boolean | null;
  } | null;
}

interface Session {
  readonly engine: readonly { at: number; asset: string; kind: string; detail: string }[];
  readonly lab: readonly {
    at: number;
    asset: string;
    action: string;
    succeeded: boolean;
    parameters: Record<string, unknown>;
    diagnostics: Record<string, unknown>;
  }[];
}

/** A simulated position, as the Lab describes it (PH-24.3). */
interface LabPositionView {
  readonly id: string;
  readonly direction: 'up' | 'down';
  readonly stake: number;
  readonly entryDisplay: string;
  readonly expiryInstant: number;
  readonly expected: {
    readonly outcome: string;
    readonly basis: string;
    readonly closeDisplay: string;
  };
  readonly actual: {
    readonly outcome: string;
    readonly expiryDisplay: string;
    readonly net: number;
    readonly agrees: boolean;
  } | null;
}

const PRESET_LABELS: readonly { name: string; label: string }[] = [
  { name: 'win-minimum', label: 'WIN by min. distance' },
  { name: 'loss-minimum', label: 'LOSS by min. distance' },
  { name: 'tie', label: 'TIE' },
  { name: 'entry-plus-tick', label: 'entry +1 tick' },
  { name: 'entry-minus-tick', label: 'entry −1 tick' },
  { name: 'exact-entry', label: 'exact entry' },
];

/** A scenario as the Lab catalogues it (PH-24.4). */
interface ScenarioView {
  readonly name: string;
  readonly label: string;
  readonly selectable: boolean;
  readonly why: string | null;
  readonly parameters: readonly { name: string; label: string; default: number }[];
}

interface ScenarioPlan {
  readonly scenario: string;
  readonly windowMs: number;
  readonly instant: number;
  readonly ticksInWindow: number;
  readonly attempts: number;
  readonly acceptanceRate: number;
  readonly shape: {
    net: number;
    high: number;
    low: number;
    range: number;
    directionChanges: number;
    ticks: number;
  } | null;
  readonly impossible: string | null;
  readonly armed: boolean;
}

/** §70 over the operator's closes (PH-24.5 §2). */
interface ClosesView {
  readonly controlled: number;
  readonly distances: Readonly<Record<string, number>>;
  readonly oneStepFraction: number | null;
  readonly minimumForVerdict: number;
  readonly verdict: 'too-few-to-say' | 'no-pattern' | 'one-sided';
  readonly note: string;
}

type CloseTimeframe = '30s' | '1m' | '5m' | '15m';
const CLOSE_TIMEFRAMES: readonly CloseTimeframe[] = ['30s', '1m', '5m', '15m'];

interface Quality {
  readonly sampledTicks: number;
  readonly bounded: string;
  readonly realism: {
    readonly plausible: boolean;
    readonly passed: number;
    readonly of: number;
    readonly failed: readonly string[];
    readonly note: string;
    readonly metrics: readonly { readonly name: string; readonly value: number }[];
  };
  readonly predictability: {
    readonly verdict: 'inconclusive' | 'clean-above-resolution' | 'exploitable';
    readonly clean: boolean;
    readonly resolutionPoints: number;
    readonly minimumHypotheses: number;
    readonly hypothesesTested: number;
    readonly bucketsSkippedForOccupancy: number;
    readonly sensitivity: readonly unknown[];
    readonly notes: readonly string[];
  };
}

interface Unavailable {
  readonly running: false;
  readonly reason: string;
}

async function labGet<T>(path: string): Promise<T | Unavailable> {
  const response = await fetch(`/lab/${path}`);
  const body = (await response.json()) as T | Unavailable;
  return body;
}

/** The Lab's acts — apply, release — as POSTs carrying only the query. */
async function labPost<T>(path: string): Promise<T | Unavailable> {
  const response = await fetch(`/lab/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return (await response.json()) as T | Unavailable;
}

const isBetween = (value: unknown): value is BetweenLevels =>
  typeof value === 'object' && value !== null && 'below' in value && 'above' in value;

const isUnavailable = (value: unknown): value is Unavailable =>
  typeof value === 'object' && value !== null && (value as { running?: unknown }).running === false;

export function Lab(): ReactElement {
  const [assets, setAssets] = useState<LabMarket[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<LabState | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [tf, setTf] = useState<CloseTimeframe>('1m');
  const [bucket, setBucket] = useState<'current' | 'next'>('current');
  const [price, setPrice] = useState('');
  const [plan, setPlan] = useState<ClosePlan | null>(null);
  const [notice, setNotice] = useState<BetweenLevels | string | null>(null);
  const [control, setControl] = useState<Control | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [positions, setPositions] = useState<LabPositionView[]>([]);
  const [planExpiry, setPlanExpiry] = useState<number | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioView[]>([]);
  const [scenarioPlan, setScenarioPlan] = useState<ScenarioPlan | null>(null);
  const [scenarioNotice, setScenarioNotice] = useState<string | null>(null);
  const [closes, setCloses] = useState<ClosesView | null>(null);
  const [positionNotice, setPositionNotice] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    // The Lab's own markets, never production's. A screen that listed the
    // production catalogue beside a close-selection control would be offering
    // to steer a market carrying positions, whatever the request underneath
    // actually reached (§3). It cannot name one because it never learns one.
    void labGet<{ scenarios: ScenarioView[] }>('scenarios').then((body) => {
      if (!isUnavailable(body)) setScenarios(body.scenarios);
    });
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
    const [ctl, timelines, open, diagnostic] = await Promise.all([
      labGet<Control>(`markets/${asset}/control`),
      labGet<Session>('session'),
      labGet<{ positions: LabPositionView[] }>(`markets/${asset}/positions`),
      labGet<ClosesView>('session/closes'),
    ]);
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

  const closeQuery = (): string =>
    `price=${encodeURIComponent(price.trim())}&bucket=${bucket}&timeframe=${tf}`;

  const settle = (body: ClosePlan | BetweenLevels | Unavailable | { message?: string }): void => {
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
    setNotice(typeof body.message === 'string' ? body.message : 'The Lab refused the request.');
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
    setPositionNotice(
      'position' in body ? null : (body.message ?? 'The Lab refused the position.'),
    );
    void refreshState(selected);
  };

  const applyPreset = async (id: string, name: string): Promise<void> => {
    if (selected === null) return;
    // A preset's plan belongs to the position's expiry. When parity refuses
    // entry ± 1 the plan names entry and entry ± 2, and choosing one of them
    // must close at the *same* expiry — not at whatever candle the control's
    // selectors happen to show. The neighbour buttons read this.
    setPlanExpiry(positions.find((p) => p.id === id)?.expiryInstant ?? null);
    setBusy('preset');
    // A preset is a close at the position's expiry: the answer is a plan, and it
    // lands in the close control's plan block like any other.
    settle(
      await labPost<ClosePlan | BetweenLevels>(
        `markets/${selected}/positions/${id}/preset?name=${name}`,
      ),
    );
    setBusy(null);
    void refreshState(selected);
  };

  const applyNeighbour = async (level: string): Promise<void> => {
    if (selected === null) return;
    setPrice(level);
    setBusy('apply');
    const query =
      planExpiry === null
        ? `price=${encodeURIComponent(level)}&bucket=${bucket}&timeframe=${tf}`
        : `price=${encodeURIComponent(level)}&expiry=${String(planExpiry)}`;
    settle(await labPost<ClosePlan | BetweenLevels>(`markets/${selected}/close?${query}`));
    setBusy(null);
    void refreshState(selected);
  };

  const runScenario = async (
    name: string,
    windowMs: number,
    params: Record<string, number>,
    apply: boolean,
  ): Promise<void> => {
    if (selected === null) return;
    setBusy(apply ? 'scenario-apply' : 'scenario-preview');
    const query = [`name=${name}`, `window=${String(windowMs)}`]
      .concat(Object.entries(params).map(([k, v]) => `${k}=${String(v)}`))
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
      setScenarioNotice(body.message ?? 'The Lab refused the scenario.');
    }
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

  return (
    <div data-testid="lab" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Banner />
      {unavailable !== null && <NotRunning reason={unavailable} />}
      <div style={{ display: 'flex', gap: 16, padding: 14, flex: 1, minHeight: 0 }}>
        <AssetList assets={assets} selected={selected} onSelect={setSelected} />
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          <MarketState state={state} />
          <CloseControl
            timeframe={tf}
            onTimeframe={setTf}
            bucket={bucket}
            onBucket={setBucket}
            price={price}
            onPrice={setPrice}
            onPreview={previewClose}
            onApply={applyClose}
            onNeighbour={applyNeighbour}
            onRelease={releaseMarket}
            busy={busy}
            plan={plan}
            notice={notice}
            control={control}
            displayPrecision={state === null ? 7 : (state.price.split('.')[1] ?? '').length}
          />
          <ScenariosPanel
            scenarios={scenarios}
            plan={scenarioPlan}
            notice={scenarioNotice}
            busy={busy}
            onRun={runScenario}
          />
          <PositionsPanel
            positions={positions}
            onOpen={openPosition}
            onPreset={applyPreset}
            busy={busy}
            notice={positionNotice}
          />
          <SessionPanel session={session} />
          <ClosesPanel closes={closes} />
          <QualityPanel quality={quality} busy={busy === 'quality'} onRun={runQuality} />
        </div>
      </div>
    </div>
  );
}

/**
 * The banner, in the frame rather than in the content.
 *
 * A screenshot of this screen must not be mistakable for one of the market
 * (§3). That is why it is not a line that scrolls away.
 */
function Banner(): ReactElement {
  return (
    <div
      data-testid="lab-banner"
      style={{
        background: '#3a1d1d',
        borderBottom: '2px solid #f85149',
        color: '#f8b0aa',
        padding: '8px 14px',
        fontSize: 12,
        letterSpacing: 0.5,
        display: 'flex',
        gap: 16,
      }}
    >
      <strong style={{ color: '#f85149' }}>OTC LAB</strong>
      <span>SIMULATION ENVIRONMENT</span>
      <span style={{ color: '#a2827e' }}>
        engine internals and keystream cursors — never a market carrying positions
      </span>
    </div>
  );
}

function NotRunning({ reason }: { reason: string }): ReactElement {
  return (
    <div
      data-testid="lab-not-running"
      style={{ padding: 14, color: '#8b93a7', fontSize: 12, lineHeight: 1.6 }}
    >
      <div style={{ color: '#e3b341', marginBottom: 6 }}>No Lab is running.</div>
      {reason}
    </div>
  );
}

function AssetList({
  assets,
  selected,
  onSelect,
}: {
  assets: LabMarket[];
  selected: string | null;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <div style={{ width: 170, flexShrink: 0, borderRight: '1px solid #242c3d' }}>
      {assets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          data-testid={`lab-asset-${asset.id}`}
          onClick={() => {
            onSelect(asset.id);
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '7px 12px',
            border: 'none',
            cursor: 'pointer',
            background: selected === asset.id ? '#161b26' : 'transparent',
            color: selected === asset.id ? '#d7dce5' : '#8b93a7',
            fontSize: 12,
          }}
        >
          {asset.displayName}
        </button>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: '#5b6377', width: 150, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#d7dce5', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 11, color: '#5b6377', letterSpacing: 1, margin: '0 0 8px' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * §8 and §10.
 *
 * The specification asks for the engine's directional probabilities — "UP 51.8%
 * / DOWN 48.2%" and an influence breakdown. Those numbers cannot exist: the
 * sign is an independent fair coin at every tick and the magnitude engine
 * cannot observe one, so it is exactly one half and no influence moves it.
 *
 * What is shown instead is the latent magnitude and rhythm state, with that
 * sentence beside it. An operator asking whether this market is exploitable is
 * better served by the reason than by a number that would have to be invented.
 */
function MarketState({ state }: { state: LabState | null }): ReactElement {
  if (state === null)
    return (
      <Section title="MARKET STATE">
        <Row label="state" value="…" />
      </Section>
    );
  return (
    <Section title="MARKET STATE">
      <Row label="sequence" value={String(state.sequence)} />
      <Row label="price" value={state.price} />
      <Row label="lattice level" value={String(state.latticeLevel)} />
      <Row label="previous magnitude" value={String(state.previousMagnitude)} />
      <Row label="previous interval" value={`${String(state.previousIntervalMs)} ms`} />
      <div data-testid="lab-direction" style={{ marginTop: 10 }}>
        <Row
          label="next tick"
          value={`UP ${(100 * state.direction.up).toFixed(3)}%  ·  DOWN ${(100 * state.direction.down).toFixed(3)}%`}
        />
        <div style={{ color: '#8b93a7', fontSize: 11, lineHeight: 1.6, marginTop: 4 }}>
          {state.direction.why}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <Row label="keystream cursors" value={Object.keys(state.cursors).join(', ')} />
        <div style={{ color: '#a2827e', fontSize: 11, marginTop: 4 }}>
          INV-010 forbids publishing these. They exist here and in no production response, which is
          why the Lab is a separate process rather than a flag.
        </div>
      </div>
    </Section>
  );
}

/**
 * Candle Close Control (§19–§37), on a real candle (PH-24.2).
 *
 * The operator picks the current or the next candle on a timeframe, types a
 * price in display units, sees what applying it would do — the lattice level,
 * the instant, how many ticks remain, the measured reachability — applies it,
 * and can release the market at any time. A price between two lattice levels
 * is answered with both, as buttons, and nothing is armed. The outcome of the
 * last applied close is shown once its candle has ended, read the way
 * settlement reads (ADR-0017), because "applied" is a claim about the future
 * and this is the line that checks it.
 */
function CloseControl({
  timeframe,
  onTimeframe,
  bucket,
  onBucket,
  price,
  onPrice,
  onPreview,
  onApply,
  onNeighbour,
  onRelease,
  busy,
  plan,
  notice,
  control,
  displayPrecision,
}: {
  timeframe: CloseTimeframe;
  onTimeframe: (value: CloseTimeframe) => void;
  bucket: 'current' | 'next';
  onBucket: (value: 'current' | 'next') => void;
  price: string;
  onPrice: (value: string) => void;
  onPreview: () => Promise<void>;
  onApply: () => Promise<void>;
  /** A reachable price the Lab offered: applying it is the act, where the plan belongs. */
  onNeighbour: (level: string) => Promise<void>;
  onRelease: () => Promise<void>;
  busy: string | null;
  plan: ClosePlan | null;
  notice: BetweenLevels | string | null;
  control: Control | null;
  displayPrecision: number;
}): ReactElement {
  const field = {
    background: '#0b0e14',
    border: '1px solid #242c3d',
    color: '#d7dce5',
    padding: '4px 8px',
    fontSize: 12,
  } as const;
  const button = (kind: 'neutral' | 'arm' | 'release'): CSSProperties => ({
    background: kind === 'arm' ? '#1f3a2a' : kind === 'release' ? '#3a1f1f' : '#161b26',
    border: `1px solid ${kind === 'arm' ? '#3fb950' : kind === 'release' ? '#f85149' : '#242c3d'}`,
    color: '#d7dce5',
    padding: '4px 12px',
    cursor: busy !== null ? 'wait' : 'pointer',
    fontSize: 12,
  });
  const when = (instant: number): string => new Date(instant).toISOString().slice(11, 19) + ' UTC';
  const armed = control?.armed ?? false;
  return (
    <Section title="CANDLE CLOSE CONTROL">
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}
      >
        <select
          data-testid="lab-close-timeframe"
          value={timeframe}
          onChange={(event) => {
            onTimeframe(event.target.value as CloseTimeframe);
          }}
          style={field}
        >
          {CLOSE_TIMEFRAMES.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <select
          data-testid="lab-close-bucket"
          value={bucket}
          onChange={(event) => {
            onBucket(event.target.value as 'current' | 'next');
          }}
          style={field}
        >
          <option value="current">current candle</option>
          <option value="next">next candle</option>
        </select>
        <input
          data-testid="lab-close-price"
          value={price}
          placeholder={`close, ${String(displayPrecision)} decimals`}
          onChange={(event) => {
            onPrice(event.target.value);
          }}
          style={{ ...field, width: 150 }}
        />
        <button
          type="button"
          data-testid="lab-close-preview"
          disabled={busy !== null}
          onClick={() => {
            void onPreview();
          }}
          style={button('neutral')}
        >
          {busy === 'preview' ? 'sampling…' : 'Preview'}
        </button>
        <button
          type="button"
          data-testid="lab-close-apply"
          disabled={busy !== null || price.trim().length === 0}
          onClick={() => {
            void onApply();
          }}
          style={button('arm')}
        >
          {busy === 'apply' ? 'arming…' : 'Apply'}
        </button>
        <button
          type="button"
          data-testid="lab-close-release"
          disabled={busy !== null || !armed}
          onClick={() => {
            void onRelease();
          }}
          style={button('release')}
        >
          Release market
        </button>
      </div>
      <div data-testid="lab-control" style={{ marginBottom: 8 }}>
        <Row
          label="sign source"
          value={
            armed
              ? `ARMED — ${String(control?.remaining ?? 0)} scripted signs remaining`
              : 'keystream (nothing armed)'
          }
        />
        {control?.lastApplied !== null && control?.lastApplied !== undefined && (
          <Row
            label="last applied"
            value={
              control.lastApplied.closedPrice === null
                ? `target ${control.lastApplied.targetPrice} at ${when(control.lastApplied.instant)} — pending`
                : `target ${control.lastApplied.targetPrice} · closed at ${control.lastApplied.closedPrice} ${
                    control.lastApplied.exact ? '— EXACT' : '— MISSED'
                  }`
            }
          />
        )}
      </div>
      {typeof notice === 'string' && (
        <div
          data-testid="lab-close-notice"
          style={{ color: '#e3b341', fontSize: 11, lineHeight: 1.6 }}
        >
          {notice}
        </div>
      )}
      {notice !== null && typeof notice !== 'string' && (
        <div
          data-testid="lab-close-notice"
          style={{ color: '#e3b341', fontSize: 11, lineHeight: 1.6 }}
        >
          {notice.message}{' '}
          {[notice.below, notice.above].map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => {
                void onNeighbour(level);
              }}
              style={{ ...button('neutral'), marginLeft: 6, padding: '1px 8px' }}
            >
              {level}
            </button>
          ))}
        </div>
      )}
      {plan !== null && (
        <div data-testid="lab-close-plan">
          <Row label="target" value={`${plan.price} (lattice ${String(plan.target)})`} />
          <Row label="closes at" value={when(plan.instant)} />
          <Row label="ticks in window" value={String(plan.ticksInWindow)} />
          <Row label="lattice steps to go" value={String(plan.delta)} />
          <Row label="reachability" value={plan.reachability} />
          <Row label="attempts" value={String(plan.attempts)} />
          <Row
            label="acceptance rate"
            value={plan.acceptanceRate === 0 ? '0' : plan.acceptanceRate.toFixed(6)}
          />
          <Row
            label="armed"
            value={plan.armed ? 'YES — the next ticks are the selected vector' : 'no'}
          />
          {plan.impossible !== null && (
            <div style={{ color: '#e3b341', fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
              {plan.impossible}
              {plan.reachableNeighbours !== null && (
                <>
                  {' '}
                  Reachable next to it:{' '}
                  {plan.reachableNeighbours.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        void onNeighbour(level);
                      }}
                      style={{ ...button('neutral'), marginLeft: 6, padding: '1px 8px' }}
                    >
                      {level}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
      <div style={{ color: '#5b6377', fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
        The close is the price in force at the candle&apos;s end (ADR-0017). It is selected among
        the engine&apos;s own futures, never steered: the rate is the fraction of them that close
        there, and a target the market cannot reach is refused, with the reachable prices beside it
        named.
      </div>
    </Section>
  );
}

/**
 * The session: two timelines, never merged (§72–§73).
 *
 * The engine's own events on one side, the operator's acts on the other. The
 * engine list is empty until PH-24.5 feeds it, and says so rather than
 * pretending nothing happened.
 */
function SessionPanel({ session }: { session: Session | null }): ReactElement {
  const when = (instant: number): string => new Date(instant).toISOString().slice(11, 19);
  return (
    <Section title="SESSION — TWO TIMELINES">
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }} data-testid="lab-session-engine">
          <div style={{ color: '#8b93a7', fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>
            ENGINE — what the market did, unasked
          </div>
          {session === null || session.engine.length === 0 ? (
            <div style={{ color: '#5b6377', fontSize: 11 }}>
              nothing recorded yet — regime and volatility events are fed in PH-24.5
            </div>
          ) : (
            session.engine.map((event, i) => (
              <div key={i} style={{ fontSize: 11, color: '#d7dce5' }}>
                {when(event.at)} · {event.asset} · {event.kind} — {event.detail}
              </div>
            ))
          )}
        </div>
        <div style={{ flex: 1 }} data-testid="lab-session-lab">
          <div style={{ color: '#f85149', fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>
            LAB — what an operator asked for
          </div>
          {session === null || session.lab.length === 0 ? (
            <div style={{ color: '#5b6377', fontSize: 11 }}>no Lab action in this session</div>
          ) : (
            [...session.lab].reverse().map((action, i) => (
              <div key={i} style={{ fontSize: 11, color: '#d7dce5', lineHeight: 1.6 }}>
                {when(action.at)} · {action.asset} · <strong>{action.action}</strong>{' '}
                {action.succeeded ? '✓' : '✗'}{' '}
                <span style={{ color: '#8b93a7' }}>
                  {Object.entries(action.parameters)
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(' ')}
                  {' · '}
                  {Object.entries(action.diagnostics)
                    .filter(([, v]) => v !== null && typeof v !== 'object')
                    .map(
                      ([k, v]) =>
                        `${k}=${typeof v === 'number' ? String(Number(v.toFixed(6))) : String(v)}`,
                    )
                    .join(' ')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Section>
  );
}

/**
 * Scenarios (§48–§49, P1–P16), as selection criteria over the next window.
 *
 * "The Lab defines the scenario. The OTC Engine generates the path." Literally:
 * every candidate is the engine's own continuation and the Lab keeps one whose
 * shape matches. The two scenarios the signs cannot express are shown greyed
 * with the reason, not with a button. A preview shows the selected shape and
 * how rare it was before anything is armed.
 */
function ScenariosPanel({
  scenarios,
  plan,
  notice,
  busy,
  onRun,
}: {
  scenarios: readonly ScenarioView[];
  plan: ScenarioPlan | null;
  notice: string | null;
  busy: string | null;
  onRun: (
    name: string,
    windowMs: number,
    params: Record<string, number>,
    apply: boolean,
  ) => Promise<void>;
}): ReactElement {
  const [windowSeconds, setWindowSeconds] = useState('60');
  const [chosen, setChosen] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const scenario = scenarios.find((s) => s.name === chosen) ?? null;
  const field = {
    background: '#0b0e14',
    border: '1px solid #242c3d',
    color: '#d7dce5',
    padding: '3px 6px',
    fontSize: 11,
    width: 70,
  } as const;
  const numbers = (): Record<string, number> =>
    Object.fromEntries(
      (scenario?.parameters ?? []).map((p) => [
        p.name,
        Number(params[p.name] ?? String(p.default)),
      ]),
    );
  const when = (instant: number): string => new Date(instant).toISOString().slice(11, 19) + ' UTC';
  return (
    <Section title="SCENARIOS — THE LAB DEFINES THE SHAPE, THE ENGINE GENERATES THE PATH">
      <div
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}
        data-testid="lab-scenarios"
      >
        {scenarios.map((s) => (
          <button
            key={s.name}
            type="button"
            data-testid={`lab-scenario-${s.name}`}
            disabled={!s.selectable || busy !== null}
            title={s.why ?? s.label}
            onClick={() => {
              setChosen(s.name);
              setParams({});
            }}
            style={{
              background: chosen === s.name ? '#1f2a3a' : '#161b26',
              border: `1px solid ${s.selectable ? (chosen === s.name ? '#58a6ff' : '#242c3d') : '#2a2a2a'}`,
              color: s.selectable ? '#d7dce5' : '#5b6377',
              padding: '3px 8px',
              fontSize: 11,
              cursor: s.selectable ? 'pointer' : 'not-allowed',
              textDecoration: s.selectable ? 'none' : 'line-through',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {scenarios
        .filter((s) => !s.selectable)
        .map((s) => (
          <div
            key={s.name}
            data-testid={`lab-scenario-why-${s.name}`}
            style={{ color: '#5b6377', fontSize: 11, lineHeight: 1.6 }}
          >
            <strong>{s.label}</strong> — {s.why}
          </div>
        ))}
      {scenario !== null && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            margin: '8px 0',
          }}
        >
          <span style={{ color: '#5b6377', fontSize: 11 }}>window (s)</span>
          <input
            data-testid="lab-scenario-window"
            value={windowSeconds}
            onChange={(e) => {
              setWindowSeconds(e.target.value);
            }}
            style={field}
          />
          {scenario.parameters.map((p) => (
            <span key={p.name} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <span style={{ color: '#5b6377', fontSize: 11 }}>{p.label}</span>
              <input
                data-testid={`lab-scenario-param-${p.name}`}
                value={params[p.name] ?? String(p.default)}
                onChange={(e) => {
                  setParams({ ...params, [p.name]: e.target.value });
                }}
                style={field}
              />
            </span>
          ))}
          <button
            type="button"
            data-testid="lab-scenario-preview"
            disabled={busy !== null}
            onClick={() => {
              void onRun(scenario.name, Number(windowSeconds) * 1000, numbers(), false);
            }}
            style={{
              background: '#161b26',
              border: '1px solid #242c3d',
              color: '#d7dce5',
              padding: '3px 10px',
              fontSize: 11,
            }}
          >
            Preview
          </button>
          <button
            type="button"
            data-testid="lab-scenario-apply"
            disabled={busy !== null}
            onClick={() => {
              void onRun(scenario.name, Number(windowSeconds) * 1000, numbers(), true);
            }}
            style={{
              background: '#1f3a2a',
              border: '1px solid #3fb950',
              color: '#d7dce5',
              padding: '3px 10px',
              fontSize: 11,
            }}
          >
            Apply
          </button>
        </div>
      )}
      {notice !== null && (
        <div
          data-testid="lab-scenario-notice"
          style={{ color: '#e3b341', fontSize: 11, lineHeight: 1.6 }}
        >
          {notice}
        </div>
      )}
      {plan !== null && (
        <div data-testid="lab-scenario-plan">
          <Row label="scenario" value={plan.scenario} />
          <Row
            label="window"
            value={`${String(plan.ticksInWindow)} ticks, until ${when(plan.instant)}`}
          />
          <Row label="attempts" value={String(plan.attempts)} />
          <Row
            label="acceptance rate"
            value={plan.acceptanceRate === 0 ? '0' : plan.acceptanceRate.toFixed(6)}
          />
          {plan.shape !== null && (
            <Row
              label="selected shape"
              value={`net ${String(plan.shape.net)} · high ${String(plan.shape.high)} · low ${String(
                plan.shape.low,
              )} · range ${String(plan.shape.range)} · ${String(plan.shape.directionChanges)} direction changes`}
            />
          )}
          <Row
            label="armed"
            value={plan.armed ? 'YES — the next ticks are the selected continuation' : 'no'}
          />
          {plan.impossible !== null && (
            <div style={{ color: '#e3b341', fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
              {plan.impossible}
            </div>
          )}
        </div>
      )}
      <div style={{ color: '#5b6377', fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
        A scenario is a criterion over the engine&apos;s own futures for the window. Nothing is
        produced, one is chosen; the rate says how rare the shape is, and a shape this market does
        not make in this window is reported as zero, not nudged into being.
      </div>
    </Section>
  );
}

/**
 * Simulated positions (§38–§45) and the presets that decide how they end (§41).
 *
 * Every row shows two outcomes: what the Lab expects — from the armed target if
 * one is armed for that expiry, otherwise from the current price, and it says
 * which — and what the production settlement returned against the Lab's own
 * record once the position expired. They must agree; a row where they do not
 * is a finding about the engine and is marked so.
 */
function PositionsPanel({
  positions,
  onOpen,
  onPreset,
  busy,
  notice,
}: {
  positions: readonly LabPositionView[];
  onOpen: (direction: 'up' | 'down', stake: number, horizonMs: number) => Promise<void>;
  onPreset: (id: string, name: string) => Promise<void>;
  busy: string | null;
  notice: string | null;
}): ReactElement {
  const [stake, setStake] = useState('100');
  const [horizon, setHorizon] = useState('60');
  const when = (instant: number): string => new Date(instant).toISOString().slice(11, 19);
  const field = {
    background: '#0b0e14',
    border: '1px solid #242c3d',
    color: '#d7dce5',
    padding: '4px 8px',
    fontSize: 12,
    width: 80,
  } as const;
  const small = {
    background: '#161b26',
    border: '1px solid #242c3d',
    color: '#d7dce5',
    padding: '2px 8px',
    fontSize: 11,
    cursor: busy !== null ? 'wait' : 'pointer',
  } as const;
  return (
    <Section title="SIMULATED POSITIONS">
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}
      >
        <span style={{ color: '#5b6377', fontSize: 11 }}>stake</span>
        <input
          data-testid="lab-position-stake"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          style={field}
        />
        <span style={{ color: '#5b6377', fontSize: 11 }}>expires in (s)</span>
        <input
          data-testid="lab-position-horizon"
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
          style={field}
        />
        <button
          type="button"
          data-testid="lab-position-call"
          disabled={busy !== null}
          onClick={() => void onOpen('up', Number(stake), Number(horizon) * 1000)}
          style={{ ...small, border: '1px solid #3fb950' }}
        >
          open CALL
        </button>
        <button
          type="button"
          data-testid="lab-position-put"
          disabled={busy !== null}
          onClick={() => void onOpen('down', Number(stake), Number(horizon) * 1000)}
          style={{ ...small, border: '1px solid #f85149' }}
        >
          open PUT
        </button>
      </div>
      {notice !== null && (
        <div
          data-testid="lab-position-notice"
          style={{ color: '#e3b341', fontSize: 11, lineHeight: 1.6, marginBottom: 6 }}
        >
          {notice}
        </div>
      )}
      <div data-testid="lab-positions">
        {positions.length === 0 && (
          <div style={{ color: '#5b6377', fontSize: 11 }}>no simulated position</div>
        )}
        {positions.map((p) => (
          <div
            key={p.id}
            data-testid={`lab-position-${p.id}`}
            style={{
              borderTop: '1px solid #1b2130',
              padding: '6px 0',
              fontSize: 11,
              lineHeight: 1.7,
            }}
          >
            <div style={{ color: '#d7dce5' }}>
              <strong>{p.id}</strong> · {p.direction === 'up' ? 'CALL' : 'PUT'} · stake{' '}
              {String(p.stake)} · entry {p.entryDisplay} · expires {when(p.expiryInstant)} UTC
            </div>
            <div style={{ color: '#8b93a7' }}>
              expected <strong style={{ color: '#d7dce5' }}>{p.expected.outcome}</strong> at{' '}
              {p.expected.closeDisplay}{' '}
              <span style={{ color: '#5b6377' }}>({p.expected.basis})</span>
              {' · '}
              actual{' '}
              {p.actual === null ? (
                <span style={{ color: '#5b6377' }}>not expired</span>
              ) : (
                <span
                  data-testid={`lab-position-${p.id}-actual`}
                  style={{ color: p.actual.agrees ? '#3fb950' : '#f85149' }}
                >
                  <strong>{p.actual.outcome}</strong> at {p.actual.expiryDisplay} · net{' '}
                  {String(p.actual.net)}{' '}
                  {p.actual.agrees ? '— agrees' : '— DISAGREES WITH EXPECTED'}
                </span>
              )}
            </div>
            {p.actual === null && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {PRESET_LABELS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    data-testid={`lab-preset-${p.id}-${preset.name}`}
                    disabled={busy !== null}
                    onClick={() => void onPreset(p.id, preset.name)}
                    style={small}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ color: '#5b6377', fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
        A preset is a close at the position&apos;s expiry — one lattice level from entry, which is
        the asset&apos;s own tick. Settlement is the production engine against this Lab&apos;s
        record; the two columns must agree, and a row where they do not is a finding, not a display
        bug.
      </div>
    </Section>
  );
}

/**
 * §70, over the operator (PH-24.5 §2).
 *
 * The paths a selection produces carry no signature — that is the construction,
 * and a plant that replaced the sampler with a solver was caught. What can
 * carry one is the hand choosing the closes: a session that always closes one
 * step past entry is a distribution no natural market has. This shows that
 * distribution and what it rests on, and refuses to call three closes a
 * pattern.
 */
function ClosesPanel({ closes }: { closes: ClosesView | null }): ReactElement {
  const colour =
    closes === null || closes.verdict === 'too-few-to-say'
      ? '#8b93a7'
      : closes.verdict === 'one-sided'
        ? '#e3b341'
        : '#3fb950';
  return (
    <Section title="THIS SESSION'S CLOSES — THE OPERATOR'S PATTERN, NOT THE PATH'S">
      <div data-testid="lab-closes">
        {closes === null ? (
          <div style={{ color: '#5b6377', fontSize: 11 }}>no reading yet</div>
        ) : (
          <>
            <Row
              label="controlled closes"
              value={`${String(closes.controlled)} (a verdict needs ${String(closes.minimumForVerdict)})`}
            />
            <Row
              label="one lattice step away"
              value={
                closes.oneStepFraction === null
                  ? '—'
                  : `${String(Math.round(closes.oneStepFraction * 100))}%`
              }
            />
            <Row
              label="distances (steps: count)"
              value={
                Object.keys(closes.distances).length === 0
                  ? '—'
                  : Object.entries(closes.distances)
                      .map(([d, n]) => `${d}: ${String(n)}`)
                      .join(' · ')
              }
            />
            <div
              style={{ color: colour, fontSize: 12, marginTop: 4 }}
              data-testid="lab-closes-verdict"
            >
              <strong>{closes.verdict.toUpperCase()}</strong>
            </div>
            <div style={{ color: '#8b93a7', fontSize: 11, lineHeight: 1.6 }}>{closes.note}</div>
          </>
        )}
      </div>
    </Section>
  );
}

/** §52–§68, from the laboratory that has been running headless for eight phases. */
/**
 * What the screen prints, and why none of the three is the bare word "clean".
 *
 * "Clean" and "clean at a stated resolution" are different claims and only the
 * second can be acted on — the distinction `VALIDATION.md` exists to keep, and
 * the one Cycle Audit 7 caught PH-21 collapsing (CA7-05).
 */
const VERDICT: Record<Quality['predictability']['verdict'], string> = {
  inconclusive: 'INCONCLUSIVE — too few hypotheses survived to have looked',
  'clean-above-resolution': 'clean, above the resolution below',
  exploitable: 'EDGE DETECTED',
};

function QualityPanel({
  quality,
  busy,
  onRun,
}: {
  quality: Quality | null;
  busy: boolean;
  onRun: () => Promise<void>;
}): ReactElement {
  return (
    <Section title="MARKET QUALITY">
      <button
        type="button"
        data-testid="lab-quality"
        disabled={busy}
        onClick={() => {
          void onRun();
        }}
        style={{
          background: '#161b26',
          border: '1px solid #242c3d',
          color: '#d7dce5',
          padding: '4px 12px',
          cursor: busy ? 'wait' : 'pointer',
          fontSize: 12,
          marginBottom: 8,
        }}
      >
        {busy ? 'running the battery…' : 'Run'}
      </button>
      {quality !== null && (
        <div data-testid="lab-quality-result">
          {/*
            "at this sample", never a bare `plausible` / `IMPLAUSIBLE`. Three
            consecutive forks of one market at this size measured 14/15, 15/15
            and 15/15 — so the word flips and the market does not.
          */}
          <Row
            label="realism"
            value={`${String(quality.realism.passed)} of ${String(
              quality.realism.of,
            )} metrics inside their bands, on this fork`}
          />
          <div
            data-testid="lab-realism-note"
            style={{ color: '#8b93a7', fontSize: 11, lineHeight: 1.6, margin: '2px 0 8px' }}
          >
            {quality.realism.note}
          </div>
          <Row label="predictability" value={VERDICT[quality.predictability.verdict]} />
          <Row
            label="resolution"
            value={`no edge above ${quality.predictability.resolutionPoints.toFixed(2)}pp`}
          />
          <Row
            label="hypotheses tested"
            value={`${String(quality.predictability.hypothesesTested)} (a verdict needs ${String(
              quality.predictability.minimumHypotheses,
            )})`}
          />
          <Row label="sampled ticks" value={String(quality.sampledTicks)} />
          <div
            data-testid="lab-quality-caveat"
            style={{ color: '#e3b341', fontSize: 11, marginTop: 6, lineHeight: 1.6 }}
          >
            {quality.bounded}
          </div>
          {/*
            The battery's own account of what it could not test. It was being
            computed and dropped: the first version of this panel printed a
            green `clean` resting on two hypotheses out of eight hundred, and
            these are the four sentences that would have said so.
          */}
          <ul
            data-testid="lab-quality-notes"
            style={{
              color: '#8b93a7',
              fontSize: 11,
              lineHeight: 1.6,
              margin: '6px 0 0',
              paddingLeft: 16,
            }}
          >
            {quality.predictability.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
