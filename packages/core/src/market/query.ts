import type { EpochMillis } from '../time/instant.js';
import { logPrice, type LogPrice } from './instrument.js';

/**
 * The price in force at an instant: the last tick at or before it.
 *
 * A market that ticks irregularly has no tick at most instants, so "the price at
 * time t" needs a rule. This one is deterministic, identical for every observer,
 * and reproducible from the record — the three properties INV-002 and INV-009
 * require. It is also the rule a chart already implies: a candle's close is the
 * last price seen, not an interpolation toward the next one.
 *
 * Interpolating between ticks would invent prices the market never visited,
 * which is the same defect as synthesising a candle for an empty bucket.
 *
 * Binary settlement will be built on this in PH-6; the validation laboratory
 * uses it now so that what is attacked and what will settle are the same
 * quantity.
 */
export function priceAtOrBefore(
  instants: Float64Array,
  prices: Int32Array,
  instant: EpochMillis,
): { price: LogPrice; index: number } | null {
  const length = Math.min(instants.length, prices.length);
  if (length === 0 || instant < instants[0]!) return null;

  // Binary search for the last index whose instant is <= the target.
  let low = 0;
  let high = length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (instants[middle]! <= instant) low = middle;
    else high = middle - 1;
  }
  return { price: logPrice(prices[low]!), index: low };
}

/**
 * Index of the first tick at or after an instant, or `null` if none exists.
 * Used to place an entry on the tick grid without looking into the future.
 */
export function indexAtOrAfter(instants: Float64Array, instant: EpochMillis): number | null {
  const length = instants.length;
  if (length === 0 || instant > instants[length - 1]!) return null;
  let low = 0;
  let high = length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (instants[middle]! >= instant) high = middle;
    else low = middle + 1;
  }
  return low;
}
