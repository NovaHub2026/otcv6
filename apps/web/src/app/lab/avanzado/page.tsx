import type { ReactElement } from 'react';
import { Lab } from '../Lab.js';

export const dynamic = 'force-dynamic';

/** The instrument: every former tab of the Lab (PH-24.19). */
export default function LabAdvancedPage(): ReactElement {
  return <Lab mode="avanzado" />;
}
