import { describe, expect, it } from 'vitest';
import { crossesAChange, frameOfSpan, reframedSequences, reframesAt } from './priceFrame.js';

/**
 * ADR-0021. `settle()` takes a contract across an ordinary seam and refuses one
 * across a change of lattice, so whether a seam changed the lattice decides
 * whether money moves. The dangerous answer is a false "no": prices either side
 * of the gap would be compared as though they counted in one unit.
 */
describe('whether a seam crosses a change of lattice (ADR-0021)', () => {
  const A = { logQuantum: 1e-5, referencePrice: 1.1 };
  const B = { logQuantum: 3e-7, referencePrice: 1.1 };

  it('does not count where the log starts, or an epoch that restates the one before it', () => {
    expect(reframedSequences([])).toEqual(new Set());
    expect(reframedSequences([{ fromSequence: 1, ...A }])).toEqual(new Set());
    expect(
      reframedSequences([
        { fromSequence: 1, ...A },
        { fromSequence: 500, ...A },
      ]),
    ).toEqual(new Set());
  });

  it('counts a change of quantum or of reference, at the epoch that makes it', () => {
    expect(
      reframedSequences([
        { fromSequence: 1, ...A },
        { fromSequence: 500, ...B },
        { fromSequence: 900, ...B, referencePrice: 1.2 },
      ]),
    ).toEqual(new Set([500, 900]));
  });

  it('sees a change logged anywhere inside the seam, not only at its resume', () => {
    const epochs = [
      { fromSequence: 1, ...A },
      { fromSequence: 500, ...B },
    ];
    // The change at the resume itself: the shape a relattice writes.
    expect(reframesAt(epochs, { lastSequence: 499, resumesAtSequence: 500 })).toBe(true);
    // Logged one sequence off inside a wider gap: still a change across it.
    expect(reframesAt(epochs, { lastSequence: 480, resumesAtSequence: 520 })).toBe(true);
    // A seam wholly before or after the change is ordinary.
    expect(reframesAt(epochs, { lastSequence: 200, resumesAtSequence: 300 })).toBe(false);
    expect(reframesAt(epochs, { lastSequence: 500, resumesAtSequence: 600 })).toBe(false);
    // And the empty log — a store older than the log — says nothing changed,
    // which is how every reader treats it.
    expect(reframesAt([], { lastSequence: 499, resumesAtSequence: 500 })).toBe(false);
  });

  it('treats a change of display precision alone as no change, anywhere (PH-40.3)', () => {
    const epochs = [
      { assetId: 'x', fromSequence: 1, fromInstant: 0, ...A, displayPrecision: 2 },
      { assetId: 'x', fromSequence: 500, fromInstant: 0, ...A, displayPrecision: 3 },
    ];
    expect(reframedSequences(epochs)).toEqual(new Set());
    expect(reframesAt(epochs, { lastSequence: 499, resumesAtSequence: 500 })).toBe(false);
    // A span across it has one unit, rendered at the finer precision…
    expect(frameOfSpan(epochs, 400, 600, null)).toEqual(epochs[1]);
    // …and a span across a change of unit still has none.
    const unit = [epochs[0]!, { ...epochs[1]!, logQuantum: A.logQuantum * 2 }];
    expect(frameOfSpan(unit, 400, 600, null)).toBeNull();
    // Wholly on one side, the frame of that side.
    expect(frameOfSpan(epochs, 10, 20, null)).toEqual(epochs[0]);
  });

  it('bounds a seam at its last tick exclusive and its resume inclusive', () => {
    const changes = new Set([500]);
    expect(crossesAChange(changes, { lastSequence: 500, resumesAtSequence: 510 })).toBe(false);
    expect(crossesAChange(changes, { lastSequence: 499, resumesAtSequence: 500 })).toBe(true);
    expect(crossesAChange(changes, { lastSequence: 490, resumesAtSequence: 499 })).toBe(false);
  });
});
