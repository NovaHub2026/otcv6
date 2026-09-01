import type { EpochMillis, LogPrice, Tick } from '@otc/core';
import type { ReplicationLog } from './replication.js';

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
 * type exists. `UnknownSequenceError` tells a client asking beyond the
 * head that it "is not behind — it is holding a record this feed did not
 * produce", which is correct on one node and a false accusation across several:
 * a client that read sequence 8,000 from the leader and reconnected to a
 * follower at 7,950 holds a perfectly real record, and the follower is the one
 * behind. Sending it to reset a correct history would be the worst available
 * answer.
 */
export type ServeResult =
  | { readonly kind: 'ticks'; readonly ticks: readonly Tick[] }
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

/** Thrown when a follower is asked to apply ticks that do not continue it. */
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
  #history: Tick[] = [];
  /** Newest sequence ever applied, retained after eviction trims the array. */
  #head: number | null = null;

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

  /** Oldest sequence still retained, or null. */
  get oldestRetained(): number | null {
    return this.#history.length === 0 ? null : this.#history[0]!.sequence;
  }

  /** Everything currently retained, oldest first. */
  get retained(): readonly Tick[] {
    return this.#history;
  }

  /**
   * Read the record forward and apply what is there.
   *
   * Returns the number of ticks applied. Applying nothing means the follower is
   * current, which is an ordinary state and not an error.
   */
  async pull(log: ReplicationLog, limit = 4_096): Promise<number> {
    const from = this.#head === null ? 1 : this.#head + 1;
    const ticks = await log.readTicks(this.assetId, from, limit);
    this.apply(ticks);
    return ticks.length;
  }

  /**
   * Apply ticks that continue this follower exactly.
   *
   * Refuses a gap rather than closing it. A follower that guessed would serve
   * the guess to every observer reaching this node, and none of them could tell.
   */
  apply(ticks: readonly Tick[]): void {
    if (ticks.length === 0) return;
    for (const tick of ticks) {
      const expected = this.#head === null ? tick.sequence : this.#head + 1;
      if (tick.sequence !== expected) {
        throw new ReplicationGapError(this.assetId, expected, tick.sequence);
      }
      this.#history.push(tick);
      this.#head = tick.sequence;
    }
    if (this.#history.length > this.#retainTicks) {
      this.#history.splice(0, this.#history.length - this.#retainTicks);
    }
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
        ? { kind: 'ticks', ticks: [] }
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
    const offset = oldest === null ? 0 : fromSequence - oldest;
    return { kind: 'ticks', ticks: this.#history.slice(offset) };
  }

  /**
   * The price in force at an instant: the last tick at or before it.
   *
   * Null before the follower's first retained tick, because a price it has not
   * been given is not a price it may invent — that would be exactly the
   * follower-generates-quietly failure this module exists to make impossible.
   */
  priceAt(instant: EpochMillis): LogPrice | null {
    let answer: LogPrice | null = null;
    for (const tick of this.#history) {
      if (tick.instant > instant) break;
      answer = tick.price;
    }
    return answer;
  }
}
