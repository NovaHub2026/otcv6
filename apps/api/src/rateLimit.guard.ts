import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { VenueService } from './venue.service.js';

export const RATE_LIMIT_PER_MINUTE = 'RATE_LIMIT_PER_MINUTE';
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;

/**
 * A per-client token bucket on every route (PH-30.1).
 *
 * A flood from one address is refused with `429` and a `Retry-After`, before
 * a handler runs; a stream connection is one request, its frames are not
 * counted. Time comes from the venue's clock, never the wall clock —
 * `apps/api/src` is replayable and the scan says so — which also makes the
 * bucket testable to the millisecond. Zero disables the limit, and a
 * deployment behind a proxy that already limits will want that.
 *
 * **The key is the address Express resolves, and what Express resolves is
 * configured (Cycle Audit 10: a1-02, a5-01, a8-01, found independently).**
 * `main.ts` sets `trust proxy` from `OTC_TRUSTED_PROXIES`, which is 0 unless a
 * deployment says otherwise; behind the `deploy/nginx.conf` this repository
 * ships it is 1 and the forwarded client is the bucket. Before that, every
 * client behind the proxy shared one bucket of 600 a minute, because the only
 * address the venue ever saw was the proxy's own.
 *
 * **The operational probes are never refused (a5-01).** Liveness, readiness
 * and the metrics scrape belong to the orchestrator and the monitor, not to a
 * client: a flood that made the venue answer `429` to its own readiness probe
 * would take a healthy process out of rotation, which is worse than the flood
 * it was defending against. They are exempt by exact path.
 */
/**
 * Paths the limit never refuses: the orchestrator's two probes and the
 * monitor's scrape. Compared exactly, so nothing can widen the hole by
 * prefixing a route with one of these names.
 */
const OPERATIONAL_PROBES: ReadonlySet<string> = new Set([
  '/health/live',
  '/health/ready',
  '/metrics',
]);

/** Whether a path is one the rate limit must never refuse. */
export function isOperationalProbe(path: string): boolean {
  return OPERATIONAL_PROBES.has(path);
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  readonly #buckets = new Map<string, { tokens: number; at: number }>();
  readonly #perMinute: number;

  constructor(
    private readonly venue: VenueService,
    @Optional() @Inject(RATE_LIMIT_PER_MINUTE) perMinute: number | null = null,
  ) {
    this.#perMinute = perMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE;
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.#perMinute === 0) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (isOperationalProbe(request.path)) return true;
    const response = context.switchToHttp().getResponse<Response>();
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const verdict = this.admit(key, this.venue.now());
    if (verdict.admitted) return true;
    response.setHeader('Retry-After', String(verdict.retryAfterSeconds));
    throw new HttpException(
      {
        message: `Too many requests from this address: ${String(this.#perMinute)} a minute are admitted. Retry after ${String(verdict.retryAfterSeconds)} s.`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** The decision, separated from the framework so a unit test can drive it with a clock. */
  admit(
    key: string,
    now: number,
  ): { admitted: true } | { admitted: false; retryAfterSeconds: number } {
    if (this.#perMinute === 0) return { admitted: true };
    const capacity = this.#perMinute;
    const refillPerMs = capacity / 60_000;
    const bucket = this.#buckets.get(key) ?? { tokens: capacity, at: now };
    const refilled = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.at) * refillPerMs);
    if (refilled >= 1) {
      this.#buckets.set(key, { tokens: refilled - 1, at: now });
      this.#forget(now);
      return { admitted: true };
    }
    this.#buckets.set(key, { tokens: refilled, at: now });
    return {
      admitted: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - refilled) / refillPerMs / 1000)),
    };
  }

  /** Buckets full again are forgotten, so the map is bounded by recent clients. */
  #forget(now: number): void {
    if (this.#buckets.size < 10_000) return;
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.at > 60_000) this.#buckets.delete(key);
    }
  }
}
