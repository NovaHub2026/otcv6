/**
 * The frame a stored price counts in (PH-38.1).
 *
 * A published price is an integer, and an integer is not a price. It becomes
 * one only next to the numbers `toDisplayPrice` uses:
 *
 * ```
 * referencePrice * exp(logQuantum * price)
 * ```
 *
 * The durable stores kept the integer and threw those numbers away, so when
 * PH-37 moved all thirty lattices every read route began rendering the retained
 * past on a lattice it was never written on. Measured on the live venue at the
 * time: 3,664,367 of 7,500,278 retained ticks, 48.9%, on 30 of 30 assets, a
 * median error of 31.7% and a worst case of 1,472% (Cycle Audit 12, finding 3).
 *
 * **Three fields, not one.** Storing only the quantum would be the same defect
 * one release later: `referencePrice` is inside the personality fingerprint too
 * (`personality.ts`), so it can move across a release and force a seam exactly
 * as the quantum can, and `onLattice` in `resume.ts` rescales by the quantum
 * ratio alone and silently assumes the reference never moved.
 * `displayPrecision` is the third because it is what turns the number into the
 * string an observer actually read — and it is deliberately **not** in the
 * fingerprint, so it can change with no seam at all. That asymmetry is the
 * reason a frame history cannot be derived from the seam table and has to be
 * its own record.
 */
export interface PriceFrame {
  /** The log-lattice step a stored integer counts in. */
  readonly logQuantum: number;
  /** The price the integer counts from. */
  readonly referencePrice: number;
  /** Decimal places the observer was shown. */
  readonly displayPrecision: number;
}

/**
 * A frame in force from a sequence onward.
 *
 * Half-open by sequence: an epoch covers `[fromSequence, nextFromSequence)` and
 * the newest one is in force. `fromInstant` is carried so a reader that has an
 * instant rather than a sequence — the settlement query — can resolve a frame
 * without a join back to the tick table.
 */
export interface LatticeEpoch extends PriceFrame {
  readonly assetId: string;
  readonly fromSequence: number;
  readonly fromInstant: number;
}

/**
 * Whether two frames are the same one.
 *
 * Compared by value and exactly. A quantum read back from SQLite must equal the
 * catalogue's double or every append would write a new epoch row; IEEE-754
 * doubles round-trip through SQLite's REAL, so exact equality is the right test
 * and a tolerance here would hide the defect it pretends to absorb — a
 * near-miss quantum renders a price wrong below `displayPrecision`, invisibly
 * and permanently, which is Cycle Audit 12's finding 6 in a new costume.
 */
export function sameFrame(a: PriceFrame, b: PriceFrame): boolean {
  return (
    a.logQuantum === b.logQuantum &&
    a.referencePrice === b.referencePrice &&
    a.displayPrecision === b.displayPrecision
  );
}

/**
 * Why `frame` is not a usable frame, or null when it is.
 *
 * A frame is written durably and read back as the truth about what an integer
 * meant, so a malformed one is worse than a missing one: it is a wrong answer
 * recorded as a right one. The quantum and the reference must both be finite
 * and strictly positive — `exp(logQuantum * price)` is meaningless otherwise
 * and a zero reference collapses every price to zero — and the precision must
 * be a non-negative integer, because it counts decimal places.
 */
export function malformedFrame(frame: PriceFrame, assetId: string): RangeError | null {
  const bad = (what: string, value: number): RangeError =>
    new RangeError(
      `${assetId}'s price frame has ${what} ${String(value)}. The record was not modified.`,
    );
  if (!Number.isFinite(frame.logQuantum) || frame.logQuantum <= 0) {
    return bad('a log quantum that is not finite and positive:', frame.logQuantum);
  }
  if (!Number.isFinite(frame.referencePrice) || frame.referencePrice <= 0) {
    return bad('a reference price that is not finite and positive:', frame.referencePrice);
  }
  if (!Number.isSafeInteger(frame.displayPrecision) || frame.displayPrecision < 0) {
    return bad('a display precision that is not a non-negative integer:', frame.displayPrecision);
  }
  return null;
}

/**
 * The epoch in force at `sequence`, or null when the range is undeclared.
 *
 * `epochs` must be oldest first. Null is a real answer and not an absence to
 * paper over: it means the record holds ticks written before it could say what
 * they counted in, and rendering those on the current frame is precisely the
 * defect this module exists to end. PH-38.2 is what lets an operator declare
 * such a range; until then a caller is expected to say "undeclared" rather than
 * guess.
 */
export function frameAtOrBefore(
  epochs: readonly LatticeEpoch[],
  sequence: number,
): LatticeEpoch | null {
  let found: LatticeEpoch | null = null;
  for (const epoch of epochs) {
    if (epoch.fromSequence > sequence) break;
    found = epoch;
  }
  return found;
}
