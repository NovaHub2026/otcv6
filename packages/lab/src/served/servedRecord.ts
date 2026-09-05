import { assertTickOrder, type EpochMillis, type Tick, type TickSource } from '@otc/core';
import { datasetFromTicks, type ObserverDataset, type PublicInstrument } from '../observer.js';

/**
 * PH-25.1 — the served record, read as a browser reads it.
 *
 * Every adversarial run before this phase built its own engine or ran against
 * the Lab's composition. This is the other half of the instrument: a client of
 * `GET /markets/:id/stream` that holds nothing but what the wire carried —
 * ticks, and the frames that say what it did *not* carry — and hands the
 * battery a `TickSource` it consumes unchanged.
 *
 * Two properties, and both are tested against a spawned service rather than
 * argued:
 *
 * - **Faithful.** Two connections produce byte-identical datasets (INV-002),
 *   and a read that continues across a restart is the record's own
 *   continuation (INV-008).
 * - **Honest.** A `gap` frame is not a tick, a sequence that does not follow
 *   the previous one is a discontinuity, and a resume the server refuses is an
 *   error. None of them is closed by this client, because a hole an observer
 *   fills in is indistinguishable from the market.
 *
 * Deliberately outside this file: everything. No engine, no runtime, no
 * private state, no state directory — the boundary scan in `servedRecord.test.ts`
 * holds it to the public read surface.
 */

/** A frame the server sent to say what the client will not receive. */
export interface ServedGap {
  /** The sequence the client asked for, as the server echoed it. */
  readonly requested: number | null;
  readonly reason: string;
  /** Where the server said the record picks up after the gap, when it said. */
  readonly resumesAt: number | null;
  /** Last sequence held when the gap was told, or null before any tick. */
  readonly afterSequence: number | null;
}

/** The server ending the stream in its own vocabulary rather than dropping it. */
export interface ServedClose {
  readonly reason: string;
  readonly afterSequence: number | null;
}

/**
 * A tick whose sequence did not follow the one before it.
 *
 * Not necessarily a defect — a resume across a seam is one by design
 * (`SeamMarker`) — but never silent: a dataset that holds one says so.
 */
export interface Discontinuity {
  /** The sequence held before the jump; the requested `from - 1` on the first tick. */
  readonly afterSequence: number;
  readonly nextSequence: number;
}

/** When to stop reading. Each is inclusive of the tick that satisfies it. */
export type StopRule =
  { readonly ticks: number } | { readonly sequence: number } | { readonly instant: EpochMillis };

export interface ServedRecordOptions {
  /** `http://host:port`, no trailing slash. */
  readonly baseUrl: string;
  readonly assetId: string;
  /** The next sequence wanted, inclusive — `?from=` on the wire. Omitted: the live edge. */
  readonly from?: number;
  /**
   * What to do when `from` is no longer served. `refuse` (default) makes the
   * server's 400 an error here; `live` asks to be told and to be given the
   * live edge, and the telling is recorded in `gaps`.
   */
  readonly onGap?: 'refuse' | 'live';
  readonly stopAfter: StopRule;
  /** Ends the read early; a read ended this way reports `endedBy: 'abort'`. */
  readonly signal?: AbortSignal;
  /** Injectable for tests that serve frames without a socket. */
  readonly fetch?: typeof fetch;
}

/** Everything the wire carried, and nothing it did not. */
export interface ServedRecord {
  readonly assetId: string;
  readonly instrument: PublicInstrument;
  readonly requestedFrom: number | null;
  readonly ticks: readonly Tick[];
  readonly gaps: readonly ServedGap[];
  readonly closes: readonly ServedClose[];
  readonly discontinuities: readonly Discontinuity[];
  /** Why the read stopped: its own rule, a `close` frame, the socket ending, or the caller. */
  readonly endedBy: 'rule' | 'close' | 'end' | 'abort';
  /** Bytes read from the stream body. */
  readonly bytes: number;
  /** The record as the battery consumes it. Each call starts over the same ticks. */
  source(): TickSource;
  dataset(): ObserverDataset;
}

/** A refusal or a malformed frame. `status` is 0 when no HTTP status was involved. */
export class ServedRecordError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'ServedRecordError';
  }
}

/** The public half of a catalogue row — exactly the fields `toPublicInstrument` keeps. */
const PUBLIC_INSTRUMENT_FIELDS = [
  'id',
  'family',
  'logQuantum',
  'displayPrecision',
  'referencePrice',
] as const;

interface CatalogueRow {
  readonly id: unknown;
  readonly family: unknown;
  readonly logQuantum: unknown;
  readonly displayPrecision: unknown;
  readonly referencePrice: unknown;
}

/** One parsed server-sent event: the spec's `event`, `data` and `id` fields. */
interface SseEvent {
  readonly event: string | null;
  readonly data: string;
  readonly id: string | null;
}

/**
 * An incremental parser for `text/event-stream`.
 *
 * Line-based, as the specification is, rather than split on `\n\n`: a chunk
 * boundary can fall anywhere — inside a line, between a `\r` and its `\n` —
 * and a parser that assumed frames arrive whole would drop or merge ticks at
 * exactly the moments a loaded server is most likely to produce them.
 */
export class SseParser {
  #carry = '';
  #event: string | null = null;
  #data: string[] = [];
  #id: string | null = null;

  /** Feed a chunk; returns every event completed by it, in order. */
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
    // `retry` and unknown fields are ignored, as the specification says.
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

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function tickOf(data: string): Tick {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new ServedRecordError(`unparseable tick frame: ${data}`, 0, data);
  }
  const row = parsed as Partial<Record<keyof Tick, unknown>>;
  if (!isInteger(row.sequence) || !isInteger(row.price) || typeof row.instant !== 'number') {
    throw new ServedRecordError(`a tick frame without a tick in it: ${data}`, 0, data);
  }
  // Only the three fields a tick has, whatever else the server put beside them
  // (a multiplexed stream names the asset): the record holds ticks.
  return {
    instant: row.instant as EpochMillis,
    sequence: row.sequence,
    price: row.price as Tick['price'],
  };
}

function reasonOf(data: string): {
  requested: number | null;
  reason: string;
  resumesAt: number | null;
} {
  try {
    const parsed = JSON.parse(data) as {
      requested?: unknown;
      reason?: unknown;
      resumesAt?: unknown;
    };
    return {
      requested: isInteger(parsed.requested) ? parsed.requested : null,
      reason: typeof parsed.reason === 'string' ? parsed.reason : data,
      resumesAt: isInteger(parsed.resumesAt) ? parsed.resumesAt : null,
    };
  } catch {
    return { requested: null, reason: data, resumesAt: null };
  }
}

function satisfied(rule: StopRule, tick: Tick, count: number): boolean {
  if ('ticks' in rule) return count >= rule.ticks;
  if ('sequence' in rule) return tick.sequence >= rule.sequence;
  return tick.instant >= rule.instant;
}

function assertRule(rule: StopRule): void {
  if ('ticks' in rule && (!Number.isInteger(rule.ticks) || rule.ticks <= 0)) {
    throw new RangeError(`stopAfter.ticks must be a positive integer, received ${rule.ticks}.`);
  }
  if ('sequence' in rule && !Number.isSafeInteger(rule.sequence)) {
    throw new RangeError(`stopAfter.sequence must be an integer, received ${rule.sequence}.`);
  }
  if ('instant' in rule && !Number.isFinite(rule.instant)) {
    throw new RangeError(`stopAfter.instant must be finite, received ${rule.instant}.`);
  }
}

async function publicInstrument(
  doFetch: typeof fetch,
  baseUrl: string,
  assetId: string,
  signal: AbortSignal,
): Promise<PublicInstrument> {
  const response = await doFetch(`${baseUrl}/catalogue`, { signal });
  const body = await response.text();
  if (response.status !== 200) {
    throw new ServedRecordError(
      `GET /catalogue answered ${response.status}`,
      response.status,
      body,
    );
  }
  const rows = JSON.parse(body) as readonly CatalogueRow[];
  const row = rows.find((candidate) => candidate.id === assetId);
  if (row === undefined) {
    throw new ServedRecordError(`${assetId} is not in the served catalogue`, 404, body);
  }
  if (
    typeof row.family !== 'string' ||
    typeof row.logQuantum !== 'number' ||
    typeof row.displayPrecision !== 'number' ||
    typeof row.referencePrice !== 'number'
  ) {
    throw new ServedRecordError(`${assetId}'s catalogue row is not an instrument`, 0, body);
  }
  // Built field by field rather than spread from the row: the row carries
  // what a broker's screen wants, and the record must hold only what an
  // observer is allowed to see (INV-010).
  return {
    id: assetId,
    family: row.family as PublicInstrument['family'],
    logQuantum: row.logQuantum,
    displayPrecision: row.displayPrecision,
    referencePrice: row.referencePrice,
  };
}

/**
 * Read the served record of one market until a rule is met.
 *
 * Resolves with everything the wire carried. Rejects on a refused request, a
 * malformed frame, or a tick out of order — never on a gap, a close or a
 * discontinuity, which are facts about the record and are recorded as such.
 */
export async function readServedRecord(options: ServedRecordOptions): Promise<ServedRecord> {
  const { baseUrl, assetId, from, onGap = 'refuse', stopAfter } = options;
  assertRule(stopAfter);
  if (from !== undefined && (!Number.isSafeInteger(from) || from < 0)) {
    throw new RangeError(`from must be a non-negative integer, received ${from}.`);
  }
  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const abortedByCaller = (): boolean => options.signal?.aborted === true;
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  const instrument = await publicInstrument(doFetch, baseUrl, assetId, controller.signal);

  const query = new URLSearchParams();
  if (from !== undefined) query.set('from', String(from));
  if (onGap === 'live') query.set('onGap', 'live');
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  const url = `${baseUrl}/markets/${encodeURIComponent(assetId)}/stream${suffix}`;
  const response = await doFetch(url, {
    signal: controller.signal,
    headers: { accept: 'text/event-stream' },
  });
  if (response.status !== 200 || response.body === null) {
    const body = await response.text();
    throw new ServedRecordError(`GET ${url} answered ${response.status}`, response.status, body);
  }

  const ticks: Tick[] = [];
  const gaps: ServedGap[] = [];
  const closes: ServedClose[] = [];
  const discontinuities: Discontinuity[] = [];
  let endedBy: ServedRecord['endedBy'] = 'end';
  let bytes = 0;
  let expected: number | null = from ?? null;
  const last = (): Tick | null => ticks[ticks.length - 1] ?? null;

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  // A cancelled reader resolves a pending read as done, whatever produced the
  // body — a socket or a test's stream — so stopping never waits on a tick.
  controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => undefined), {
    once: true,
  });
  const decoder = new TextDecoder();
  const parser = new SseParser();

  const take = (event: SseEvent): boolean => {
    if (event.event === 'gap') {
      const { requested, reason, resumesAt } = reasonOf(event.data);
      gaps.push({ requested, reason, resumesAt, afterSequence: last()?.sequence ?? null });
      // The server said what it will not send; whatever comes next is not a
      // continuation of what was asked for, and is not counted as a jump twice.
      expected = null;
      return false;
    }
    if (event.event === 'close') {
      closes.push({ reason: reasonOf(event.data).reason, afterSequence: last()?.sequence ?? null });
      endedBy = 'close';
      return true;
    }
    if (event.event !== null && event.event !== 'message') return false;
    const tick = tickOf(event.data);
    assertTickOrder(last(), tick);
    if (expected !== null && tick.sequence !== expected) {
      discontinuities.push({ afterSequence: expected - 1, nextSequence: tick.sequence });
    }
    ticks.push(tick);
    expected = tick.sequence + 1;
    if (satisfied(stopAfter, tick, ticks.length)) {
      endedBy = 'rule';
      return true;
    }
    return false;
  };

  try {
    reading: for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) {
        if (take(event)) break reading;
      }
    }
  } catch (error) {
    if (!abortedByCaller()) throw error;
  } finally {
    controller.abort();
  }
  if (abortedByCaller() && endedBy === 'end') endedBy = 'abort';

  const record: ServedRecord = {
    assetId,
    instrument,
    requestedFrom: from ?? null,
    ticks,
    gaps,
    closes,
    discontinuities,
    endedBy,
    bytes,
    source(): TickSource {
      let index = 0;
      return {
        instrument,
        next: (): Tick | null => ticks[index++] ?? null,
      };
    },
    dataset(): ObserverDataset {
      return datasetFromTicks(instrument, ticks);
    },
  };
  return record;
}

export { PUBLIC_INSTRUMENT_FIELDS };
