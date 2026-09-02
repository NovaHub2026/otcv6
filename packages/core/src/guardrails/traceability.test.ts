import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Invariant traceability.
 *
 * The first Cycle Audit found INV-005 completely unenforced: a `selectedExpirationMs`
 * field planted into the price engine's input type left every guardrail passing. It
 * had been asserted in three phase approvals without ever being tested.
 *
 * The gap was invisible because nothing connected an invariant to its evidence. This
 * test makes the connection checkable: docs/architecture/INVARIANTS.md declares which
 * invariants are enforced, and this fails if any of them has no test claiming it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const INVARIANTS_DOC = 'docs/architecture/INVARIANTS.md';

/**
 * What the status column may say, by its first word.
 *
 * **a2-09.** The enforcement check compared the cell with the exact string
 * `Enforced`, so `enforced`, `Enforced (structural)` and `Verified` each made an
 * invariant vanish from the check — and a companion check keyed on
 * `startsWith('Pending')` let the same cells through the other way. A one-word
 * editorial change silently removed an invariant from enforcement, which is the
 * "gap in an unwritten map" failure this guard was written for. The cell is
 * normalised now, and anything outside this vocabulary fails rather than being
 * read as harmless.
 */
const INVARIANT_STATUSES = ['enforced', 'pending'] as const;
type InvariantStatus = (typeof INVARIANT_STATUSES)[number];

/** The first word of a status cell, lower-cased: `Enforced (structural)` is `enforced`. */
function normaliseInvariantStatus(cell: string): string {
  return (
    cell
      .replace(/\*/g, '')
      .trim()
      .toLowerCase()
      .split(/[\s(—-]/)[0] ?? ''
  );
}

function isInvariantStatus(word: string): word is InvariantStatus {
  return (INVARIANT_STATUSES as readonly string[]).includes(word);
}

function read(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), 'utf8');
}

function testFiles(): string[] {
  const found: string[] = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const child = path.join(absolute, entry);
      if (statSync(child).isDirectory()) walk(child);
      else if (entry.endsWith('.test.ts')) found.push(path.relative(repoRoot, child));
    }
  };
  // `apps/` too: an invariant whose only evidence is an application test must
  // not read as unbacked (a2-09).
  for (const root of ['packages', 'tools', 'apps']) walk(path.join(repoRoot, root));
  return found.sort();
}

/** Invariant ids named in CLAUDE.md's invariant table. */
function declaredInvariants(): string[] {
  const ids = new Set<string>();
  for (const match of read('CLAUDE.md').matchAll(/\bINV-(\d{3})\b/g)) ids.add(`INV-${match[1]!}`);
  return [...ids].sort();
}

/** Invariant id -> status, from the traceability table. */
function documentedStatus(): Map<string, string> {
  const statuses = new Map<string, string>();
  for (const line of read(INVARIANTS_DOC).split('\n')) {
    const match = /^\|\s*(INV-\d{3})\b[^|]*\|\s*([^|]+?)\s*\|/.exec(line);
    if (match) statuses.set(match[1]!, match[2]!.replace(/\*/g, '').trim());
  }
  return statuses;
}

/** Invariant id -> the test files whose header claims to discharge it. */
function evidence(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of testFiles()) {
    if (file.endsWith('traceability.test.ts')) continue;
    const firstLine = read(file).split('\n')[0] ?? '';
    if (!firstLine.includes('Invariant evidence:')) continue;
    for (const match of firstLine.matchAll(/\bINV-\d{3}\b/g)) {
      const list = map.get(match[0]) ?? [];
      list.push(file);
      map.set(match[0], list);
    }
  }
  return map;
}

describe('every invariant is traceable to evidence', () => {
  const declared = declaredInvariants();
  const status = documentedStatus();
  const found = evidence();

  it('declares ten invariants', () => {
    expect(declared).toHaveLength(10);
  });

  it('gives every invariant a documented status', () => {
    expect([...status.keys()].sort()).toEqual(declared);
  });

  it('documents every status in the vocabulary', () => {
    const unknown = [...status.entries()]
      .filter(([, cell]) => !isInvariantStatus(normaliseInvariantStatus(cell)))
      .map(([id, cell]) => `${id}: "${cell}"`);
    expect(unknown, `statuses outside ${INVARIANT_STATUSES.join(' | ')}`).toEqual([]);
  });

  it('backs every enforced invariant with at least one tagged test', () => {
    const unbacked = declared.filter(
      (id) =>
        normaliseInvariantStatus(status.get(id) ?? '') === 'enforced' &&
        (found.get(id) ?? []).length === 0,
    );
    expect(unbacked, 'enforced invariants with no evidence').toEqual([]);
  });

  it('does not claim evidence for an invariant documented as pending', () => {
    // A pending invariant that has acquired evidence means the table is stale —
    // the work landed and nobody promoted it.
    const stale = declared.filter(
      (id) =>
        normaliseInvariantStatus(status.get(id) ?? '') === 'pending' &&
        (found.get(id) ?? []).length > 0,
    );
    expect(stale, 'pending invariants that now have evidence').toEqual([]);
  });

  it('reads every spelling of a status the same way', () => {
    for (const cell of ['Enforced', 'enforced', '**Enforced**', 'Enforced (structural)']) {
      expect(normaliseInvariantStatus(cell), cell).toBe('enforced');
    }
    expect(normaliseInvariantStatus('Pending (PH-9)')).toBe('pending');
    expect(isInvariantStatus(normaliseInvariantStatus('Verified'))).toBe(false);
  });

  it('tags no invariant that does not exist', () => {
    const unknown = [...found.keys()].filter((id) => !declared.includes(id)).sort();
    expect(unknown, 'tagged invariant ids absent from CLAUDE.md').toEqual([]);
  });
});
