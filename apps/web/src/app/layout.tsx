import type { ReactElement, ReactNode } from 'react';
import { Nav } from './Nav';

export const metadata = {
  title: 'OTC engine — admin',
  description: 'The operator surface for a synthetic market that shows only what happened',
};

/**
 * Same origin, through the route handler in `engine/[...path]/route.ts`.
 *
 * An absolute URL is still allowed via `NEXT_PUBLIC_OTC_API_BASE`, for a
 * deployment that serves the engine from its own host — that path needs the
 * engine's CORS headers, which is why they exist.
 */
const API_BASE = process.env.NEXT_PUBLIC_OTC_API_BASE ?? '/engine';

/**
 * The panel shell.
 *
 * Three submenus — watching a market, creating one, administering the list —
 * and, since the out-of-band audit, the engine's health on every screen
 * (a6-18). What it is not is a trading screen: nothing here is economic, and
 * `guardrails` keeps that true rather than convention.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          height: '100vh',
          display: 'flex',
          background: '#0b0e14',
          color: '#d7dce5',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
        }}
      >
        <Nav apiBase={API_BASE} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </body>
    </html>
  );
}
