'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { usePathname } from 'next/navigation';
import { es } from '../lib/es.js';

/**
 * The deployment's own declaration that the engine on every screen is the
 * Lab-composed engine (PH-24.12, ADR-0018 §2), asked of `/labmode` on mount
 * because environment is a runtime fact. On `/lab` the Lab's banner already
 * says it, once is enough.
 */
export function LabModeBanner(): ReactElement | null {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  useEffect(() => {
    // Read per request from the deployment's environment (never baked at build).
    const controller = new AbortController();
    fetch('/labmode', { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.json())
      .then((body: { active?: boolean }) => setActive(body.active === true))
      .catch(() => setActive(false));
    return () => controller.abort();
  }, []);
  if (!active || pathname.startsWith('/lab')) return null;
  return (
    <div
      data-testid="lab-mode-banner"
      style={{
        background: '#3a1f1f',
        borderBottom: '2px solid #ff6b6b',
        color: '#ffd7d7',
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexShrink: 0,
      }}
    >
      <strong style={{ letterSpacing: 2, fontSize: 13 }}>{es.lab.banner.title}</strong>
      <span style={{ letterSpacing: 1, fontSize: 11 }}>{es.lab.banner.subtitle}</span>
      <span style={{ fontSize: 11, color: '#f0b0b0' }}>{es.shell.labMode}</span>
    </div>
  );
}
