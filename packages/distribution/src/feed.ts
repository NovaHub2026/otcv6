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

/**
 * Ticks retained per asset, and what that costs.
 *
 * **Cycle Audit 7, CA7-33, re-measured by Cycle Audit 8 (a3).** The figures this
 * docstring carried — 105.1 bytes a tick, 5.01 MiB an asset, 501 MB at a hundred
 * — were 44% high and recorded no method, so nothing could tell whether they had
 * ever been true of this feed or had merely stopped being so. They are the
 * numbers PH-22 was sized from.
 *
 * Re-measured against the tick the engine actually publishes, whose `price` is
 * an integer count of log units (ADR-0004) and therefore a small integer V8
 * stores inline rather than a boxed double: **72.9 bytes retained per tick**, so
 * 50,000 ticks is **3.47 MiB per asset**, and PH-21's hundred-asset catalogue
 * holds **344 MiB** in this map alone — 15% of the 2,240 MB heap Node defaults to
 * on the machine that measured it, and 428 MiB of resident set. Roughly 645
 * assets exhausts the heap before any market state, history recorder,
 * publication buffer or framework overhead. Nothing configures a heap for the
 * service anywhere in the repository.
 *
 * **The method, because the spread between honest ones is a factor of forty.**
 * `heapUsed` after six forced collections, with this feed the only owner of the
 * ticks: 72.9 bytes. Charging the feed only what it adds when the ticks are
 * retained elsewhere as well: 8.8 bytes, the array slot and nothing else.
 * Resident set instead of heap: 348 bytes, which measures the allocator's arenas
 * rather than the window. The first answers the question this docstring asks —
 * what the retained window costs a process that hosts a catalogue — and it is
 * the one `feed.test.ts` re-measures on every run.
 *
 * The window itself is not changed here. It is the resume window every
 * reconnecting client depends on, and shrinking it silently trades a memory
 * problem for a correctness one.
 */
export const DEFAULT_RETAIN_TICKS = 50_000;

/**
 * Bytes retained per tick, and the figure every sizing claim above rests on.
 *
 * Pinned by the test that quotes it. The number it replaced was asserted nowhere
 * and read by nothing, so it went a whole cycle 44% wrong with the entire suite
 * green (a3) — a constant nothing reads is a comment with a type. What moves it
 * is the shape of `Tick`, a field costing 8 bytes as measured, so the test pins
 * the shape exactly and the bytes in a band rather than pretending a heap
 * measurement is exact across V8 versions.
 */
export const MEASURED_BYTES_PER_TICK = 73;

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
    // **Checked whole, then applied whole (Cycle Audit 7, CA7-32).** The first
    // version validated and appended in one pass, and `history` is the stored
    // array itself — so a batch that gapped halfway left the ticks before the
    // gap *retained but never delivered*: the throw skipped the fan-out, and no
    // current subscriber ever saw them again. Every observer of that asset was
    // then permanently behind the record by however many ticks preceded the
    // gap, silently, which is the exact shape INV-002 forbids.
    //
    // A refusal must leave the feed as it found it.
    for (const tick of ticks) {
      if (previous !== null && tick.sequence !== previous + 1) {
        throw new RangeError(
          `Feed for ${assetId} received sequence ${tick.sequence} after ${previous}: a gap or ` +
            `reordering here would reach every observer.`,
        );
      }
      previous = tick.sequence;
    }
    for (const tick of ticks) history.push(tick);
    if (history.length > this.#retainTicks) {
      history.splice(0, history.length - this.#retainTicks);
    }
    this.#history.set(assetId, history);

    for (const subscription of this.#subscriptions.get(assetId) ?? []) {
      subscription.push(ticks);
    }
  }

  /**
   * Stop carrying an asset: drop its retained ticks and close its subscribers.
   *
   * **Cycle Audit 7, CA7-35.** There was no way to do this, so a retired market
   * kept its full 50,000-tick window — 5 MB — for the life of the process, and
   * its subscribers were left holding a stream that would never produce another
   * tick. A venue that retires and registers over a long run leaked both.
   */
  forget(assetId: string, reason = 'asset retired'): void {
    for (const subscription of [...(this.#subscriptions.get(assetId) ?? [])]) {
      subscription.cancel(reason);
    }
    this.#subscriptions.delete(assetId);
    this.#history.delete(assetId);
  }

  /** Retained ticks from `fromSequence` onwards, inclusive. */
  since(assetId: string, fromSequence: number): readonly Tick[] {
    // **Cycle Audit 7, CA7-20.** Neither bound below compares true against
    // `NaN`, so a `NaN` fell through both and reached `history.slice(Math.max(0,
    // NaN))` — and `slice(NaN)` is `slice(0)`. A client resuming with a corrupt
    // sequence was handed **the entire retained window** as though it were a
    // continuation, rather than the refusal the whole resume contract is built
    // on. A fractional sequence was quietly floored, replaying a tick the
    // client already had.
    //
    // The HTTP edge has validated `?from=` strictly since CA6 — but `since` and
    // `subscribe` are this package's public surface, and the follower and every
    // in-process caller reach them without passing that edge.
    if (!Number.isSafeInteger(fromSequence) || fromSequence < 0) {
      throw new UnknownSequenceError(assetId, fromSequence, FIRST_SEQUENCE - 1);
    }
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
