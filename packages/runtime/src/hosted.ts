import { epochMillis, type Clock, type EpochMillis, type LogPrice, type Tick } from '@otc/core';
import type { MarketEngine } from '@otc/engine';

/**
 * A market that advances because time passed, rather than because something
 * asked it for a tick.
 *
 * This is the distinction the whole runtime turns on. `MarketEngine` produces
 * ticks as fast as it is called; each carries the instant it belongs to, and in
 * a test that instant is a label. Hosted, it is a deadline: a tick may only be
 * published once the clock has reached it, and it must be published even if
 * nobody asked, because the market did not stop while the process was busy.
 *
 * The consequence is that a hosted market is a function of the clock, not of how
 * often it is polled. Polling twice as often produces the same ticks at the same
 * instants; not polling for a minute produces a minute of ticks the moment it is
 * polled again. That is what makes the market the same for every observer
 * (INV-002) and continuous across interruptions (INV-008).
 */
export interface HostedMarketOptions {
  readonly engine: MarketEngine;
  readonly clock: Clock;
  /**
   * How far behind the clock this market may fall before catching up is refused.
   *
   * A bound is required because catch-up is unbounded work: the engine will
   * happily generate three weeks of a one-second market, and at 800k ticks per
   * second it would even do it quickly. But past some outage length the honest
   * statement is that the venue was closed, not that a month of prices happened
   * while nobody was watching.
   *
   * **Decided in PH-12.3** (ADR-0010), after being carried as an undecided
   * default since PH-5.
   *
   * The bound is **shorter than the shortest contract the product sells**, so a
   * catch-up burst can never contain both the entry and the expiry of any
   * contract. That is the criterion; 15 seconds is half of the 30-second
   * minimum expiry.
   *
   * It guards a *running* venue that lost the CPU — a suspended VM, a long
   * pause, a descheduled process. It does not guard restarts: `resumeMarket`
   * seams forward to now, so a restarted market has no backlog to replay.
   */
  readonly maxCatchUpMs?: number;
  /**
   * A tick drawn before a restart but never published.
   *
   * Restoring an engine snapshot alone would skip it: the snapshot is taken
   * after every draw, so the restored engine's next tick is the one *after* the
   * pending one. Resuming without this loses a tick silently, which is the
   * quietest way to break replay.
   */
  readonly resumePending?: Tick | null;
  /** The last tick published before a restart, if any. */
  readonly resumeLastPublished?:
    Tick | { sequence: number; instant: EpochMillis; price: LogPrice } | null;
}

/** Default catch-up bound: one hour. */
/**
 * Catch-up bound: 15 seconds, half the shortest expiry the product sells.
 *
 * The criterion is that **no burst may span a complete contract**. At 30 seconds
 * a single catch-up could generate a whole contract's lifetime at once — entry
 * and expiry both invented in a moment nobody observed — and the market's entire
 * product is a record people settle against.
 *
 * The previous value was an hour, chosen in PH-5 to give the runtime defined
 * behaviour while the policy was undecided. An hour means a venue starved for 59
 * minutes silently generates 59 minutes of market on its next advance, which is
 * the precise failure the bound exists to prevent.
 */
export const DEFAULT_MAX_CATCH_UP_MS = 15_000;

export class CatchUpTooLargeError extends Error {
  constructor(
    readonly behindMs: number,
    readonly limitMs: number,
  ) {
    super(
      `Market is ${Math.round(behindMs / 1000)}s behind the clock, past the ` +
        `${Math.round(limitMs / 1000)}s catch-up bound. Resuming would publish a ` +
        `gap this runtime is not authorised to invent.`,
    );
    this.name = 'CatchUpTooLargeError';
  }
}

export class HostedMarket {
  readonly #engine: MarketEngine;
  readonly #clock: Clock;
  readonly #maxCatchUpMs: number;

  /**
   * A tick that has been generated but is not yet due.
   *
   * The engine has no way to report when its next tick would fall without
   * producing it, so the runtime pulls one ahead and holds it. This is the only
   * state the runtime keeps about the future, and it is why `advance` can decide
   * whether anything is due without consuming a tick it would have to discard.
   */
  #pending: Tick | null = null;
  #lastPublished: Tick | null = null;
  #lastPublishedSequence: number | null = null;
  #lastPublishedInstant: EpochMillis | null = null;
  #lastPublishedPrice: LogPrice | null = null;
  #exhausted = false;

  /**
   * Where "behind" is measured from before anything has been published.
   *
   * Without it the catch-up bound was inert until the first tick: a fresh market
   * whose genesis sat a day in the past published 68,160 ticks against a
   * one-second bound without complaint, and a resumed market carrying a degraded
   * record published 19,018 ticks over a six-hour gap under the one-hour bound.
   */
  readonly #floorInstant: EpochMillis;

  constructor(options: HostedMarketOptions) {
    this.#engine = options.engine;
    this.#clock = options.clock;
    this.#floorInstant = options.engine.snapshot().instant;
    this.#pending = options.resumePending ?? null;
    const resumed = options.resumeLastPublished ?? null;
    if (resumed !== null) {
      this.#lastPublishedSequence = resumed.sequence;
      this.#lastPublishedInstant = resumed.instant;
      this.#lastPublishedPrice = resumed.price;
    }
    this.#maxCatchUpMs = options.maxCatchUpMs ?? DEFAULT_MAX_CATCH_UP_MS;
    if (!(this.#maxCatchUpMs > 0)) {
      throw new RangeError(`maxCatchUpMs must be positive, received ${this.#maxCatchUpMs}.`);
    }
  }

  /** The last tick published in this process, or `null` before the first. */
  get lastPublished(): Tick | null {
    return this.#lastPublished;
  }

  /**
   * Sequence of the last tick published, including one carried across a restart.
   *
   * Distinct from `lastPublished`, which is only the ticks this process emitted.
   * A resumed market has published history it never saw.
   */
  get lastPublishedSequence(): number | null {
    return this.#lastPublishedSequence;
  }

  /**
   * The last published tick, including one inherited across a restart.
   *
   * A resumed market has published history this process never saw. Reporting
   * `null` until it emits its own first tick would show a client an asset with
   * no price for up to several seconds after every deploy, which is wrong: the
   * price is known, it simply was not produced here.
   */
  get lastPublishedState(): { sequence: number; instant: EpochMillis; price: LogPrice } | null {
    if (this.#lastPublishedSequence === null) return null;
    return {
      sequence: this.#lastPublishedSequence,
      instant: this.#lastPublishedInstant!,
      price: this.#lastPublishedPrice!,
    };
  }

  /** The tick drawn but not yet due, if any. */
  get pending(): Tick | null {
    return this.#pending;
  }

  /** Latent engine state, for persistence. Carries cursors, never key material. */
  snapshotEngine(): ReturnType<MarketEngine['snapshot']> {
    return this.#engine.snapshot();
  }

  /** Whether the engine has reached its tick limit. */
  get exhausted(): boolean {
    return this.#exhausted;
  }

  /** The instant of the next tick, once one has been drawn. */
  get nextInstant(): EpochMillis | null {
    return this.#pending === null ? null : this.#pending.instant;
  }

  /**
   * Publish every tick now due, in order.
   *
   * Idempotent with respect to the clock: calling it repeatedly at the same
   * instant yields nothing after the first call.
   */
  advance(): Tick[] {
    return this.advanceTo(this.#clock.now());
  }

  /** Publish every tick due at or before `now`. */
  advanceTo(now: EpochMillis): Tick[] {
    const published: Tick[] = [];
    // Always defined: falls back to where the engine itself starts, so the bound
    // applies from the first call rather than from the first publication.
    const lastInstant =
      this.#lastPublished?.instant ?? this.#lastPublishedInstant ?? this.#floorInstant;
    const behind = now - lastInstant;
    if (behind > this.#maxCatchUpMs) {
      throw new CatchUpTooLargeError(behind, this.#maxCatchUpMs);
    }

    for (;;) {
      if (this.#pending === null) {
        if (this.#exhausted) break;
        const tick = this.#engine.next();
        if (tick === null) {
          this.#exhausted = true;
          break;
        }
        this.#pending = tick;
      }
      if (this.#pending.instant > now) break;
      this.#lastPublished = this.#pending;
      this.#lastPublishedSequence = this.#pending.sequence;
      this.#lastPublishedInstant = this.#pending.instant;
      this.#lastPublishedPrice = this.#pending.price;
      published.push(this.#pending);
      this.#pending = null;
    }
    return published;
  }

  /**
   * Milliseconds until the next tick is due, or `null` if none is known.
   *
   * A scheduler uses this rather than polling on a fixed interval: the assets in
   * the catalogue tick between about 330ms and 3.2s apart, so one interval would
   * be either wasteful or late.
   */
  msUntilNextTick(now: EpochMillis = this.#clock.now()): number | null {
    if (this.#pending === null) return null;
    return Math.max(0, this.#pending.instant - now);
  }

  /**
   * Prime the market so `nextInstant` is known without publishing anything.
   *
   * Safe to call before the clock has reached the first tick.
   */
  prime(): void {
    if (this.#pending !== null || this.#exhausted) return;
    const tick = this.#engine.next();
    if (tick === null) this.#exhausted = true;
    else this.#pending = tick;
  }

  /** Wall-clock start instant used when nothing has been published yet. */
  static startedAt(tick: Tick): EpochMillis {
    return epochMillis(tick.instant);
  }
}
