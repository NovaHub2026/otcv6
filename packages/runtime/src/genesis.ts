import type { EpochMillis } from '@otc/core';

/**
 * How many key epochs one start instant owns.
 *
 * A keystream is keyed by the instant it starts, scaled by this span, so the
 * epochs of two different milliseconds are disjoint runs rather than
 * neighbours. The run is what lets a start on a clock that has not moved — a
 * second seam in the same millisecond, which only a test clock produces — take
 * the next epoch without landing on the one a start a millisecond later would
 * take.
 *
 * 1,024 keeps every instant before the year 2248 inside the safe integers the
 * stream label requires.
 */
export const START_EPOCH_SPAN = 1_024;

/** The latest start instant whose whole run of epochs is still a safe integer. */
const LATEST_START = Math.floor(
  (Number.MAX_SAFE_INTEGER - (START_EPOCH_SPAN - 1)) / START_EPOCH_SPAN,
);

/**
 * The key epoch of a keystream that starts at `instant`.
 *
 * **Every keystream a market starts is keyed by when it starts** — a genesis,
 * a backfill's genesis, a seam, a reopening past the record. Before this, a
 * genesis always took epoch 0 and a seam always took the previous epoch plus
 * one, so under one secret two markets started from nothing were the same
 * market tick for tick, and two seams taken from one restored backup were the
 * same increments from the same price. Found in a broker's deployment of
 * `v2.0.0` on 2026-09-22, where it read as a figure repeating across all thirty
 * assets (ADR-0019).
 *
 * `previous` is the epoch the market was on, when it had one. The result is
 * never at or below it, so within one market the epochs only ever rise and no
 * keystream is re-entered — including a legacy market that has been on epoch 0
 * since before this rule, which moves onto its instant's run at its next seam.
 *
 * The instant is public and the epoch is only a label: the stream key is still
 * derived from the master secret, which nothing here reads (INV-010). And the
 * epoch is written into every checkpoint, so a resume continues the keystream
 * the record indexes (INV-009).
 */
export function startKeyEpoch(instant: EpochMillis, previous?: number): number {
  if (!Number.isSafeInteger(instant) || instant < 0 || instant > LATEST_START) {
    throw new RangeError(
      `A keystream cannot start at ${instant}: its key epoch must be a safe integer, which ` +
        `holds for whole-millisecond instants from 0 to ${LATEST_START}.`,
    );
  }
  const own = instant * START_EPOCH_SPAN;
  return previous === undefined ? own : Math.max(previous + 1, own);
}
