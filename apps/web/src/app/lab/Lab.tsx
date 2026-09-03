'use client';

import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';

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

interface Reachability {
  readonly delta: number;
  readonly ticksRemaining: number;
  readonly attempts: number;
  readonly acceptanceRate: number;
  readonly reachability: string;
  readonly impossible: string | null;
}

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

const isUnavailable = (value: unknown): value is Unavailable =>
  typeof value === 'object' && value !== null && (value as { running?: unknown }).running === false;

export function Lab(): ReactElement {
  const [assets, setAssets] = useState<LabMarket[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<LabState | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [delta, setDelta] = useState('0');
  const [reach, setReach] = useState<Reachability | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    // The Lab's own markets, never production's. A screen that listed the
    // production catalogue beside a close-selection control would be offering
    // to steer a market carrying positions, whatever the request underneath
    // actually reached (§3). It cannot name one because it never learns one.
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

  const probe = async (): Promise<void> => {
    if (selected === null) return;
    setBusy('reachability');
    const body = await labGet<Reachability>(`markets/${selected}/reachable/${delta.trim()}`);
    setBusy(null);
    if (isUnavailable(body)) {
      setUnavailable(body.reason);
      return;
    }
    setReach(body);
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
            delta={delta}
            onDelta={setDelta}
            onProbe={probe}
            busy={busy === 'reachability'}
            result={reach}
          />
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

/** §19–§37, as far as PH-23 built it: reachability, measured. */
function CloseControl({
  delta,
  onDelta,
  onProbe,
  busy,
  result,
}: {
  delta: string;
  onDelta: (value: string) => void;
  onProbe: () => Promise<void>;
  busy: boolean;
  result: Reachability | null;
}): ReactElement {
  return (
    <Section title="CANDLE CLOSE CONTROL — REACHABILITY">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          data-testid="lab-delta"
          value={delta}
          onChange={(event) => {
            onDelta(event.target.value);
          }}
          style={{
            width: 120,
            background: '#0b0e14',
            border: '1px solid #242c3d',
            color: '#d7dce5',
            padding: '4px 8px',
            fontSize: 12,
          }}
        />
        <span style={{ color: '#5b6377', fontSize: 11 }}>lattice steps from here</span>
        <button
          type="button"
          data-testid="lab-probe"
          disabled={busy}
          onClick={() => {
            void onProbe();
          }}
          style={{
            background: '#161b26',
            border: '1px solid #242c3d',
            color: '#d7dce5',
            padding: '4px 12px',
            cursor: busy ? 'wait' : 'pointer',
            fontSize: 12,
          }}
        >
          {busy ? 'sampling…' : 'Measure'}
        </button>
      </div>
      {result !== null && (
        <div data-testid="lab-reachability">
          <Row label="reachability" value={result.reachability} />
          <Row label="ticks remaining" value={String(result.ticksRemaining)} />
          <Row label="attempts" value={String(result.attempts)} />
          <Row
            label="acceptance rate"
            value={result.acceptanceRate === 0 ? '0' : result.acceptanceRate.toFixed(6)}
          />
          {result.impossible !== null && (
            <div style={{ color: '#e3b341', fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
              {result.impossible}
            </div>
          )}
        </div>
      )}
      <div style={{ color: '#5b6377', fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
        The rate is measured, not estimated: it is the fraction of the engine&apos;s own futures
        that close there. A target the market cannot reach is refused by arithmetic, without
        sampling.
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
