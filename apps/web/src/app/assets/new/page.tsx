import type { ReactElement } from 'react';
import { CreateAsset } from './CreateAsset';

const API_BASE = process.env.NEXT_PUBLIC_OTC_API_BASE ?? '/engine';

export default function CreateAssetPage(): ReactElement {
  return <CreateAsset apiBase={API_BASE} />;
}
