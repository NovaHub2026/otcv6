import type { HistoryCandle, InstrumentView } from './series.js';

/**
 * The panel's view of the engine, and it is read-only by construction.
 *
 * Every function here maps onto an endpoint that answers a question about what
 * the engine *is* or *was*. None of them writes, because PH-18 is Preview: an
 * operator who cannot see an asset has no business creating one, so seeing comes
 * first and the submenus that change things come after.
 */

export interface CatalogueEntry extends InstrumentView {
  readonly id: string;
  readonly displayName: string;
  readonly family: string;
  readonly live: boolean;
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
