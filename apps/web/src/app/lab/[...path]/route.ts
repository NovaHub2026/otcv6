import type { NextRequest } from 'next/server';

/**
 * The Lab, reached from the panel — if an operator started one.
 *
 * ## Why this is not the engine proxy with a different prefix
 *
 * The Lab is a **separate process** (`apps/api/src/lab/lab.main.ts`), and that
 * is the whole of ADR-0015 §3: `LabModule` composes `AppModule`, the production
 * service never imports the Lab, and the Lab's routes do not exist in the
 * binary an operator runs in production.
 *
 * If this proxy pointed at the engine, that boundary would end here — the panel
 * would make Lab routes reachable from a service that does not have them. So it
 * points at `OTC_LAB_BASE`, and **when that is unset there is nothing to
 * reach**. Absence by default, presence by a deliberate act, on both sides.
 *
 * The Lab serves all seven keystream cursors, which INV-010 forbids publishing.
 * The panel binds loopback (CA7-06) and so does the Lab, so an operator who
 * starts one is exposing it to their own machine and no further.
 */

/** Where the Lab is, when an operator has started one. */
function labBase(): string | null {
  const configured = process.env['OTC_LAB_BASE']?.trim();
  return configured === undefined || configured.length === 0 ? null : configured;
}

const NOT_RUNNING = {
  environment: 'OTC LAB — SIMULATION ENVIRONMENT',
  running: false,
  reason:
    'No Lab is configured. The Lab is a separate process and the panel points at one only when ' +
    'OTC_LAB_BASE names it — the routes do not exist in the production service (ADR-0015). ' +
    'Start it with OTC_LAB_PORT=3100 node apps/api/dist/lab/lab.main.js and set ' +
    'OTC_LAB_BASE=http://127.0.0.1:3100.',
};

async function forward(
  request: NextRequest,
  path: string[],
  method: 'GET' | 'POST',
): Promise<Response> {
  const base = labBase();
  if (base === null) {
    return Response.json(NOT_RUNNING, { status: 503 });
  }
  const url = new URL(`${base}/lab/${path.join('/')}`);
  url.search = request.nextUrl.search;
  try {
    // POST for the Lab's acts — apply, release — carrying only the query: the
    // routes take no body, and a proxy that forwarded one would be forwarding
    // something nothing reads (PH-24.2).
    //
    // The acts are writes, and the Lab composes the application's global
    // write guard: every non-read request needs `Authorization: Bearer
    // <OTC_ADMIN_TOKEN>`. Added here, server-side, from this process's own
    // token — the same arrangement as the engine proxy, and for the same
    // reason: a browser never holds the credential. Nothing a browser sends
    // under `authorization` is forwarded. Found by clicking Apply: the screen
    // said "keystream (nothing armed)" and the Lab had answered 403.
    const headers = new Headers({ accept: 'application/json' });
    let body: string | undefined;
    if (method !== 'GET') {
      const token = process.env['OTC_ADMIN_TOKEN'];
      if (token !== undefined && token.length > 0) headers.set('authorization', `Bearer ${token}`);
      // The guard also takes writes as `application/json` only — a write a
      // browser could send without a preflight would be a write any page
      // could make — so the acts carry an empty JSON body under that type.
      headers.set('content-type', 'application/json');
      body = '{}';
    }
    const upstream = await fetch(url, { method, headers, ...(body === undefined ? {} : { body }) });
    // The body is handed over unread, like the engine proxy: a Lab response can
    // be a long analysis and a buffered proxy would hold all of it.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (error) {
    return Response.json(
      {
        ...NOT_RUNNING,
        reason: `The Lab at ${base} did not answer: ${(error as Error).message}`,
      },
      { status: 502 },
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  return forward(request, path, 'GET');
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  return forward(request, path, 'POST');
}
