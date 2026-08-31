import type { ReactElement } from 'react';
import { Chart } from './Chart';

const API_BASE = process.env.OTC_API_BASE ?? 'http://127.0.0.1:3000';

export default function Page(): ReactElement {
  return <Chart apiBase={API_BASE} assetId="btcusd" />;
}
