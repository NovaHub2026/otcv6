import type { EpochMillis, Tick } from '@otc/core/browser';

/**
 * A client's view of the market, held as a bounded contiguous window.
 *
 * This is the browser-side counterpart of the feed's guarantees, and it exists
 * because a client can break INV-002 on its own even when the server is perfect.
 * Three ways, all of which look like ordinary client-side pragmatism:
 *
 * - accepting a batch that does not continue where the last one stopped, and
 *   drawing across the hole;
 * - keeping the newest N ticks by dropping from the middle when memory runs out;
 * - assuming that because the connection came back, no ticks were missed.
 *
 * So this window refuses a gap rather than absorbing it, evicts only from the
 * oldest end, and always knows the exact sequence to resume from. A backgrounded
 * tab is the ordinary case, not the exotic one: browsers throttle timers, the
 * socket stalls, and the client returns needing to know precisely what it missed.
 */
export interface TickWindowOptions {
  /** Maximum ticks retained. Eviction is from the oldest end only. */
  readonly capacity?: number;
}

export const DEFAULT_WINDOW_CAPACITY = 200_000;

export class ContiguityError extends Error {
  constructor(
    readonly expected: number,
    readonly received: number,
  ) {
    super(
      `Expected sequence ${expected} but received ${received}. The window will not draw across ` +
        `a hole: resume from ${expected} instead.`,
    );
    this.name = 'ContiguityError';
  }
}

export class TickWindow {
  readonly #capacity: number;
  #ticks: Tick[] = [];
  #evictedThrough: number | null = null;

  constructor(options: TickWindowOptions = {}) {
    this.#capacity = options.capacity ?? DEFAULT_WINDOW_CAPACITY;
    if (!Number.isInteger(this.#capacity) || this.#capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, received ${this.#capacity}.`);
    }
  }

  get size(): number {
    return this.#ticks.length;
  }

  /** Oldest and newest sequence retained, or null when empty. */
  get range(): { oldest: number; newest: number } | null {
    if (this.#ticks.length === 0) return null;
    return {
      oldest: this.#ticks[0]!.sequence,
      newest: this.#ticks[this.#ticks.length - 1]!.sequence,
    };
  }

  /**
   * The sequence to ask the server for after a disconnection.
   *
   * Never "the newest I have plus one, probably" — exactly that, and `undefined`
   * only when nothing has ever been received.
   */
  get resumeFrom(): number | undefined {
    const range = this.range;
    if (range !== null) return range.newest + 1;
    return this.#evictedThrough === null ? undefined : this.#evictedThrough + 1;
  }

  /**
   * Append a batch, refusing anything that does not continue the window.
   *
   * A gap here is not recoverable by drawing over it: the client would show a
   * line between two prices with no evidence about what happened between them,
   * which is the interpolation defect arriving through the network layer.
   */
  append(ticks: readonly Tick[]): void {
    if (ticks.length === 0) return;
    for (let i = 1; i < ticks.length; i += 1) {
      if (ticks[i]!.sequence !== ticks[i - 1]!.sequence + 1) {
        throw new ContiguityError(ticks[i - 1]!.sequence + 1, ticks[i]!.sequence);
      }
    }
    const range = this.range;
    if (range !== null && ticks[0]!.sequence !== range.newest + 1) {
      throw new ContiguityError(range.newest + 1, ticks[0]!.sequence);
    }
    this.#ticks.push(...ticks);

    if (this.#ticks.length > this.#capacity) {
      const dropping = this.#ticks.length - this.#capacity;
      // Oldest end only. Dropping from the middle to keep both ends would leave
      // a window that looks contiguous and is not.
      this.#evictedThrough = this.#ticks[dropping - 1]!.sequence;
      this.#ticks = this.#ticks.slice(dropping);
    }
  }

  /** Instants and prices, in the shape the reduction consumes. */
  series(): { instants: Float64Array; prices: Int32Array } {
    const instants = new Float64Array(this.#ticks.length);
    const prices = new Int32Array(this.#ticks.length);
    for (let i = 0; i < this.#ticks.length; i += 1) {
      instants[i] = this.#ticks[i]!.instant;
      prices[i] = this.#ticks[i]!.price;
    }
    return { instants, prices };
  }

  /** The latest tick, or null. */
  get latest(): Tick | null {
    return this.#ticks.length === 0 ? null : this.#ticks[this.#ticks.length - 1]!;
  }

  /** Wall-clock span currently held. */
  get span(): { from: EpochMillis; to: EpochMillis } | null {
    if (this.#ticks.length === 0) return null;
    return {
      from: this.#ticks[0]!.instant,
      to: this.#ticks[this.#ticks.length - 1]!.instant,
    };
  }
}
