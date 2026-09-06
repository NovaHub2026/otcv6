import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { isOperationalProbe, RateLimitGuard } from './rateLimit.guard.js';
import { VenueService } from './venue.service.js';

const GENESIS = epochMillis(1_776_000_000_000);
function guard(perMinute: number | null): { guard: RateLimitGuard; clock: SteppableClock } {
  const clock = new SteppableClock(GENESIS);
  const venue = new VenueService(
    new MemoryStateStore(),
    MasterKeyring.fromSecret('rate-limit-spec', new Uint8Array(32).fill(31)),
    clock,
    [ASSET_CATALOGUE[0]!],
  );
  return { guard: new RateLimitGuard(venue, perMinute), clock };
}

describe('the per-client rate limit (PH-30.1)', () => {
  it('admits a minute of requests, refuses the next with a retry, and refills by the clock', () => {
    const { guard: limiter, clock } = guard(60);
    for (let i = 0; i < 60; i += 1) expect(limiter.admit('a', clock.now()).admitted).toBe(true);
    const refused = limiter.admit('a', clock.now());
    expect(refused.admitted).toBe(false);
    expect(refused.admitted === false && refused.retryAfterSeconds).toBe(1);
    // Another client is another bucket.
    expect(limiter.admit('b', clock.now()).admitted).toBe(true);
    // One token a second at sixty a minute.
    expect(limiter.admit('a', clock.now() + 999).admitted).toBe(false);
    expect(limiter.admit('a', clock.now() + 1_000).admitted).toBe(true);
    expect(limiter.admit('a', clock.now() + 1_000).admitted).toBe(false);
    // A full minute later the bucket is full again, and no fuller.
    for (let i = 0; i < 60; i += 1)
      expect(limiter.admit('a', clock.now() + 120_000).admitted).toBe(true);
    expect(limiter.admit('a', clock.now() + 120_000).admitted).toBe(false);
  });

  it('is disabled at zero, and defaults to six hundred', () => {
    const { guard: off, clock } = guard(0);
    for (let i = 0; i < 1_000; i += 1) expect(off.admit('a', clock.now()).admitted).toBe(true);
    const { guard: byDefault } = guard(null);
    for (let i = 0; i < 600; i += 1) expect(byDefault.admit('a', GENESIS).admitted).toBe(true);
    expect(byDefault.admit('a', GENESIS).admitted).toBe(false);
  });
});

/**
 * Cycle Audit 10 (a1-02, a5-01, a8-01 — three auditors, independently). The
 * limit keyed on an address the venue could not see behind the proxy this
 * repository ships, and it refused the orchestrator and the monitor along with
 * the flood.
 */
describe('the limit is keyed on a client and never refuses the probes (Cycle Audit 10)', () => {
  it('exempts liveness, readiness and the scrape, by exact path and nothing near them', () => {
    for (const path of ['/health/live', '/health/ready', '/metrics'])
      expect(isOperationalProbe(path), path).toBe(true);
    // Not a prefix match: a route may not buy exemption by wearing the name.
    for (const path of [
      '/health',
      '/metrics/all',
      '/markets/metrics',
      '/health/ready/x',
      '/Metrics',
      '',
    ])
      expect(isOperationalProbe(path), path).toBe(false);
  });

  it('admits a probe from an address whose bucket is empty', () => {
    const { guard: limiter, clock } = guard(1);
    const request = (path: string, ip: string): boolean => {
      // The shape `canActivate` reads, and nothing else it touches.
      const headers: Record<string, string> = {};
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ path, ip, socket: { remoteAddress: ip }, headers }),
          getResponse: () => ({ setHeader: () => undefined }),
        }),
      } as unknown as Parameters<RateLimitGuard['canActivate']>[0];
      try {
        return limiter.canActivate(context);
      } catch {
        return false;
      }
    };
    expect(request('/markets', '10.0.0.1')).toBe(true);
    // The bucket is empty now: a client is refused...
    expect(request('/markets', '10.0.0.1')).toBe(false);
    // ...and the orchestrator and the monitor are not, however empty it is.
    for (let i = 0; i < 50; i += 1) {
      expect(request('/health/live', '10.0.0.1')).toBe(true);
      expect(request('/health/ready', '10.0.0.1')).toBe(true);
      expect(request('/metrics', '10.0.0.1')).toBe(true);
    }
    // And a probe never spends a token, so the client's own refusal is
    // unchanged by however many times the orchestrator asked.
    expect(limiter.admit('10.0.0.1', clock.now()).admitted).toBe(false);
  });
});
