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
