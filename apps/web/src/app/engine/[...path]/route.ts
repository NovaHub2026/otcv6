import type { NextRequest } from 'next/server';

/**
 * The engine, served under the panel's own origin.
 *
 * ## Why this is a route handler and not a rewrite
 *
 * It was a rewrite — `next.config.mjs` mapping `/engine/:path*` at the server —
 * and the ordinary endpoints proxied through it correctly. **The tick stream did
 * not.** Measured against a running pair: `/engine/catalogue` and
 * `/engine/markets/eurusd/history` returned in milliseconds, while
 * `/engine/markets/eurusd/stream` returned nothing at all in fifteen seconds and
 * Next never opened a connection to the engine for it — `ss` showed the client
 * connected to Next and Next connected to nothing.
 *
 * A rewrite to an external destination is not a streaming proxy, and a live
 * market is nothing but a stream. So the proxy is written out: the upstream
 * body is handed to the response **unread**, which is what makes it stream.
 *
 * ## What it forwards, and what it does not
 *
 * Method, path, query, body and the headers that decide content negotiation and
 * stream resumption. Not `host`, which belongs to this origin; not
 * `content-length`, which belongs to the body as re-sent; not `connection`; and
 * not `authorization` — see below.
 *
 * `Last-Event-ID` is on the list deliberately: it is how a browser resumes a
 * stream after a disconnect, and an SSE proxy that drops it turns every
 * reconnection into a gap in the client's sequence.
 *
 * ## The operator's token stays on this server (a6-01)
 *
 * The engine refuses every write without `Authorization: Bearer
 * <OTC_ADMIN_TOKEN>`. This handler adds that header to every non-read request,
 * from its own `OTC_ADMIN_TOKEN`, read per request like the engine address. The
 * browser never holds the token: it is not in the bundle, not in a cookie, and
 * an `authorization` header the browser sends is not forwarded. Whoever can
 * load the panel can administer the engine — which is the panel's own access
 * question to answer, at its own origin — and nobody else can, because the
 * engine listens on loopback by default and the token never leaves this
 * process.
 *
 * Nothing here is economic and nothing here generates. It moves bytes.
 */

/** Never cached, never prerendered: every path through here is live. */
export const dynamic = 'force-dynamic';

/**
 * Where this server reaches the engine — read **per request**, never inlined.
 *
 * `next.config.mjs` used to carry `env: { OTC_API_BASE }`, and Next's `env` key
 * substitutes the value **at build time**. The consequence was not a warning: a
 * panel started with `OTC_API_BASE=http://127.0.0.1:41337` proxied to
 * `http://127.0.0.1:3000` anyway, because that was the default baked in when the
 * bundle was built. On a machine with a stale engine on 3000 the panel talked to
 * it happily — the catalogue and the history answered, and only the tick stream
 * was silent, because that engine's markets had stalled hours earlier.
 *
 * Reading it here, on each call, means the address is whatever the process was
 * started with. It never reaches the browser: this module is server-only.
 */
function engineOrigin(): string {
  return process.env.OTC_API_BASE ?? 'http://127.0.0.1:3000';
}

/** The write credential, read per request for the same reason the address is. */
function adminToken(): string | null {
  const raw = process.env.OTC_ADMIN_TOKEN;
  return raw === undefined || raw.length === 0 ? null : raw;
}

const FORWARDED = ['accept', 'accept-language', 'content-type', 'last-event-id'];

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const url = new URL(`${engineOrigin()}/${path.join('/')}`);
  url.search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const reads = READ_METHODS.has(request.method.toUpperCase());
  if (!reads) {
    // Added here and only here. When the panel was started without the
    // token, nothing is added and the engine answers with the message that
    // names the variable — which the panel shows verbatim.
    const token = adminToken();
    if (token !== null) headers.set('authorization', `Bearer ${token}`);
  }

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    ...(reads ? {} : { body: await request.text() }),
    cache: 'no-store',
    redirect: 'manual',
  });

  const out = new Headers();
  for (const name of ['content-type', 'cache-control', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  // Told explicitly rather than inferred: a proxy that lets an intermediary
  // buffer a `text/event-stream` produces a chart that updates in bursts, or
  // never.
  if ((upstream.headers.get('content-type') ?? '').includes('text/event-stream')) {
    out.set('cache-control', 'no-cache, no-transform');
    out.set('connection', 'keep-alive');
    out.set('x-accel-buffering', 'no');
  }
  // `upstream.body` is passed through unread. Reading it here — with `.text()`,
  // or `.json()`, or anything that awaits completion — is exactly what the
  // rewrite was doing wrong.
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxy(request, (await context.params).path);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxy(request, (await context.params).path);
}

/**
 * `PATCH` is exported for the same reason `POST` is, and it was forgotten once.
 *
 * A route handler serves only the methods it exports; everything else is a 405
 * with no explanation from the engine. The panel's rename silently did nothing
 * until this existed, and the browser test that caught it did so by checking the
 * name on screen rather than the status of the request.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxy(request, (await context.params).path);
}
