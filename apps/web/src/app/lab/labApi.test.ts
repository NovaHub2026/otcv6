import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isControl,
  isUnavailable,
  labGet,
  labPost,
  LAB_POLL_TIMEOUT_MS,
  LAB_TIMEOUT_MS,
} from './labApi.js';

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

/**
 * Cycle Audit 8 (a4): a Lab that stops answering is a Lab that never answers.
 *
 * A blocked Lab holds the socket open rather than closing it, so the transport
 * never fails and none of the above happens: without a deadline the screen
 * waits for the whole outage, the poll it belongs to stops asking, and the
 * `busy` flag on whichever act was in flight is held by a request that will
 * not come back — the failure PH-24.11 was written for, arriving the one way
 * PH-24.11 did not close.
 */
describe('the Lab client gives up on a Lab that never answers', () => {
  /** A Lab that accepted the connection and then went quiet. */
  const silent = (): void => {
    globalThis.fetch = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject((init.signal as AbortSignal).reason as Error);
        });
      });
  };

  it('answers a read that never returns as unavailable', async () => {
    silent();
    const body = await labGet<unknown>('markets/eurusd/state', 250);
    expect(isUnavailable(body)).toBe(true);
    expect((body as { reason: string }).reason).toMatch(/el Lab no respondió/);
  });

  it('answers a write that never returns as unavailable, so the strip is released', async () => {
    silent();
    const body = await labPost<unknown>('markets/eurusd/release', 250);
    expect(isUnavailable(body)).toBe(true);
    expect((body as { reason: string }).reason).toMatch(/el Lab no respondió/);
  });

  it('waits longer for an act than for a poll, and both long enough to say seconds', () => {
    // The poll asks again by itself and must not sit on a dead socket; an act
    // may be a rejection search or the battery, and cutting one short would be
    // a defect rather than a rescue.
    expect(LAB_POLL_TIMEOUT_MS).toBeLessThan(LAB_TIMEOUT_MS);
    expect(LAB_POLL_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
  });
});
