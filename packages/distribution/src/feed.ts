import type { Tick } from '@otc/core';

/**
 * Ticks are addressed by **sequence**, never by time.
 *
 * Time is ambiguous here in a way sequence is not: arrivals are irregular, two
 * nodes' clocks differ, and a client's notion of "now" is its own. A sequence
 * number is the one identifier every party agrees on, which is what resumption,
 * replay and deduplication all need.
 *
 * It is also why PH-5's sequence *leasing* matters at this layer. Before Cycle
 * Audit 2 a restart seam restarted numbering at 1; two clients reconstructing
 * across that seam would have held irreconcilable histories with no way to
 * detect the disagreement.
 */
export interface FeedSink {
  /**
   * Deliver ticks, in order.
   *
   * Return `false` to say the sink cannot accept them. The feed then **closes
   * the subscription** rather than dropping, coalescing, or skipping ahead —
   * see {@link TickFeed} for why those are all the same bug.
   */
  deliver(assetId: string, ticks: readonly Tick[]): boolean;
  /** The subscription has ended, and why. */
  close(reason: string): void;
}

export interface Subscription {
  readonly assetId: string;
  /** Sequence the subscriber has been delivered through, or null before any. */
  readonly deliveredThrough: number | null;
  readonly active: boolean;
  cancel(reason?: string): void;
}

/**
 * Thrown when a client asks for a sequence the feed has never published.
 *
 * Found by Cycle Audit 3. The feed refused history it had *lost* but accepted a
 * future it had never *had*: asking for sequence 600 when 100 existed returned an
 * empty array, indistinguishable from "you are up to date". A client in that
 * state holds ticks the server never published — it is following a different
 * market, or a different asset id — and silence lets it sit there indefinitely
 * believing it is current.
 *
 * Refusing both directions is the same principle applied symmetrically: the feed
 * never guesses about a record it cannot account for.
 */
export class UnknownSequenceError extends Error {
  constructor(
    readonly assetId: string,
    readonly requested: number,
    readonly newestPublished: number,
  ) {
    super(
      `Sequence ${requested} for ${assetId} has never been published; the newest is ` +
        `${newestPublished}. A client asking for it is not behind — it is holding a record ` +
        `this feed did not produce.`,
    );
    this.name = 'UnknownSequenceError';
  }
}

/** Thrown when a client asks for history the feed no longer retains. */
export class EvictedError extends Error {
  constructor(
    readonly assetId: string,
    readonly requested: number,
    readonly oldestRetained: number,
  ) {
    super(
      `Sequence ${requested} for ${assetId} is older than the retained window, which ` +
        `starts at ${oldestRetained}. The feed will not guess at what it no longer has.`,
    );
    this.name = 'EvictedError';
  }
}

export interface TickFeedOptions {
  /**
   * Ticks retained per asset for replay.
   *
   * Retention is bounded and the bound is explicit, because the alternative —
   * quietly truncating — turns a resumable feed into one that silently skips.
   * A client asking for something evicted gets an error it can act on.
   */
  readonly retainTicks?: number;
}

export const DEFAULT_RETAIN_TICKS = 50_000;

/**
 * The sequence of the first tick any market publishes.
 *
 * The only sequence an asset with no history can legitimately be asked for:
 * "send me what comes next" when nothing has come yet. Every other request of
 * an empty feed claims ticks that were never published (a5-09).
 */
export const FIRST_SEQUENCE = 1;

/**
 * Ordered, gapless, resumable distribution of one market to many observers.
 *
 * The design decision worth stating is what happens to a client that cannot keep
 * up. The tempting responses — drop ticks, coalesce them, send the latest price
 * instead of the next one — all give that client a *different market*, and it is
 * invisible to them, because a client cannot know what it never received. That
 * is INV-002 broken in the one place nobody looks.
 *
 * So there are exactly two acceptable outcomes: every tick in order, or
 * disconnection with a reason and a sequence to resume from.
 */
export class TickFeed {
  readonly #retainTicks: number;
  readonly #history = new Map<string, Tick[]>();
  readonly #subscriptions = new Map<string, Set<InternalSubscription>>();

  constructor(options: TickFeedOptions = {}) {
    this.#retainTicks = options.retainTicks ?? DEFAULT_RETAIN_TICKS;
    if (!Number.isInteger(this.#retainTicks) || this.#retainTicks < 1) {
      throw new RangeError(
        `retainTicks must be a positive integer, received ${this.#retainTicks}.`,
      );
    }
  }

  /** Sequence range currently retained for an asset. */
  retained(assetId: string): { oldest: number; newest: number } | null {
    const history = this.#history.get(assetId);
    if (history === undefined || history.length === 0) return null;
    return { oldest: history[0]!.sequence, newest: history[history.length - 1]!.sequence };
  }

  /**
   * Record ticks and fan them out.
   *
   * Ticks must arrive in strictly increasing sequence order. A gap here would be
   * propagated to every observer, so it is refused rather than published: the
   * feed cannot invent what the runtime did not give it.
   */
  publish(assetId: string, ticks: readonly Tick[]): void {
    if (ticks.length === 0) return;
    const history = this.#history.get(assetId) ?? [];
    let previous = history.length > 0 ? history[history.length - 1]!.sequence : null;
    for (const tick of ticks) {
      if (previous !== null && tick.sequence !== previous + 1) {
        throw new RangeError(
          `Feed for ${assetId} received sequence ${tick.sequence} after ${previous}: a gap or ` +
            `reordering here would reach every observer.`,
        );
      }
      previous = tick.sequence;
      history.push(tick);
    }
    if (history.length > this.#retainTicks) {
      history.splice(0, history.length - this.#retainTicks);
    }
    this.#history.set(assetId, history);

    for (const subscription of this.#subscriptions.get(assetId) ?? []) {
      subscription.push(ticks);
    }
  }

  /** Retained ticks from `fromSequence` onwards, inclusive. */
  since(assetId: string, fromSequence: number): readonly Tick[] {
    const history = this.#history.get(assetId) ?? [];
    if (history.length === 0) {
      // **a5-09.** The empty case returned [] for any sequence, so the
      // Cycle Audit 3 refusal below did not apply "symmetrically" as the error
      // type claims: a client asking for 600 of an asset that had published
      // nothing was accepted silently and told it was current. With nothing
      // published, the newest sequence is the one before the first.
      if (fromSequence !== FIRST_SEQUENCE) {
        throw new UnknownSequenceError(assetId, fromSequence, FIRST_SEQUENCE - 1);
      }
      return [];
    }
    const oldest = history[0]!.sequence;
    if (fromSequence < oldest) {
      throw new EvictedError(assetId, fromSequence, oldest);
    }
    const newest = history[history.length - 1]!.sequence;
    // `newest + 1` is legitimate: it means "I have everything, send me what comes
    // next". Anything beyond that is a client claiming ticks that do not exist.
    if (fromSequence > newest + 1) {
      throw new UnknownSequenceError(assetId, fromSequence, newest);
    }
    const offset = fromSequence - oldest;
    return history.slice(Math.max(0, offset));
  }

  /**
   * Subscribe, optionally replaying from a sequence the client already has.
   *
   * `fromSequence` is the next sequence the client wants. Passing the value it
   * was last delivered plus one resumes exactly; passing something evicted is an
   * error rather than a silent jump forward.
   */
  subscribe(assetId: string, sink: FeedSink, fromSequence?: number): Subscription {
    const subscription = new InternalSubscription(assetId, sink, () => {
      this.#subscriptions.get(assetId)?.delete(subscription);
    });

    if (fromSequence !== undefined) {
      const backlog = this.since(assetId, fromSequence);
      if (backlog.length > 0) subscription.push(backlog);
    }
    if (subscription.active) {
      const set = this.#subscriptions.get(assetId) ?? new Set<InternalSubscription>();
      set.add(subscription);
      this.#subscriptions.set(assetId, set);
    }
    return subscription;
  }

  /** Live subscriptions for an asset. */
  subscriberCount(assetId: string): number {
    return this.#subscriptions.get(assetId)?.size ?? 0;
  }
}

class InternalSubscription implements Subscription {
  #deliveredThrough: number | null = null;
  #active = true;

  constructor(
    readonly assetId: string,
    private readonly sink: FeedSink,
    private readonly detach: () => void,
  ) {}

  get deliveredThrough(): number | null {
    return this.#deliveredThrough;
  }

  get active(): boolean {
    return this.#active;
  }

  push(ticks: readonly Tick[]): void {
    if (!this.#active) return;
    // Never skip forward to "catch up": a subscriber that has fallen behind is
    // disconnected, not fast-forwarded past ticks it has not seen.
    const accepted = this.sink.deliver(this.assetId, ticks);
    if (!accepted) {
      this.cancel('backpressure: the sink could not accept delivery');
      return;
    }
    this.#deliveredThrough = ticks[ticks.length - 1]!.sequence;
  }

  cancel(reason = 'cancelled'): void {
    if (!this.#active) return;
    this.#active = false;
    this.detach();
    this.sink.close(reason);
  }
}
