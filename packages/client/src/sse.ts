import type { Tick } from '@otc/core';

/** One server-sent event as the venue writes it. */
export interface SseEvent {
  readonly event: string | null;
  readonly data: string;
  readonly id: string | null;
}

/**
 * A line-based, chunk-agnostic parser for `text/event-stream`, per the
 * specification: `event`, `data` (joined by newlines) and `id` fields, a blank
 * line dispatches, a `:` line is a comment, CRLF is tolerated. The lab has the
 * same parser; a broker's client cannot depend on the lab, which carries the
 * planted-defect corpus, so it has its own.
 */
export class SseParser {
  #carry = '';
  #event: string | null = null;
  #data: string[] = [];
  #id: string | null = null;

  push(chunk: string): SseEvent[] {
    const completed: SseEvent[] = [];
    const text = this.#carry + chunk;
    let start = 0;
    for (;;) {
      const lf = text.indexOf('\n', start);
      if (lf === -1) break;
      const line = text[lf - 1] === '\r' ? text.slice(start, lf - 1) : text.slice(start, lf);
      start = lf + 1;
      const event = this.#line(line);
      if (event !== null) completed.push(event);
    }
    this.#carry = text.slice(start);
    return completed;
  }

  #line(line: string): SseEvent | null {
    if (line === '') return this.#dispatch();
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.#event = value;
    else if (field === 'data') this.#data.push(value);
    else if (field === 'id') this.#id = value;
    return null;
  }

  #dispatch(): SseEvent | null {
    if (this.#data.length === 0 && this.#event === null) return null;
    const event: SseEvent = { event: this.#event, data: this.#data.join('\n'), id: this.#id };
    this.#event = null;
    this.#data = [];
    return event;
  }
}

export interface GapFrame {
  readonly requested: number | null;
  readonly reason: string;
  readonly resumesAt: number | null;
}

export interface StreamRead {
  readonly ticks: readonly Tick[];
  readonly gaps: readonly GapFrame[];
  readonly closes: readonly string[];
  /** Why the read ended: the rule was met, the server closed, or the caller aborted. */
  readonly endedBy: 'rule' | 'close' | 'abort';
  readonly status: number;
  /** The body when the server refused with a status other than 200. */
  readonly refusal: string | null;
}

export interface StreamReadOptions {
  readonly baseUrl: string;
  readonly assetId: string;
  readonly from?: number;
  readonly onGap?: 'live';
  /** Stop after this many ticks, inclusive. */
  readonly ticks: number;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** What the stream yields as it arrives: the opening status, then frames. */
export type StreamFrame =
  | { readonly kind: 'open'; readonly status: number; readonly refusal: string | null }
  | { readonly kind: 'tick'; readonly tick: Tick }
  | { readonly kind: 'gap'; readonly gap: GapFrame }
  | { readonly kind: 'close'; readonly reason: string };

export interface StreamOptions {
  readonly baseUrl: string;
  readonly assetId: string;
  readonly from?: number;
  readonly onGap?: 'live';
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
}

/**
 * One market's stream, frame by frame as it arrives.
 *
 * The first frame is always `open`, with the status: a refusal — a status
 * other than 200 — is yielded with its body rather than thrown, so a
 * conformance check can assert on it, and nothing follows it. Then every
 * `message` frame is a tick with three integer fields, a `gap` frame is a
 * hole the client is told about and must not fill, and a `close` frame ends
 * the stream with the venue's reason. The generator ends when the venue
 * closes the socket or the caller aborts.
 */
export async function* streamFrames(
  options: StreamOptions,
): AsyncGenerator<StreamFrame, void, void> {
  const doFetch = options.fetch ?? fetch;
  const query = new URLSearchParams();
  if (options.from !== undefined) query.set('from', String(options.from));
  if (options.onGap !== undefined) query.set('onGap', options.onGap);
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  const url = `${options.baseUrl}/markets/${encodeURIComponent(options.assetId)}/stream${suffix}`;
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await doFetch(url, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (response.status !== 200 || response.body === null) {
      yield { kind: 'open', status: response.status, refusal: await response.text() };
      return;
    }
    yield { kind: 'open', status: 200, refusal: null };
    const parser = new SseParser();
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (controller.signal.aborted) return;
        throw error;
      }
      if (chunk.done) return;
      for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) {
        if (event.event === 'gap') {
          const gap = JSON.parse(event.data) as GapFrame;
          yield {
            kind: 'gap',
            gap: { requested: gap.requested, reason: gap.reason, resumesAt: gap.resumesAt },
          };
        } else if (event.event === 'close') {
          yield { kind: 'close', reason: (JSON.parse(event.data) as { reason: string }).reason };
          return;
        } else if (event.event === null) {
          const row = JSON.parse(event.data) as Partial<Record<keyof Tick, unknown>>;
          if (!isInteger(row.sequence) || !isInteger(row.instant) || !isInteger(row.price)) {
            throw new Error(`a tick frame without three integer fields: ${event.data}`);
          }
          yield {
            kind: 'tick',
            tick: {
              sequence: row.sequence,
              instant: row.instant as Tick['instant'],
              price: row.price as Tick['price'],
            },
          };
        }
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

/**
 * Read one market's stream until `ticks` ticks have arrived — the frames
 * above, collected. A refusal is returned with its body rather than thrown.
 */
export async function readStream(options: StreamReadOptions): Promise<StreamRead> {
  const ticks: Tick[] = [];
  const gaps: GapFrame[] = [];
  const closes: string[] = [];
  let endedBy: StreamRead['endedBy'] = 'abort';
  let status = 0;
  let refusal: string | null = null;
  const { ticks: wanted, ...rest } = options;
  for await (const frame of streamFrames(rest)) {
    if (frame.kind === 'open') {
      status = frame.status;
      refusal = frame.refusal;
      if (frame.status !== 200) {
        endedBy = 'close';
        break;
      }
    } else if (frame.kind === 'gap') {
      gaps.push(frame.gap);
    } else if (frame.kind === 'close') {
      closes.push(frame.reason);
      endedBy = 'close';
      break;
    } else {
      ticks.push(frame.tick);
      if (ticks.length >= wanted) {
        endedBy = 'rule';
        break;
      }
    }
  }
  if (endedBy === 'abort' && status === 200 && !(options.signal?.aborted ?? false))
    endedBy = 'close';
  return { ticks, gaps, closes, endedBy, status, refusal };
}
