import { reduceToColumns, type Column, type TickWindow } from '@otc/chart';
import type { Tick } from '@otc/core/browser';

/**
 * Connect a `TickWindow` to the PH-7 stream, resuming exactly when it can and
 * starting over honestly when it cannot.
 *
 * The only interesting decisions here are what to do when the connection drops.
 * The tempting answer — reopen the stream and carry on — silently loses whatever
 * arrived while disconnected, and the chart then draws a line across the hole.
 * So a reconnection asks for `window.resumeFrom`, and a batch that does not
 * continue the window is refused by the window itself rather than absorbed.
 *
 * ## When the server will not resume (a6-11)
 *
 * The replay window is finite: ~4.6 hours of `btcusd`, ~46 of `spx`, a laptop
 * closed overnight. A resume point older than that is answered with a 400, and
 * the first version of this module asked for the same evicted sequence every
 * second for ever — a browser's `EventSource` cannot see a status code, only
 * that the connection failed. It *can* see whether the connection ever opened:
 * a refusal fails before `onopen`, a drop fails after it. So a resume that is
 * refused is not retried. The window is replaced with an empty one, the caller
 * is told there was a gap, and the stream reopens from now. What the old window
 * held is gone rather than joined across a hole, because the client cannot know
 * what it missed (INV-002).
 *
 * Every retry backs off: the first after one second, then two, four, up to
 * thirty, reset by a successful open. One request a second against an engine
 * that is down is a client contributing to the outage.
 */
export interface StreamHandle {
  close(): void;
}

/** What the stream tells its caller about itself, beside the ticks. */
export type StreamNotice =
  | { readonly kind: 'live'; readonly afterGap: boolean }
  | {
      readonly kind: 'reconnecting';
      readonly attempt: number;
      readonly inMs: number;
      readonly resuming: boolean;
    }
  | { readonly kind: 'gap'; readonly reason: string };

/** The slice of `fetch` this module needs: a URL in, `ok` and a JSON body out. */
export type FetchLike = (
  url: string,
) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;

export interface StreamOptions {
  /** Delay before the first reconnect; doubles per consecutive failure. */
  readonly backoffMs?: number;
  /** The longest delay between attempts. */
  readonly maxBackoffMs?: number;
  /** The `EventSource` implementation, injectable so the policy can be tested in Node. */
  readonly eventSource?: typeof EventSource;
  /**
   * How to ask the engine which markets it still hosts, injectable the same
   * way. Only the multiplexed stream asks, and only when a whole set has been
   * refused before it opened (a5-03).
   */
  readonly fetch?: FetchLike;
}

export const DEFAULT_RECONNECT_BACKOFF_MS = 1_000;
export const MAX_RECONNECT_BACKOFF_MS = 30_000;

export function streamMarket(
  apiBase: string,
  assetId: string,
  createWindow: () => TickWindow,
  onUpdate: (window: TickWindow) => void,
  onNotice: (notice: StreamNotice) => void = () => undefined,
  options: StreamOptions = {},
): StreamHandle {
  const backoffMs = options.backoffMs ?? DEFAULT_RECONNECT_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? MAX_RECONNECT_BACKOFF_MS;
  const Source = options.eventSource ?? EventSource;

  let window = createWindow();
  let closed = false;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive failed attempts; the backoff exponent. Reset by an open. */
  let failures = 0;
  /** Whether the current window began after a refused resume. */
  let afterGap = false;

  const connect = (resume: boolean): void => {
    if (closed) return;
    const from = resume ? window.resumeFrom : undefined;
    const query = from === undefined ? '' : `?from=${String(from)}`;
    let opened = false;
    const current = new Source(`${apiBase}/markets/${assetId}/stream${query}`);
    source = current;

    current.onopen = (): void => {
      opened = true;
      failures = 0;
      onNotice({ kind: 'live', afterGap });
    };

    current.onmessage = (event: MessageEvent<string>): void => {
      const tick = JSON.parse(event.data) as Tick;
      // Appended one at a time so a contiguity failure names the exact tick.
      window.append([tick]);
      onUpdate(window);
    };

    current.onerror = (): void => {
      current.close();
      if (closed || source !== current) return;
      source = null;
      failures += 1;
      let nextResume = true;
      if (!opened && from !== undefined) {
        // Refused before it opened, with a resume point: evicted, unknown, or
        // an engine that no longer has this market. Asking again would be the
        // loop this exists to end. Start over and say so.
        window = createWindow();
        afterGap = true;
        nextResume = false;
        onNotice({ kind: 'gap', reason: `the engine refused to resume from sequence ${from}` });
      }
      const inMs = Math.min(backoffMs * 2 ** (failures - 1), maxBackoffMs);
      onNotice({
        kind: 'reconnecting',
        attempt: failures,
        inMs,
        resuming: nextResume && window.resumeFrom !== undefined,
      });
      timer = setTimeout(() => {
        timer = null;
        connect(nextResume);
      }, inMs);
    };
  };

  connect(true);
  return {
    close(): void {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      source?.close();
      source = null;
    },
  };
}

/** Visible spans a viewer can choose between. */
export const TIMEFRAMES = [
  { label: '1m', spanMs: 60_000 },
  { label: '5m', spanMs: 300_000 },
  { label: '15m', spanMs: 900_000 },
  { label: '1h', spanMs: 3_600_000 },
] as const;

export type TimeframeLabel = (typeof TIMEFRAMES)[number]['label'];

/**
 * Reduce the last `spanMs` of what the window holds to drawable columns.
 *
 * Changing the timeframe changes only which slice of the record is shown and how
 * finely it is cut. It never refetches, never resamples the underlying data, and
 * never changes a price — which is INV-004 as a viewer experiences it: switching
 * the view cannot change the market.
 *
 * When the window holds less than the requested span, the view simply shows what
 * exists. It does not pad the beginning with anything, because a bar before the
 * first tick would assert a trade that had not happened yet.
 */
export function columnsFor(window: TickWindow, columns: number, spanMs?: number): Column[] {
  const span = window.span;
  if (span === null) return [];
  const to = (span.to + 1) as typeof span.to;
  const from =
    spanMs === undefined ? span.from : (Math.max(span.from, to - spanMs) as typeof span.from);
  if (!(to > from)) return [];
  const { instants, prices } = window.series();
  return reduceToColumns(instants, prices, { from, to, columns });
}

/** What one market on a multiplexed stream tells its chart (PH-30.2). */
export type MarketNotice =
  | StreamNotice
  | { readonly kind: 'hole'; readonly from: number; readonly to: number }
  | { readonly kind: 'retired'; readonly reason: string };

export interface MultiplexedHandle {
  close(): void;
  /** The one connection every chart on the page shares, or null between attempts. */
  readonly connected: boolean;
}

/**
 * Several markets on **one** stream (PH-30.2, Issue #16).
 *
 * A browser allows six connections per origin on HTTP/1.1, so a page with
 * eight charts on eight streams blocks on the seventh. `/markets/stream`
 * carries any set of assets on one connection, each frame naming its asset;
 * this opens that one connection for the page, keeps a window per asset,
 * resumes every asset from its own last sequence plus one after a drop, and
 * tells each chart what happened to *its* market: a gap the venue announced
 * (as a bounded hole when the frame names `resumesAt`), a close because the
 * market was retired, or the plain reconnect notices `streamMarket` gives.
 *
 * ## When the set itself is refused (a5-03, a8-08)
 *
 * One connection for eight charts means one refusal for eight charts, and a
 * refusal arrives with no status code — only the fact that the connection never
 * opened. Two things cause it, and they are answered in order. A resume point
 * the venue will not serve is the first: the windows that held one are replaced
 * and their charts are told there was a gap, exactly as `streamMarket` has done
 * since a6-11, and the set is asked for again from now. A market that has *gone*
 * — retired while this page was disconnected — is the second: the venue answers
 * 404 for the whole set because of the one asset it no longer hosts, and no
 * `close` frame can teach the page that, because a `close` frame needs a
 * connection that opened. So when the set is refused with no resume point left
 * to blame, the engine is asked which markets it still hosts and the ones it
 * does not name are dropped, each chart told its market is retired. A venue
 * that lists nothing (still booting) or cannot be asked drops nobody: a market
 * the engine still serves is never silently taken off the page.
 */
export function streamMarkets(
  apiBase: string,
  assetIds: readonly string[],
  createWindow: () => TickWindow,
  onUpdate: (assetId: string, window: TickWindow) => void,
  onNotice: (assetId: string | null, notice: MarketNotice) => void = () => undefined,
  options: StreamOptions = {},
): MultiplexedHandle {
  const backoffMs = options.backoffMs ?? DEFAULT_RECONNECT_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? MAX_RECONNECT_BACKOFF_MS;
  const Source = options.eventSource ?? EventSource;
  const ask: FetchLike = options.fetch ?? ((url) => fetch(url));
  const windows = new Map<string, TickWindow>(assetIds.map((id) => [id, createWindow()]));
  const retired = new Set<string>();
  let closed = false;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let connected = false;

  /**
   * Which of `carried` the engine no longer hosts, dropped and reported.
   *
   * The engine's own list is the only thing that can tell a retired market from
   * a venue that is down, and it is read defensively: an answer that is not a
   * non-empty list of markets drops nobody, so a refusal, a proxy error page or
   * a venue that has not finished resuming leaves the page exactly as it was.
   */
  const dropWhatIsGone = async (carried: readonly string[]): Promise<void> => {
    const hosted = new Set<string>();
    try {
      const response = await ask(`${apiBase}/markets`);
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (!Array.isArray(body) || body.length === 0) return;
      for (const market of body as { id?: unknown }[])
        if (typeof market.id === 'string') hosted.add(market.id);
    } catch {
      return; // unreachable: the backoff is the answer, not a page full of retirements
    }
    if (hosted.size === 0) return;
    // The page can be taken down while this request is in flight; a chart that
    // no longer exists is not told its market retired.
    if (closed) return;

    for (const id of carried) {
      if (hosted.has(id) || retired.has(id)) continue;
      retired.add(id);
      onNotice(id, { kind: 'retired', reason: 'the engine no longer hosts this market' });
    }
  };

  const connect = (): void => {
    if (closed) return;
    const carried = assetIds.filter((id) => !retired.has(id));
    if (carried.length === 0) return;
    const from = carried
      .map((id) => [id, windows.get(id)!.resumeFrom] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
      .map(([id, sequence]) => `${id}:${String(sequence)}`)
      .join(',');
    const params = new URLSearchParams({ assets: carried.join(','), onGap: 'live' });
    if (from.length > 0) params.set('from', from);
    let opened = false;
    const current = new Source(`${apiBase}/markets/stream?${params.toString()}`);
    source = current;

    current.onopen = (): void => {
      opened = true;
      connected = true;
      failures = 0;
      for (const id of carried) onNotice(id, { kind: 'live', afterGap: false });
    };

    current.onmessage = (event: MessageEvent<string>): void => {
      const frame = JSON.parse(event.data) as Tick & { asset: string };
      const window = windows.get(frame.asset);
      if (window === undefined) return;
      window.append([{ sequence: frame.sequence, instant: frame.instant, price: frame.price }]);
      onUpdate(frame.asset, window);
    };

    current.addEventListener('gap', (event: Event): void => {
      const frame = JSON.parse((event as MessageEvent<string>).data) as {
        asset: string;
        requested: number | null;
        reason: string;
        resumesAt: number | null;
      };
      // The window is reset: what it held ends before the hole, and drawing
      // across a hole is the one thing a chart must not do.
      windows.set(frame.asset, createWindow());
      if (
        frame.requested !== null &&
        frame.resumesAt !== null &&
        frame.resumesAt > frame.requested
      ) {
        onNotice(frame.asset, { kind: 'hole', from: frame.requested, to: frame.resumesAt - 1 });
      } else {
        onNotice(frame.asset, { kind: 'gap', reason: frame.reason });
      }
    });

    current.addEventListener('close', (event: Event): void => {
      const frame = JSON.parse((event as MessageEvent<string>).data) as {
        asset?: string;
        reason: string;
      };
      if (frame.asset !== undefined && /retired/i.test(frame.reason)) {
        retired.add(frame.asset);
        onNotice(frame.asset, { kind: 'retired', reason: frame.reason });
      }
    });

    current.onerror = (): void => {
      current.close();
      connected = false;
      if (closed || source !== current) return;
      source = null;
      failures += 1;
      // Refused before it ever opened, or dropped after it did: the one bit an
      // `EventSource` gives, and the whole policy below is built on it.
      const refused = !opened;
      let resume = true;
      if (refused && from.length > 0) {
        // A resume point the venue will not serve — evicted, or a feed that
        // restarted past it. Asking again for the same one is the loop a6-11
        // ended for `streamMarket`; the multiplexed stream kept running it.
        for (const id of carried) {
          const sequence = windows.get(id)!.resumeFrom;
          if (sequence === undefined) continue;
          windows.set(id, createWindow());
          onNotice(id, {
            kind: 'gap',
            reason: `the engine refused to resume from sequence ${String(sequence)}`,
          });
        }
        // The windows above were replaced, so `resumeFrom` is already undefined
        // for every one of them and the notice below would say `resuming:false`
        // anyway. The flag says it where it is decided rather than leaving it to
        // be derived from a line thirty lines away.
        resume = false;
      }
      // Refused with no resume point left to blame: the set is what is refused,
      // and one of these markets is gone. Ask before asking again (a5-03).
      const whoRemains = refused && from.length === 0;
      const inMs = Math.min(backoffMs * 2 ** (failures - 1), maxBackoffMs);
      for (const id of carried) {
        onNotice(id, {
          kind: 'reconnecting',
          attempt: failures,
          inMs,
          resuming: resume && (opened || windows.get(id)!.resumeFrom !== undefined),
        });
      }
      timer = setTimeout(() => {
        timer = null;
        if (!whoRemains) {
          connect();
          return;
        }
        void dropWhatIsGone(carried).then(connect);
      }, inMs);
    };
  };

  connect();
  return {
    close(): void {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      source?.close();
      source = null;
      connected = false;
    },
    get connected(): boolean {
      return connected;
    },
  };
}
