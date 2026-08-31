import type { EpochMillis } from '../time/instant.js';
import type { LogPrice } from './instrument.js';

/**
 * What must be recorded so a segment of history can be reproduced exactly.
 *
 * A snapshot alone is not sufficient. A restart moves the entropy cursor
 * discontinuously by design — the lease reserves indices ahead of use so that a
 * crash can never redraw values already consumed (ADR-0002 §4) — so a segment
 * spanning a restart cannot be reproduced without knowing where the cursor
 * jumped.
 *
 * A replayable history is therefore `snapshot + ordered cursor advances`, which
 * is also the artefact INV-009 requires for resolving a settlement dispute.
 */

export interface StreamSnapshot {
  readonly instrumentId: string;
  /** Which sealed secret produced this history. Never the secret itself. */
  readonly keyId: string;
  readonly takenAt: EpochMillis;
  readonly sequence: number;
  readonly price: LogPrice;
  /** Stream purpose -> formatted cursor, as produced by `formatCursor`. */
  readonly cursors: Readonly<Record<string, string>>;
  /** Opaque to this package; PH-3 defines the generative model's state. */
  readonly modelState: unknown;
}

export type CursorAdvanceReason = 'restart-lease';

export interface CursorAdvance {
  readonly instrumentId: string;
  readonly purpose: string;
  readonly atSequence: number;
  readonly from: string;
  readonly to: string;
  readonly reason: CursorAdvanceReason;
}

export interface ReplaySegment {
  readonly snapshot: StreamSnapshot;
  /** Ordered by `atSequence`, strictly increasing. */
  readonly advances: readonly CursorAdvance[];
}

export function assertReplaySegment(segment: ReplaySegment): void {
  const { snapshot, advances } = segment;
  if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) {
    throw new RangeError(
      `Snapshot sequence must be a non-negative safe integer, received ${snapshot.sequence}.`,
    );
  }
  if (snapshot.keyId.length === 0) {
    throw new RangeError('Snapshot must record the key identifier that produced the history.');
  }

  // A single restart advances every stream the engine holds, all at the same
  // sequence. So the list is ordered non-decreasing overall, and strictly
  // increasing only within a purpose — a purpose cannot jump twice at one tick.
  let previous = -1;
  const lastBySequenceForPurpose = new Map<string, number>();
  for (const advance of advances) {
    if (advance.instrumentId !== snapshot.instrumentId) {
      throw new RangeError(
        `Cursor advance for ${advance.instrumentId} does not belong to a segment for ${snapshot.instrumentId}.`,
      );
    }
    if (advance.atSequence < snapshot.sequence) {
      throw new RangeError(
        `Cursor advance at ${advance.atSequence} precedes the snapshot at ${snapshot.sequence}.`,
      );
    }
    if (advance.atSequence < previous) {
      throw new RangeError(
        `Cursor advances must be ordered by sequence: ${advance.atSequence} follows ${previous}.`,
      );
    }
    const lastForPurpose = lastBySequenceForPurpose.get(advance.purpose);
    if (lastForPurpose !== undefined && advance.atSequence <= lastForPurpose) {
      throw new RangeError(
        `Stream ${JSON.stringify(advance.purpose)} advances more than once at sequence ${advance.atSequence}.`,
      );
    }
    lastBySequenceForPurpose.set(advance.purpose, advance.atSequence);
    previous = advance.atSequence;
    if (!Object.prototype.hasOwnProperty.call(snapshot.cursors, advance.purpose)) {
      throw new RangeError(
        `Cursor advance references purpose ${JSON.stringify(advance.purpose)}, absent from the snapshot.`,
      );
    }
  }
}

/**
 * Cursor positions in force at a given sequence, applying every advance recorded
 * at or before it. This is what a replay driver seeks each stream to.
 */
export function cursorsAt(segment: ReplaySegment, sequence: number): Record<string, string> {
  assertReplaySegment(segment);
  if (sequence < segment.snapshot.sequence) {
    throw new RangeError(
      `Cannot resolve cursors at ${sequence}: the segment begins at ${segment.snapshot.sequence}.`,
    );
  }
  const cursors: Record<string, string> = { ...segment.snapshot.cursors };
  for (const advance of segment.advances) {
    if (advance.atSequence > sequence) break;
    cursors[advance.purpose] = advance.to;
  }
  return cursors;
}
