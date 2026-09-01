import type { ReactElement } from 'react';
import { Preview } from './Preview';

/**
 * Same origin, through the rewrite in `next.config.mjs`.
 *
 * An absolute URL is still allowed via `NEXT_PUBLIC_OTC_API_BASE`, for a
 * deployment that serves the engine from its own host — that path needs the
 * engine's CORS headers, which is why they exist.
 */
const API_BASE = process.env.NEXT_PUBLIC_OTC_API_BASE ?? '/engine';

export default function PreviewPage(): ReactElement {
  return <Preview apiBase={API_BASE} />;
}
