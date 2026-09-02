import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isApprovedStatus,
  isRecognisedStatus,
  namesIdentifier,
  normaliseStatus,
  roadmapRows,
  STATUS_VOCABULARY,
  type RoadmapRow,
} from './lifecycle.js';
import { readRepositoryFile, repoRoot } from './repository.js';

/**
 * The canonical state documents agree with the roadmap.
 *
 * This exists because it happened, twice over, and neither the phase gates nor
 * Cycle Audit 1's guardrails caught it. Every edit to a table row in
 * `CURRENT_STATE.md` between PH-4 and PH-6 silently did nothing: Prettier pads
 * table columns to the widest cell, so adding one longer row re-pads every other
 * row, and the next exact-string replacement matches nothing. The script
 * reported success because it never checked.
 *
 * The result was a canonical state document claiming Cycle 2 had **0 of 3**
 * phases approved and that PH-5 was next to be created, at a point where PH-4,
 * PH-5 and PH-6 were all approved and merged. `GOVERNANCE.md` §71 requires a
 * fresh agent to determine the current phase from the repository alone; that
 * document would have sent one back two phases.
 *
 * The existing documentation guardrails could not see it. They check that phase
 * *documents* agree with the roadmap, and both were correct — it was the summary
 * of them that had drifted.
 *
 * **Out-of-band audit 7, a2-08.** §71 says phase *and subphase*, and the
 * subphase — the level a fresh agent actually resumes at — was unguarded end to
 * end: `Active subphase` naming an approved one, `Last approved subphase` naming
 * an active one, `Phase lifecycle` reading APPROVED under an active phase, and
 * `SESSION_HANDOFF.md`'s active phase naming an approved one all passed. So did
 * a roadmap cell reading `REVERTED (was APPROVED)`, which counted as approved.
 * Every row of both documents is checked now, against the roadmap, by exact
 * vocabulary.
 */

/** What a lifecycle cell may say when nothing is active. */
const NO_LIFECYCLE: ReadonlySet<string> = new Set(['N/A', 'NONE']);

/** Value cell of a two-column table row whose first cell starts with `label`. */
function rowValue(markdown: string, label: string): string | null {
  for (const line of markdown.split('\n')) {
    const match = /^\|([^|]+)\|([^|]*)\|/.exec(line);
    if (match === null) continue;
    if (match[1]!.trim().startsWith(label)) return match[2]!.trim();
  }
  return null;
}

/** A cell that says nothing but "none". The M-12 rule: the word excuses only a cell that says nothing else. */
function saysOnlyNone(cell: string): boolean {
  return /^none\b[\s.—-]*$/i.test(cell.trim());
}

/** `PH-21.1` sorts after `PH-20.3`; a phase sorts before its subphases. */
function later(a: RoadmapRow, b: RoadmapRow): boolean {
  if (a.phase !== b.phase) return a.phase > b.phase;
  return (a.subphase ?? -1) > (b.subphase ?? -1);
}

function latest(rows: readonly RoadmapRow[]): RoadmapRow | undefined {
  return rows.reduce<RoadmapRow | undefined>(
    (best, row) => (best === undefined || later(row, best) ? row : best),
    undefined,
  );
}

describe('canonical state agrees with the roadmap', () => {
  const rows = roadmapRows(readRepositoryFile('docs/phases/ROADMAP.md'));
  const phases = rows.filter((row) => row.subphase === null);
  const subphases = rows.filter((row) => row.subphase !== null);
  const current = readRepositoryFile('CURRENT_STATE.md');
  const handoff = readRepositoryFile('SESSION_HANDOFF.md');

  const activePhases = phases.filter((row) => normaliseStatus(row.status) === 'ACTIVE');
  const activeSubphases = subphases.filter((row) => normaliseStatus(row.status) === 'ACTIVE');

  it('finds phases and subphases in the roadmap', () => {
    expect(phases.length).toBeGreaterThanOrEqual(6);
    expect(subphases.length).toBeGreaterThanOrEqual(6);
  });

  it('uses only the status vocabulary', () => {
    // **a2-08, DOC-17.** `REVERTED (was APPROVED)` counted as approved. A cell
    // that matches no known state fails here, rather than being read as
    // whatever a substring test makes of it.
    const unrecognised = rows
      .filter((row) => !isRecognisedStatus(row.status))
      .map((row) => `${row.id}: "${row.status}"`);
    expect(unrecognised, `roadmap status cells outside ${STATUS_VOCABULARY.join(' | ')}`).toEqual(
      [],
    );
  });

  it('has at most one active phase and one active subphase, and they belong together', () => {
    expect(activePhases.map((row) => row.id).length).toBeLessThanOrEqual(1);
    expect(activeSubphases.map((row) => row.id).length).toBeLessThanOrEqual(1);
    if (activeSubphases.length === 1) {
      expect(activePhases.map((row) => row.phase)).toEqual([activeSubphases[0]!.phase]);
    }
  });

  it('names the correct last approved phase', () => {
    const approved = phases.filter((row) => isApprovedStatus(row.status));
    expect(approved.length).toBeGreaterThan(0);
    const last = latest(approved)!;
    const recorded = rowValue(current, 'Last approved phase');
    expect(recorded, 'CURRENT_STATE.md has no "Last approved phase" row').not.toBeNull();
    expect(
      namesIdentifier(recorded!, last.id),
      `roadmap's latest approved phase is ${last.id}; CURRENT_STATE says "${recorded!}"`,
    ).toBe(true);
  });

  it('names the correct last approved subphase', () => {
    // **a2-08, DOC-11.** This row named an ACTIVE subphase and nothing noticed.
    const approved = subphases.filter((row) => isApprovedStatus(row.status));
    expect(approved.length).toBeGreaterThan(0);
    const last = latest(approved)!;
    const recorded = rowValue(current, 'Last approved subphase');
    expect(recorded, 'CURRENT_STATE.md has no "Last approved subphase" row').not.toBeNull();
    expect(
      namesIdentifier(recorded!, last.id),
      `roadmap's latest approved subphase is ${last.id}; CURRENT_STATE says "${recorded!}"`,
    ).toBe(true);
  });

  it('counts approved phases in the active cycle correctly', () => {
    // Cycles are three phases: cycle N covers PH-(3N-2) .. PH-3N.
    const activeCycle = rowValue(current, 'Active development cycle');
    expect(activeCycle, 'no "Active development cycle" row').not.toBeNull();
    const cycleNumber = Number.parseInt(/Cycle\s+(\d+)/.exec(activeCycle!)?.[1] ?? '0', 10);
    expect(cycleNumber).toBeGreaterThan(0);

    const first = 3 * cycleNumber - 2;
    const inCycle = phases.filter((p) => p.phase >= first && p.phase < first + 3);
    const approvedInCycle = inCycle.filter((p) => isApprovedStatus(p.status)).length;

    const recorded = rowValue(current, 'Approved phases in current cycle');
    expect(recorded, 'no "Approved phases in current cycle" row').not.toBeNull();
    const claimed = Number.parseInt(/(\d+)\s*of\s*3/.exec(recorded!)?.[1] ?? '-1', 10);
    expect(claimed, `roadmap shows ${approvedInCycle} approved in cycle ${cycleNumber}`).toBe(
      approvedInCycle,
    );
  });

  it('has a handoff that agrees with the state document', () => {
    // Two documents disagreeing about where the project is makes §71's
    // cold-start requirement impossible to satisfy: a fresh agent cannot know
    // which to believe.
    const stateCount = /(\d+)\s*of\s*3/.exec(
      rowValue(current, 'Approved phases in current cycle') ?? '',
    )?.[1];
    const handoffCount = /(\d+)\s*of\s*3/.exec(rowValue(handoff, 'Active cycle') ?? '')?.[1];
    expect(handoffCount, 'SESSION_HANDOFF.md has no phase count').toBeDefined();
    expect(handoffCount).toBe(stateCount);

    const stateCycle = /Cycle\s+(\d+)/.exec(
      rowValue(current, 'Active development cycle') ?? '',
    )?.[1];
    const handoffCycle = /Cycle\s+(\d+)/.exec(rowValue(handoff, 'Active cycle') ?? '')?.[1];
    expect(handoffCycle).toBe(stateCycle);
  });

  /**
   * The active-row rule, applied to both documents and both levels.
   *
   * **Cycle Audit 5, M-12.** This short-circuited on `/none/i` anywhere in the
   * cell, and the cell CURRENT_STATE actually uses reads `None — PH-15 is next
   * to create`. So the escape hatch written for "Active phase: None" swallowed
   * every "None, and here is what's next" phrasing, and a live claim that an
   * approved, merged phase was still to be created went unseen by the guard
   * written for exactly that. The word `none` now excuses only a cell that
   * says nothing else.
   */
  function checkActiveRow(
    document: string,
    markdown: string,
    label: string,
    active: readonly RoadmapRow[],
    all: readonly RoadmapRow[],
  ): void {
    const cell = rowValue(markdown, label);
    expect(cell, `${document} has no "${label}" row`).not.toBeNull();
    if (active.length === 1) {
      expect(
        namesIdentifier(cell!, active[0]!.id),
        `the roadmap's active ${label.toLowerCase()} is ${active[0]!.id}; ${document} says "${cell!}"`,
      ).toBe(true);
    }
    for (const row of all.filter((r) => isApprovedStatus(r.status))) {
      if (namesIdentifier(cell!, row.id) && !saysOnlyNone(cell!)) {
        expect.unreachable(
          `${document}'s ${label.toLowerCase()} names ${row.id}, which the roadmap shows as APPROVED`,
        );
      }
    }
  }

  function checkLifecycleRow(label: string, active: readonly RoadmapRow[]): void {
    const cell = rowValue(current, label);
    expect(cell, `CURRENT_STATE.md has no "${label}" row`).not.toBeNull();
    const status = normaliseStatus(cell!);
    if (active.length === 1) {
      // **a2-08, DOC-09.** `Phase lifecycle: APPROVED` under an active phase
      // was unread.
      expect(status, `${label} under active ${active[0]!.id}`).toBe('ACTIVE');
    } else {
      expect(
        NO_LIFECYCLE.has(status) || (STATUS_VOCABULARY.includes(status) && status !== 'ACTIVE'),
        `${label} reads "${cell!}" while the roadmap shows nothing active`,
      ).toBe(true);
    }
  }

  it('names the active phase as the roadmap has it', () => {
    checkActiveRow('CURRENT_STATE.md', current, 'Active phase', activePhases, phases);
    checkLifecycleRow('Phase lifecycle', activePhases);
  });

  it('names the active subphase as the roadmap has it', () => {
    // **a2-08, DOC-10.** `Active subphase: PH-20.3` — an approved subphase —
    // passed, because subphase rows were never validated at all.
    checkActiveRow('CURRENT_STATE.md', current, 'Active subphase', activeSubphases, subphases);
    checkLifecycleRow('Subphase lifecycle', activeSubphases);
  });

  it('has a handoff that names the same active phase and subphase', () => {
    // **a2-08, DOC-15.** The active-phase rule ran on CURRENT_STATE only.
    checkActiveRow('SESSION_HANDOFF.md', handoff, 'Active phase', activePhases, phases);
    checkActiveRow('SESSION_HANDOFF.md', handoff, 'Active subphase', activeSubphases, subphases);
  });

  it('has a document for the active subphase that declares it active', () => {
    // The roadmap, the state document and the subphase's own document agree:
    // three sources, one answer.
    for (const row of activeSubphases) {
      const documents = readdirSync(path.join(repoRoot, 'docs/phases')).filter((name) =>
        name.startsWith(`${row.id}-`),
      );
      expect(documents, `no document for the active subphase ${row.id}`).toHaveLength(1);
      const status = /^Status:\s*(.+)$/m.exec(
        readRepositoryFile(`docs/phases/${documents[0]!}`),
      )?.[1];
      expect(normaliseStatus(status ?? ''), `${documents[0]!} status`).toBe('ACTIVE');
      expect(existsSync(path.join(repoRoot, 'docs/phases', documents[0]!))).toBe(true);
    }
  });

  it('reads a negated, reverted or unknown status as not approved', () => {
    // The guard's own defect, planted: a phase row saying NOT APPROVED must not
    // count towards the approved total — and neither may one that merely
    // contains the word.
    expect(isApprovedStatus('| APPROVED |'.replace(/\|/g, ''))).toBe(true);
    expect(isApprovedStatus('**APPROVED**')).toBe(true);
    expect(isApprovedStatus('**APPROVED WITH OPEN FINDINGS**')).toBe(true);
    expect(isApprovedStatus('NOT APPROVED')).toBe(false);
    expect(isApprovedStatus('NOT APPROVED — reverted')).toBe(false);
    expect(isApprovedStatus('never approved')).toBe(false);
    expect(isApprovedStatus('not started')).toBe(false);
    expect(isApprovedStatus('REVERTED (was APPROVED)')).toBe(false);
    expect(isRecognisedStatus('REVERTED (was APPROVED)')).toBe(false);
    expect(isRecognisedStatus('NOT APPROVED — reverted')).toBe(false);
    expect(isRecognisedStatus('planned')).toBe(true);
    expect(namesIdentifier('PH-20.31 — x', 'PH-20.3')).toBe(false);
    expect(namesIdentifier('PH-20.3 — x', 'PH-20.3')).toBe(true);
    expect(namesIdentifier('PH-2 — x', 'PH-20')).toBe(false);
  });
});
