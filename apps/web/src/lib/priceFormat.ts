/**
 * How a price is handed to the chart library, and why it is two functions.
 *
 * ## The defect these exist to prevent
 *
 * The Human Owner opened the panel on 2026-09-02 and found two price labels
 * reading `1.91146.5` and `1.87649.8` — numbers with **two decimal points**,
 * which are not numbers. The prices behind them were fine (1.07911465 and
 * 1.07876498, both inside the visible range); it was the rendering that broke.
 *
 * Lightweight Charts builds its formatter as
 * `new PriceFormatter(10 ** precision, minMove * 10 ** precision)` and then
 * renders the fractional part as
 *
 * ```
 * numberToStringWithLeadingZero(fracPart * minMove, precision)
 *   // ('0000000000000000' + value.toString()).slice(-precision)
 * ```
 *
 * The panel declared `precision: 7` with a hard-coded `minMove: 1e-8`. Those
 * two disagree, so `fracPart * minMove` came out as `791146.5` rather than an
 * integer, its `toString()` carried a decimal point of its own, and the
 * left-pad-then-slice cut the string in the middle of it:
 *
 * ```
 * ('0000000000791146.5').slice(-7)  ->  '91146.5'  ->  '1.' + '91146.5'
 * ```
 *
 * Two conditions have to hold for that to be impossible, and neither is
 * obvious from the call site — which is why they are here, named, with a test
 * on each:
 *
 * 1. **`minMove` is `10^-precision`.** Any other value makes the library's
 *    internal base disagree with the digit count it pads to.
 * 2. **The price carries no more decimals than the precision declares.** A
 *    live tick converts to a full-precision float; a candle from history does
 *    too. Only the last one is ever rendered as text, which is why the axis and
 *    the candles looked right while the two badges did not.
 *
 * The second is worth doing on its own account. `displayPrecision` is the
 * precision the asset's lattice settles on, so a price shown with more digits
 * than that is showing a movement no contract can settle against.
 */

/** The finest lattice the core will accept, and so the widest this may go. */
const MAX_DISPLAY_PRECISION = 18;

export interface PriceFormatOptions {
  readonly type: 'price';
  readonly precision: number;
  readonly minMove: number;
}

/**
 * The price format for an asset, with `minMove` derived rather than chosen.
 *
 * Derived, because the two numbers are one decision: the smallest movement the
 * asset can show is one unit of its last displayed digit.
 */
export function priceFormatFor(asset: { readonly displayPrecision: number }): PriceFormatOptions {
  const precision = asset.displayPrecision;
  if (!Number.isInteger(precision) || precision < 0 || precision > MAX_DISPLAY_PRECISION) {
    throw new RangeError(
      `displayPrecision must be an integer in [0, ${MAX_DISPLAY_PRECISION}], received ${precision}.`,
    );
  }
  return { type: 'price', precision, minMove: minMoveFor(precision) };
}

/** One unit of the last displayed digit: `10^-precision`, exactly. */
export function minMoveFor(precision: number): number {
  // `Number.parseFloat('1e-7')` rather than an exponent expression, so the
  // value is the exact double the literal denotes at every precision.
  return Number.parseFloat(`1e-${precision}`);
}

/**
 * A price rounded to the digits the asset actually shows.
 *
 * The chart is given this, never the raw conversion. Half-away-from-zero, which
 * is what `toFixed` does and what a reader expects; prices here are positive.
 */
export function toDisplayedPrice(price: number, precision: number): number {
  if (!Number.isFinite(price)) {
    throw new RangeError(`A displayed price must be finite, received ${price}.`);
  }
  return Number.parseFloat(price.toFixed(precision));
}
