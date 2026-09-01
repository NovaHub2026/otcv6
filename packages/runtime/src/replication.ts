import type { Tick } from '@otc/core';
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
   * the record cannot invent what it was not given.
   */
  appendTicks(assetId: string, token: FenceToken, ticks: readonly Tick[]): Promise<void>;

  /** Ticks from `fromSequence` onwards, at most `limit` of them. */
  readTicks(assetId: string, fromSequence: number, limit: number): Promise<readonly Tick[]>;

  /** The newest sequence in the record, or null if the asset has none. */
  recordHead(assetId: string): Promise<number | null>;
}

/** Whether two ticks are the same tick. */
export function sameTick(a: Tick, b: Tick): boolean {
  return a.sequence === b.sequence && a.instant === b.instant && a.price === b.price;
}
