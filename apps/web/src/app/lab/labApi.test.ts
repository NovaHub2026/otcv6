import { afterEach, describe, expect, it, vi } from 'vitest';
import { isControl, isUnavailable, labGet, labPost } from './labApi.js';

/**
 * Cycle Audit 8 (a8): an HTTP error from the Lab is an answer, not a market.
 *
 * The defect: `GET markets/:id/state` answers 404 `{message, error, statusCode}`
 * for a market the Lab no longer hosts — an asset retired through the panel's
 * own Manage screen, or a Lab restarted against another state directory. That
 * object was stored as the market state, the next render read `price.split` on
 * it, and the whole Lab screen went white. The market list is fetched once on
 * mount, so every poll for the next second, and the next, did it again.
 */
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const answering = (status: number, body: unknown): void => {
  globalThis.fetch = (): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
};

describe('the Lab client turns a refusal into an answer', () => {
  it('reads a 404 as unavailable, carrying the Lab’s own words', async () => {
    answering(404, { message: 'Asset eurusd is not hosted.', error: 'Not Found', statusCode: 404 });
    const body = await labGet<{ price: string }>('markets/eurusd/state');
    expect(isUnavailable(body)).toBe(true);
    expect((body as { reason: string }).reason).toBe('Asset eurusd is not hosted.');
    // And it is certainly not mistaken for a market.
    expect((body as { price?: string }).price).toBeUndefined();
    expect(isControl(body)).toBe(false);
  });

  it('reads a refusal with no message as unavailable, naming the status', async () => {
    answering(503, {});
    const body = await labPost<unknown>('markets/eurusd/push?distance=1');
    expect(isUnavailable(body)).toBe(true);
    expect((body as { reason: string }).reason).toMatch(/503/);
  });

  it('passes the Lab’s own «not running» body through unchanged', async () => {
    // The proxy's 503 says more than a status code can, and the screen shows it.
    answering(503, { running: false, reason: 'No Lab is configured.' });
    const body = await labGet<unknown>('markets');
    expect(isUnavailable(body)).toBe(true);
    expect((body as { reason: string }).reason).toBe('No Lab is configured.');
  });

  it('leaves a successful answer exactly as it came', async () => {
    answering(200, { price: '1.0850382', latticeLevel: 128 });
    const body = await labGet<{ price: string; latticeLevel: number }>('markets/eurusd/state');
    expect(isUnavailable(body)).toBe(false);
    expect(body).toEqual({ price: '1.0850382', latticeLevel: 128 });
  });

  it('is still an answer when the transport fails outright', async () => {
    globalThis.fetch = (): Promise<Response> => Promise.reject(new Error('socket hang up'));
    const body = await labGet<unknown>('markets');
    expect(isUnavailable(body)).toBe(true);
    expect((body as { reason: string }).reason).toMatch(/socket hang up/);
  });
});
