import type { HorizonSpec } from './horizons.js';

/**
 * Direction outcomes at several horizons, accumulated as ticks arrive.
 *
 * ## Why streaming
 *
 * Policing the 15-minute horizon to the 0.2513 percentage points the promotional
 * payout implies needs on the order of 310,000 decided non-overlapping windows —
 * about 8.9 simulated years. `ObserverDataset` materialises instants and prices,
 * which at that length is roughly 2.4 GB per asset. The battery cannot be pointed
 * at a run this size.
 *
 * So the outcome is accumulated instead of stored. Memory is `O(horizons)`,
 * independent of how long the market runs, and the same pass serves every horizon
 * at once because one price path yields non-overlapping windows at all of them
 * simultaneously.
 *
 * ## What it gives up
 *
 * Everything the battery does. There is no history to condition on, no features,
 * no buckets, no learned family. This answers one narrow question — is the
 * unconditional direction a fair coin at this horizon — at a sample size the
 * battery cannot reach.
 *
 * That division is deliberate and it must not be blurred. A leak that needs the
 * battery's conditioning to see will not appear here, and a large clean number
 * from this instrument is **not** stronger evidence than a smaller clean number
 * from the battery. It is different evidence.
 *
 * ## Windows are non-overlapping, and that is load-bearing
 *
 * Each horizon advances its own boundary by exactly its own duration, so windows
 * tile the timeline rather than sliding along it. Overlapping windows share
 * increments and are therefore dependent, which would invalidate the independent
 * error bar every verdict is quoted with. `dependence.ts` measures whether the
 * independence actually holds.
 */
export interface HorizonOutcome {
  readonly horizon: string;
  readonly durationMs: number;
  /** Windows whose closing price was above the opening price. */
  readonly ups: number;
  readonly downs: number;
  /** Windows that closed at exactly the opening lattice price. */
  readonly ties: number;
  /** `ups + downs`: windows that settled a direction. */
  readonly decided: number;
  /** `ups + downs + ties`. */
  readonly windows: number;
  /** `ups / decided`, or NaN when nothing settled. */
  readonly upRate: number;
  /** `ties / windows`, the realised at-the-money rate. */
  readonly tieRate: number;
  /** Sum of |close − open| over completed windows. */
  readonly sumAbsoluteReturn: number;
  /** Sum of (close − open)² over completed windows: the path's total variance. */
  readonly sumSquaredReturn: number;
}

interface HorizonState {
  readonly spec: HorizonSpec;
  boundary: number;
  open: number;
  ups: number;
  downs: number;
  ties: number;
  sumAbs: number;
  sumSquared: number;
}

export class HorizonAccumulator {
  readonly #states: HorizonState[];
  /** Last price observed, which is the price at or before any boundary crossed. */
  #last: number;
  #ticks = 0;
  #lastInstant: number;

  constructor(horizons: readonly HorizonSpec[], startInstant: number, startPrice: number) {
    if (horizons.length === 0) {
      throw new RangeError('An accumulator needs at least one horizon.');
    }
    if (!Number.isFinite(startInstant)) {
      throw new RangeError(`Start instant must be finite, received ${startInstant}.`);
    }
    this.#last = startPrice;
    this.#lastInstant = startInstant;
    this.#states = horizons.map((spec) => ({
      spec,
      boundary: startInstant + spec.durationMs,
      open: startPrice,
      ups: 0,
      downs: 0,
      ties: 0,
      sumAbs: 0,
      sumSquared: 0,
    }));
    this.#startPrice = startPrice;
  }

  readonly #startPrice: number;

  /**
   * Net displacement of the whole path so far, in lattice steps.
   *
   * Load-bearing for interpreting a multi-horizon result. Non-overlapping window
   * returns **telescope**: at every horizon they sum to this one number. So a
   * path that happens to end up displaced biases the up-rate at *every* horizon
   * in the same direction, and the eight horizon tests on one path are close to
   * one test rather than eight.
   *
   * PH-11.2 found btcusd positive at all eight horizons and needed to know
   * whether that was a leak or a property of measuring one realisation. See
   * {@link HorizonOutcome.sumAbsoluteReturn} for the quantitative version.
   */
  get netDisplacement(): number {
    return this.#last - this.#startPrice;
  }

  /**
   * Observe one published tick.
   *
   * Ticks must arrive in non-decreasing instant order, which is what the engine
   * produces. A window closes at the last price published strictly before its
   * boundary — the same rule settlement uses, so a tally and a settlement cannot
   * disagree about which side a contract landed on.
   */
  observe(instant: number, price: number): void {
    if (instant < this.#lastInstant) {
      throw new RangeError(
        `Ticks must arrive in order: received instant ${instant} after ${this.#lastInstant}.`,
      );
    }
    for (const state of this.#states) {
      while (instant >= state.boundary) {
        const move = this.#last - state.open;
        if (move > 0) state.ups += 1;
        else if (move < 0) state.downs += 1;
        else state.ties += 1;
        state.sumAbs += Math.abs(move);
        state.sumSquared += move * move;
        state.open = this.#last;
        state.boundary += state.spec.durationMs;
      }
    }
    this.#last = price;
    this.#lastInstant = instant;
    this.#ticks += 1;
  }

  get ticks(): number {
    return this.#ticks;
  }

  /** Windows completed at the horizon that has completed the fewest. */
  get slowestHorizonWindows(): number {
    let fewest = Number.POSITIVE_INFINITY;
    for (const state of this.#states) {
      const windows = state.ups + state.downs + state.ties;
      if (windows < fewest) fewest = windows;
    }
    return fewest === Number.POSITIVE_INFINITY ? 0 : fewest;
  }

  outcomes(): HorizonOutcome[] {
    return this.#states.map((state) => {
      const decided = state.ups + state.downs;
      const windows = decided + state.ties;
      return {
        horizon: state.spec.label,
        durationMs: state.spec.durationMs,
        ups: state.ups,
        downs: state.downs,
        ties: state.ties,
        decided,
        windows,
        upRate: decided === 0 ? Number.NaN : state.ups / decided,
        tieRate: windows === 0 ? Number.NaN : state.ties / windows,
        sumAbsoluteReturn: state.sumAbs,
        sumSquaredReturn: state.sumSquared,
      };
    });
  }
}
