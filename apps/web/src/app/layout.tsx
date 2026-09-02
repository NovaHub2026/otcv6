import type { ReactElement, ReactNode } from 'react';
import { Nav } from './Nav';

export const metadata = {
  title: 'OTC engine — admin',
  description: 'The operator surface for a synthetic market that shows only what happened',
};

/**
 * The panel shell.
 *
 * Two submenus now — watching a market and creating one — and the navigation is
 * built as though there will be more, because there will be: editing an asset
 * and retiring one. What it is not is a trading screen: nothing here is
 * economic, and `guardrails` keeps that true rather than convention.
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
        <Nav />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </body>
    </html>
  );
}
