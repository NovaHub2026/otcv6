import { describe, expect, it } from 'vitest';
import { ASSET_CATALOGUE } from '@otc/engine';
import {
  brokerFitReport,
  inForce,
  render,
  staleQuoteWinRate,
  tieCounts,
  type Series,
} from './brokerFit.js';

/**
 * The measurements `BROKER-FIT-*.md` records (PH-40.6), on inputs whose answer
 * is known by hand, so a wrong count cannot hide inside a plausible percentage.
 */
const series: Series = { instants: [10, 20, 30, 40], prices: [1, 2, 2, 3] };

describe('the price in force, as settlement reads it', () => {
  it('is the last tick at or before the instant, and the starting price before any', () => {
    expect(inForce(series, 5)).toBe(0);
    expect(inForce(series, 10)).toBe(1);
    expect(inForce(series, 19)).toBe(1);
    expect(inForce(series, 20)).toBe(2);
    expect(inForce(series, 1_000)).toBe(3);
    expect(inForce({ instants: [], prices: [] }, 50)).toBe(0);
  });
});

describe('ties, as settle() counts them and as a broker at five decimals does', () => {
  // One step of this lattice is 0.2 of a fifth decimal: adjacent integers print
  // the same five decimals, so a broker sees a draw where settle() sees a move.
  const fine = {
    id: 'x',
    family: 'forex' as const,
    logQuantum: 2e-6,
    referencePrice: 1,
    displayPrecision: 6,
  };

  it('counts the windows, the integer ties and the printed ones', () => {
    // Windows [0,10) [10,20) [20,30) [30,40): prices 0→1, 1→2, 2→2, 2→3.
    const counts = tieCounts(series, fine, 10, 0, 40);
    expect(counts.n).toBe(4);
    expect(counts.integer).toBe(1);
    // At five decimals integers 0..3 print 1.00000, 1.00000, 1.00000, 1.00001:
    // two real moves print as none, the third crosses a rounding boundary.
    expect([0, 1, 2, 3].map((k) => render(fine, k, 5))).toEqual([
      '1.00000',
      '1.00000',
      '1.00000',
      '1.00001',
    ]);
    expect(counts.broker).toBe(3);
    // At the engine's own six decimals a step is visible and they agree.
    expect(tieCounts(series, fine, 10, 0, 40, 6).broker).toBe(counts.integer);
  });
});

describe('a stale quote', () => {
  it('wins when the move it watched continues, and leaves undecided quotes out', () => {
    const rising: Series = { instants: [10, 20, 30, 40], prices: [1, 2, 3, 4] };
    expect(staleQuoteWinRate(rising, [5, 15], 10, 10)).toBe(1);
    const reversing: Series = { instants: [10, 20], prices: [1, -1] };
    expect(staleQuoteWinRate(reversing, [5], 10, 10)).toBe(0);
    // Nothing moved during the look: undecided.
    expect(staleQuoteWinRate(series, [21], 5, 10)).toBeNaN();
  });
});

describe('the report', () => {
  it('runs on the engine and states its procedure', async () => {
    const asset = ASSET_CATALOGUE.find((a) => a.definition.id === 'usdchf-otc')!;
    const report = await brokerFitReport([asset], { windows: 4, replicates: 1, trials: 20 });
    expect(report).toContain('| usdchf-otc | 0.24 |');
    // Finer than one fifth decimal, so the coarsened column is filled.
    expect(report).toMatch(/\| ×5: \d+\.\d{2}% \|/);
    expect(report).toContain('1 replicates × 4 windows per horizon for ties; 20 quotes per cell');
  });
});
