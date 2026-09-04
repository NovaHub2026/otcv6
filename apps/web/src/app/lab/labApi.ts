/**
 * The Lab's client: shapes the routes answer with, and the two calls.
 *
 * Kept apart from the screens (PH-24.6) so a section is a view over a shape
 * and nothing else. The Lab is reached through the panel's own proxy
 * (`/lab/*`), which points at `OTC_LAB_BASE` and never at the engine
 * (ADR-0015 §3).
 */
export interface Unavailable {
  readonly running: false;
  readonly reason: string;
}

export const isUnavailable = (value: unknown): value is Unavailable =>
  typeof value === 'object' && value !== null && (value as { running?: unknown }).running === false;

/**
 * A failed request is an answer, never an exception (PH-24.11): the screen
 * reads the reason and every button stays usable. A `busy` flag held by a
 * request that never came back locked the strip on 2026-09-03.
 */
async function asJson<T>(request: Promise<Response>): Promise<T | Unavailable> {
  try {
    const response = await request;
    return (await response.json()) as T | Unavailable;
  } catch (error) {
    return { running: false, reason: `no se alcanza el Lab: ${(error as Error).message}` };
  }
}

export async function labGet<T>(path: string): Promise<T | Unavailable> {
  return asJson<T>(fetch(`/lab/${path}`));
}

/** The Lab's acts — apply, release, open, preset, scenario — as JSON writes carrying only the query. */
export async function labPost<T>(path: string): Promise<T | Unavailable> {
  return asJson<T>(
    fetch(`/lab/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  );
}

export interface LabMarket {
  readonly id: string;
  readonly displayName: string;
  readonly family: string;
}

export interface LabState {
  readonly environment: string;
  readonly sequence: number;
  /** PH-24.18: the market's own distance unit — a quarter of its median 1m range. */
  readonly distance?: {
    readonly unitSteps: number;
    readonly unitPrice: string;
    readonly candleRangeSteps: number;
    readonly minutes: number;
  };
  /** Rendered to the asset's display precision; the lattice level is beside it. */
  readonly price: string;
  readonly latticeLevel: number;
  readonly previousMagnitude: number;
  readonly previousIntervalMs: number;
  readonly netDisplacement?: { readonly '1m': number | null; readonly '5m': number | null };
  readonly magnitudeState: {
    readonly modulators?: readonly ({
      regime?: string;
      phase?: string;
      remainingMs?: number;
      ageMs?: number;
    } | null)[];
  };
  readonly arrivalState: { readonly excitation?: number; readonly averageMagnitude?: number };
  readonly cursors: Readonly<Record<string, string>>;
  readonly direction: { readonly up: number; readonly down: number; readonly why: string };
}

export interface ClosePlan {
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
  /** PH-24.17: an apply that took the reachable neighbour of an off-parity request. */
  readonly adjusted?: { requested: string; applied: string; why: string } | null;
}

export interface BetweenLevels {
  readonly message: string;
  readonly below: string;
  readonly above: string;
}

export const isBetween = (value: unknown): value is BetweenLevels =>
  typeof value === 'object' && value !== null && 'below' in value && 'above' in value;

export type Pace = 'normal' | 'medio' | 'rapido';

export interface Pushing {
  readonly direction: 1 | -1;
  readonly requested: number;
  readonly remaining: number;
  readonly pace?: Pace;
}

export interface PushResult extends Control {
  readonly direction: 'up' | 'down';
  readonly ticks: number;
  readonly pace?: Pace;
  readonly extended: boolean;
  readonly landing: {
    readonly latticeLevel: number;
    readonly price: string;
    readonly afterTicks: number;
  };
  readonly released: { readonly discarded: number } | null;
  readonly distance?: {
    readonly units: number;
    readonly unitSteps: number;
    readonly ticks: number;
  } | null;
}

export interface Control {
  readonly armed: boolean;
  readonly remaining: number;
  readonly pushing?: Pushing | null;
  /** PH-24.16: the sustained direction, or null. */
  readonly bias?: 1 | -1 | null;
  readonly lastPush?: {
    readonly direction: 1 | -1;
    readonly ticks: number;
    readonly sequence: number;
    readonly landingPrice: string;
    readonly landedPrice: string | null;
    readonly exact: boolean | null;
  } | null;
  readonly lastApplied: {
    readonly instant: number;
    readonly target: number;
    readonly targetPrice: string;
    readonly closed: number | null;
    readonly closedPrice: string | null;
    readonly exact: boolean | null;
    readonly onBoundary?: boolean;
  } | null;
}

export interface MarketControl extends Control {
  readonly id: string;
  readonly displayName: string;
  readonly price: string | null;
  readonly regime: string | null;
  readonly openPositions: number;
}

export interface ControlAll {
  readonly markets: readonly MarketControl[];
}

export interface KeptSnapshotView {
  readonly sequence: number;
  readonly instant: number;
  readonly keptAt: number;
  readonly why: 'arm' | 'release' | 'time';
  readonly script: number;
}

export interface ReplayView {
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly replayed: number;
  readonly identical: boolean;
  readonly firstDivergence: { sequence: number } | null;
  readonly scriptPlayed: number;
}

export interface MirrorView {
  readonly plain: { ticks: number; net: number; high: number; low: number };
  readonly mirror: { ticks: number; net: number; high: number; low: number };
  readonly onlySignsDiffer: boolean;
}

export interface Session {
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

export interface ClosesView {
  readonly controlled: number;
  readonly distances: Readonly<Record<string, number>>;
  readonly oneStepFraction: number | null;
  readonly minimumForVerdict: number;
  readonly verdict: 'too-few-to-say' | 'no-pattern' | 'one-sided';
  readonly note: string;
}

export interface PositionsView {
  readonly settled: number;
  readonly byOutcome: Readonly<Record<string, number>>;
  readonly byPreset: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly winFraction: number | null;
  readonly minimumForVerdict: number;
  readonly verdict: 'too-few-to-say' | 'no-pattern' | 'one-sided';
  readonly note: string;
}

export interface LabPositionView {
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

export interface ScenarioView {
  readonly name: string;
  readonly label: string;
  readonly selectable: boolean;
  readonly why: string | null;
  readonly parameters: readonly { name: string; label: string; default: number }[];
}

export interface ScenarioPlan {
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
  readonly shockAt?: number | null;
  readonly targetLevel?: number | null;
  readonly targetPrice?: string | null;
}

export interface GranularityView {
  readonly minutes: number;
  readonly ticksPerMinute: { readonly median: number; readonly p10: number; readonly p90: number };
  readonly gapOverRange: { readonly median: number; readonly shareAboveQuarter: number };
  readonly step: { readonly median: number; readonly p90: number; readonly zeroShare: number };
  readonly intervalMs: { readonly median: number; readonly p90: number };
}

export interface Quality {
  readonly granularity?: GranularityView;
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

export type CloseTimeframe = '30s' | '1m' | '5m' | '15m';
export const CLOSE_TIMEFRAMES: readonly CloseTimeframe[] = ['30s', '1m', '5m', '15m'];

/** HH:MM:SS UTC, the operator's clock. */
export const when = (instant: number): string =>
  `${new Date(instant).toISOString().slice(11, 19)} UTC`;

/**
 * The engine's own event lines, in the operator's language.
 *
 * The observer writes English detail strings (`observed: regime normal, cascade
 * coil`); the screen translates the ones it knows and shows the rest as they
 * came, so nothing the engine said is lost in the translation.
 */
export function describeEvent(detail: string): string {
  const observed = /^observed: regime (\S+), cascade (\S+)$/.exec(detail);
  if (observed) return `observado: régimen ${observed[1]!}, cascada ${observed[2]!}`;
  const regime = /^volatility regime (\S+) → (\S+)$/.exec(detail);
  if (regime) return `régimen de volatilidad ${regime[1]!} → ${regime[2]!}`;
  const phase = /^cascade phase (\S+) → (\S+)$/.exec(detail);
  if (phase) return `fase de la cascada ${phase[1]!} → ${phase[2]!}`;
  if (/^market stalled/.test(detail)) return 'mercado parado (límite de recuperación)';
  if (/^market publishing again/.test(detail)) return 'mercado publicando de nuevo';
  return detail;
}
