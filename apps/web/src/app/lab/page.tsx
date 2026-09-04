import type { ReactElement } from 'react';
import { Lab } from './Lab.js';

export const dynamic = 'force-dynamic';

/** The Lab's control panel (PH-24.19); the instrument is /lab/avanzado. */
export default function LabPage(): ReactElement {
  return <Lab mode="control" />;
}
