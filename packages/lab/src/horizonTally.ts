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
 *
 * ## A window closes at the price settlement uses
 *
 * The last tick at or before the boundary — and when several ticks share the
 * boundary instant, the **last** of them, because that is what
 * `priceAtOrBefore` returns. A boundary is therefore final only once a tick has
 * arrived strictly after it; until then the window is scored provisionally from
 * the ticks seen so far, and a later tick at the same instant revises it
 * (out-of-band audit, a4-12). The engine cannot produce two ticks at one instant
 * — it floors intervals at 1 ms — but the observer boundary accepts an external
 * record that can, and the promise this class makes is agreement with
 * settlement, not agreement with the engine.
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
   * produces. A window closes at the last price published at or before its
   * boundary — the same rule settlement uses, so a tally and a settlement cannot
   * disagree about which side a contract landed on.
   *
   * **Cycle Audit 4.** An earlier version closed on `#last` before this tick
   * unconditionally, which excluded a tick landing exactly on the boundary —
   * while settlement's `priceAtOrBefore` includes it (`instants[i] <= instant`).
   * An auditor built the disagreeing case: a 30-second window scored a tie by
   * the tally and an UP by settlement. Measured frequency on the real engine: 6
   * windows in 18,939 at the 30-second horizon, about 0.03%, direction-neutral.
   *
   * **Out-of-band audit, a4-12.** The Cycle Audit 4 repair closed the window on
   * the *first* tick to land on the boundary, and a second tick at the same
   * instant then passed unseen — while settlement returns the *last* of them.
   * So a boundary is closed here only once the clock has moved strictly past
   * it; `#last` is then the last tick at or before the boundary, whichever
   * tick that turns out to be. The window whose boundary is the latest instant
   * seen is scored provisionally by {@link outcomes}.
   */
  observe(instant: number, price: number): void {
    if (instant < this.#lastInstant) {
      throw new RangeError(
        `Ticks must arrive in order: received instant ${instant} after ${this.#lastInstant}.`,
      );
    }
    for (const state of this.#states) {
      while (state.boundary < instant) close(state, this.#last);
    }
    this.#last = price;
    this.#lastInstant = instant;
    this.#ticks += 1;
  }

  /**
   * A window's tallies, including the window whose boundary is exactly the
   * last observed instant.
   *
   * That window's closing price is the last tick seen — unless a further tick
   * arrives at the same instant, in which case the next call revises it. It is
   * counted here rather than left open so that a stream ending on a boundary
   * reports the window settlement would have settled.
   */
  #settled(
    state: HorizonState,
  ): Pick<HorizonState, 'ups' | 'downs' | 'ties' | 'sumAbs' | 'sumSquared'> {
    const settled = {
      ups: state.ups,
      downs: state.downs,
      ties: state.ties,
      sumAbs: state.sumAbs,
      sumSquared: state.sumSquared,
    };
    if (state.boundary <= this.#lastInstant) score(settled, this.#last - state.open);
    return settled;
  }

  get ticks(): number {
    return this.#ticks;
  }

  /** Windows completed at the horizon that has completed the fewest. */
  get slowestHorizonWindows(): number {
    let fewest = Number.POSITIVE_INFINITY;
    for (const state of this.#states) {
      const settled = this.#settled(state);
      const windows = settled.ups + settled.downs + settled.ties;
      if (windows < fewest) fewest = windows;
    }
    return fewest === Number.POSITIVE_INFINITY ? 0 : fewest;
  }

  outcomes(): HorizonOutcome[] {
    return this.#states.map((state) => {
      const settled = this.#settled(state);
      const decided = settled.ups + settled.downs;
      const windows = decided + settled.ties;
      return {
        horizon: state.spec.label,
        durationMs: state.spec.durationMs,
        ups: settled.ups,
        downs: settled.downs,
        ties: settled.ties,
        decided,
        windows,
        upRate: decided === 0 ? Number.NaN : settled.ups / decided,
        tieRate: windows === 0 ? Number.NaN : settled.ties / windows,
        sumAbsoluteReturn: settled.sumAbs,
        sumSquaredReturn: settled.sumSquared,
      };
    });
  }
}

/** Score one window's move into a tally. */
function score(
  tally: Pick<HorizonState, 'ups' | 'downs' | 'ties' | 'sumAbs' | 'sumSquared'>,
  move: number,
): void {
  if (move > 0) tally.ups += 1;
  else if (move < 0) tally.downs += 1;
  else tally.ties += 1;
  tally.sumAbs += Math.abs(move);
  tally.sumSquared += move * move;
}

/** Close a window at `closing` and open the next one there. */
function close(state: HorizonState, closing: number): void {
  score(state, closing - state.open);
  state.open = closing;
  state.boundary += state.spec.durationMs;
}
