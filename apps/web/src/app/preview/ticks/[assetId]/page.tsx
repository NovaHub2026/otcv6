import type { ReactElement } from 'react';
import { Chart } from '../../../Chart';

const API_BASE = process.env.NEXT_PUBLIC_OTC_API_BASE ?? '/engine';

/**
 * The microstructure view: ticks, not candles.
 *
 * The history tier stores minutes and refuses anything finer, because a stored
 * one-second bar of last March would be a shape no tick produced. But the
 * sub-minute view is exactly where an operator judges whether a personality
 * *feels* right — the arrival rhythm, the bursts, the pauses — so it is served
 * where it honestly can be: live, from the tick stream, through PH-8's
 * extreme-preserving reduction.
 */
export default async function TicksPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}): Promise<ReactElement> {
  const { assetId } = await params;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '8px 12px', borderBottom: '1px solid #242c3d', fontSize: 12 }}>
        <a href="/preview" style={{ color: '#8b93a7', textDecoration: 'none' }}>
          ← candles
        </a>
        <span style={{ marginLeft: 12, color: '#d7dce5' }}>{assetId} · live ticks</span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Chart apiBase={API_BASE} assetId={assetId} />
      </div>
    </div>
  );
}
