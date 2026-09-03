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

export async function labGet<T>(path: string): Promise<T | Unavailable> {
  const response = await fetch(`/lab/${path}`);
  return (await response.json()) as T | Unavailable;
}

/** The Lab's acts — apply, release, open, preset, scenario — as JSON writes carrying only the query. */
export async function labPost<T>(path: string): Promise<T | Unavailable> {
  const response = await fetch(`/lab/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return (await response.json()) as T | Unavailable;
}

export interface LabMarket {
  readonly id: string;
  readonly displayName: string;
  readonly family: string;
}

export interface LabState {
  readonly environment: string;
  readonly sequence: number;
  /** Rendered to the asset's display precision; the lattice level is beside it. */
  readonly price: string;
  readonly latticeLevel: number;
  readonly previousMagnitude: number;
  readonly previousIntervalMs: number;
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
}

export interface BetweenLevels {
  readonly message: string;
  readonly below: string;
  readonly above: string;
}

export const isBetween = (value: unknown): value is BetweenLevels =>
  typeof value === 'object' && value !== null && 'below' in value && 'above' in value;

export interface Control {
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
}

export interface Quality {
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
