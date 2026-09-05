import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { datasetFromTicks } from '../observer.js';
import { readServedRecord, ServedRecordError, SseParser } from './servedRecord.js';

/**
 * PH-25.1: the served-record client, against frames served without a socket.
 *
 * What a spawned service cannot be made to do on demand — split a frame at a
 * byte, send a `\r\n`, tell a gap, jump a sequence, refuse — a fake `fetch`
 * can. The socket half is `apps/api/src/servedRecord.stat.test.ts`.
 */

const INSTRUMENT = {
  id: 'eurusd-otc',
  family: 'forex' as const,
  logQuantum: 3.1e-7,
  displayPrecision: 5,
  referencePrice: 1.16,
};

const CATALOGUE_ROW = {
  seat: { archetype: 'major-fx', character: 'prose', priceSource: 'a citation' },
  ...INSTRUMENT,
  displayName: 'EUR/USD OTC',
  live: true,
  retired: false,
  meanIntervalMs: 348,
  tieRate: 0.0095,
  excessKurtosis: 51.7,
  dispersion: { quarterlyLogSigma: 0.03, quarterlyPercent: 3 },
};

function tick(sequence: number, price = 100 + sequence, instant = 1_000 + sequence * 10): Tick {
  return { sequence, price: logPrice(price), instant: epochMillis(instant) };
}

function tickFrame(t: Tick): string {
  return `id: ${String(t.sequence)}\ndata: ${JSON.stringify(t)}\n\n`;
}

/** A `fetch` that answers the catalogue and serves the stream body in the chunks given. */
function fakeFetch(
  chunks: readonly string[],
  options: { status?: number; body?: string; seen?: string[]; hang?: boolean } = {},
): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    options.seen?.push(url);
    if (url.endsWith('/catalogue')) {
      return Promise.resolve(new Response(JSON.stringify([CATALOGUE_ROW]), { status: 200 }));
    }
    if (options.status !== undefined && options.status !== 200) {
      return Promise.resolve(new Response(options.body ?? 'refused', { status: options.status }));
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        if (!options.hang) controller.close();
        init?.signal?.addEventListener('abort', () => {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },
    });
    return Promise.resolve(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
  };
}

const read = (
  chunks: readonly string[],
  overrides: Partial<Parameters<typeof readServedRecord>[0]> = {},
  fetchOptions: Parameters<typeof fakeFetch>[1] = {},
) =>
  readServedRecord({
    baseUrl: 'http://venue',
    assetId: INSTRUMENT.id,
    stopAfter: { ticks: 1_000 },
    fetch: fakeFetch(chunks, fetchOptions),
    ...overrides,
  });

describe('the parser reads the wire as the specification describes it', () => {
  it('completes an event only at a blank line, whatever the chunking', () => {
    const parser = new SseParser();
    const frame = 'event: gap\ndata: {"a":\ndata: 1}\nid: 7\n\n';
    let events: ReturnType<SseParser['push']> = [];
    // One byte at a time: every boundary a socket can produce.
    for (const byte of frame) events = [...events, ...parser.push(byte)];
    expect(events).toEqual([{ event: 'gap', data: '{"a":\n1}', id: '7' }]);
  });

  it('accepts CRLF, ignores comments and unknown fields, and strips one leading space', () => {
    const parser = new SseParser();
    const events = parser.push(':keep-alive\r\nretry: 500\r\ndata:  two spaces\r\n\r\n');
    expect(events).toEqual([{ event: null, data: ' two spaces', id: null }]);
  });

  it('dispatches nothing for a blank line with nothing pending', () => {
    expect(new SseParser().push('\n\n\n')).toEqual([]);
  });
});

describe('the record holds what the wire carried', () => {
  it('reads ticks split across chunks and stops at its rule, inclusively', async () => {
    const frames = [1, 2, 3, 4, 5].map((n) => tickFrame(tick(n))).join('');
    // Cut mid-frame, mid-JSON, so a frame-at-a-time reader would have failed.
    const cut = frames.indexOf('"price"') + 3;
    const record = await read([frames.slice(0, cut), frames.slice(cut)], {
      stopAfter: { ticks: 3 },
    });
    expect(record.ticks.map((t) => t.sequence)).toEqual([1, 2, 3]);
    expect(record.endedBy).toBe('rule');
    expect(record.discontinuities).toEqual([]);
    expect(record.gaps).toEqual([]);
    expect(record.bytes).toBeGreaterThan(0);
  });

  it('stops by sequence and by instant, inclusively', async () => {
    const frames = [[1, 2, 3, 4].map((n) => tickFrame(tick(n))).join('')];
    expect((await read(frames, { stopAfter: { sequence: 2 } })).ticks).toHaveLength(2);
    expect((await read(frames, { stopAfter: { instant: epochMillis(1_030) } })).ticks).toHaveLength(
      3,
    );
  });

  it('asks for `from` and `onGap` on the wire, and for nothing it was not told', async () => {
    const seen: string[] = [];
    await read([tickFrame(tick(9))], { from: 9 }, { seen });
    expect(seen[1]).toBe('http://venue/markets/eurusd-otc/stream?from=9');
    seen.length = 0;
    await read([tickFrame(tick(9))], { from: 9, onGap: 'live' }, { seen });
    expect(seen[1]).toBe('http://venue/markets/eurusd-otc/stream?from=9&onGap=live');
    seen.length = 0;
    await read([tickFrame(tick(9))], {}, { seen });
    expect(seen[1]).toBe('http://venue/markets/eurusd-otc/stream');
  });

  it('records a told gap and never fills it', async () => {
    const frames = [
      `event: gap\ndata: ${JSON.stringify({ requested: 3, reason: 'evicted' })}\n\n`,
      tickFrame(tick(40)),
      tickFrame(tick(41)),
    ];
    const record = await read(frames, { from: 3, onGap: 'live' });
    expect(record.gaps).toEqual([
      { requested: 3, reason: 'evicted', resumesAt: null, afterSequence: null },
    ]);
    // And where the server said it picks up, when it said.
    const named = await read(
      [
        `event: gap\ndata: ${JSON.stringify({ requested: 3, reason: 'evicted', resumesAt: 40 })}\n\n`,
      ],
      { from: 3, onGap: 'live' },
    );
    expect(named.gaps[0]!.resumesAt).toBe(40);
    expect(record.ticks.map((t) => t.sequence)).toEqual([40, 41]);
    // Told, so not also counted as a jump the server said nothing about.
    expect(record.discontinuities).toEqual([]);
    expect(record.endedBy).toBe('end');
  });

  it('records a jump the server did not explain as a discontinuity', async () => {
    const record = await read([tickFrame(tick(5)), tickFrame(tick(6)), tickFrame(tick(9))]);
    expect(record.discontinuities).toEqual([{ afterSequence: 6, nextSequence: 9 }]);
    expect(record.ticks).toHaveLength(3);
    // And the first tick against what was asked for.
    const resumed = await read([tickFrame(tick(12))], { from: 10 });
    expect(resumed.discontinuities).toEqual([{ afterSequence: 9, nextSequence: 12 }]);
  });

  it('records a close and stops there', async () => {
    const record = await read([
      tickFrame(tick(1)),
      `event: close\ndata: ${JSON.stringify({ reason: 'server shutting down' })}\n\n`,
      tickFrame(tick(2)),
    ]);
    expect(record.closes).toEqual([{ reason: 'server shutting down', afterSequence: 1 }]);
    expect(record.ticks).toHaveLength(1);
    expect(record.endedBy).toBe('close');
  });

  it('is an error when the server refuses, and the status and body survive', async () => {
    await expect(read([], { from: 1 }, { status: 400, body: 'evicted' })).rejects.toMatchObject({
      name: 'ServedRecordError',
      status: 400,
      body: 'evicted',
    });
    await expect(read([], { assetId: 'nobody-otc' })).rejects.toThrow(ServedRecordError);
  });

  it('is an error when a tick goes backwards or a frame holds no tick', async () => {
    await expect(read([tickFrame(tick(3)), tickFrame(tick(2))])).rejects.toThrow(/strictly/);
    await expect(read(['data: {"sequence":"1"}\n\n'])).rejects.toThrow(/without a tick/);
    // Each field missing in turn (CA9 a4-07): a tick has all three.
    for (const partial of [
      { sequence: 1, price: 2 },
      { sequence: 1, instant: 3 },
      { price: 2, instant: 3 },
      { sequence: 1, price: 2, instant: null },
      { sequence: 1, price: 2, instant: 'soon' },
    ]) {
      await expect(
        read([`data: ${JSON.stringify(partial)}\n\n`]),
        JSON.stringify(partial),
      ).rejects.toThrow(/without a tick/);
    }
    await expect(read(['data: not json\n\n'])).rejects.toThrow(/unparseable/);
  });

  it('refuses a rule or a `from` it cannot honour before touching the network', async () => {
    const seen: string[] = [];
    await expect(read([], { stopAfter: { ticks: 0 } }, { seen })).rejects.toThrow(RangeError);
    await expect(read([], { from: -1 }, { seen })).rejects.toThrow(RangeError);
    expect(seen).toEqual([]);
  });

  it('ends when the caller aborts, and says so', async () => {
    const controller = new AbortController();
    const pending = read([tickFrame(tick(1))], { signal: controller.signal }, { hang: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const record = await pending;
    expect(record.ticks).toHaveLength(1);
    expect(record.endedBy).toBe('abort');
  });
});

describe('the record is what the battery consumes', () => {
  it('yields a source and a dataset equal to one built in-process from the same ticks', async () => {
    const ticks = [1, 2, 3, 4, 5, 6].map((n) => tick(n, 100 + (n % 3), 1_000 + n * 17));
    const record = await read([ticks.map(tickFrame).join('')]);
    const source = record.source();
    expect(source.instrument).toEqual(INSTRUMENT);
    const drained: Tick[] = [];
    for (let next = source.next(); next !== null; next = source.next()) drained.push(next);
    expect(drained).toEqual(ticks);
    // A second cursor starts over: the source is the record, not a consumed stream.
    expect(record.source().next()).toEqual(ticks[0]);

    const served = record.dataset();
    const direct = datasetFromTicks(INSTRUMENT, ticks);
    expect(Array.from(served.prices)).toEqual(Array.from(direct.prices));
    expect(Array.from(served.instants)).toEqual(Array.from(direct.instants));
    expect(served.candles('1m')).toEqual(direct.candles('1m'));
  });

  it('holds only the public fields of the instrument, whatever the catalogue row carried', async () => {
    const record = await read([tickFrame(tick(1))]);
    expect(Object.keys(record.instrument).sort()).toEqual(
      ['id', 'family', 'logQuantum', 'displayPrecision', 'referencePrice'].sort(),
    );
    expect(JSON.stringify(record)).not.toMatch(/seat|archetype|meanInterval|tieRate|kurtosis/);
  });
});

describe('the client is an observer and nothing more', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.includes('.test.'));

  it('imports nothing that generates, hosts or stores a market', () => {
    // Static `from '…'`, dynamic `import('…')` and `require('…')` alike (Cycle
    // Audit 9, a8-06: a dynamic import passed the scan, tsc and eslint). A
    // relative path into the rest of `@otc/lab` is allowed here because the
    // package boundary is the guard: `@otc/lab` depends on `@otc/core` alone
    // (`package.json`, `publicSurface.test.ts`), so nothing reachable through
    // `../` generates, hosts or stores a market either.
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(path.join(here, file), 'utf8');
      const imports = [
        ...[...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!),
        ...[...text.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]!),
        ...[...text.matchAll(/\brequire\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]!),
      ];
      for (const specifier of imports) {
        expect(
          specifier === '@otc/core' || specifier.startsWith('../') || specifier.startsWith('./'),
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
      // No ambient time, no ambient randomness, no private vocabulary — every
      // spelling of ambient time (CA9 a4-06: `performance.now()` passed).
      expect(text, file).not.toMatch(
        /Date\.now|new Date\(|performance\.now|hrtime|Math\.random|keyring|cursor|secret/i,
      );
    }
  });
});
