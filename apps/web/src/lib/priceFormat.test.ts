import { describe, expect, it } from 'vitest';
import {
  minMoveFor,
  priceFormatFor,
  renderablePrecision,
  toDisplayedPrice,
} from './priceFormat.js';

/**
 * The label the Human Owner saw, reproduced.
 *
 * This is Lightweight Charts' own formatting algorithm, copied from the
 * installed `lightweight-charts@5` (`PriceFormatter._formatAsDecimal` and
 * `numberToStringWithLeadingZero`) so the defect can be reproduced without a
 * browser — the price scale is drawn on a canvas, so no DOM assertion can read
 * it and the browser suite cannot guard this.
 *
 * A copy of someone else's algorithm is a liability: it can drift from the
 * library it mirrors. It earns its place here because it turns "the options
 * disagree" from an abstract rule into the exact string a reader saw, and
 * because the two properties asserted below hold for any sane formatter, not
 * only for this one. If it ever drifts, the properties are still the contract.
 */
function renderLikeLightweightCharts(price: number, precision: number, minMove: number): string {
  const priceScale = 10 ** precision;
  const scaledMinMove = minMove * priceScale;
  let fractionalLength = 0;
  for (let base = priceScale; base > 1; base /= 10) fractionalLength += 1;
  const base = priceScale / scaledMinMove;
  let intPart = Math.floor(price);
  let fracString = '';
  if (base > 1) {
    let fracPart = Number((Math.round(price * base) - intPart * base).toFixed(fractionalLength));
    if (fracPart >= base) {
      fracPart -= base;
      intPart += 1;
    }
    const scaled = Number(fracPart.toFixed(fractionalLength)) * scaledMinMove;
    fracString = `.${`0000000000000000${scaled.toString()}`.slice(-fractionalLength)}`;
  }
  return `${String(intPart)}${fracString}`;
}

/** A label is a number: one decimal point, digits either side. */
const WELL_FORMED = /^\d+\.\d+$/;

describe('the price format the chart is given', () => {
  it('derives minMove as one unit of the last displayed digit', () => {
    for (let precision = 0; precision <= 18; precision += 1) {
      // The property the panel violated: the library pads to `precision` digits
      // and scales by `minMove * 10 ** precision`, so anything but 10^-precision
      // makes those two disagree.
      expect(minMoveFor(precision) * 10 ** precision, `precision ${precision}`).toBeCloseTo(1, 12);
    }
    expect(priceFormatFor({ displayPrecision: 7 })).toEqual({
      type: 'price',
      precision: 7,
      minMove: 1e-7,
    });
  });

  it('refuses a precision the core would not accept', () => {
    expect(() => priceFormatFor({ displayPrecision: 19 })).toThrow(RangeError);
    expect(() => priceFormatFor({ displayPrecision: -1 })).toThrow(RangeError);
    expect(() => priceFormatFor({ displayPrecision: 7.5 })).toThrow(RangeError);
  });

  it('rounds a price to the digits the asset shows, and no further', () => {
    // A live tick converts to a full-precision float. `displayPrecision` is the
    // precision the lattice settles on, so a digit past it is a movement no
    // contract can settle against.
    // 1.07911465 rounds *down* at seven digits, and that is not a mistake:
    // `toFixed` rounds the double, and the nearest double to 1.07911465 sits
    // just below the decimal a reader types. A half-way case in decimal is not
    // a half-way case in binary. It matters only in that an expectation written
    // from the decimal is wrong — which is how this line was first written.
    expect(toDisplayedPrice(1.07911465, 7)).toBe(1.0791146);
    expect(toDisplayedPrice(1.07876498, 7)).toBe(1.078765);
    expect(toDisplayedPrice(64123.456789, 2)).toBe(64123.46);
    expect(() => toDisplayedPrice(Number.NaN, 7)).toThrow(RangeError);

    for (const precision of [0, 2, 5, 7, 8]) {
      const rounded = toDisplayedPrice(1.0791146512345, precision);
      const decimals = (rounded.toString().split('.')[1] ?? '').length;
      expect(decimals, `precision ${precision}`).toBeLessThanOrEqual(precision);
    }
  });
});

describe('a price is not shown to more digits than it has (CA7-29)', () => {
  // An auditor registered `{referencePrice: 1e15, displayPrecision: 18}` — both
  // values inside their own bounds, the product inside neither — and the panel
  // printed `1000000000000099.864691128455135200`: 34 digits, roughly sixteen
  // of which are a price and the rest the binary residue of the double.
  it('caps the precision by the magnitude of the price', () => {
    expect(renderablePrecision(18, 1e15)).toBe(0);
    expect(renderablePrecision(18, 1e14)).toBe(1);
    expect(renderablePrecision(18, 100)).toBe(13);
    // Small prices keep every decimal they asked for: this is why the cap is
    // not a registration rule. Eighteen decimals is honest near 1e-15.
    expect(renderablePrecision(18, 1e-15)).toBe(18);
    expect(renderablePrecision(7, 1.08)).toBe(7);
    expect(renderablePrecision(2, 64_000)).toBe(2);
  });

  it('leaves an asset with no reference price exactly as it was', () => {
    expect(renderablePrecision(7, undefined)).toBe(7);
    expect(renderablePrecision(7, Number.NaN)).toBe(7);
    expect(renderablePrecision(7, 0)).toBe(7);
  });

  it('never renders more significant digits than a double carries', () => {
    for (const referencePrice of [1e15, 1e14, 1e9, 1_000, 100, 1, 0.01, 1e-9, 1e-15]) {
      const { precision } = priceFormatFor({ displayPrecision: 18, referencePrice });
      // Significant digits used = decimals shown + decimal exponent + 1. This
      // is the measure, not the integer-digit count: at 1e-15 an eighteen-decimal
      // display is four significant digits, and honest.
      const used = precision + Math.floor(Math.log10(referencePrice)) + 1;
      expect(used, `at ${referencePrice}`).toBeLessThanOrEqual(16);
    }
  });

  it('and the five catalogue assets are untouched by the cap', () => {
    // The cap must not quietly coarsen a real asset.
    for (const [referencePrice, displayPrecision] of [
      [1.08, 7],
      [64_000, 2],
      [2_409, 2],
      [195.5, 3],
    ] as const) {
      expect(priceFormatFor({ displayPrecision, referencePrice }).precision).toBe(displayPrecision);
    }
  });
});

describe('the malformed label of 2026-09-02', () => {
  // The two the Human Owner photographed, and one ordinary price that rendered
  // correctly all along — which is why nobody caught this until a live price
  // with eight decimals reached a badge.
  const observed = [
    { price: 1.07911465, broken: '1.91146.5' },
    { price: 1.07876498, broken: '1.87649.8' },
  ] as const;

  it('reproduces exactly what a mismatched minMove printed', () => {
    for (const { price, broken } of observed) {
      expect(renderLikeLightweightCharts(price, 7, 1e-8), `${price}`).toBe(broken);
      expect(broken).not.toMatch(WELL_FORMED);
    }
  });

  it('is well formed once minMove is derived from the precision', () => {
    for (const { price } of observed) {
      const { precision, minMove } = priceFormatFor({ displayPrecision: 7 });
      expect(renderLikeLightweightCharts(price, precision, minMove)).toMatch(WELL_FORMED);
    }
  });

  it('is well formed for every precision the catalogue uses, rounded or not', () => {
    // Both halves of the fix, over the precisions the five compiled assets and
    // the eight archetypes produce, at prices whose tail is longer than the
    // precision. Either half alone would have been enough for these; both are
    // asserted because each closes a different way in.
    const prices = [1.07911465, 1.0000000123, 64123.456789012, 0.9999999999, 2409.87654321];
    for (const precision of [0, 2, 4, 5, 7, 8]) {
      const { minMove } = priceFormatFor({ displayPrecision: precision });
      for (const raw of prices) {
        const shown = toDisplayedPrice(raw, precision);
        const label = renderLikeLightweightCharts(shown, precision, minMove);
        expect(label, `${raw} at precision ${precision}`).toMatch(
          precision === 0 ? /^\d+$/ : WELL_FORMED,
        );
      }
    }
  });
});
