import type { ReactElement, ReactNode } from 'react';

export const metadata = {
  title: 'OTC engine — admin',
  description: 'The operator surface for a synthetic market that shows only what happened',
};

/**
 * The panel shell.
 *
 * One submenu, and the navigation is built as though there will be more, because
 * there will be: creating an asset, editing one, retiring one. What it is not
 * is a trading screen — nothing here is economic, and `guardrails` keeps that
 * true rather than convention.
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
        <nav
          style={{
            width: 180,
            flexShrink: 0,
            borderRight: '1px solid #242c3d',
            padding: '14px 0',
          }}
        >
          <div style={{ padding: '0 14px 14px', color: '#5b6377', fontSize: 11 }}>OTC ENGINE</div>
          <a
            href="/preview"
            style={{
              display: 'block',
              padding: '8px 14px',
              color: '#d7dce5',
              textDecoration: 'none',
              borderLeft: '3px solid #3fb950',
              background: '#161b26',
            }}
          >
            Preview
          </a>
        </nav>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </body>
    </html>
  );
}
