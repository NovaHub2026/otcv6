/**
 * Which interfaces this service listens on, and why that is a decision.
 *
 * Its own module because `main.ts` boots the application at import time, so
 * nothing in it can be tested without starting a server — and Cycle Audit 7
 * found that the bind default, the one constant deciding whether an admin
 * surface is reachable from the LAN, had no test at all. Changing it to
 * `0.0.0.0` passed 557 tests in silence (CA7-27).
 */

/**
 * The default: this machine only.
 *
 * The service used to listen on every interface, which on a LAN meant anyone
 * who could reach the port could create, rename and retire assets (out-of-band
 * audit, a6-01). An operator who means to expose it says so.
 */
export const DEFAULT_BIND_ADDRESS = '127.0.0.1';

/**
 * Spellings of "every interface" that are too short to be deliberate.
 *
 * **Cycle Audit 7, CA7-28.** `OTC_BIND=0` binds everything: Node reads a bare
 * `0` as `0.0.0.0`. So the shortest possible typo — and a plausible one, from
 * someone meaning "no, don't restrict it", or from a port that landed in the
 * wrong variable — silently published the write surface to the network, and the
 * boot line printed `0` without saying what it had done.
 *
 * Exposing this service is a decision an operator is entitled to make. It is
 * not one they get to make by accident, so the full form is required.
 */
const WILDCARD_SHORTHANDS = new Set(['0', '*', 'any', 'all']);

/**
 * The environment is passed in, never read here.
 *
 * `main.ts` and `app.module.ts` are the allowlisted readers of ambient state:
 * confining that to the modules that wire the application together is what
 * lets everything below them stay replayable. The guardrail scan caught the
 * default parameter this function was first written with, which is the guard
 * doing exactly what it exists for.
 */
export function bindAddressFromEnvironment(env: NodeJS.ProcessEnv): string {
  const raw = env['OTC_BIND']?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_BIND_ADDRESS;
  if (WILDCARD_SHORTHANDS.has(raw.toLowerCase())) {
    throw new Error(
      `OTC_BIND is "${raw}", which binds every interface. If that is what you mean, write it ` +
        `out: OTC_BIND=0.0.0.0 — and set OTC_ADMIN_TOKEN first.`,
    );
  }
  return raw;
}

/** Whether an address reaches beyond this machine. */
export function isExposedBind(host: string): boolean {
  return host !== DEFAULT_BIND_ADDRESS && host !== 'localhost' && host !== '::1';
}

/**
 * Proxy hops to trust when reading a client's address, from `OTC_TRUSTED_PROXIES`.
 *
 * **Cycle Audit 10 (a1-02, a5-01, a8-01 — three auditors independently).** The
 * rate limit keys on the address Express resolves, nothing configured `trust
 * proxy`, and `deploy/nginx.conf` — the proxy this repository ships — forwards
 * the client in `X-Forwarded-For` and connects from loopback. So behind the
 * shipped deployment every client on the Internet shared **one** bucket: six
 * distinct forwarded addresses were measured taking each other's tokens, and a
 * flood then refused the orchestrator's readiness probe and the monitor's
 * scrape along with everyone else.
 *
 * The number is hops, not a boolean, and it is Express's own `trust proxy`
 * setting: `1` means the last entry of `X-Forwarded-For` is the client, which
 * is true behind one reverse proxy. It defaults to **0** — trust nothing —
 * because a service reachable directly must not let a header choose its own
 * bucket, which is the other half of this defect and the reason a boolean
 * would be wrong.
 */
export function trustedProxiesFromEnvironment(env: NodeJS.ProcessEnv): number {
  const raw = env['OTC_TRUSTED_PROXIES']?.trim();
  if (raw === undefined || raw.length === 0) return 0;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `OTC_TRUSTED_PROXIES must be a whole number of proxy hops written as digits, got ${raw}. ` +
        `Behind the nginx this repository ships, that is 1.`,
    );
  }
  return Number.parseInt(raw, 10);
}
