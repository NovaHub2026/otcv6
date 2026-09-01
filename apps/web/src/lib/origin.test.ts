// Invariant evidence: INV-002 (shared market) — the panel must be able to reach the record at all.
import { describe, expect, it } from 'vitest';
import config from '../../next.config.mjs';

/**
 * The panel talks to one origin, and that is load-bearing rather than tidy.
 *
 * The first person to open this panel saw `Cannot reach the engine: Failed to
 * fetch`. The page loaded, so its own port was fine; the engine's port was not,
 * because something else on the host already held it. A panel that needs two
 * ports opened, forwarded and free is a panel that does not work.
 *
 * So the engine is served under the panel's own origin at `/engine`, proxied by
 * the Next server — which runs beside the engine and does not need it to be
 * publicly reachable at all.
 */
describe('the panel reaches the engine through its own origin', () => {
  it('proxies /engine to the configured engine', async () => {
    const rewrites = (await (
      config as { rewrites: () => Promise<{ source: string; destination: string }[]> }
    ).rewrites()) as { source: string; destination: string }[];
    const engine = rewrites.find((rule) => rule.source === '/engine/:path*');
    expect(engine, 'no /engine rewrite').toBeDefined();
    // Every path under it, not a fixed list: a rewrite that forwarded only the
    // endpoints known today would break silently on the next one.
    expect(engine!.destination).toMatch(/\/:path\*$/);
    expect(engine!.destination).toMatch(/^https?:\/\//);
  });

  it('sends the engine address to the server and not to the browser', () => {
    // `OTC_API_BASE` is read in the Next config and used as the rewrite target.
    // It is deliberately not a `NEXT_PUBLIC_` variable: the browser never needs
    // the engine's address, and a deployment should be free to keep the engine
    // off the public network entirely.
    expect(Object.keys(process.env).filter((key) => key.startsWith('NEXT_PUBLIC_OTC'))).toEqual([]);
  });
});
