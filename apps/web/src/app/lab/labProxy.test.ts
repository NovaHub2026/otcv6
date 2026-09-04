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

function request(url: string, method = 'GET'): NextRequest {
  const base = new Request(url, { method });
  return Object.assign(base, { nextUrl: new URL(url) }) as unknown as NextRequest;
}
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
      request('http://panel/lab/release-all', 'POST'),
      params(['release-all']),
    );
    expect(response.status).toBe(502);
    expect(calls).toBe(1);
  });
});
