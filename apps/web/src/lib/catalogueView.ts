import type { CatalogueEntry } from './api.js';

/**
 * Turning a catalogue into something a person can find one asset in.
 *
 * The sidebar was an unsorted flat list, which is exactly right for five assets
 * and useless at a hundred: the operator's question stops being "which of these"
 * and becomes "where is the one I want". PH-21 measured that a hundred-asset
 * build succeeds and stays differentiated; this is the part of that scale the
 * panel has to absorb.
 *
 * Both functions are pure and live outside React on purpose. Filtering is the
 * kind of thing that looks obviously right and is quietly wrong at the edges —
 * an empty query, a query that matches nothing, a query in the wrong case — and
 * a pure function can be exhaustively tested where a component cannot.
 */

/**
 * Entries matching `query`, in catalogue order.
 *
 * Matches an id, a display name or a family, case-insensitively, on a substring.
 * A blank query matches everything rather than nothing: a filter that hides the
 * catalogue until something is typed is a filter that broke the screen.
 *
 * Substring rather than prefix, because an operator looking for the euro pairs
 * types `eur` and means both `eurusd` and `gbpeur`. Space-separated terms are
 * conjunctive — `fx metal` matches nothing, which is correct, and `eur 1m`
 * would let a future field participate without changing this.
 */
export function filterCatalogue(
  entries: readonly CatalogueEntry[],
  query: string,
): readonly CatalogueEntry[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return entries;
  return entries.filter((entry) => {
    const haystack = `${entry.id} ${entry.displayName} ${entry.family}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export interface FamilyGroup {
  readonly family: string;
  readonly entries: readonly CatalogueEntry[];
}

/**
 * Entries grouped by family, families in first-appearance order.
 *
 * First appearance rather than alphabetical, so the order is the catalogue's own
 * — which is registration order, and therefore stable as the catalogue grows. An
 * alphabetical sort would move every group each time a family gained its first
 * member, which is the kind of movement that makes a list impossible to learn.
 */
export function groupByFamily(entries: readonly CatalogueEntry[]): readonly FamilyGroup[] {
  const groups = new Map<string, CatalogueEntry[]>();
  for (const entry of entries) {
    const existing = groups.get(entry.family);
    if (existing === undefined) groups.set(entry.family, [entry]);
    else existing.push(entry);
  }
  return [...groups].map(([family, grouped]) => ({ family, entries: grouped }));
}
