import type { ReactElement } from 'react';
import { ManageAssets } from './ManageAssets';

const API_BASE = process.env.NEXT_PUBLIC_OTC_API_BASE ?? '/engine';

export default function ManageAssetsPage(): ReactElement {
  return <ManageAssets apiBase={API_BASE} />;
}
