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

export interface StreamOptions {
  /** Delay before the first reconnect; doubles per consecutive failure. */
  readonly backoffMs?: number;
  /** The longest delay between attempts. */
  readonly maxBackoffMs?: number;
  /** The `EventSource` implementation, injectable so the policy can be tested in Node. */
  readonly eventSource?: typeof EventSource;
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
