import type { ReactElement } from 'react';
import { Preview } from './Preview';

const API_BASE = process.env.NEXT_PUBLIC_OTC_API_BASE ?? 'http://127.0.0.1:3000';

export default function PreviewPage(): ReactElement {
  return <Preview apiBase={API_BASE} />;
}
