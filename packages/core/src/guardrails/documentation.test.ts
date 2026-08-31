import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
});

describe('every repo-relative link resolves', () => {
  const documents = [
    'DOCS_INDEX.md',
    'CLAUDE.md',
    'PROJECT_CONTEXT.md',
    'CURRENT_STATE.md',
    'SESSION_HANDOFF.md',
    'docs/phases/ROADMAP.md',
    ...listMarkdown('docs/decisions').map((name) => `docs/decisions/${name}`),
    ...listMarkdown('docs/architecture').map((name) => `docs/architecture/${name}`),
    ...listMarkdown('docs/phases').map((name) => `docs/phases/${name}`),
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
