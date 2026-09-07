// Invariant evidence: INV-002 (shared market) — the panel must be able to reach the record at all.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET, PATCH, POST } from './[...path]/route.js';

/**
 * The panel talks to one origin, and the proxy that makes that true must stream.
 *
 * ## What this replaced, and why
 *
 * There was a test here that read `next.config.mjs` and asserted a
 * `/engine/:path*` rewrite existed. It passed for a week while the rewrite was
 * **silently not streaming**: ordinary endpoints proxied in milliseconds and the
 * tick stream returned nothing at all, with Next never opening a connection to
 * the engine for it. A test of a configuration value is not a test of the
 * behaviour that value was chosen for.
 *
 * So these drive the handler and watch what it does with a body that has not
 * finished — which is what a live market always is.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

/** A body that emits `chunks` on demand and never ends on its own. */
function endlessStream(chunks: string[]): {
  body: ReadableStream<Uint8Array>;
  push: (text: string) => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
    },
  });
  return {
    body,
    push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
  };
}

function request(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    ip?: string;
    /** The browser's connection, when a test needs to end it (a2-11). */
    signal?: AbortSignal;
  } = {},
): NextRequest {
  return {
    url,
    method: init.method ?? 'GET',
    headers: new Headers(init.headers ?? {}),
    signal: init.signal ?? new AbortController().signal,
    text: () => Promise.resolve(''),
    ...(init.ip === undefined ? {} : { ip: init.ip }),
  } as unknown as NextRequest;
}

function params(path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) };
}

describe('the engine proxy', () => {
  it('returns before the upstream body ends, and streams what arrives after', async () => {
    // The whole defect in one assertion. A proxy that awaited the body would
    // never resolve here, because this body never ends.
    const stream = endlessStream(['id: 1\ndata: {"sequence":1}\n\n']);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream.body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const response = await GET(
      request('http://panel.test/engine/markets/eurusd/stream'),
      params(['markets', 'eurusd', 'stream']),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('"sequence":1');

    // A tick published after the response was returned still reaches the client.
    stream.push('id: 2\ndata: {"sequence":2}\n\n');
    expect(decoder.decode((await reader.read()).value)).toContain('"sequence":2');
    await reader.cancel();
  });

  it('tells intermediaries not to buffer an event stream', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(endlessStream([]).body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    const response = await GET(
      request('http://panel.test/engine/markets/eurusd/stream'),
      params(['markets', 'eurusd', 'stream']),
    );
    expect(response.headers.get('cache-control')).toContain('no-cache');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    await response.body?.cancel();
  });

  it('reads the engine address at request time, not at build time', async () => {
    // **This is the guard for the worst defect PH-20.2 found.**
    //
    // `next.config.mjs` carried `env: { OTC_API_BASE }`, and Next's `env` key
    // substitutes at *build* time. A panel started with an explicit
    // `OTC_API_BASE` proxied to the baked-in default anyway — and on a machine
    // with a stale, stalled engine on port 3000 it talked to that one instead:
    // the catalogue and the history answered, so the panel looked healthy, and
    // only the tick stream was silent. The browser suite booted its own engine
    // and then tested a different one for everything the stream touched.
    //
    // A handler that reads the variable per call cannot do that.
    const spy = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    globalThis.fetch = spy;
    vi.stubEnv('OTC_API_BASE', 'http://engine.internal:9999');

    await GET(
      request('http://panel.test/engine/markets/eurusd/history?timeframe=1h&from=1&to=2'),
      params(['markets', 'eurusd', 'history']),
    );
    const [first] = spy.mock.calls[0] as [URL];
    expect(first.origin).toBe('http://engine.internal:9999');
    expect(first.pathname).toBe('/markets/eurusd/history');
    expect(first.search).toBe('?timeframe=1h&from=1&to=2');

    // And it follows the variable when it changes, which is what "per request"
    // means and what a module-level constant would fail.
    vi.stubEnv('OTC_API_BASE', 'http://elsewhere.internal:1234');
    await GET(request('http://panel.test/engine/catalogue'), params(['catalogue']));
    const [second] = spy.mock.calls[1] as [URL];
    expect(second.origin).toBe('http://elsewhere.internal:1234');
  });

  it('keeps the engine address out of the browser bundle', async () => {
    // The `env` key did two wrong things at once: it froze the address, and it
    // published it. `env` entries are inlined into client bundles, so the
    // engine's internal host and port travelled to every viewer of the panel.
    const config = (await import('../../../next.config.mjs')) as {
      default: { env?: Record<string, string> };
    };
    expect(config.default.env, 'next.config env inlines values at build time').toBeUndefined();
  });

  it('forwards Last-Event-ID, which is how a stream resumes', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = spy;
    await GET(
      request('http://panel.test/engine/markets/eurusd/stream', {
        headers: { 'last-event-id': '4200', accept: 'text/event-stream' },
      }),
      params(['markets', 'eurusd', 'stream']),
    );
    const [, init] = spy.mock.calls[0] as [URL, { headers: Headers }];
    // Dropping it would turn every reconnection into a gap in the sequence the
    // client reconstructs, which is INV-002 broken for whoever reconnected.
    expect(init.headers.get('last-event-id')).toBe('4200');
    expect(init.headers.get('accept')).toBe('text/event-stream');
    // The panel's own host is not the engine's.
    expect(init.headers.get('host')).toBeNull();
  });

  it('carries a status through rather than inventing one', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('Unknown asset nope.', { status: 404 }));
    const response = await GET(
      request('http://panel.test/engine/markets/nope/history'),
      params(['markets', 'nope', 'history']),
    );
    // The engine's refusals say why, and the panel shows them verbatim. A proxy
    // that mapped every failure to 502 would throw that away.
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Unknown asset nope.');
  });

  it('proxies a PATCH, so an asset can be renamed from this origin too', async () => {
    // A route handler serves only the methods it exports. `PATCH` was missing
    // for one build, and the panel's rename silently did nothing.
    const spy = vi.fn().mockResolvedValue(new Response('{"id":"gbpjpy"}', { status: 200 }));
    globalThis.fetch = spy;
    const response = await PATCH(
      request('http://panel.test/engine/assets/gbpjpy', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
      }),
      params(['assets', 'gbpjpy']),
    );
    expect(response.status).toBe(200);
    const [, init] = spy.mock.calls[0] as [URL, { method: string }];
    expect(init.method).toBe('PATCH');
  });

  it('adds the operator token to a write on this server, and never to a read (a6-01)', async () => {
    // The engine refuses every write without the bearer. The panel holds it
    // in its own environment and adds it here, per request like the address;
    // the browser never sees it — not in a bundle, not in a cookie, not in a
    // response header.
    const spy = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    globalThis.fetch = spy;
    vi.stubEnv('OTC_ADMIN_TOKEN', 'operator-token-of-thirty-two-chars');

    await POST(
      request('http://panel.test/engine/assets/gbpjpy/retire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
      params(['assets', 'gbpjpy', 'retire']),
    );
    const [, write] = spy.mock.calls[0] as [URL, { headers: Headers }];
    expect(write.headers.get('authorization')).toBe('Bearer operator-token-of-thirty-two-chars');

    await GET(request('http://panel.test/engine/catalogue'), params(['catalogue']));
    const [, read] = spy.mock.calls[1] as [URL, { headers: Headers }];
    expect(read.headers.get('authorization'), 'a read carries no credential').toBeNull();
  });

  it('never forwards a credential the browser sent, and sends none when it has none', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
    globalThis.fetch = spy;
    vi.stubEnv('OTC_ADMIN_TOKEN', '');

    const response = await PATCH(
      request('http://panel.test/engine/assets/gbpjpy', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: 'Bearer from-the-browser' },
      }),
      params(['assets', 'gbpjpy']),
    );
    const [, init] = spy.mock.calls[0] as [URL, { headers: Headers }];
    expect(init.headers.get('authorization')).toBeNull();
    // The engine's refusal — which names OTC_ADMIN_TOKEN — travels back as is.
    expect(response.status).toBe(403);
  });

  it('proxies a POST, so an asset can be created from this origin too', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('{"job":"job-1"}', { status: 201 }));
    globalThis.fetch = spy;
    const response = await POST(
      request('http://panel.test/engine/assets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
      params(['assets']),
    );
    expect(response.status).toBe(201);
    const [, init] = spy.mock.calls[0] as [URL, { method: string; headers: Headers }];
    expect(init.method).toBe('POST');
    expect(init.headers.get('content-type')).toBe('application/json');
  });
});

/**
 * **Cycle Audit 10 (a2-11).** PH-30.2 found that every chart a page had ever
 * opened stayed subscribed on the engine through this proxy —
 * `otc_stream_connections` read 16 for a board of eight — and it was closed by
 * one line, `signal: request.signal`. Ten tests in this file drove the proxy
 * and not one of them ever aborted anything: the fixture handed every request a
 * fresh `AbortController`'s signal that nothing fired, so deleting that line
 * again passed all ten, exit 0. Its only guard was the board test in
 * `panel.stat.test.ts` — a real Chromium, forty to seventy seconds away, and
 * unreachable on a host whose browser cannot launch.
 *
 * A leaked subscription is not a rendering defect: the engine holds the
 * connection, the feed keeps writing to it, and the cost grows with every
 * screen an operator ever opened. That deserves a guard in the fast suite.
 */
describe("the browser's disconnect reaches the engine (Cycle Audit 10, a2-11)", () => {
  it("hands the upstream request the browser's own signal, and it aborts with it", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: URL, init: { signal?: AbortSignal }) => {
      signals.push(init.signal);
      return Promise.resolve(
        new Response(endlessStream(['id: 1\ndata: {"sequence":1}\n\n']).body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );
    });

    const browser = new AbortController();
    const response = await GET(
      request('http://panel.test/engine/markets/eurusd/stream', { signal: browser.signal }),
      params(['markets', 'eurusd', 'stream']),
    );
    expect(response.status).toBe(200);

    const upstream = signals[0];
    expect(upstream, 'the proxy opened the upstream stream with no signal at all').toBeDefined();
    expect(upstream!.aborted, 'the upstream was aborted before the browser left').toBe(false);

    // The browser navigates away, or the chart is closed. Node's fetch ends the
    // upstream request when this fires; without it the engine keeps the
    // subscription for the life of the panel process.
    browser.abort();
    expect(
      upstream!.aborted,
      'the upstream request does not follow the browser: a closed chart stays subscribed on the engine',
    ).toBe(true);

    await response.body?.cancel();
  });

  it('aborts a write the same way, so a hung engine cannot pin this server', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: URL, init: { signal?: AbortSignal }) => {
      signals.push(init.signal);
      return Promise.resolve(new Response('{}', { status: 201 }));
    });
    const browser = new AbortController();
    await POST(
      request('http://panel.test/engine/assets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: browser.signal,
      }),
      params(['assets']),
    );
    const upstream = signals[0];
    expect(upstream, 'a write was proxied with no signal').toBeDefined();
    browser.abort();
    expect(upstream!.aborted).toBe(true);
  });
});

/**
 * Cycle Audit 10 (a8-01, second half). The engine's rate limit keys on the
 * address it is given; this proxy gave it none, so every operator at every
 * screen shared the panel's one bucket, and no `trust proxy` setting on the
 * engine could recover an address that was never sent.
 */
describe('the proxy tells the engine whose request it is (Cycle Audit 10)', () => {
  it('forwards the address it observed, appending to a chain rather than trusting one', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = spy;
    await GET(
      request('http://panel.test/engine/markets', { ip: '203.0.113.7' }),
      params(['markets']),
    );
    const [, first] = spy.mock.calls[0] as [URL, { headers: Headers }];
    expect(first.headers.get('x-forwarded-for')).toBe('203.0.113.7');

    // A browser that sends its own chain does not get to displace what this
    // server saw: the observed address is appended last, and the engine
    // decides how far down the list to read.
    spy.mockClear();
    await GET(
      request('http://panel.test/engine/markets', {
        ip: '203.0.113.7',
        headers: { 'x-forwarded-for': '198.51.100.9' },
      }),
      params(['markets']),
    );
    const [, second] = spy.mock.calls[0] as [URL, { headers: Headers }];
    expect(second.headers.get('x-forwarded-for')).toBe('198.51.100.9, 203.0.113.7');

    // A proxy in front of the panel puts the client in x-real-ip.
    spy.mockClear();
    await GET(
      request('http://panel.test/engine/markets', { headers: { 'x-real-ip': '192.0.2.44' } }),
      params(['markets']),
    );
    const [, third] = spy.mock.calls[0] as [URL, { headers: Headers }];
    expect(third.headers.get('x-forwarded-for')).toBe('192.0.2.44');

    // And nothing is invented when the runtime exposes no address.
    spy.mockClear();
    await GET(request('http://panel.test/engine/markets'), params(['markets']));
    const [, fourth] = spy.mock.calls[0] as [URL, { headers: Headers }];
    expect(fourth.headers.get('x-forwarded-for')).toBeNull();
  });
});
