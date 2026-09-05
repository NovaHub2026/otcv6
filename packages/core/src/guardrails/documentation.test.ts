import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isApprovedStatus,
  isRecognisedStatus,
  normaliseStatus,
  STATUS_VOCABULARY,
} from './lifecycle.js';

/**
 * Documentation integrity.
 *
 * Governance's cold-start requirement is that a fresh agent can reconstruct the
 * project from the repository alone. That fails quietly: a decision record that
 * exists but is not indexed, or an index entry pointing at a file that was
 * renamed, leaves no trace until someone follows the link.
 *
 * These checks exist because that happened. Four of five ADRs went unindexed
 * for several commits — an edit to a Markdown table silently matched nothing
 * after the table was reformatted, and nothing failed.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

function read(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), 'utf8');
}

function listMarkdown(directory: string): string[] {
  const absolute = path.join(repoRoot, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => name.endsWith('.md'))
    .sort();
}

/** Repo-relative link targets in a Markdown document, excluding anchors and URLs. */
function linkTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]!;
    if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) {
      continue;
    }
    targets.push(target.split('#')[0]!);
  }
  return targets;
}

describe('the documentation index is complete', () => {
  const index = read('DOCS_INDEX.md');

  it('references every decision record on disk', () => {
    const missing = listMarkdown('docs/decisions').filter((name) => !index.includes(name));
    expect(missing).toEqual([]);
  });

  it('references every architecture document on disk', () => {
    const missing = listMarkdown('docs/architecture').filter((name) => !index.includes(name));
    expect(missing).toEqual([]);
  });

  // The same rule for the two directories it was never extended to.
  //
  // PH-11.3 found the index asserting `docs/audits/` was "Empty: no Cycle Audit
  // has run yet" with three audit records on disk, and `docs/evidence/`
  // "Currently unused" with Cycle 1's verification sitting in it. Both claims
  // went stale the moment the first file landed, and nothing failed, because the
  // completeness check covered decisions and architecture and stopped there.
  //
  // GOVERNANCE.md §71 requires a fresh agent to determine the project's state
  // from the repository alone. An index that says no audit has run is worse than
  // no index.
  it('references every cycle audit on disk', () => {
    const missing = listMarkdown('docs/audits').filter((name) => !index.includes(name));
    expect(missing).toEqual([]);
  });

  it('references every recorded evidence document on disk', () => {
    const missing = listMarkdown('docs/evidence').filter((name) => !index.includes(name));
    expect(missing).toEqual([]);
  });

  it('lists at least the canonical documents Governance names', () => {
    for (const document of [
      'GOVERNANCE.md',
      'PROJECT_INTRODUCTION.md',
      'PROJECT_CONTEXT.md',
      'CURRENT_STATE.md',
      'SESSION_HANDOFF.md',
      'docs/phases/ROADMAP.md',
    ]) {
      expect(index, document).toContain(document);
    }
  });
});

describe('the roadmap tracks every phase document', () => {
  const roadmap = read('docs/phases/ROADMAP.md');
  const phaseDocuments = listMarkdown('docs/phases').filter((name) => name.startsWith('PH-'));

  it('has phase documents to track', () => {
    expect(phaseDocuments.length).toBeGreaterThan(0);
  });

  it('mentions every phase identifier that has a document', () => {
    // Subphase documents are tracked inside their phase's section, so the check
    // is on the identifier rather than the filename.
    const missing = phaseDocuments
      .map((name) => /^(PH-\d+(?:\.\d+)?)/.exec(name)?.[1] ?? name)
      .filter((id, index, all) => all.indexOf(id) === index)
      .filter((id) => !roadmap.includes(id));
    expect(missing).toEqual([]);
  });

  it('and every identifier the roadmap tracks has a document (CA7-12)', () => {
    // **Cycle Audit 7.** The check above runs one way only: it enumerates the
    // *files* and asks whether the roadmap knows them. Delete an approved
    // subphase's Technical Document and there is simply one case fewer — the
    // gate stays green and the test count drops from 2,203 to 2,202, which
    // nothing reads. An approved subphase whose document is gone is exactly
    // what `GOVERNANCE.md` §71 says a fresh agent must be able to reconstruct.
    //
    // Rows are read from the roadmap's own tables, so a phase that is planned
    // but not yet documented has to be written as prose rather than as a row.
    const present = new Set(
      phaseDocuments.map((name) => /^(PH-\d+(?:\.\d+)?)/.exec(name)?.[1] ?? name),
    );
    const rows = [
      ...roadmap.matchAll(/^\|\s*(PH-\d+(?:\.\d+)?)\s*\|[^|]*\|\s*([^|]*?)\s*\|/gm),
    ].map((match) => ({
      id: match[1]!,
      state: match[2]!.replaceAll('*', '').trim().toLowerCase(),
    }));
    expect(rows.length, 'no roadmap rows were parsed; the tables changed shape').toBeGreaterThan(
      20,
    );

    // A phase that has been started owes a document. One that is only planned
    // does not — PH-22 is a row and a paragraph of intent, and that is correct.
    // Vocabulary from `stateConsistency.test.ts`: NOT STARTED and PLANNED both
    // mean "no work has begun", and neither owes a Technical Document yet.
    const NOT_YET = new Set(['not started', 'planned', 'next']);
    const started = rows.filter((row) => !NOT_YET.has(row.state));
    expect(started.length, 'no started rows were parsed').toBeGreaterThan(20);
    const undocumented = [...new Set(started.map((row) => row.id))].filter(
      (id) => !present.has(id),
    );
    expect(undocumented, 'the roadmap tracks these as started, and no document exists').toEqual([]);
  });
});

describe('phase states agree between documents and the roadmap', () => {
  // Lifecycle state drifting between a phase document and the roadmap is the
  // most consequential kind of documentation staleness: Governance §71 requires
  // a fresh agent to determine the current phase and subphase from the
  // repository alone, and two sources disagreeing makes that impossible.
  //
  // This check exists because it happened. Four roadmap rows silently kept
  // stale states across several approvals, because Markdown table edits matched
  // nothing after the table was reformatted.
  const roadmap = read('docs/phases/ROADMAP.md');

  const phases = listMarkdown('docs/phases')
    .filter((name) => name.startsWith('PH-'))
    .map((name) => {
      const id = /^(PH-\d+(?:\.\d+)?)/.exec(name)?.[1] ?? name;
      const status = /^Status:\s*(\w[\w ]*)$/m.exec(read(`docs/phases/${name}`))?.[1]?.trim();
      return { name, id, status };
    });

  it('every phase document declares a status', () => {
    expect(phases.filter((p) => p.status === undefined)).toEqual([]);
  });

  it.each(phases.map((p) => [p.id, p.status!] as const))(
    '%s is recorded as %s in the roadmap',
    (id, status) => {
      // Find the roadmap row for this identifier and confirm it carries the
      // same state the phase document declares.
      const row = roadmap
        .split('\n')
        .find((line) =>
          new RegExp(`^\\|\\s*(\\*\\*)?${id.replace('.', '\\.')}(\\*\\*)?\\s*\\|`).test(line),
        );
      expect(row, `no roadmap row for ${id}`).toBeDefined();
      // **Cycle Audit 5, M-11.** This tested the whole row, so it passed when
      // the word appeared in the description column, and it could not see a
      // negation: `NOT APPROVED` contains `APPROVED`. The status is read from
      // its own cell.
      //
      // **a2-08, DOC-17.** Read from its own cell, it was still a substring
      // test — `REVERTED (was APPROVED)` contained `APPROVED` and matched a
      // document saying APPROVED — with a negation list one entry long. Both
      // sides are now normalised against the lifecycle vocabulary and must be
      // the same word, and a cell outside the vocabulary fails on its own.
      const cells = row!.split('|').map((cell) => cell.trim());
      const stated = cells[cells.length - 2] ?? '';
      expect(
        isRecognisedStatus(stated),
        `roadmap status cell for ${id} is outside ${STATUS_VOCABULARY.join(' | ')}: "${stated}"`,
      ).toBe(true);
      expect(
        isRecognisedStatus(status),
        `${id}'s document declares a status outside the vocabulary: "${status}"`,
      ).toBe(true);
      expect(
        normaliseStatus(stated),
        `roadmap and document disagree about ${id}: roadmap "${stated}", document "${status}"`,
      ).toBe(normaliseStatus(status));
    },
  );
});

describe('the cycle-audit boundary is a fact, not a label (CA7-11)', () => {
  /**
   * **Cycle Audit 7.** The state guards checked every phase and subphase row
   * and nothing about the two fields that decide whether an audit is *due*:
   * `Cycle Audit state` was asserted only to be present, never to have a value,
   * and the "exact next legal action" only to be longer than sixty characters.
   * Nothing read `docs/audits/` — although this same file already enumerates it
   * for the index check — and nothing related the next action to the
   * approved-phase count this file already computes from the roadmap.
   *
   * `GOVERNANCE.md` §28 makes three approved phases a hard boundary: development
   * stops and the audit runs. A record that can drift on exactly that is a
   * record that can hide the one rule the project cannot postpone.
   */
  const state = read('CURRENT_STATE.md');

  /** Audit records that exist, by number. */
  const recorded = listMarkdown('docs/audits')
    .map((name) => /^CYCLE-AUDIT-(\d+)\.md$/.exec(name)?.[1])
    .filter((number): number is string => number !== undefined)
    .map((number) => Number.parseInt(number, 10))
    .sort((a, b) => a - b);

  it('has audit records to check', () => {
    expect(recorded.length).toBeGreaterThan(0);
  });

  it('names the highest audit record that exists, with the state that record declares', () => {
    /**
     * **Cycle Audit 8.** This required the state to name a *closed* audit whose
     * number equalled the highest record on disk, which is unsatisfiable the
     * moment an audit is recorded before it is closed — the state has to
     * choose between naming a record that exists and telling the truth about
     * it. §32 explicitly allows an audit to stay open while findings are
     * tracked, so the guard reads the record's own `Status:` line instead.
     */
    const highest = recorded[recorded.length - 1]!;
    const number = String(highest).padStart(3, '0');
    const record = read(`docs/audits/CYCLE-AUDIT-${number}.md`);
    const status = /^Status:\s*(\w+)/m.exec(record)?.[1]?.toUpperCase();
    expect(status, `CYCLE-AUDIT-${number}.md declares no status`).toBeDefined();
    const claimed = new RegExp(
      `Cycle Audit state\\s*\\|\\s*\\*\\*${number} (closed|OPEN)\\*\\*`,
      'i',
    ).exec(state)?.[1];
    expect(
      claimed,
      `CURRENT_STATE must name audit ${number} — the highest record on disk — and say whether ` +
        `it is closed or open`,
    ).toBeDefined();
    expect(
      claimed!.toUpperCase() === 'OPEN' ? 'OPEN' : 'CLOSED',
      `CURRENT_STATE and CYCLE-AUDIT-${number}.md disagree about that audit`,
    ).toBe(status === 'OPEN' ? 'OPEN' : 'CLOSED');
  });

  /**
   * Cycle Audit 8, found while closing it: the roadmap's own state column had
   * been wrong about three separate audits at once.
   *
   * Cycle 5's row read `RAN — findings open` and its three phases
   * `APPROVED WITH OPEN FINDINGS`, against a record that has read
   * `Status: CLOSED` since Cycle Audit 6 closed it. Cycle 6's row read
   * `RECORDED` where every other row reads APPROVED. Cycle 8's table had no
   * audit row at all. The check above reads `CURRENT_STATE.md` — one document,
   * one audit, the current one — so a roadmap misreporting a whole past cycle
   * as unremediated passed every gate for three cycles.
   *
   * The relation is simple and worth asserting for every audit rather than the
   * newest: a record that declares itself CLOSED is APPROVED on the roadmap, and
   * one that does not, is not.
   */
  it('agrees with every audit record about every audit, not only the newest', () => {
    const roadmap = read('docs/phases/ROADMAP.md');
    const records = listMarkdown('docs/audits').filter((name) =>
      /^CYCLE-AUDIT-\d+\.md$/.test(name),
    );
    expect(records.length, 'no cycle-audit records to check').toBeGreaterThan(2);

    for (const name of records) {
      const number = Number.parseInt(/CYCLE-AUDIT-(\d+)\.md/.exec(name)![1]!, 10);
      const declared = /^Status:\s*(\w+)/m.exec(read(`docs/audits/${name}`))?.[1]?.toUpperCase();

      // The row is `| — | **Cycle Audit N** … | STATE |`. Anchored on the number
      // so `Cycle Audit 1` cannot match the row for `Cycle Audit 10`.
      const row = new RegExp(
        `^\\|[^|]*\\|[^|]*Cycle Audit ${String(number)}\\b[^|]*\\|([^|]*)\\|`,
        'm',
      ).exec(roadmap);
      expect(row, `the roadmap has no row for Cycle Audit ${String(number)}`).not.toBeNull();
      // The first three records predate the `Status:` header the project later
      // settled on. They still owe a row — a record with no row is invisible —
      // but there is nothing to compare their state against.
      if (declared === undefined) continue;
      const state = row![1]!.replaceAll('*', '').trim().toUpperCase();
      // `CLOSED` is the word the records have settled on; audit 4 says
      // `APPROVED`. Both mean the same thing to a reader — the audit is done —
      // and neither is `OPEN`.
      const settled = declared === 'CLOSED' || declared === 'APPROVED';
      if (settled) {
        expect(
          state.startsWith('APPROVED'),
          `Cycle Audit ${String(number)} is ${declared} and the roadmap says «${row![1]!.trim()}»`,
        ).toBe(true);
      } else {
        expect(
          state.startsWith('APPROVED'),
          `Cycle Audit ${String(number)} is ${declared} and the roadmap calls it approved`,
        ).toBe(false);
      }
    }
  });

  it('counts the approved phases of the current cycle the way the roadmap does', () => {
    const claimed = /Approved phases in current cycle\s*\|\s*\*\*(\d+) of (\d+)\*\*/.exec(state);
    expect(claimed, 'CURRENT_STATE does not state an approved-phase count').not.toBeNull();
    const cycle = /Active development cycle\s*\|\s*Cycle (\d+)/.exec(state)?.[1];
    expect(cycle, 'CURRENT_STATE does not state a cycle number').toBeDefined();

    // The roadmap's section for that cycle, up to the next `## ` heading.
    // Read line by line rather than with a multiline regex: the heading and the
    // rows are both anchored, and a regex that quietly matched nothing is how
    // this check would fail open.
    const lines = read('docs/phases/ROADMAP.md').split('\n');
    const from = lines.findIndex((line) => line.startsWith(`## Cycle ${cycle!}`));
    expect(from, `the roadmap has no section for Cycle ${cycle!}`).toBeGreaterThanOrEqual(0);
    const rest = lines.slice(from + 1);
    const to = rest.findIndex((line) => line.startsWith('## '));
    const section = (to === -1 ? rest : rest.slice(0, to)).join('\n');

    const rows = section.split('\n').filter((line) => /^\|\s*PH-\d+\s*\|/.test(line));
    // Rows, not approvals: a cycle that has just opened has zero of the second
    // and must still be checkable. The first version asserted `approved > 0`
    // and failed the moment Cycle 8 opened with PH-22 — a guard that only works
    // in the middle of a cycle is a guard that is off at both boundaries, and
    // the boundary is the whole subject.
    expect(rows.length, `no phase rows parsed for Cycle ${cycle!}`).toBeGreaterThan(0);
    const approved = rows.filter((line) => line.includes('APPROVED')).length;
    expect(Number.parseInt(claimed![1]!, 10), 'CURRENT_STATE vs the roadmap').toBe(approved);
  });

  it('names the audit as the next action when the cycle is full and unaudited', () => {
    const claimed = /Approved phases in current cycle\s*\|\s*\*\*(\d+) of (\d+)\*\*/.exec(state);
    const done = Number.parseInt(claimed![1]!, 10);
    const needed = Number.parseInt(claimed![2]!, 10);
    const cycle = Number.parseInt(
      /Active development cycle\s*\|\s*Cycle (\d+)/.exec(state)![1]!,
      10,
    );
    if (done < needed || recorded.includes(cycle)) return;
    // Three approved phases, and no record for this cycle: §28 says development
    // stops here, so the document a fresh agent reads has to say so.
    const action = /## EXACT NEXT LEGAL ACTION\n([\s\S]*)$/.exec(state)?.[1] ?? '';
    /**
     * **Cycle Audit 8 (a7).** This matched `/Cycle Audit/i` anywhere in the
     * section, and the section named **PH-22.1** — a subphase approved and
     * merged two phases earlier — while mentioning a past audit further down.
     * The guard passed on the mention; a fresh session read the heading and
     * started re-implementing an approved subphase, with the same document's own
     * table saying `Active phase: none`.
     *
     * So the assertion is about the **stated action**: the first non-empty line
     * under the heading, which is what a reader acts on, and it must name this
     * cycle's audit by number.
     */
    const stated = action.split('\n').find((line) => line.trim().length > 0) ?? '';
    expect(stated, 'the section states no action').not.toBe('');
    expect(
      stated,
      `the cycle is full and unaudited; the first line under the heading must name Cycle Audit ` +
        `${String(cycle)}, and it reads: ${stated}`,
    ).toMatch(new RegExp(`Cycle Audit ${String(cycle)}\\b`, 'i'));
    // And the stated action may not name a phase or subphase the roadmap already
    // shows as approved: that is the shape the finding took.
    const roadmap = read('docs/phases/ROADMAP.md');
    for (const line of roadmap.split('\n')) {
      const row = /^\|\s*(PH-[\d.]+)\s*\|(.*)\|\s*([^|]+?)\s*\|/.exec(line);
      if (row === null || !isApprovedStatus(row[3]!)) continue;
      expect(
        stated,
        `the stated action names ${row[1]!}, which the roadmap shows as APPROVED`,
      ).not.toMatch(new RegExp(`\\b${row[1]!.replace(/\./g, '\\.')}\\b`));
    }
  });
});

describe('every repo-relative link resolves', () => {
  const documents = [
    'DOCS_INDEX.md',
    'CLAUDE.md',
    'PROJECT_CONTEXT.md',
    'CURRENT_STATE.md',
    'SESSION_HANDOFF.md',
    // **Cycle Audit 7, CA7-30.** Three of the places a fresh agent is sent
    // were not checked: `GOVERNANCE.md` — the first document CLAUDE.md tells
    // it to read — and the whole of `docs/audits/` and `docs/evidence/`, which
    // are where every finding and every measured number live. Four planted
    // broken links in those files were invisible to the gate.
    'GOVERNANCE.md',
    'PROJECT_INTRODUCTION.md',
    'docs/phases/ROADMAP.md',
    ...listMarkdown('docs/decisions').map((name) => `docs/decisions/${name}`),
    ...listMarkdown('docs/architecture').map((name) => `docs/architecture/${name}`),
    ...listMarkdown('docs/phases').map((name) => `docs/phases/${name}`),
    ...listMarkdown('docs/audits').map((name) => `docs/audits/${name}`),
    ...listMarkdown('docs/evidence').map((name) => `docs/evidence/${name}`),
  ];

  it.each(documents)('%s', (document) => {
    const directory = path.dirname(path.join(repoRoot, document));
    const broken = linkTargets(read(document)).filter(
      (target) => !existsSync(path.resolve(directory, target)),
    );
    expect(broken).toEqual([]);
  });
});

describe('canonical state documents stay answerable', () => {
  it('CURRENT_STATE names the exact next legal action', () => {
    // Governance §71: a fresh agent must not need conversation history.
    const state = read('CURRENT_STATE.md');
    expect(state).toContain('EXACT NEXT LEGAL ACTION');
    const section = state.slice(state.indexOf('EXACT NEXT LEGAL ACTION'));
    expect(section.trim().length).toBeGreaterThan(60);
  });

  /**
   * Cycle Audit 8 (a7, row 47): SESSION_HANDOFF's table was entirely pre-merge —
   * a branch that had moved, a cycle at 2 of 3 that was 3 of 3, an audit it did
   * not know had run — and no guard read a single one of its rows.
   *
   * The rows guarded here are the two a fresh session acts on before it reads
   * anything else: whether the cycle is full, and whether an audit is open.
   * Both are stated in `CURRENT_STATE.md` too, and that copy *is* guarded
   * (CA7-11 above), so the check is that the two records agree — the failure
   * mode is one of them being updated and the other not.
   */
  it('SESSION_HANDOFF’s table agrees with CURRENT_STATE about the cycle and the audit', () => {
    const handoff = read('SESSION_HANDOFF.md');
    const state = read('CURRENT_STATE.md');

    const audit = /Cycle Audit\s*\|\s*\*\*(\d+) (closed|OPEN)\*\*/i.exec(handoff);
    expect(audit, 'SESSION_HANDOFF does not name an audit and its state').not.toBeNull();
    const stated = /Cycle Audit state\s*\|\s*\*\*(\d+) (closed|OPEN)\*\*/i.exec(state)!;
    expect(audit![1], 'the two records name different audits').toBe(stated[1]);
    expect(
      audit![2]!.toUpperCase(),
      'the two records disagree about whether the audit is open',
    ).toBe(stated[2]!.toUpperCase());

    const cycle = /Active cycle\s*\|\s*Cycle (\d+), \*\*(\d+) of (\d+)\*\*/.exec(handoff);
    expect(cycle, 'SESSION_HANDOFF does not state a cycle and a phase count').not.toBeNull();
    expect(cycle![1], 'the two records are in different cycles').toBe(
      /Active development cycle\s*\|\s*Cycle (\d+)/.exec(state)![1],
    );
    const count = /Approved phases in current cycle\s*\|\s*\*\*(\d+) of (\d+)\*\*/.exec(state)!;
    expect([cycle![2], cycle![3]], 'the two records count approved phases differently').toEqual([
      count[1],
      count[2],
    ]);
  });

  it('SESSION_HANDOFF names a continuation point', () => {
    const handoff = read('SESSION_HANDOFF.md');
    expect(handoff).toContain('Continuation point');
    expect(handoff).toContain('CURRENT_STATE.md');
  });

  /**
   * Cycle Audit 8 (a7, row 50): the Relevant records table stopped at ADR-0016.
   *
   * ADR-0017 and ADR-0018 were written in the cycle the table was supposed to
   * summarise, are cited by the phase documents, and settle two of the questions
   * a fresh agent is likeliest to ask — where the expiry price comes from, and
   * whether a Lab-composed process may be production. The table is the first
   * place §71's fresh agent looks, and it silently answered "there are eighteen
   * decisions" with sixteen.
   *
   * `DOCS_INDEX.md` was already guarded above; this is the other list, and it is
   * the one written by hand for a reader rather than generated for a linker.
   */
  it('CURRENT_STATE’s Relevant records table names every decision record', () => {
    const state = read('CURRENT_STATE.md');
    const onDisk = listMarkdown('docs/decisions')
      .map((name) => /^(ADR-\d{4})/.exec(name)?.[1])
      .filter((id): id is string => id !== undefined)
      .sort();
    expect(onDisk.length, 'no decision records to check').toBeGreaterThan(0);

    const table = state.slice(state.indexOf('## Relevant records'));
    expect(table.indexOf('|'), 'the Relevant records section has no table').toBeGreaterThan(0);
    const listed = new Set(
      [...table.matchAll(/^\|\s*(ADR-\d{4})\s*\|/gm)].map((match) => match[1]!),
    );
    const missing = onDisk.filter((id) => !listed.has(id));
    expect(missing, `CURRENT_STATE does not name ${missing.join(', ')}`).toEqual([]);

    // Each row must say something about the decision, not merely its number:
    // a row that names an ADR and nothing else is a link, and this is a summary.
    for (const id of onDisk) {
      const row = new RegExp(`^\\|\\s*${id}\\s*\\|(.*)\\|`, 'm').exec(table);
      expect(row, `${id} has no row`).not.toBeNull();
      expect(row![1]!.trim().length, `${id}'s row says nothing`).toBeGreaterThan(20);
      // And its lifecycle state, which is the half a reader acts on.
      expect(row![1]!, `${id} does not carry a status`).toMatch(
        /APPROVED|PROPOSED|SUPERSEDED|REJECTED|WITHDRAWN/,
      );
    }
  });

  it('CURRENT_STATE records the cycle position', () => {
    const state = read('CURRENT_STATE.md');
    expect(state).toMatch(/Approved phases in current cycle/);
    expect(state).toMatch(/Cycle Audit state/);
  });
});

/**
 * Cycle Audit 8 (a2): `rm packages/engine/src/mirror.test.ts` — 438 lines, the
 * project's primary structural gate — and every cheap step of `npm run gate`
 * exited 0. The file count fell from 125 to 124 and nothing compares that
 * against anything.
 *
 * A count is the wrong guard: it is a constant, and Cycle Audit 7 recorded that
 * guards written against constants are the ones that fail. What is not a
 * constant is that the canonical documents name the tests they rest on —
 * ADR-0003 §6 names `mirror.test.ts` as the gate a statistical battery cannot
 * replace, CLAUDE.md tells an agent to run it before every engine change — so a
 * deleted or renamed test file makes a document a liar, and that is checkable.
 *
 * It closes a class rather than an instance: every test a document leans on is
 * covered, and a new one joins by being named.
 */
describe('a document that names a test names one that exists', () => {
  const documents = [
    'CLAUDE.md',
    'GOVERNANCE.md',
    'PROJECT_INTRODUCTION.md',
    'PROJECT_CONTEXT.md',
    'CURRENT_STATE.md',
    'SESSION_HANDOFF.md',
    'DOCS_INDEX.md',
    ...listMarkdown('docs/decisions').map((name) => `docs/decisions/${name}`),
    ...listMarkdown('docs/architecture').map((name) => `docs/architecture/${name}`),
    // **Cycle Audit 9 (a7-03).** The phase documents, the audits, the evidence
    // and the reports name tests too — PH-27.2's "closed by … (the guard that
    // holds it)" annotations name one per item — and none of them was read.
    // Not the audit records: an audit quotes the false claims it found — CA8
    // recorded a docstring naming a `labModule.test.ts` that never existed —
    // and holding the quotation to the disk would hold the finding to be the
    // lie. Phases, evidence and reports assert; audits report.
    ...listMarkdown('docs/phases').map((name) => `docs/phases/${name}`),
    ...listMarkdown('docs/evidence').map((name) => `docs/evidence/${name}`),
    ...listMarkdown('docs/reports').map((name) => `docs/reports/${name}`),
  ];

  /** Every `*.test.ts` file in the repository, by basename. */
  const onDisk = (): Map<string, string[]> => {
    const found = new Map<string, string[]>();
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        // By path segment, never by substring: `packages/distribution` contains
        // the four letters of `dist`, and a substring filter silently skips the
        // package that holds the publication tests.
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
            continue;
          }
          walk(path.join(directory, entry.name));
        } else if (entry.name.endsWith('.test.ts')) {
          const at = path.relative(repoRoot, path.join(directory, entry.name));
          found.set(entry.name, [...(found.get(entry.name) ?? []), at]);
        }
      }
    };
    for (const root of ['packages', 'tools', 'apps']) walk(path.join(repoRoot, root));
    return found;
  };

  it('finds the test files it is checking against', () => {
    const files = onDisk();
    expect(files.size, 'no test files were found at all').toBeGreaterThan(50);
    expect(files.has('mirror.test.ts'), 'the primary structural gate is gone').toBe(true);
  });

  /**
   * Every `*.test.ts` basename ever tracked, from git's own history. A phase
   * document approved when `recalibration.test.ts` existed, or an audit record
   * quoting a file a docstring falsely claimed, is history and stays true; a
   * name that never existed anywhere is a lie in any document. Canonical
   * documents — the ones a fresh session reads first — are held to the disk.
   */
  const everTracked = (): Set<string> | null => {
    // Null when there is no history to ask — a tree copied without `.git`,
    // as the meta-audit's clean copy is (`guardrailMetaAudit.stat.test.ts`).
    // Without history a historical document cannot be held to it, and is not
    // held to the disk either: that would call every retired test a lie.
    try {
      const out = execFileSync(
        'git',
        ['log', '--all', '--diff-filter=A', '--name-only', '--pretty=format:', '--', '*.test.ts'],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return new Set(
        out
          .split('\n')
          .filter((line) => line.endsWith('.test.ts'))
          .map((line) => path.basename(line)),
      );
    } catch {
      return null;
    }
  };
  const HISTORICAL = /^docs\/(phases|evidence|reports)\//;

  it('names no test file that does not exist', () => {
    const files = onDisk();
    const tracked = everTracked();
    const missing: string[] = [];
    let named = 0;
    for (const document of documents) {
      if (!existsSync(path.join(repoRoot, document))) continue;
      const historical = HISTORICAL.test(document);
      for (const match of read(document).matchAll(/`([A-Za-z0-9_.\-/]+\.test\.ts)`/g)) {
        named += 1;
        const base = path.basename(match[1]!);
        const known = files.has(base) || (historical && (tracked === null || tracked.has(base)));
        if (!known) missing.push(`${document} names ${match[1]!}`);
      }
    }
    // A scan that matched nothing would pass this silently, which is the failure
    // mode of every guard in this file that has ever gone quiet.
    expect(named, 'no document named a test file; the scan is broken').toBeGreaterThan(30);
    expect(missing, 'these documents name test files that are not on disk').toEqual([]);
  });
});

describe('the documented repository layout is real', () => {
  // CLAUDE.md's layout block is the first thing a fresh agent reads to find its
  // way around. The first Cycle Audit found it listing `docs/evidence/` with no
  // caveat, for a directory that did not exist, and omitting two of the five
  // packages entirely — an agent trusting it would not have known the validation
  // laboratory existed.
  const FUTURE = '(created in the phase that needs it)';

  function layoutEntries(): { path: string; future: boolean }[] {
    const claude = read('CLAUDE.md');
    const block = /```\n([\s\S]*?docs\/architecture\/[\s\S]*?)```/.exec(claude);
    expect(block, 'CLAUDE.md layout block').not.toBeNull();
    const entries: { path: string; future: boolean }[] = [];
    for (const line of block![1]!.split('\n')) {
      const match = /^([A-Za-z][\w./*-]*\/?)\s{2,}(.+)$/.exec(line.trim());
      if (match === null) continue;
      entries.push({ path: match[1]!, future: match[2]!.includes(FUTURE) });
    }
    return entries;
  }

  it('lists a usable number of entries', () => {
    expect(layoutEntries().length).toBeGreaterThan(8);
  });

  it('names nothing that does not exist without marking it as future work', () => {
    const missing = layoutEntries()
      .filter((entry) => !entry.future)
      .filter((entry) => !entry.path.includes('*'))
      .filter((entry) => !existsSync(path.join(repoRoot, entry.path)))
      .map((entry) => entry.path);
    expect(missing, `documented but absent (mark future ones "${FUTURE}")`).toEqual([]);
  });

  it('lists every workspace package', () => {
    const documented = new Set(layoutEntries().map((entry) => entry.path.replace(/\/$/, '')));
    const actual = readdirSync(path.join(repoRoot, 'packages')).map((name) => `packages/${name}`);
    expect(actual.length).toBeGreaterThan(0);
    for (const pkg of actual) expect(documented, `${pkg} is undocumented`).toContain(pkg);
  });
});

/**
 * **Cycle Audit 9 (a7-03).** PH-27.2 annotated every "leaves open" section
 * with a dated verdict per item — *closed by PH-N (the guard that holds it)*,
 * *still open*, *superseded*. A "closed by" that names a phase the roadmap
 * does not show as approved is a closure by narrative; this reads every such
 * block and holds each named phase to the roadmap.
 */
describe('a "closed by" annotation names an approved phase', () => {
  const roadmap = read('docs/phases/ROADMAP.md');
  const approved = new Set<string>();
  for (const line of roadmap.split('\n')) {
    const row = /^\| (PH-\d+(?:\.\d+)?)\s*\|[^|]*\|\s*([^|]*?)\s*\|/.exec(line);
    if (row !== null && /APPROVED/.test(row[2]!)) approved.add(row[1]!);
  }

  it('finds the roadmap rows it holds the annotations to', () => {
    expect(approved.size).toBeGreaterThan(20);
  });

  it('every phase a re-check annotation says closed an item is APPROVED in the roadmap', () => {
    const offenders: string[] = [];
    for (const name of listMarkdown('docs/phases')) {
      const text = read(`docs/phases/${name}`);
      const blocks = text.match(/> \*\*Re-checked against the tree[\s\S]*?(?=\n\n(?!>)|$)/g) ?? [];
      for (const block of blocks) {
        for (const match of block.matchAll(/closed by\*\*?\s*(PH-\d+(?:\.\d+)?)/g)) {
          if (!approved.has(match[1]!)) offenders.push(`${name}: closed by ${match[1]!}`);
        }
        for (const match of block.matchAll(/\*\*closed by\*\*\s+(PH-\d+(?:\.\d+)?)/g)) {
          if (!approved.has(match[1]!)) offenders.push(`${name}: closed by ${match[1]!}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
