import type { Tick } from '@otc/core';
import { displayPrice } from '@otc/chart';
import type { RegisteredAsset } from '@otc/engine';

/**
 * Which half hour the unit was cut from.
 *
 * `record` is the market the operator is looking at: candles already published,
 * already on the chart. `fork` is the market's next half hour, which nobody has
 * seen. It is derived from the ticks — a label the caller passes is a label
 * that goes on being passed after the source it describes has changed.
 */
export type DistanceBasis = 'record' | 'fork';

/**
 * The Lab's distance unit (PH-24.18): a quarter of the median range of the
 * market's own 1-minute candle, in lattice steps.
 *
 * Every control that used to count ticks or lattice steps says less than it
 * did since PH-24.17 made a tick smaller and more frequent. The candle is what
 * an operator sees, so distances are stated in it — and the candle is measured
 * on the market itself, never assumed from a family.
 *
 * **Which half hour it is measured over is not a detail (Cycle Audit 8, a5).**
 * The median 1m range is strongly regime-dependent, so the market's next thirty
 * minutes and its last thirty minutes disagree by more than 2x about one
 * measurement in ten. The strip says «1 = ¼ vela», and the candles the operator
 * reads that against are the ones on the chart — the past. A unit cut from a
 * future nobody has seen makes «+3 unidades» move three times what the screen
 * suggests, or a third of it, with nothing on the screen saying so. So the
 * measurement carries {@link DistanceUnit.basis}, read from the ticks it was
 * given rather than declared by whoever passed them.
 */
export interface DistanceUnit {
  /** Lattice steps in one unit: a quarter of the median 1m range, at least one. */
  readonly unitSteps: number;
  /** The unit as a price difference at the current level, at display precision. */
  readonly unitPrice: string;
  /** The median 1m candle range the unit was cut from, in lattice steps. */
  readonly candleRangeSteps: number;
  /** Complete minutes the median was taken over. */
  readonly minutes: number;
  /** Whether those minutes are the published record's or a fork's future. */
  readonly basis: DistanceBasis;
  readonly measuredAt: number;
}

const MINUTE_MS = 60_000;

/**
 * How much of the record the median is taken over.
 *
 * Half an hour: enough complete minutes that a median is a median, and short
 * enough that it is still the regime on the screen rather than an average over
 * several. It is the same span the forward measurement used, so the two are
 * comparable when one is checked against the other.
 */
export const MEASUREMENT_SPAN_MS = 30 * MINUTE_MS;

/**
 * Complete minutes below which the record cannot answer for itself.
 *
 * A market that has just started, or one whose retained window has been
 * evicted, has no half hour to measure, and a median of two candles is not a
 * median. {@link recordWindow} returns nothing rather than a thin answer, so
 * the caller falls back to a fork and the unit says which it got.
 */
export const MIN_RECORD_MINUTES = 5;

/**
 * The tail of the published record the unit is measured over: the ticks of the
 * last {@link MEASUREMENT_SPAN_MS} at or before `at`.
 *
 * Given the whole retained window — 50,000 ticks per asset, which at PH-24.17's
 * grain is under three hours of BTC/USD and over ten of the S&P 500 — this is
 * what makes the measurement a fixed span of market time rather than whatever
 * the retention happens to hold.
 */
export function recordWindow(
  ticks: readonly Tick[],
  at: number,
  spanMs = MEASUREMENT_SPAN_MS,
): readonly Tick[] {
  const from = at - spanMs;
  const window: Tick[] = [];
  for (const tick of ticks) {
    if (tick.instant >= from && tick.instant <= at) window.push(tick);
  }
  return medianCandleRange(window).minutes < MIN_RECORD_MINUTES ? [] : window;
}

/** Median 1m candle range over complete minutes of a tick series, in lattice steps. */
export function medianCandleRange(ticks: readonly Tick[]): { range: number; minutes: number } {
  const buckets: { start: number; high: number; low: number }[] = [];
  for (const tick of ticks) {
    const start = Math.floor(tick.instant / MINUTE_MS) * MINUTE_MS;
    const last = buckets[buckets.length - 1];
    if (last === undefined || last.start !== start)
      buckets.push({ start, high: tick.price, low: tick.price });
    else {
      last.high = Math.max(last.high, tick.price);
      last.low = Math.min(last.low, tick.price);
    }
  }
  const complete = buckets.slice(1, -1);
  if (complete.length === 0) return { range: 0, minutes: 0 };
  const ranges = complete.map((b) => b.high - b.low).sort((a, b) => a - b);
  return { range: ranges[Math.floor(ranges.length / 2)]!, minutes: complete.length };
}

export function distanceUnitFrom(
  asset: RegisteredAsset,
  level: number,
  ticks: readonly Tick[],
  measuredAt: number,
): DistanceUnit {
  const { range, minutes } = medianCandleRange(ticks);
  const unitSteps = Math.max(1, Math.round(range / 4));
  const spec = {
    logQuantum: asset.instrument.logQuantum,
    referencePrice: asset.instrument.referencePrice,
    displayPrecision: asset.instrument.displayPrecision,
  };
  const unitPrice = (displayPrice(level + unitSteps, spec) - displayPrice(level, spec)).toFixed(
    asset.instrument.displayPrecision,
  );
  // A window whose last tick has not happened yet is a fork's; anything else is
  // the record's. Read here, once, from the only thing that cannot be stale.
  const last = ticks[ticks.length - 1];
  const basis: DistanceBasis = last !== undefined && last.instant > measuredAt ? 'fork' : 'record';
  return { unitSteps, unitPrice, candleRangeSteps: range, minutes, basis, measuredAt };
}

/** Units cached per market for a while: the candle does not change by the second. */
export class LabDistances {
  readonly #cache = new Map<string, DistanceUnit>();
  constructor(private readonly ttlMs = 5 * MINUTE_MS) {}

  cached(assetId: string, now: number): DistanceUnit | null {
    const unit = this.#cache.get(assetId);
    return unit !== undefined && now - unit.measuredAt < this.ttlMs ? unit : null;
  }

  remember(assetId: string, unit: DistanceUnit): DistanceUnit {
    this.#cache.set(assetId, unit);
    return unit;
  }
}
