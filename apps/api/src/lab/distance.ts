import type { Tick } from '@otc/core';
import { displayPrice } from '@otc/chart';
import type { RegisteredAsset } from '@otc/engine';

/**
 * The Lab's distance unit (PH-24.18): a quarter of the median range of the
 * market's own 1-minute candle, in lattice steps.
 *
 * Every control that used to count ticks or lattice steps says less than it
 * did since PH-24.17 made a tick smaller and more frequent. The candle is what
 * an operator sees, so distances are stated in it — and the candle is measured
 * on a fork of the market itself, never assumed from a family.
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
  readonly measuredAt: number;
}

const MINUTE_MS = 60_000;

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
  return { unitSteps, unitPrice, candleRangeSteps: range, minutes, measuredAt };
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
