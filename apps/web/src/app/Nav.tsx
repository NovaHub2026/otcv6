'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactElement } from 'react';
import { fetchHealth, type HealthView } from '../lib/api.js';
import { es } from '../lib/es.js';
import { Info, T } from './ui/kit.js';

const ENTRIES = [
  { href: '/preview', label: es.shell.nav.preview },
  { href: '/assets/new', label: es.shell.nav.create },
  { href: '/assets/manage', label: es.shell.nav.manage },
  /**
   * The Lab, marked in the menu as well as on its own screen.
   *
   * §3 of the specification requires `OTC LAB` and `SIMULATION ENVIRONMENT` to
   * be permanently displayed, and the menu is where an operator decides to go
   * there. The entry is always present, even with no Lab running: the Lab is a
   * separate process by design (ADR-0015 §3), and the screen says so.
   */
  { href: '/lab', label: es.shell.nav.lab, lab: true },
] as const;

/** How often the shell asks the engine whether it is publishing (a6-18). */
export const HEALTH_POLL_MS = 5_000;

/**
 * The panel's menu and the engine's own account of itself (a6-18), in Spanish
 * since PH-24.6: the health as a dot and a short line, the explanation behind ⓘ.
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
        borderRight: `1px solid ${T.line}`,
        padding: '14px 0',
        display: 'flex',
        flexDirection: 'column',
        background: T.panel,
      }}
    >
      <div style={{ padding: '0 14px 14px', color: T.faint, fontSize: 11, letterSpacing: 1 }}>
        {es.shell.brand}
      </div>
      {ENTRIES.map((entry) => {
        const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
        const isLab = 'lab' in entry;
        return (
          <a
            key={entry.href}
            href={entry.href}
            data-testid={`nav-${entry.href.replaceAll('/', '-')}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '9px 14px',
              color: active ? T.text : T.muted,
              textDecoration: 'none',
              borderLeft: `3px solid ${active ? (isLab ? T.lab : T.ok) : 'transparent'}`,
              background: active ? T.raised : 'transparent',
              fontSize: 13,
            }}
          >
            <span>{entry.label}</span>
            {isLab && (
              <span
                data-testid="nav-lab-marker"
                style={{ color: T.lab, fontSize: 9, letterSpacing: 0.5 }}
              >
                {es.shell.labMark}
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
  let colour: string = T.muted;
  let headline: string = es.shell.engine.loading;
  let detail: string[] = [];
  if (unreachable !== null) {
    colour = T.bad;
    headline = es.shell.engine.unreachable;
    detail = [unreachable];
  } else if (health !== null && health.status === 'ok') {
    colour = T.ok;
    headline = es.shell.engine.ok(health.assets);
  } else if (health !== null) {
    colour = T.bad;
    headline = es.shell.engine.degraded(health.stalled.length, health.assets);
    // The venue's own words, per market (CA6-33) — behind ⓘ, not on the menu.
    detail = health.stalled.map((entry) => `${entry.assetId}: ${entry.reason}`);
  }
  return (
    <div
      style={{
        padding: '14px 14px 0',
        fontSize: 11,
        lineHeight: 1.5,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: colour,
          marginRight: 8,
          flexShrink: 0,
        }}
      />
      <span data-testid="health-status" style={{ color: colour }}>
        {headline}
      </span>
      <Info
        text={
          <>
            <div>{es.shell.engine.info}</div>
            {detail.map((line) => (
              <div key={line} style={{ color: T.bad, marginTop: 4 }}>
                {line}
              </div>
            ))}
          </>
        }
      />
    </div>
  );
}
