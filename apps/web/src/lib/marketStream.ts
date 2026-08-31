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

/** Reduce whatever the window currently holds to drawable columns. */
export function columnsFor(window: TickWindow, columns: number): Column[] {
  const span = window.span;
  if (span === null) return [];
  const { instants, prices } = window.series();
  return reduceToColumns(instants, prices, {
    from: span.from,
    to: (span.to + 1) as typeof span.to,
    columns,
  });
}
