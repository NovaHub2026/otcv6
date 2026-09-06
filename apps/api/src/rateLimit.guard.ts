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
 * bucket testable to the millisecond. The key is the remote address as
 * Express resolves it (`trust proxy` is the deployment's, `deploy/nginx.conf`
 * forwards it). Zero disables the limit, and a deployment behind a proxy
 * that already limits will want that.
 */
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
