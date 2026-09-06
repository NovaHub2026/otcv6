import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { RateLimitGuard } from './rateLimit.guard.js';
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
