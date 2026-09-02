import type { HistoryCandle, InstrumentView } from '@otc/chart';

/**
 * The panel's view of the engine, and it is read-only by construction.
 *
 * Most of it maps onto an endpoint that answers a question about what the engine
 * *is* or *was*. Three functions write — creating an asset, renaming one,
 * retiring one — and they arrived in that order for a reason: an operator who
 * cannot see an asset has no business creating one, and one who cannot create
 * one has nothing to retire.
 */

export interface CatalogueEntry extends InstrumentView {
  readonly id: string;
  readonly displayName: string;
  readonly family: string;
  readonly live: boolean;
  readonly retired?: boolean;
  readonly meanIntervalMs: number;
  readonly tieRate: number;
  readonly excessKurtosis: number;
  readonly dispersion: {
    readonly quarterlyLogSigma: number;
    readonly quarterlyPercent: number;
  };
}

export interface HistoryResponse {
  readonly assetId: string;
  readonly timeframe: string;
  readonly from: number;
  readonly to: number;
  readonly candles: readonly HistoryCandle[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, signal === undefined ? {} : { signal });
  if (!response.ok) {
    // The engine's refusals say why — a timeframe finer than the stored base, a
    // window that ends before it starts. Swallowing that into "failed to load"
    // would throw away the only part of the message worth reading.
    const body = (await response.text()).slice(0, 500);
    throw new ApiError(response.status, `${response.status} from ${url}: ${body}`);
  }
  return (await response.json()) as T;
}

export function fetchCatalogue(apiBase: string, signal?: AbortSignal): Promise<CatalogueEntry[]> {
  return getJson<CatalogueEntry[]>(`${apiBase}/catalogue`, signal);
}

export function fetchHistory(
  apiBase: string,
  assetId: string,
  timeframe: string,
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<HistoryResponse> {
  const query = new URLSearchParams({
    timeframe,
    from: String(Math.floor(from)),
    to: String(Math.ceil(to)),
  });
  return getJson<HistoryResponse>(
    `${apiBase}/markets/${assetId}/history?${query.toString()}`,
    signal,
  );
}

export interface ArchetypeEntry {
  readonly id: string;
  readonly label: string;
  readonly family: string;
  readonly character: string;
  readonly dispersion: {
    readonly min: number;
    readonly max: number;
    readonly minPercent: number;
    readonly maxPercent: number;
  };
}

/** What an operator supplies to create an asset. Five fields, none directional. */
export interface AssetBriefInput {
  readonly id: string;
  readonly archetypeId: string;
  readonly displayName: string;
  readonly referencePrice: number;
  readonly dispersion?: number;
  readonly displayPrecision?: number;
}

export interface RegistrationJobView {
  readonly id: string;
  readonly brief: AssetBriefInput;
  readonly state: 'queued' | 'running' | 'registered' | 'refused' | 'failed';
  readonly stage: string | null;
  readonly reason: string | null;
  readonly assetId: string | null;
  readonly submittedAt: number;
  readonly finishedAt: number | null;
}

export function fetchArchetypes(apiBase: string, signal?: AbortSignal): Promise<ArchetypeEntry[]> {
  return getJson<ArchetypeEntry[]>(`${apiBase}/archetypes`, signal);
}

/**
 * Start a registration. Returns a job id, never an asset.
 *
 * Four of the pipeline's six stages are simulation and it runs for seconds to
 * tens of seconds, so there is nothing to return yet. This is the one function
 * in this module that writes, and it writes a *request* rather than a record.
 */
export async function createAsset(
  apiBase: string,
  brief: AssetBriefInput,
  signal?: AbortSignal,
): Promise<{ job: string }> {
  const response = await fetch(`${apiBase}/assets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(brief),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    // A refusal here is a *named* one — a duplicate id, an unknown family, a
    // display coarser than the lattice. Reducing it to "could not create" would
    // discard the only part an operator can act on.
    const body = (await response.text()).slice(0, 500);
    let message = body;
    try {
      message = (JSON.parse(body) as { message?: string }).message ?? body;
    } catch {
      /* not JSON; the text is the message */
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as { job: string };
}

export function fetchRegistration(
  apiBase: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<RegistrationJobView> {
  return getJson<RegistrationJobView>(`${apiBase}/registrations/${jobId}`, signal);
}

/**
 * Rename an asset. The display name is the only editable field there is.
 *
 * Everything else about a market — its id, its lattice, its reference price, its
 * personality — decided what already happened, and the engine refuses to change
 * any of it **by name**, so the message a refusal carries is worth showing.
 */
export async function renameAsset(
  apiBase: string,
  assetId: string,
  displayName: string,
): Promise<void> {
  await write(`${apiBase}/assets/${assetId}`, 'PATCH', { displayName });
}

/** Retire an asset: stop hosting it, keep everything it published. Final. */
export async function retireAsset(apiBase: string, assetId: string): Promise<void> {
  await write(`${apiBase}/assets/${assetId}/retire`, 'POST', null);
}

async function write(url: string, method: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    ...(body === null
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = (await response.text()).slice(0, 500);
  if (!response.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* not JSON; the text is the message */
    }
    throw new ApiError(response.status, message);
  }
  return text === '' ? null : (JSON.parse(text) as unknown);
}
