import type { NextRequest } from 'next/server';

/**
 * The Lab's own engine routes, read-only, for the chart inside the Lab (PH-24.12).
 *
 * A Lab-composed process is the whole engine (ADR-0018): catalogue, history
 * and the tick stream live on the same origin as `/lab`. The Lab screen draws
 * its chart from **here**, never from `/engine`, so that in a deployment with
 * two processes the candles under the Lab's controls are the market those
 * controls act on — and in the one-process deployment they are the same
 * candles Vista shows.
 *
 * Reads only. The Lab's writes go through `/lab`, which signs them; nothing
 * here carries a token, and a write is answered 405 rather than forwarded.
 */
export const dynamic = 'force-dynamic';

function labOrigin(): string | null {
  const raw = process.env.OTC_LAB_BASE;
  return raw === undefined || raw.length === 0 ? null : raw.replace(/\/+$/, '');
}

const FORWARDED = ['accept', 'accept-language', 'last-event-id'];

async function read(request: NextRequest, path: string[]): Promise<Response> {
  const origin = labOrigin();
  if (origin === null) {
    return Response.json(
      { running: false, reason: 'OTC_LAB_BASE is not configured: no Lab engine to read.' },
      { status: 503 },
    );
  }
  const url = new URL(`${origin}/${path.join('/')}`);
  url.search = new URL(request.url).search;
  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const upstream = await fetch(url, {
    method: request.method,
    headers,
    cache: 'no-store',
    redirect: 'manual',
  });
  const out = new Headers();
  for (const name of ['content-type', 'cache-control', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  if ((upstream.headers.get('content-type') ?? '').includes('text/event-stream')) {
    out.set('cache-control', 'no-cache, no-transform');
    out.set('connection', 'keep-alive');
    out.set('x-accel-buffering', 'no');
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return read(request, (await context.params).path);
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return read(request, (await context.params).path);
}

/** A write to the Lab's engine routes is not a thing this proxy does. */
export function POST(): Response {
  return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
}
