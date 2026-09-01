/**
 * Fencing: the mechanism that stops a leader who no longer leads.
 *
 * Kept apart from the lease deliberately. A lease grants leadership and a fence
 * refuses a write, and PH-14.1 §2 is explicit that the first is worth nothing
 * without the second — expiry is a fact at the store, not at a stranded node,
 * so a partitioned leader keeps generating and keeps trying to persist no matter
 * what its lease says.
 *
 * The separation is also what keeps the follower unable to generate. A follower
 * needs the token type to *read* the record's contract; it must not reach the
 * lease, the state record, or through them the engine. Splitting this out cut
 * the path `follower -> replication -> lease -> state -> @otc/engine`, which the
 * single-writer guardrail found the moment it was written.
 */

/**
 * A fence token: monotone per asset, strictly increasing across every grant.
 *
 * Monotonicity is the whole safety argument. Because no two grants for an asset
 * ever share a token, a writer holding a token from a superseded grant cannot
 * match the current one, so the store can refuse it without knowing anything
 * about who is alive.
 */
export type FenceToken = number;

/** Thrown when a write is refused because its token is not the current grant. */
export class StaleFenceError extends Error {
  constructor(
    readonly assetId: string,
    readonly presented: FenceToken,
    readonly current: FenceToken | null,
    readonly detail: string,
  ) {
    super(
      `Write to ${assetId} refused: fence token ${presented} is not the current grant ` +
        `(${current === null ? 'no grant' : `token ${current}`}, ${detail}). The record ` +
        `was not written.`,
    );
    this.name = 'StaleFenceError';
  }
}
