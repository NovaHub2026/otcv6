// Invariant evidence: none directly — this is presentation, and presentation is where a hundred assets are felt.
import { describe, expect, it } from 'vitest';
import { filterCatalogue, groupByFamily } from './catalogueView.js';
import type { CatalogueEntry } from './api.js';

function entry(id: string, displayName: string, family: string): CatalogueEntry {
  return {
    id,
    displayName,
    family,
    live: true,
    referencePrice: 1,
    displayPrecision: 4,
    logQuantum: 1e-6,
    meanIntervalMs: 1_000,
    tieRate: 0,
    excessKurtosis: 3,
    dispersion: { quarterlyLogSigma: 0.1, quarterlyPercent: 0.1 },
  };
}

const catalogue = [
  entry('eurusd', 'EUR/USD', 'forex'),
  entry('gbpjpy', 'GBP/JPY', 'forex'),
  entry('btcusd', 'BTC/USD', 'crypto'),
  entry('spx', 'S&P 500', 'index'),
  entry('xauusd', 'XAU/USD', 'commodity'),
];

describe('finding one asset among many', () => {
  it('matches an id, a name or a family', () => {
    expect(filterCatalogue(catalogue, 'eur').map((e) => e.id)).toEqual(['eurusd']);
    expect(filterCatalogue(catalogue, 's&p').map((e) => e.id)).toEqual(['spx']);
    expect(filterCatalogue(catalogue, 'forex').map((e) => e.id)).toEqual(['eurusd', 'gbpjpy']);
  });

  it('ignores case, because nobody types an id the way it is stored', () => {
    expect(filterCatalogue(catalogue, 'BTC').map((e) => e.id)).toEqual(['btcusd']);
    expect(filterCatalogue(catalogue, 'Forex').map((e) => e.id)).toEqual(['eurusd', 'gbpjpy']);
  });

  it('matches a substring, not a prefix', () => {
    // An operator looking for the dollar pairs types `usd` and means all three.
    expect(filterCatalogue(catalogue, 'usd').map((e) => e.id)).toEqual([
      'eurusd',
      'btcusd',
      'xauusd',
    ]);
  });

  it('treats several terms as all-of', () => {
    expect(filterCatalogue(catalogue, 'usd forex').map((e) => e.id)).toEqual(['eurusd']);
    expect(filterCatalogue(catalogue, 'forex crypto')).toEqual([]);
  });

  it('shows everything for a blank query, not nothing', () => {
    // A filter that hides the catalogue until something is typed is a filter
    // that broke the screen.
    expect(filterCatalogue(catalogue, '')).toEqual(catalogue);
    expect(filterCatalogue(catalogue, '   ')).toEqual(catalogue);
  });

  it('returns nothing when nothing matches, and says so by being empty', () => {
    expect(filterCatalogue(catalogue, 'zzz')).toEqual([]);
  });

  it('keeps catalogue order', () => {
    expect(filterCatalogue(catalogue, 'usd').map((e) => e.id)).toEqual([
      'eurusd',
      'btcusd',
      'xauusd',
    ]);
  });
});

describe('grouping a hundred assets', () => {
  it('groups by family in first-appearance order', () => {
    expect(groupByFamily(catalogue).map((g) => g.family)).toEqual([
      'forex',
      'crypto',
      'index',
      'commodity',
    ]);
    expect(groupByFamily(catalogue)[0]!.entries.map((e) => e.id)).toEqual(['eurusd', 'gbpjpy']);
  });

  it('keeps every entry exactly once', () => {
    const grouped = groupByFamily(catalogue).flatMap((g) => g.entries);
    expect(grouped).toHaveLength(catalogue.length);
    expect(new Set(grouped.map((e) => e.id)).size).toBe(catalogue.length);
  });

  it('is empty for an empty catalogue rather than one empty group', () => {
    expect(groupByFamily([])).toEqual([]);
  });

  it('holds a hundred assets across eight families', () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      entry(`asset-${i}`, `Asset ${i}`, `family-${i % 8}`),
    );
    const groups = groupByFamily(many);
    expect(groups).toHaveLength(8);
    expect(groups.reduce((sum, g) => sum + g.entries.length, 0)).toBe(100);
    // And the filter still finds one of them.
    expect(filterCatalogue(many, 'asset-57').map((e) => e.id)).toEqual(['asset-57']);
  });
});
