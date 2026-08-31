import type { ReactElement, ReactNode } from 'react';

export const metadata = {
  title: 'OTC market',
  description: 'A synthetic market that shows only what happened',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#0b0e14',
          color: '#d7dce5',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        {children}
      </body>
    </html>
  );
}
