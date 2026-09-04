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
import { selectClose, selectCloseWhere, type CloseSelection } from '@otc/engine';

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
  // Which two is decided from the nearest level and the side the request lies
  // on — no logarithm here. `Math.log` is not portable across engines
  // (CA7-14; the kernel uses its own `ln`), and the first version of this used
  // it; the guardrail caught it in the gate. The nearest level came from the
  // kernel's portable conversion, so everything below is integer arithmetic.
  const nearest = toDisplayPrice(spec, level);
  const lower = requested > nearest ? level : logPrice(level - 1);
  const upper = requested > nearest ? logPrice(level + 1) : level;
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
  /** The sign each of those ticks carries on the fork: the market's own path (PH-24.21). */
  readonly signs: readonly (1 | -1)[];
  /** Instant of the last tick inside the window, or null when there is none. */
  readonly lastInstant: EpochMillis | null;
  /**
   * Whether the walk stopped at its tick bound rather than at the instant asked
   * for (PH-24.2 by way of Cycle Audit 8). A plan computed on a truncated window
   * would describe a different market from the one the request named, so a
   * caller refuses rather than answering.
   */
  readonly truncated: boolean;
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
/**
 * The most ticks one request may make the Lab walk (Cycle Audit 8, a8).
 *
 * A fork never ends: `next()` keeps generating, so this loop was bounded only
 * by the instant asked for. `expiry=` takes any future instant a safe integer
 * can hold, and `bucket=next&timeframe=1d` asks for a day — 355,392 ticks at
 * EUR/USD's grain, against 12,438 for an hour. And the Lab process **is** the
 * engine (ADR-0018), on one thread: a walk of that size stops tick generation,
 * publication, `/health` and every other route for as long as it runs. One
 * unauthenticated GET measured 121 seconds of blocked event loop.
 *
 * Fifty thousand is about four hours of the fastest market in the catalogue and
 * two days of the slowest — far past any close an operator addresses, and far
 * short of an outage.
 */
export const LAB_MAX_WINDOW_TICKS = 50_000;

export function readWindow(
  fork: ForkSource,
  instant: EpochMillis,
  maxTicks: number = LAB_MAX_WINDOW_TICKS,
): CloseWindow {
  const steps: number[] = [];
  const signs: (1 | -1)[] = [];
  let price = fork.price;
  let lastInstant: EpochMillis | null = null;
  let truncated = false;
  for (;;) {
    if (steps.length >= maxTicks) {
      truncated = true;
      break;
    }
    const tick = fork.next();
    if (tick === null || tick.instant > instant) break;
    steps.push(Math.abs(tick.price - price));
    signs.push(tick.price >= price ? 1 : -1);
    price = tick.price;
    lastInstant = tick.instant;
  }
  return { instant, fromPrice: fork.price, steps, signs, lastInstant, truncated };
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

/** Where a close must end relative to a mark (PH-24.21). */
export type CloseCondition = 'exact' | 'above' | 'below';

export interface ConditionedClosePlan extends ClosePlan {
  readonly condition: 'above' | 'below';
  /** The mark, as a level. */
  readonly mark: LogPrice;
  /** The market's own path already ends on the asked side, and is what is armed. */
  readonly natural: boolean;
}

/**
 * Select a close on a side of a mark (PH-24.21).
 *
 * If the market's own path over the window already ends on that side, it is
 * the plan — armed as is, zero attempts: the market does what it was going to
 * do. Otherwise the first natural path whose close satisfies the side, by
 * rejection sampling (`selectCloseWhere`), so the endpoint is drawn from the
 * satisfying closes rather than glued to the mark. Parity never applies to a
 * side; the record keeps the level the chosen path ends on.
 */
export function planConditionedClose(
  spec: InstrumentSpec,
  mark: LogPrice,
  condition: 'above' | 'below',
  window: CloseWindow,
  random: RandomSource,
  maxAttempts = 200_000,
): ConditionedClosePlan {
  const bound = mark - window.fromPrice;
  const satisfies = (delta: number): boolean =>
    condition === 'above' ? delta > bound : delta < bound;
  const closeOf = (signs: readonly (1 | -1)[]): number =>
    window.steps.reduce((sum, step, i) => sum + signs[i]! * step, 0);
  const natural = satisfies(closeOf(window.signs));
  const selection: CloseSelection = natural
    ? {
        signs: [...window.signs],
        attempts: 0,
        acceptanceRate: 1,
        reachability: 'easy',
        impossible: null,
      }
    : selectCloseWhere({ steps: window.steps, satisfies, random, maxAttempts });
  const delta = selection.signs === null ? bound : closeOf(selection.signs);
  const target = logPrice(window.fromPrice + delta);
  const display = toDisplayPrice(spec, target).toFixed(spec.displayPrecision);
  return {
    target,
    display,
    window,
    delta,
    selection,
    reachableNeighbours: null,
    condition,
    mark,
    natural,
  };
}
