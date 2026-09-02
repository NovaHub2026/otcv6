import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnsupportedMediaTypeException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * The write surface is closed unless the caller holds the operator's token.
 *
 * ## What this closes (a6-01)
 *
 * Until the out-of-band audit of 2026-09-02 the only thing between a web page
 * and `POST /assets/:id/retire` was CORS, and CORS is not authorisation. It
 * governs whether a page may *read* a cross-origin answer; a request with no
 * body and no custom header is a "simple request" that the browser sends
 * without a preflight, and the server executed it. Measured: `curl -X POST
 * /assets/gbpjpy/retire -H 'Origin: http://evil.example'` → `201 Created`, and
 * the market was retired — irreversibly, by the 2026-09-02 decision — by any
 * page open in the operator's browser.
 *
 * Three rules, all enforced here so that no route can forget one:
 *
 * 1. every method other than `GET`, `HEAD` and `OPTIONS` must carry
 *    `Authorization: Bearer <OTC_ADMIN_TOKEN>`, compared in constant time;
 * 2. when the engine was started without `OTC_ADMIN_TOKEN`, every write is
 *    refused with a message naming the variable — the service still boots and
 *    reads are unaffected, because a market that cannot be administered is
 *    still a market, while a market anyone can retire is not;
 * 3. every write must be `Content-Type: application/json`, so no write is a
 *    simple request and a browser preflights all of them.
 *
 * ## Why the token is injected rather than read here
 *
 * `apps/api/src` is inside the replayable set and the guardrail scan refuses
 * `process.env` everywhere but the composition root (`app.module.ts`). The
 * root reads the variable once, at boot, and hands the value in under
 * {@link ADMIN_TOKEN}; nothing below it can reach the environment.
 *
 * ## What it does not do
 *
 * Authenticate readers. The market is public by design (INV-002): every
 * observer sees the same prices at the same moment, and there is nothing
 * origin- or identity-specific in a read to protect.
 */

/** Injection token for the operator's write credential, read at composition. */
export const ADMIN_TOKEN = 'ADMIN_TOKEN';

/**
 * The shortest `OTC_ADMIN_TOKEN` the service will boot with.
 *
 * A one-character token is guessed in a hundred requests and is not a
 * credential, so the composition root refuses it at boot the way it refuses a
 * master secret of the wrong shape — loudly, before anything is hosted, rather
 * than by silently serving a write surface that is open in all but name.
 */
export const MIN_ADMIN_TOKEN_LENGTH = 16;

/** Methods that read. Everything else writes and must carry the credential. */
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The one media type a write may carry. */
const WRITE_MEDIA_TYPE = 'application/json';

/**
 * Whether a `Content-Type` header names JSON, ignoring its parameters.
 *
 * `application/json; charset=utf-8` is what `fetch` and most clients send; the
 * comparison is on the media type alone.
 */
export function isJsonContentType(value: string | string[] | undefined): boolean {
  if (typeof value !== 'string') return false;
  const media = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return media === WRITE_MEDIA_TYPE;
}

/**
 * Whether an `Authorization` header carries exactly this bearer token.
 *
 * Both sides are hashed before comparison so that `timingSafeEqual` sees equal
 * lengths and the length of the real token is not itself a timing signal.
 */
export function bearerMatches(header: string | undefined, token: string): boolean {
  if (typeof header !== 'string') return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (match === null) return false;
  const presented = createHash('sha256').update(match[1]!).digest();
  const expected = createHash('sha256').update(token).digest();
  return timingSafeEqual(presented, expected);
}

@Injectable()
export class AdminWriteGuard implements CanActivate {
  constructor(
    /** Null when the engine was started without `OTC_ADMIN_TOKEN`. */
    @Optional() @Inject(ADMIN_TOKEN) private readonly token: string | null = null,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    return this.check(
      request.method,
      request.headers.authorization,
      request.headers['content-type'],
    );
  }

  /**
   * The decision, separated from the framework so a unit test can drive it
   * with three strings rather than a mocked `ExecutionContext`.
   *
   * The token is checked before the content type, deliberately: a caller
   * without the credential learns nothing about what a well-formed write looks
   * like.
   */
  check(
    method: string,
    authorization: string | undefined,
    contentType: string | undefined,
  ): boolean {
    if (READ_METHODS.has(method.toUpperCase())) return true;
    if (this.token === null) {
      throw new ForbiddenException(
        'Writes are refused on this engine because OTC_ADMIN_TOKEN is not set. Start the ' +
          `service with OTC_ADMIN_TOKEN (at least ${MIN_ADMIN_TOKEN_LENGTH} characters) to ` +
          'create, rename or retire assets; reads are unaffected.',
      );
    }
    if (!bearerMatches(authorization, this.token)) {
      throw new ForbiddenException(
        'This write needs "Authorization: Bearer <OTC_ADMIN_TOKEN>". The panel adds it on ' +
          'the server side; a browser never holds it.',
      );
    }
    if (!isJsonContentType(contentType)) {
      throw new UnsupportedMediaTypeException(
        `Writes take Content-Type: ${WRITE_MEDIA_TYPE} only` +
          (contentType === undefined ? ' (none was sent)' : `, got ${contentType}`) +
          '. A write that a browser could send without a preflight would be a write any ' +
          'page could make.',
      );
    }
    return true;
  }
}
