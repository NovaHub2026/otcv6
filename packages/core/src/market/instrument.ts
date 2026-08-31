import { exp, ln } from '../math/portable.js';

/**
 * The canonical price is an **integer count of logarithmic units** (ADR-0004).
 *
 * Two properties follow from the representation rather than from discipline:
 *
 *  - **Proportional volatility is free.** A fixed integer step is a fixed ratio,
 *    so the same magnitude means the same percentage move at every price level.
 *    The generator therefore never consults the price, which removes the entire
 *    level-dependence attack surface — and price level is a sign-dependent
 *    quantity, so consulting it would break the symmetry theorem of ADR-0003.
 *  - **There is exactly one value.** The integer the generator accumulates is the
 *    integer that is published and the integer that settles. No rounding sits
 *    between them, which closes a channel worth up to 22 percentage points of
 *    directional edge at the 30-second horizon.
 */

declare const logPriceBrand: unique symbol;

/** Integer count of log units above the instrument's reference price. */
export type LogPrice = number & { readonly [logPriceBrand]: true };

export const ASSET_FAMILIES = ['forex', 'crypto', 'commodity', 'index', 'etf'] as const;
export type AssetFamily = (typeof ASSET_FAMILIES)[number];

export interface InstrumentSpec {
  /** Stable identifier, matching the stream-label component pattern. */
  readonly id: string;
  readonly family: AssetFamily;
  /**
   * Size of one lattice step in log space. Smaller means a finer grid, rarer
   * ties, and a smaller quantisation channel.
   *
   * Fixed per asset from simulation evidence at registration (PH-4), against the
   * FIRST PERCENTILE of that asset's volatility distribution rather than its
   * mean: volatility varies severalfold across regimes and is publicly
   * forecastable, so an adversary simply waits for the quiet state.
   */
  readonly logQuantum: number;
  /** Decimal places for rendering. Never used in a comparison. */
  readonly displayPrecision: number;
  /** Display price at lattice origin, i.e. at LogPrice 0. */
  readonly referencePrice: number;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function assertValidInstrument(spec: InstrumentSpec): void {
  if (!ID_PATTERN.test(spec.id)) {
    throw new RangeError(
      `Instrument id ${JSON.stringify(spec.id)} must match ${ID_PATTERN.source}.`,
    );
  }
  if (!ASSET_FAMILIES.includes(spec.family)) {
    throw new RangeError(`Unknown asset family ${JSON.stringify(spec.family)}.`);
  }
  if (!Number.isFinite(spec.logQuantum) || spec.logQuantum <= 0) {
    throw new RangeError(`logQuantum must be finite and positive, received ${spec.logQuantum}.`);
  }
  if (
    !Number.isInteger(spec.displayPrecision) ||
    spec.displayPrecision < 0 ||
    spec.displayPrecision > 18
  ) {
    throw new RangeError(
      `displayPrecision must be an integer in [0, 18], received ${spec.displayPrecision}.`,
    );
  }
  if (!Number.isFinite(spec.referencePrice) || spec.referencePrice <= 0) {
    throw new RangeError(
      `referencePrice must be finite and positive, received ${spec.referencePrice}.`,
    );
  }
}

export function logPrice(value: number): LogPrice {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`A canonical price must be a safe integer, received ${value}.`);
  }
  return value as LogPrice;
}

export function shift(price: LogPrice, steps: number): LogPrice {
  if (!Number.isSafeInteger(steps)) {
    throw new RangeError(`Lattice step count must be a safe integer, received ${steps}.`);
  }
  return logPrice(price + steps);
}

/**
 * Render a canonical price for display.
 *
 * Uses the portable `exp`: the platform one would make the published price
 * differ between machines and Node versions, which would defeat the entire
 * determinism layer.
 */
export function toDisplayPrice(spec: InstrumentSpec, price: LogPrice): number {
  return spec.referencePrice * exp(spec.logQuantum * price);
}

/** Nearest canonical price to a display price. Rounds half away from zero. */
export function fromDisplayPrice(spec: InstrumentSpec, display: number): LogPrice {
  if (!Number.isFinite(display) || display <= 0) {
    throw new RangeError(`Display price must be finite and positive, received ${display}.`);
  }
  const exact = ln(display / spec.referencePrice) / spec.logQuantum;
  return logPrice(Math.round(exact));
}

/** Formatted price string, for rendering only. */
export function formatDisplayPrice(spec: InstrumentSpec, price: LogPrice): string {
  return toDisplayPrice(spec, price).toFixed(spec.displayPrecision);
}

/**
 * Exact integer comparison. This is the settlement primitive: an outcome is
 * `compare(expiryPrice, entryPrice)`.
 *
 * `0` is a genuine tie, not a rounding artefact, and its handling is a product
 * rule. Since the architecture guarantees P(up) = P(down) exactly, a policy that
 * awards ties to the house is the only way this system can produce a directional
 * edge (ADR-0003 §3).
 */
export function compare(a: LogPrice, b: LogPrice): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Relative move from one canonical price to another, e.g. 0.01 for +1%. */
export function relativeMove(spec: InstrumentSpec, from: LogPrice, to: LogPrice): number {
  return exp(spec.logQuantum * (to - from)) - 1;
}

/** Log-space distance in lattice steps. */
export function stepsBetween(from: LogPrice, to: LogPrice): number {
  return to - from;
}
