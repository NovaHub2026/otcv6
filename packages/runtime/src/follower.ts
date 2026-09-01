import type { EpochMillis, LogPrice, Tick } from '@otc/core';
import {
  lowerBound,
  type RecordEntry,
  type ReplicationLog,
  type SeamMarker,
} from './replication.js';

/**
 * A node's view of an asset it does not lead.
 *
 * **This module imports no engine and no key material, and that is structural
 * rather than a convention.** A follower that could construct an engine could
 * fork the record invisibly — it would generate its own continuation of a
 * market it is supposed to be reading, and every observer reaching that node
 * would see a different market with no way to detect it. So the dependency does
 * not exist: `follower.ts` takes the tick type from `@otc/core` and nothing
 * else, and a guardrail asserts the import list, so adding an engine here fails
 * the suite rather than passing review.
 *
 * It settles INV-010 for followers at the same time. A module that never
 * receives key material cannot leak it.
 */

/**
 * What a follower can say about a requested sequence.
 *
 * Four cases where a single node has two, and the lag case is the reason this
 * type exists. `UnknownSequenceError` tells a client asking beyond the head
 * that it "is not behind — it is holding a record this feed did not produce",
 * which is correct on one node and a false accusation across several: a client
 * that read sequence 8,000 from the leader and reconnected to a follower at
 * 7,950 holds a perfectly real record, and the follower is the one behind.
 * Sending it to reset a correct history would be the worst available answer.
 */
export type ServeResult =
  | { readonly kind: 'entries'; readonly entries: readonly RecordEntry[] }
  | {
      readonly kind: 'lagging';
      /** Newest sequence this follower holds, or null if it holds none. */
      readonly followerHead: number | null;
      /** Newest sequence the shared record holds. */
      readonly recordHead: number;
    }
  | {
      readonly kind: 'unknown';
      readonly requested: number;
      /** Newest sequence the shared record holds, or null. */
      readonly recordHead: number | null;
    }
  | {
      readonly kind: 'evicted';
      readonly requested: number;
      /** Oldest sequence this follower still retains. */
      readonly oldestRetained: number;
    };

export interface FollowerMarketOptions {
  readonly assetId: string;
  /**
   * Ticks retained for replay, oldest evicted first.
   *
   * Bounded and explicit for the reason `TickFeed` gives: quietly truncating
   * turns a resumable record into one that silently skips.
   */
  readonly retainTicks?: number;
}

export const DEFAULT_FOLLOWER_RETAIN_TICKS = 50_000;

/** Thrown when a follower is asked to apply entries that do not continue it. */
export class ReplicationGapError extends Error {
  constructor(
    readonly assetId: string,
    readonly expected: number,
    readonly received: number,
  ) {
    super(
      `Follower for ${assetId} expected sequence ${expected} and was given ${received}. A ` +
        `gap here would be served to observers as though the record contained it.`,
    );
    this.name = 'ReplicationGapError';
  }
}

export class FollowerMarket {
  readonly assetId: string;
  readonly #retainTicks: number;
  /**
   * What this follower serves: ticks and the seams between them.
   *
   * Ticks are also kept separately, in `#history`. Both hold the same objects,
   * and the duplication buys a linear price walk and a linear retention check
   * without filtering seams out of the entry list on every call.
   */
  #entries: RecordEntry[] = [];
  #history: Tick[] = [];
  /** Newest sequence applied, retained after eviction trims the arrays. */
  #head: number | null = null;
  /**
   * Sequence the next tick must carry.
   *
   * Carried rather than derived from `head + 1`, because after a seam they
   * differ: the head is the last sequence before the discontinuity and the next
   * tick lands at the seam's resuming sequence, far beyond it. Deriving one from
   * the other is precisely the assumption a seam breaks.
   */
  #expectNext: number | null = null;
  readonly #seams: SeamMarker[] = [];

  constructor(options: FollowerMarketOptions) {
    this.assetId = options.assetId;
    this.#retainTicks = options.retainTicks ?? DEFAULT_FOLLOWER_RETAIN_TICKS;
    if (!Number.isInteger(this.#retainTicks) || this.#retainTicks < 1) {
      throw new RangeError(
        `retainTicks must be a positive integer, received ${this.#retainTicks}.`,
      );
    }
  }

  /** Newest sequence applied, or null before any. */
  get head(): number | null {
    return this.#head;
  }

  /** Sequence the next tick must carry, or null before anything has been applied. */
  get expectNext(): number | null {
    return this.#expectNext;
  }

  /** Oldest sequence still retained, or null. */
  get oldestRetained(): number | null {
    return this.#history.length === 0 ? null : this.#history[0]!.sequence;
  }

  /** Ticks currently retained, oldest first. */
  get retained(): readonly Tick[] {
    return this.#history;
  }

  /** Ticks and seams currently retained, oldest first. */
  get entries(): readonly RecordEntry[] {
    return this.#entries;
  }

  /** Every discontinuity this follower has replicated, oldest first. */
  get seams(): readonly SeamMarker[] {
    return this.#seams;
  }

  /**
   * Whether a window crosses a recorded discontinuity.
   *
   * The settlement path needs to be able to ask. ADR-0010's criterion is that no
   * unobserved interval may span a contract, and a contract whose entry and
   * expiry sit either side of a seam cannot be settled honestly against a record
   * that was not being written in between.
   */
  spansSeam(from: EpochMillis, to: EpochMillis): boolean {
    // **Cycle Audit 5.** This required the window to *contain* the seam
    // (`from <= last && to >= resumes`), so a contract with one endpoint inside
    // the gap was reported clean — while `priceAt` refused to answer for that
    // same instant. The two contradicted each other, and the permissive one was
    // the one whose docstring says the settlement path needs to be able to ask.
    //
    // Overlap is the right test. A window that touches an interval in which no
    // node was generating cannot be settled honestly against it, whether it
    // covers the whole gap or one edge of it.
    return this.#seams.some((seam) => {
      if (seam.lastInstant === null) return false;
      return from < seam.resumesAtInstant && to > seam.lastInstant;
    });
  }

  /**
   * Read the record forward and apply what is there.
   *
   * Returns the number of entries applied. Applying nothing means the follower
   * is current, which is an ordinary state and not an error.
   */
  async pull(log: ReplicationLog, limit = 4_096): Promise<number> {
    const entries = await log.readRecord(this.assetId, this.#expectNext ?? 1, limit);
    this.apply(entries);
    return entries.length;
  }

  /**
   * Apply entries that continue this follower exactly.
   *
   * Refuses a gap rather than closing it. A follower that guessed would serve
   * the guess to every observer reaching this node, and none of them could tell.
   */
  apply(entries: readonly RecordEntry[]): void {
    if (entries.length === 0) return;
    for (const entry of entries) {
      if (entry.kind === 'seam') {
        const seam = entry.seam;
        if (seam.lastSequence !== this.#head) {
          throw new ReplicationGapError(this.assetId, this.#head ?? 0, seam.lastSequence ?? 0);
        }
        this.#seams.push(seam);
        this.#entries.push(entry);
        this.#expectNext = seam.resumesAtSequence;
        continue;
      }
      const tick = entry.tick;
      const expected = this.#expectNext ?? tick.sequence;
      if (tick.sequence !== expected) {
        throw new ReplicationGapError(this.assetId, expected, tick.sequence);
      }
      this.#entries.push(entry);
      this.#history.push(tick);
      this.#head = tick.sequence;
      this.#expectNext = tick.sequence + 1;
    }
    this.#evict();
  }

  /**
   * Trim to the retention window, counting ticks.
   *
   * A seam is dropped only once every tick before it has gone. A retained seam
   * still tells a client that the window it is asking about has a hole in it,
   * which is worth more than the space it costs.
   */
  #evict(): void {
    const excess = this.#history.length - this.#retainTicks;
    if (excess <= 0) return;
    this.#history.splice(0, excess);
    const oldest = this.#history[0]!.sequence;
    let drop = 0;
    while (drop < this.#entries.length) {
      const entry = this.#entries[drop]!;
      if (entry.kind === 'tick' && entry.tick.sequence >= oldest) break;
      if (entry.kind === 'seam' && entry.seam.resumesAtSequence >= oldest) break;
      drop += 1;
    }
    if (drop > 0) this.#entries.splice(0, drop);
  }

  /**
   * Answer a client asking for everything from `fromSequence` onwards.
   *
   * `recordHead` is the shared record's newest sequence, which the caller reads
   * from the store. It is what separates "this follower is behind" from "no such
   * sequence exists anywhere", and a follower cannot tell them apart alone.
   */
  serve(fromSequence: number, recordHead: number | null): ServeResult {
    if (!Number.isInteger(fromSequence) || fromSequence < 1) {
      throw new RangeError(`A sequence must be a positive integer, received ${fromSequence}.`);
    }
    if (recordHead !== null && fromSequence > recordHead + 1) {
      return { kind: 'unknown', requested: fromSequence, recordHead };
    }
    if (recordHead === null) {
      // Nothing has ever been recorded for this asset, so any request is for a
      // sequence that does not exist — except the very first, which is the
      // ordinary "send me what comes next".
      return fromSequence === 1
        ? { kind: 'entries', entries: [] }
        : { kind: 'unknown', requested: fromSequence, recordHead: null };
    }
    const head = this.#head;
    if (head === null || fromSequence > head + 1) {
      return { kind: 'lagging', followerHead: head, recordHead };
    }
    const oldest = this.oldestRetained;
    if (oldest !== null && fromSequence < oldest) {
      // A fourth answer, and it has to be its own. The sequence existed, this
      // follower no longer holds it, and it is neither a lag the client should
      // wait out nor a phantom it should reset over. Collapsing it into either
      // would tell the client to do the wrong thing.
      return { kind: 'evicted', requested: fromSequence, oldestRetained: oldest };
    }
    // Entries, not ticks: a client reading across a discontinuity is given the
    // seam. Two runs of ticks with nothing between them would let it interpolate
    // across a window in which no node was generating.
    return {
      kind: 'entries',
      entries: this.#entries.slice(lowerBound(this.#entries, fromSequence)),
    };
  }

  /**
   * The price in force at an instant: the last tick at or before it.
   *
   * Null before the follower's first retained tick, because a price it has not
   * been given is not a price it may invent — that would be exactly the
   * follower-generates-quietly failure this module exists to make impossible.
   *
   * Null inside a recorded seam too. Reporting the pre-seam price there would
   * answer for a window in which nothing was published and no node was
   * generating: ADR-0010's refusal applied to a read rather than a write. This
   * is narrow on purpose — an instant past the newest tick still reports the
   * newest price, because an idle market between ticks is not a discontinuity.
   */
  priceAt(instant: EpochMillis): LogPrice | null {
    for (const seam of this.#seams) {
      if (
        seam.lastInstant !== null &&
        instant > seam.lastInstant &&
        instant < seam.resumesAtInstant
      ) {
        return null;
      }
    }
    let answer: LogPrice | null = null;
    for (const tick of this.#history) {
      if (tick.instant > instant) break;
      answer = tick.price;
    }
    return answer;
  }
}
