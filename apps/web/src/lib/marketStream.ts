import { reduceToColumns, type Column, type TickWindow } from '@otc/chart';
import type { Tick } from '@otc/core/browser';

/**
 * Connect a `TickWindow` to the PH-7 stream, resuming exactly on reconnection.
 *
 * The only interesting decision here is what to do when the connection drops.
 * The tempting answer — reopen the stream and carry on — silently loses whatever
 * arrived while disconnected, and the chart then draws a line across the hole.
 * So reconnection always asks for `window.resumeFrom`, and a batch that does not
 * continue the window is refused by the window itself rather than absorbed.
 */
export interface StreamHandle {
  close(): void;
}

export function streamMarket(
  apiBase: string,
  assetId: string,
  window: TickWindow,
  onUpdate: (window: TickWindow) => void,
): StreamHandle {
  let closed = false;
  let source: EventSource | null = null;

  const connect = (): void => {
    if (closed) return;
    const from = window.resumeFrom;
    const query = from === undefined ? '' : `?from=${String(from)}`;
    source = new EventSource(`${apiBase}/markets/${assetId}/stream${query}`);

    source.onmessage = (event: MessageEvent<string>): void => {
      const tick = JSON.parse(event.data) as Tick;
      // Appended one at a time so a contiguity failure names the exact tick.
      window.append([tick]);
      onUpdate(window);
    };

    source.onerror = (): void => {
      source?.close();
      if (closed) return;
      // Reconnect asking for exactly what we are missing. Never "from now".
      setTimeout(connect, 1_000);
    };
  };

  connect();
  return {
    close(): void {
      closed = true;
      source?.close();
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
