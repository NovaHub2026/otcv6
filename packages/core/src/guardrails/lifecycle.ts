/**
 * The lifecycle vocabulary the roadmap, the phase documents and the canonical
 * state documents share, and how a status cell is read.
 *
 * **Out-of-band audit 7, a2-08 and a2-09.** Two guards read status cells by
 * asking whether they *contained* a word. `REVERTED (was APPROVED)` contained
 * `APPROVED` and counted as approved to `stateConsistency.test.ts`, whose
 * negation set was `NOT|NEVER|UN-`; `documentation.test.ts` accepted it for the
 * same reason. A status is now matched against a closed vocabulary, exactly,
 * after normalisation — and a cell that matches nothing fails rather than
 * quietly counting as "not approved", because a guard that treats what it does
 * not recognise as harmless is the a2-09 defect (`Enforced (structural)` read as
 * not enforced, and the invariant it described dropped out of enforcement).
 */

/** Every state a phase or subphase row may declare. */
export const STATUS_VOCABULARY: readonly string[] = [
  'APPROVED',
  'APPROVED WITH OPEN FINDINGS',
  'ACTIVE',
  'NOT STARTED',
  'PLANNED',
  'BLOCKED',
  'REVERTED',
  'SUPERSEDED',
  'WITHDRAWN',
  'NOT APPROVED',
];

const APPROVED: ReadonlySet<string> = new Set(['APPROVED', 'APPROVED WITH OPEN FINDINGS']);

/** A status cell, with Markdown emphasis and spacing removed, upper-cased. */
export function normaliseStatus(cell: string): string {
  return cell.replace(/\*/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function isRecognisedStatus(cell: string): boolean {
  return STATUS_VOCABULARY.includes(normaliseStatus(cell));
}

/**
 * Whether a cell states approval. Exact membership: `NOT APPROVED`,
 * `never approved`, `REVERTED (was APPROVED)` and an empty cell are all `false`,
 * and the last two are also unrecognised, which the guards report separately.
 */
export function isApprovedStatus(cell: string): boolean {
  return APPROVED.has(normaliseStatus(cell));
}

export interface RoadmapRow {
  /** `PH-21` or `PH-21.1`. */
  readonly id: string;
  readonly phase: number;
  /** `null` for a phase row. */
  readonly subphase: number | null;
  /** The status cell as written. */
  readonly status: string;
  readonly line: string;
}

/**
 * Every phase and subphase row of the roadmap's state tables.
 *
 * A state table is one whose header's last column is `State`; the status is
 * that column. The roadmap also carries tables keyed by phase whose last column
 * is something else — what each phase closes, for one — and those rows are not
 * states.
 */
export function roadmapRows(markdown: string): RoadmapRow[] {
  const rows: RoadmapRow[] = [];
  let inStateTable = false;
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) {
      inStateTable = false;
      continue;
    }
    const header = /^\|\s*(?:Phase|Subphase)\s*\|.*\|\s*State\s*\|\s*$/.exec(line);
    if (header !== null) {
      inStateTable = true;
      continue;
    }
    if (!inStateTable) continue;
    const match = /^\|\s*(?:\*\*)?(PH-(\d+)(?:\.(\d+))?)(?:\*\*)?\s*\|(.*)$/.exec(line);
    if (match === null) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    rows.push({
      id: match[1]!,
      phase: Number.parseInt(match[2]!, 10),
      subphase: match[3] === undefined ? null : Number.parseInt(match[3], 10),
      status: cells[cells.length - 2] ?? '',
      line,
    });
  }
  return rows;
}

/** Whether `text` names the identifier as a whole: `PH-20.3` is not in `PH-20.31`. */
export function namesIdentifier(text: string, id: string): boolean {
  return new RegExp(`(?<![\\w.])${id.replace(/\./g, '\\.')}(?![\\w.])`).test(text);
}
