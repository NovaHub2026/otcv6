import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET, POST } from './[...path]/route.js';

/**
 * PH-24.12: the chart inside the Lab reads the Lab's engine, read-only.
 *
 * The proxy's whole job is to point at `OTC_LAB_BASE` and never at
 * `OTC_API_BASE`: in a two-process deployment the second is production's
 * market, and the Lab must not draw it under its own controls (ADR-0018 §4).
 */
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

function request(url: string, method = 'GET', headers: Record<string, string> = {}): NextRequest {
  return new Request(url, { method, headers }) as unknown as NextRequest;
}

const params = (path: string[]): { params: Promise<{ path: string[] }> } => ({
  params: Promise.resolve({ path }),
});

describe('the Lab engine proxy', () => {
  it('reads from OTC_LAB_BASE, forwards the query, and never from OTC_API_BASE', async () => {
    vi.stubEnv('OTC_LAB_BASE', 'http://127.0.0.1:47302/');
    vi.stubEnv('OTC_API_BASE', 'http://127.0.0.1:47300');
    const seen: string[] = [];
    globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
      seen.push(String(input instanceof Request ? input.url : input));
      return Promise.resolve(
        new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    };
    const response = await GET(
      request('http://panel/labengine/markets/eurusd/history?timeframe=1m&from=1&to=2'),
      params(['markets', 'eurusd', 'history']),
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual([
      'http://127.0.0.1:47302/markets/eurusd/history?timeframe=1m&from=1&to=2',
    ]);
  });

  it('keeps an event stream unbuffered and forwards last-event-id', async () => {
    vi.stubEnv('OTC_LAB_BASE', 'http://127.0.0.1:47302');
    let forwarded: Headers | null = null;
    globalThis.fetch = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      forwarded = new Headers(init?.headers);
      return Promise.resolve(
        new Response('data: {}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );
    };
    const response = await GET(
      request('http://panel/labengine/markets/eurusd/stream', 'GET', { 'last-event-id': '41' }),
      params(['markets', 'eurusd', 'stream']),
    );
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect((forwarded as Headers | null)?.get('last-event-id')).toBe('41');
    expect((forwarded as Headers | null)?.has('authorization')).toBe(false);
  });

  it('says so when no Lab engine is configured, and refuses writes', async () => {
    vi.stubEnv('OTC_LAB_BASE', '');
    const response = await GET(request('http://panel/labengine/catalogue'), params(['catalogue']));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { running: boolean }).running).toBe(false);
    expect(POST().status).toBe(405);
  });
});
