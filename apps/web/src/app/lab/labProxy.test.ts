import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET, POST } from './[...path]/route.js';

/**
 * PH-24.19: the Lab proxy retries a read once on a transport error, never a write.
 */
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

function request(url: string, method = 'GET', headers?: Record<string, string>): NextRequest {
  const base = new Request(url, { method, ...(headers === undefined ? {} : { headers }) });
  return Object.assign(base, { nextUrl: new URL(url) }) as unknown as NextRequest;
}
const JSON_WRITE = { 'content-type': 'application/json' };
const params = (path: string[]): { params: Promise<{ path: string[] }> } => ({
  params: Promise.resolve({ path }),
});

describe('the Lab proxy', () => {
  it('retries a read once when the transport fails, and answers the retry', async () => {
    vi.stubEnv('OTC_LAB_BASE', 'http://127.0.0.1:47399');
    let calls = 0;
    globalThis.fetch = (): Promise<Response> => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('socket hang up'));
      return Promise.resolve(
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    const response = await GET(
      request('http://panel/lab/markets/eurusd/state'),
      params(['markets', 'eurusd', 'state']),
    );
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('never retries a write, and says the Lab did not answer', async () => {
    vi.stubEnv('OTC_LAB_BASE', 'http://127.0.0.1:47399');
    vi.stubEnv('OTC_ADMIN_TOKEN', 'x'.repeat(32));
    let calls = 0;
    globalThis.fetch = (): Promise<Response> => {
      calls += 1;
      return Promise.reject(new Error('socket hang up'));
    };
    const response = await POST(
      request('http://panel/lab/release-all', 'POST', JSON_WRITE),
      params(['release-all']),
    );
    expect(response.status).toBe(502);
    expect(calls).toBe(1);
  });

  /**
   * Cycle Audit 8 (a4): the two ways this proxy handed the operator's token to
   * a caller who should never have reached it.
   */
  it('refuses a path that leaves /lab, however the traversal is spelled (a4)', async () => {
    vi.stubEnv('OTC_LAB_BASE', 'http://127.0.0.1:47399');
    vi.stubEnv('OTC_ADMIN_TOKEN', 'a-token-of-sufficient-length');
    const asked: string[] = [];
    globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
      asked.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    // `..` inside one segment, which a `segment === '..'` test would not see:
    // `${base}/lab/../assets/eurusd/retire` normalises to the engine's admin route,
    // and this handler attaches the bearer token.
    for (const path of [
      ['../assets', 'eurusd', 'retire'],
      ['..', 'assets', 'eurusd', 'retire'],
      ['markets', '..', '..', 'assets'],
    ]) {
      const response = await POST(
        request(`http://panel/lab/${path.join('/')}`, 'POST', JSON_WRITE),
        params(path),
      );
      expect(response.status, `escaped with ${path.join('/')}`).toBe(400);
    }
    expect(asked, 'the upstream was called for a path outside /lab').toEqual([]);
    // A real Lab path still goes through, with the token.
    const ok = await POST(
      request('http://panel/lab/release-all', 'POST', JSON_WRITE),
      params(['release-all']),
    );
    expect(ok.status).toBe(200);
    expect(asked).toEqual(['http://127.0.0.1:47399/lab/release-all']);
  });

  it('refuses a write the browser could have sent without a preflight (a4)', async () => {
    vi.stubEnv('OTC_LAB_BASE', 'http://127.0.0.1:47399');
    vi.stubEnv('OTC_ADMIN_TOKEN', 'a-token-of-sufficient-length');
    let called = 0;
    globalThis.fetch = (): Promise<Response> => {
      called += 1;
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    // text/plain with no custom header is a CORS simple request: no preflight.
    // The proxy used to overwrite it with application/json and sign it.
    for (const sent of [
      { 'content-type': 'text/plain' },
      { 'content-type': 'text/plain;charset=UTF-8' },
      undefined,
    ]) {
      const response = await POST(
        request('http://panel/lab/markets/eurusd/bias', 'POST', sent),
        params(['markets', 'eurusd', 'bias']),
      );
      expect(response.status, `accepted ${JSON.stringify(sent)}`).toBe(415);
    }
    expect(called, 'the upstream was called for a request a page could forge').toBe(0);
    // The panel's own writes, which do send the type, are untouched.
    const ok = await POST(
      request('http://panel/lab/markets/eurusd/bias', 'POST', JSON_WRITE),
      params(['markets', 'eurusd', 'bias']),
    );
    expect(ok.status).toBe(200);
    expect(called).toBe(1);
  });
});
