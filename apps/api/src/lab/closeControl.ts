import {
  bucketEnd,
  epochMillis,
  fromDisplayPrice,
  logPrice,
  timeframe,
  toDisplayPrice,
  type EpochMillis,
  type InstrumentSpec,
  type LogPrice,
  type RandomSource,
  type TimeframeId,
} from '@otc/core';
import { selectClose, type CloseSelection } from '@otc/engine';

/**
 * Candle Close Control, on a real candle (PH-24.2).
 *
 * Three things are decided here and nowhere else, each with a test:
 *
 * 1. **What "close" means.** The price in force at the candle's end, inclusive
 *    (ADR-0017). The window is every tick up to and including one at that
 *    instant.
 * 2. **Where the window starts.** At the engine's current price — which is the
 *    pending tick's when one is drawn — and the vector begins with the draw
 *    that follows. A fork restored from `snapshotEngine()` yields exactly those
 *    ticks, because the snapshot is taken after the pending draw.
 * 3. **What a typed price is.** A lattice level or nothing: the nearest level is
 *    taken only if it renders back to what was typed; otherwise the two
 *    neighbouring lattice prices are returned and nothing is armed. Silent
 *    rounding would make "Close = 1.085100" a close at 1.085099.
 */

export type Bucket = 'current' | 'next';

/** A typed price that is a lattice level, or the two levels around it. */
export type TargetResolution =
  | { readonly kind: 'level'; readonly level: LogPrice; readonly display: string }
  | {
      readonly kind: 'between';
      readonly requested: string;
      readonly below: string;
      readonly above: string;
    };

/** A typed price, resolved against the asset's lattice. */
export function resolveTarget(spec: InstrumentSpec, priceText: string): TargetResolution {
  const requested = Number(priceText.trim());
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new RangeError(`A target price must be a positive number, received ${priceText}.`);
  }
  const level = fromDisplayPrice(spec, requested);
  const display = toDisplayPrice(spec, level).toFixed(spec.displayPrecision);
  if (display === requested.toFixed(spec.displayPrecision)) {
    return { kind: 'level', level, display };
  }
  // The nearest level did not render back to the request: it sits between two.
  const exact = Math.log(requested / spec.referencePrice) / spec.logQuantum;
  const lower = logPrice(Math.floor(exact));
  const upper = logPrice(Math.ceil(exact));
  return {
    kind: 'between',
    requested: requested.toFixed(spec.displayPrecision),
    below: toDisplayPrice(spec, lower).toFixed(spec.displayPrecision),
    above: toDisplayPrice(spec, upper).toFixed(spec.displayPrecision),
  };
}

/** The instant a close is defined at: the end of the current or the next bucket. */
export function closeInstant(
  now: EpochMillis,
  timeframeId: TimeframeId,
  bucket: Bucket,
): EpochMillis {
  const tf = timeframe(timeframeId);
  const end = bucketEnd(now, tf);
  return bucket === 'current' ? end : epochMillis(end + tf.durationMs);
}

export interface CloseWindow {
  /** Where the close is defined. */
  readonly instant: EpochMillis;
  /** The engine's price when the window was read: the pending tick's, if drawn. */
  readonly fromPrice: LogPrice;
  /** Unsigned lattice steps of every tick up to and including one at `instant`. */
  readonly steps: readonly number[];
  /** Instant of the last tick inside the window, or null when there is none. */
  readonly lastInstant: EpochMillis | null;
}

/** A source of the ticks a market will draw next, without drawing them for real. */
export interface ForkSource {
  readonly price: LogPrice;
  readonly instant: EpochMillis;
  next(): { readonly instant: EpochMillis; readonly price: LogPrice } | null;
}

/**
 * Read the window from a fork.
 *
 * Inclusive at `instant` (ADR-0017): a tick exactly at the candle's end is the
 * close. The fork is consumed up to the first tick beyond it.
 */
export function readWindow(fork: ForkSource, instant: EpochMillis): CloseWindow {
  const steps: number[] = [];
  let price = fork.price;
  let lastInstant: EpochMillis | null = null;
  for (;;) {
    const tick = fork.next();
    if (tick === null || tick.instant > instant) break;
    steps.push(Math.abs(tick.price - price));
    price = tick.price;
    lastInstant = tick.instant;
  }
  return { instant, fromPrice: fork.price, steps, lastInstant };
}

export interface ClosePlan {
  readonly target: LogPrice;
  readonly display: string;
  readonly window: CloseWindow;
  readonly delta: number;
  readonly selection: CloseSelection;
  /** When parity or range forbids the target: the two reachable neighbours, by price. */
  readonly reachableNeighbours: readonly string[] | null;
}

/**
 * Select a close for a resolved target over a read window.
 *
 * Parity halves the lattice (PH-23.1 §5). When the target is off-parity the
 * levels one step either side are on it, and they are named — an operator who
 * typed a price should be told which prices *are* reachable, not only that
 * theirs is not.
 */
export function planClose(
  spec: InstrumentSpec,
  target: LogPrice,
  window: CloseWindow,
  random: RandomSource,
  maxAttempts = 200_000,
): ClosePlan {
  const delta = target - window.fromPrice;
  const selection = selectClose({ steps: window.steps, delta, random, maxAttempts });
  const display = toDisplayPrice(spec, target).toFixed(spec.displayPrecision);
  const parityBlocked =
    selection.impossible !== null && /parity/.test(selection.impossible) && window.steps.length > 0;
  const reachableNeighbours = parityBlocked
    ? [
        toDisplayPrice(spec, logPrice(target - 1)).toFixed(spec.displayPrecision),
        toDisplayPrice(spec, logPrice(target + 1)).toFixed(spec.displayPrecision),
      ]
    : null;
  return { target, display, window, delta, selection, reachableNeighbours };
}
