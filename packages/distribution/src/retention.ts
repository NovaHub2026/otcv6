import type { Commitment } from './commitment.js';

/**
 * How long the published record is kept, and what may never be discarded.
 *
 * The window is not a storage decision. The journal must be kept at least as
 * long as a settlement can be disputed, so the dispute window is the input and
 * the storage follows from it. Sizing storage first would decide the dispute
 * window by accident, which is the wrong way round for a rule a counterparty
 * relies on.
 *
 * ## The two artefacts are not the same thing
 *
 * - **Journals may be pruned.** They carry every tick, and they are what makes
 *   an old settlement *re-derivable*.
 * - **Commitments are kept forever.** They are what makes a change
 *   *detectable*, they are tiny — one per window rather than one per tick — and
 *   each root binds its predecessor, so discarding one breaks the chain at that
 *   point permanently and irreparably.
 *
 * So pruning gives up the ability to recompute an old outcome and never gives
 * up the ability to prove the record was not altered. A retention policy that
 * pruned the chain would quietly convert a provable record into an assertion,
 * which is the whole of what PH-12 built.
 */

/**
 * The dispute window: 90 days.
 *
 * The criterion is that a counterparty must be able to raise a settlement
 * dispute and have it answered from the record rather than from the operator's
 * word. Ninety days is long enough to cover a quarterly reconciliation and a
 * complaint arising from it, and short enough that the journal is bounded.
 *
 * The cost is small enough not to be the binding constraint, which is the point:
 * PH-3 measured roughly 73,000 ticks per asset-day, so five assets over ninety
 * days is about 33 million ticks — hundreds of megabytes, not terabytes. If the
 * storage were the reason for the number, the number would be wrong.
 */
export const DEFAULT_DISPUTE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface RetentionPolicy {
  /** How long a settlement may be disputed. Journals are kept at least this long. */
  readonly disputeWindowMs: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  disputeWindowMs: DEFAULT_DISPUTE_WINDOW_MS,
};

/** A journal file, described by the window it archives. */
export interface JournalWindow {
  readonly assetId: string;
  readonly fromSequence: number;
  readonly toSequence: number;
  /** Instant of the newest tick it holds. */
  readonly newestInstant: number;
}

export class RetentionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetentionError';
  }
}

function assertPolicy(policy: RetentionPolicy): void {
  if (!Number.isFinite(policy.disputeWindowMs) || policy.disputeWindowMs <= 0) {
    throw new RetentionError(
      `The dispute window must be a positive number of milliseconds, got ${policy.disputeWindowMs}.`,
    );
  }
}

/**
 * Whether a journal window may be discarded at `now`.
 *
 * Boundary rule: a window is pruneable once its newest tick is *strictly* older
 * than the dispute window. On the boundary it is kept — the last day of a
 * dispute window is a day on which a dispute may be raised, and rounding the
 * wrong way there means answering it with "we deleted that yesterday".
 */
export function journalIsPruneable(
  window: JournalWindow,
  now: number,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): boolean {
  assertPolicy(policy);
  if (!Number.isFinite(window.newestInstant)) {
    throw new RetentionError(
      `Journal for ${window.assetId} has no usable newest instant, so its age is unknown. It is ` +
        `not pruned: an unknown age is not an old one.`,
    );
  }
  return now - window.newestInstant > policy.disputeWindowMs;
}

/**
 * Whether a commitment may be discarded. Always false.
 *
 * A function rather than a comment, because "never prune the chain" is a rule
 * some future cleanup task will need to ask about, and a rule nothing can ask
 * about is one that gets forgotten. It takes the same arguments as the journal
 * rule so a caller cannot use the wrong one by accident and get a plausible
 * answer.
 */
export function commitmentIsPruneable(
  _commitment: Commitment,
  _now: number,
  _policy: RetentionPolicy = DEFAULT_RETENTION,
): false {
  return false;
}

/** The journals that may be discarded at `now`, and the ones that may not. */
export function partitionForRetention(
  windows: readonly JournalWindow[],
  now: number,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): { readonly pruneable: readonly JournalWindow[]; readonly retained: readonly JournalWindow[] } {
  assertPolicy(policy);
  const pruneable: JournalWindow[] = [];
  const retained: JournalWindow[] = [];
  for (const window of windows) {
    (journalIsPruneable(window, now, policy) ? pruneable : retained).push(window);
  }
  return { pruneable, retained };
}
