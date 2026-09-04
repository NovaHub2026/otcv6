import { exp, ln } from '@otc/core/browser';

/** The lattice the Lab's state names (PH-24.20): what a price is made of. */
export interface Lattice {
  readonly logQuantum: number;
  readonly referencePrice: number;
  readonly displayPrecision: number;
}

/**
 * The lattice level nearest a price, rendered — with the kernel's own
 * conversions (`fromDisplayPrice` / `toDisplayPrice`, portable `ln` and `exp`),
 * so the result renders back to itself and the Lab accepts it as a level. A
 * price plus a fixed increment is not a level two times in three at EUR/USD's
 * grain; a click on a chart names an arbitrary float. Both come through here.
 */
export function nearestLevelPrice(lattice: Lattice, price: number): string | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const level = Math.round(ln(price / lattice.referencePrice) / lattice.logQuantum);
  return (lattice.referencePrice * exp(lattice.logQuantum * level)).toFixed(
    lattice.displayPrecision,
  );
}
