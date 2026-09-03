'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactElement } from 'react';
import { fetchHealth, type HealthView } from '../lib/api.js';

const ENTRIES = [
  { href: '/preview', label: 'Preview' },
  { href: '/assets/new', label: 'Create asset' },
  { href: '/assets/manage', label: 'Assets' },
  /**
   * The Lab, marked in the menu as well as on its own screen.
   *
   * §3 of the specification requires `OTC LAB` and `SIMULATION ENVIRONMENT` to
   * be permanently displayed, and the menu is where an operator decides to go
   * there. A row that looked like the others would be the first place the
   * distinction is lost.
   *
   * The entry is always present, even with no Lab running. The screen then says
   * so and says how to start one, which is the honest state: the Lab is a
   * separate process by design (ADR-0015 §3), and a menu that hid the entry
   * until one existed would make the boundary look like a bug.
   */
  { href: '/lab', label: 'Lab', lab: true },
] as const;

/**
 * How often the shell asks the engine whether it is publishing (a6-18).
 *
 * A few seconds: the catch-up bound is fifteen, so a stall is visible here
 * within a third of the time it took to become one, and a hundred-asset
 * catalogue answering `/health` every five seconds is a few kilobytes.
 */
export const HEALTH_POLL_MS = 5_000;

/**
 * The panel's submenus, and the engine's own account of itself.
 *
 * A client component because the active entry depends on the path and the
 * health line depends on a poll. It is separate from the layout so that the
 * layout can stay a server component and the list of submenus can stay one
 * array.
 *
 * ## Why the shell polls `/health` (a6-18)
 *
 * A stalled market keeps its stream open and publishes nothing. From a chart
 * that is indistinguishable from a quiet market, so the preview said `live`
 * over a price frozen for minutes. The venue knows the difference — it records
 * every market that failed its last advance, and why — and the panel had never
 * asked. Now the answer is on every screen, with the reason.
 */
export function Nav({ apiBase }: { apiBase: string }): ReactElement {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthView | null>(null);
  const [unreachable, setUnreachable] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const poll = (): void => {
      fetchHealth(apiBase, controller.signal)
        .then((view) => {
          setHealth(view);
          setUnreachable(null);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setUnreachable((cause as Error).message);
        });
    };
    poll();
    const timer = setInterval(poll, HEALTH_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [apiBase]);

  return (
    <nav
      style={{
        width: 180,
        flexShrink: 0,
        borderRight: '1px solid #242c3d',
        padding: '14px 0',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '0 14px 14px', color: '#5b6377', fontSize: 11 }}>OTC ENGINE</div>
      {ENTRIES.map((entry) => {
        const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
        return (
          <a
            key={entry.href}
            href={entry.href}
            data-testid={`nav-${entry.href.replaceAll('/', '-')}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 14px',
              color: active ? '#d7dce5' : '#8b93a7',
              textDecoration: 'none',
              borderLeft: `3px solid ${
                active ? ('lab' in entry ? '#f85149' : '#3fb950') : 'transparent'
              }`,
              background: active ? '#161b26' : 'transparent',
            }}
          >
            <span>{entry.label}</span>
            {'lab' in entry && (
              <span
                data-testid="nav-lab-marker"
                style={{ color: '#f85149', fontSize: 9, letterSpacing: 0.5 }}
              >
                SIM
              </span>
            )}
          </a>
        );
      })}
      <div style={{ flex: 1 }} />
      <HealthLine health={health} unreachable={unreachable} />
    </nav>
  );
}

function HealthLine({
  health,
  unreachable,
}: {
  health: HealthView | null;
  unreachable: string | null;
}): ReactElement {
  let colour = '#8b93a7';
  let headline = 'engine …';
  let detail: string[] = [];
  if (unreachable !== null) {
    colour = '#f85149';
    headline = 'engine unreachable';
    detail = [unreachable];
  } else if (health !== null && health.status === 'ok') {
    colour = '#3fb950';
    headline = `engine ok · ${health.assets} hosted`;
  } else if (health !== null) {
    colour = '#f85149';
    headline = `engine degraded · ${health.stalled.length} of ${health.assets} stalled`;
    // The venue's own words, per market: an operator learns from the service
    // rather than from a chart that stopped moving (CA6-33).
    detail = health.stalled.map((entry) => `${entry.assetId}: ${entry.reason}`);
  }
  return (
    <div style={{ padding: '14px 14px 0', fontSize: 11, lineHeight: 1.5 }}>
      <div data-testid="health-status" style={{ color: colour }}>
        {headline}
      </div>
      {detail.map((line) => (
        <div key={line} style={{ color: '#8b93a7', marginTop: 4, wordBreak: 'break-word' }}>
          {line}
        </div>
      ))}
    </div>
  );
}
