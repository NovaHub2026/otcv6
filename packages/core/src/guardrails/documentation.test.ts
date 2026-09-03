import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isRecognisedStatus, normaliseStatus, STATUS_VOCABULARY } from './lifecycle.js';

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

  it('names the last closed audit as the highest record that exists', () => {
    const claimed = /Cycle Audit state\s*\|\s*\*\*(\d+) closed\*\*/.exec(state)?.[1];
    expect(claimed, 'CURRENT_STATE does not state a closed cycle-audit number').toBeDefined();
    expect(Number.parseInt(claimed!, 10), 'the highest audit record on disk').toBe(
      recorded[recorded.length - 1],
    );
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
    expect(action, 'the cycle is full and unaudited; the next action must be the audit').toMatch(
      /Cycle Audit/i,
    );
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

  it('SESSION_HANDOFF names a continuation point', () => {
    const handoff = read('SESSION_HANDOFF.md');
    expect(handoff).toContain('Continuation point');
    expect(handoff).toContain('CURRENT_STATE.md');
  });

  it('CURRENT_STATE records the cycle position', () => {
    const state = read('CURRENT_STATE.md');
    expect(state).toMatch(/Approved phases in current cycle/);
    expect(state).toMatch(/Cycle Audit state/);
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
