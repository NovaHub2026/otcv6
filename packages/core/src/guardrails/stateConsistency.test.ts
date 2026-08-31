import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

function read(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), 'utf8');
}

/** Value cell of a two-column table row whose first cell starts with `label`. */
function rowValue(markdown: string, label: string): string | null {
  for (const line of markdown.split('\n')) {
    const match = /^\|([^|]+)\|([^|]*)\|/.exec(line);
    if (match === null) continue;
    if (match[1]!.trim().startsWith(label)) return match[2]!.trim();
  }
  return null;
}

interface PhaseRow {
  readonly id: string;
  readonly number: number;
  readonly approved: boolean;
}

/** Top-level phase rows from the roadmap, excluding subphases. */
function roadmapPhases(): PhaseRow[] {
  const rows: PhaseRow[] = [];
  for (const line of read('docs/phases/ROADMAP.md').split('\n')) {
    const match = /^\|\s*(?:\*\*)?(PH-\d+)(?:\*\*)?\s*\|(.*)$/.exec(line);
    if (match === null) continue;
    const id = match[1]!;
    if (id.includes('.')) continue;
    rows.push({
      id,
      number: Number.parseInt(id.slice(3), 10),
      approved: /APPROVED/i.test(match[2]!),
    });
  }
  return rows;
}

describe('canonical state agrees with the roadmap', () => {
  const phases = roadmapPhases();
  const current = read('CURRENT_STATE.md');
  const handoff = read('SESSION_HANDOFF.md');

  it('finds phases in the roadmap', () => {
    expect(phases.length).toBeGreaterThanOrEqual(6);
  });

  it('names the correct last approved phase', () => {
    const approved = phases.filter((p) => p.approved);
    expect(approved.length).toBeGreaterThan(0);
    const latest = approved.reduce((a, b) => (b.number > a.number ? b : a));
    const recorded = rowValue(current, 'Last approved phase');
    expect(recorded, 'CURRENT_STATE.md has no "Last approved phase" row').not.toBeNull();
    expect(recorded, `roadmap's latest approved phase is ${latest.id}`).toContain(latest.id);
  });

  it('counts approved phases in the active cycle correctly', () => {
    // Cycles are three phases: cycle N covers PH-(3N-2) .. PH-3N.
    const activeCycle = rowValue(current, 'Active development cycle');
    expect(activeCycle, 'no "Active development cycle" row').not.toBeNull();
    const cycleNumber = Number.parseInt(/Cycle\s+(\d+)/.exec(activeCycle!)?.[1] ?? '0', 10);
    expect(cycleNumber).toBeGreaterThan(0);

    const first = 3 * cycleNumber - 2;
    const inCycle = phases.filter((p) => p.number >= first && p.number < first + 3);
    const approvedInCycle = inCycle.filter((p) => p.approved).length;

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

  it('does not claim an active phase that the roadmap shows as approved', () => {
    const active = rowValue(current, 'Active phase') ?? '';
    for (const phase of phases.filter((p) => p.approved)) {
      if (new RegExp(`\\b${phase.id}\\b`).test(active) && !/none/i.test(active)) {
        expect.unreachable(`CURRENT_STATE says ${phase.id} is active, roadmap says APPROVED`);
      }
    }
    expect(true).toBe(true);
  });
});
