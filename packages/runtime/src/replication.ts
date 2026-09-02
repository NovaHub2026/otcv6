import type { EpochMillis, Tick } from '@otc/core';
import type { FenceToken } from './fence.js';

/**
 * Thrown when the record is asked to hold two different ticks at one sequence.
 *
 * This is INV-003 broken — one asset, two underlying streams — and it is the
 * signature two concurrent leaders would leave. It is never repaired by
 * overwriting: a fork that overwrites looks like a successful write, and the
 * evidence that anything went wrong is gone. Refusing turns it into an incident.
 */
export class RecordForkError extends Error {
  constructor(
    readonly assetId: string,
    readonly sequence: number,
    readonly recorded: Tick,
    readonly offered: Tick,
  ) {
    super(
      `Fork in the record for ${assetId} at sequence ${sequence}: it holds ` +
        `(instant ${recorded.instant}, price ${recorded.price}) and was offered ` +
        `(instant ${offered.instant}, price ${offered.price}). Two different streams are ` +
        `claiming this asset. The record was not modified.`,
    );
    this.name = 'RecordForkError';
  }
}

/**
 * A recorded discontinuity.
 *
 * PH-5.2's seam moves the sequence past the reserved block on purpose — "the gap
 * is visible and free; a duplicate is neither" — and PH-14.2's log refuses a gap
 * because one served to observers is indistinguishable from the market. Both
 * rules are right and they contradict.
 *
 * They are reconciled by making the discontinuity a thing the record *holds*
 * rather than a hole in it. The only way to write past a seam is to record one,
 * so a gap cannot be silent.
 */
export interface SeamMarker {
  readonly assetId: string;
  /** Last sequence in the record before the seam, or null if it had none. */
  readonly lastSequence: number | null;
  /** Instant of that last tick, or null. */
  readonly lastInstant: EpochMillis | null;
  /** First sequence the record carries after the seam. */
  readonly resumesAtSequence: number;
  /** Instant the market reopens at. */
  readonly resumesAtInstant: EpochMillis;
  /** Why the market could not continue. Carried verbatim from `RecoveryOutcome`. */
  readonly reason: string;
}

/** One thing the record holds: almost always a tick, occasionally a seam. */
export type RecordEntry =
  | { readonly kind: 'tick'; readonly tick: Tick }
  | { readonly kind: 'seam'; readonly seam: SeamMarker };

/**
 * Where an entry sits in the sequence space.
 *
 * A seam occupies the position just past the last sequence before it, so a
 * client asking for a sequence that fell inside a gap is given the seam before
 * the ticks that follow. Nobody reads across a discontinuity without being told.
 */
export function entrySequence(entry: RecordEntry): number {
  return entry.kind === 'tick' ? entry.tick.sequence : (entry.seam.lastSequence ?? 0) + 1;
}

/** Thrown when a seam does not continue the record it claims to continue. */
export class SeamError extends Error {
  constructor(
    readonly assetId: string,
    readonly detail: string,
  ) {
    super(`Seam for ${assetId} refused: ${detail}. The record was not modified.`);
    this.name = 'SeamError';
  }
}

/**
 * The durable, sequence-addressed record every node reads.
 *
 * Followers replicate through this and through nothing else. A second channel
 * carrying the same ticks would be a second opportunity for two copies of the
 * record to disagree, and no observer could tell which one they had.
 */
export interface ReplicationLog {
  /**
   * Append published ticks under the current grant.
   *
   * Fenced: a leader that has lost its lease cannot add to the record, which is
   * the guarantee PH-14.1 gave the checkpoint applied to what observers see.
   *
   * Ticks at sequences already recorded are accepted **only** if they are
   * identical, which is the normal outcome of the resume path replaying ticks
   * it generated before a crash. A differing tick raises {@link RecordForkError}.
   * Anything past the head must continue it exactly; a gap is refused, because
   * the record cannot invent what it was not given, and the only way past one is
   * {@link ReplicationLog.recordSeam}.
   */
  appendTicks(assetId: string, token: FenceToken, ticks: readonly Tick[]): Promise<void>;

  /**
   * Record a discontinuity, under the current grant.
   *
   * Fenced like an append, and refused unless it continues the record's own
   * head: a seam that claimed a different last sequence would be rewriting
   * history rather than extending it.
   */
  recordSeam(assetId: string, token: FenceToken, seam: SeamMarker): Promise<void>;

  /** Entries from `fromSequence` onwards, at most `limit` of them. */
  readRecord(assetId: string, fromSequence: number, limit: number): Promise<readonly RecordEntry[]>;

  /** The newest tick sequence in the record, or null if the asset has none. */
  recordHead(assetId: string): Promise<number | null>;

  /** Every seam recorded for an asset, oldest first. */
  seams(assetId: string): Promise<readonly SeamMarker[]>;
}

/**
 * A batch that no single writer could have produced, or null.
 *
 * **a5-05 (B-019, SQL-3).** The two stores validated a batch against the
 * record one tick at a time and disagreed about a batch that disagreed with
 * itself: the reference refused `[n, n]`, SQLite deduplicated the second
 * against the row the same batch had just inserted, and a differing `[n, n']`
 * from one writer raised `RecordForkError` — the signature of two leaders —
 * in SQLite alone. The rule both stores now share: a batch is one writer's
 * ordered output, and one that repeats or reorders a sequence is refused
 * whole rather than reconciled against itself. Checked before anything is
 * compared with the record, so the refusal is the same on every store.
 */
export function malformedBatch(assetId: string, ticks: readonly Tick[]): RangeError | null {
  for (let i = 1; i < ticks.length; i += 1) {
    const previous = ticks[i - 1]!.sequence;
    const current = ticks[i]!.sequence;
    if (current <= previous) {
      return new RangeError(
        `Cannot append to ${assetId}: the batch is not strictly ordered (sequence ${current} ` +
          `after ${previous}). One writer produces one ordered stream; a batch that repeats or ` +
          `reorders a sequence is not its output and is refused whole. The record was not modified.`,
      );
    }
  }
  return null;
}

/** Whether two ticks are the same tick. */
export function sameTick(a: Tick, b: Tick): boolean {
  return a.sequence === b.sequence && a.instant === b.instant && a.price === b.price;
}

/**
 * The first index whose entry sits at or past `sequence`.
 *
 * `entrySequence` is non-decreasing across the entry list, so this is a binary
 * search. It is a binary search rather than a scan because the follower calls it
 * on every pull, and a linear one made the INV-002 test quadratic once already.
 */
export function lowerBound(entries: readonly RecordEntry[], sequence: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (entrySequence(entries[middle]!) < sequence) low = middle + 1;
    else high = middle;
  }
  return low;
}
