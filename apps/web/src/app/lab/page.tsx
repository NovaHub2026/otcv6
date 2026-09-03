import type { ReactElement } from 'react';
import { Lab } from './Lab.js';

export const dynamic = 'force-dynamic';

/**
 * No `apiBase`. The Lab screen talks to the Lab and to nothing else — it lists
 * the Lab's own markets, so it never learns the name of a production asset
 * (§3). Handing it the engine's base URL would have made that a habit rather
 * than a property.
 */
export default function LabPage(): ReactElement {
  return <Lab />;
}
