'use client';

import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';

const ENTRIES = [
  { href: '/preview', label: 'Preview' },
  { href: '/assets/new', label: 'Create asset' },
] as const;

/**
 * The panel's submenus.
 *
 * A client component only because the active entry depends on the path. It is
 * separate from the layout so that the layout can stay a server component and
 * the list of submenus can stay one array.
 */
export function Nav(): ReactElement {
  const pathname = usePathname();
  return (
    <nav style={{ width: 180, flexShrink: 0, borderRight: '1px solid #242c3d', padding: '14px 0' }}>
      <div style={{ padding: '0 14px 14px', color: '#5b6377', fontSize: 11 }}>OTC ENGINE</div>
      {ENTRIES.map((entry) => {
        const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
        return (
          <a
            key={entry.href}
            href={entry.href}
            data-testid={`nav-${entry.href.replaceAll('/', '-')}`}
            style={{
              display: 'block',
              padding: '8px 14px',
              color: active ? '#d7dce5' : '#8b93a7',
              textDecoration: 'none',
              borderLeft: `3px solid ${active ? '#3fb950' : 'transparent'}`,
              background: active ? '#161b26' : 'transparent',
            }}
          >
            {entry.label}
          </a>
        );
      })}
    </nav>
  );
}
