import { epochMillis, type Clock, type EpochMillis, type Tick } from '@otc/core';
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
   * PH-5 does not decide where that line sits — it is a venue policy with
   * business consequences, and it is surfaced in the phase document rather than
   * chosen quietly here. This default exists so the runtime has defined
   * behaviour, and it is deliberately generous.
   */
  readonly maxCatchUpMs?: number;
}

/** Default catch-up bound: one hour. */
export const DEFAULT_MAX_CATCH_UP_MS = 3_600_000;

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
  #exhausted = false;

  constructor(options: HostedMarketOptions) {
    this.#engine = options.engine;
    this.#clock = options.clock;
    this.#maxCatchUpMs = options.maxCatchUpMs ?? DEFAULT_MAX_CATCH_UP_MS;
    if (!(this.#maxCatchUpMs > 0)) {
      throw new RangeError(`maxCatchUpMs must be positive, received ${this.#maxCatchUpMs}.`);
    }
  }

  /** The last tick published, or `null` before the first. */
  get lastPublished(): Tick | null {
    return this.#lastPublished;
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
    if (this.#lastPublished !== null) {
      const behind = now - this.#lastPublished.instant;
      if (behind > this.#maxCatchUpMs) {
        throw new CatchUpTooLargeError(behind, this.#maxCatchUpMs);
      }
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
