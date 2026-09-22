import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, yieldToLoop, type Tick } from '@otc/core';
import { tickGranularity } from '@otc/lab';
import { ASSET_CATALOGUE, configFor, createMarketEngine } from '@otc/engine';

/**
 * PH-24.17's outcome, guarded — which it was not (Cycle Audit 8, a5).
 *
 * The Human Owner's complaint was visible: candles opening far from the
 * previous close, because a one-minute candle held a few dozen ticks. PH-24.17
 * re-authored the catalogue's tempo to fix it and stated an acceptance
 * criterion — ticks per candle up, boundary gaps down — and then verified the
 * *inputs*: the traits, the tie rates, the variance per millisecond. Nothing in
 * the repository asserted a threshold on the thing the subphase existed for, so
 * a re-authoring that coarsened the grain again would pass every test.
 *
 * The thresholds below are the measured values with room, per asset, not a
 * round number: a guard that fails on the shipped catalogue is a guard that
 * gets deleted, and one an order of magnitude away is a guard that never fires.
 * They are checked on six hours of each market's own life, from its own
 * configuration — the same path `apps/api` composes.
 */
const SPAN_MS = 6 * 3_600_000;
const WARM_UP_MS = 600_000;

/** Ticks over one span of a market's life, from the shipped configuration. */
async function span(id: string): Promise<Tick[]> {
  const asset = ASSET_CATALOGUE.find((a) => a.definition.id === id)!;
  const engine = createMarketEngine({
    config: configFor(asset),
    keyring: MasterKeyring.forTesting(`granularity-${id}`),
    environment: 'simulation',
    start: { instant: epochMillis(1_788_000_000_000), price: logPrice(0) },
  });
  const ticks: Tick[] = [];
  let sinceYield = 0;
  for (;;) {
    const tick = engine.next();
    if (tick === null) break;
    const elapsed = tick.instant - 1_788_000_000_000;
    if (elapsed > WARM_UP_MS + SPAN_MS) break;
    if (elapsed >= WARM_UP_MS) ticks.push(tick);
    sinceYield += 1;
    if (sinceYield >= 250_000) {
      sinceYield = 0;
      await yieldToLoop();
    }
  }
  return ticks;
}

describe('the candles the recalibration was for', () => {
  it.each(ASSET_CATALOGUE.map((a) => [a.definition.id] as const))(
    '%s prints enough ticks per candle, and opens near the previous close',
    async (id) => {
      const report = tickGranularity(await span(id));
      console.log(
        `${id}: ${String(report.minutes)} candles, median ${String(report.ticksPerMinute.median)} ticks, ` +
          `gap/range ${report.gapOverRange.median.toFixed(4)}, ` +
          `above a quarter ${(report.gapOverRange.shareAboveQuarter * 100).toFixed(1)}%`,
      );
      expect(report.minutes, `${id} produced too few complete candles to judge`).toBeGreaterThan(
        300,
      );
      // **PH-34 cut the catalogue's tick rate by 40%, by the Human Owner's
      // decision, and these bands follow the measurement.** Median ticks a
      // candle across the thirty on 2026-09-22: 53 (eurusd, the worst) to 367
      // (mmx), against 53-366 before at three to four times the rate on the
      // fastest assets — the calm forex pairs carry the whole cut. It is still
      // far above the 17-40 the Human Owner was looking at when PH-24.17
      // started, which is what this file is for.
      expect(
        report.ticksPerMinute.median,
        `${id} prints ${String(report.ticksPerMinute.median)} ticks in a median candle`,
      ).toBeGreaterThanOrEqual(45);
      // The gap that started it: |open − previous close| over the candle's own
      // range. Fewer ticks a candle means a wider gap, and PH-34's bands are
      // its measurement: worst 0.0778 (gbpusd), 0.062 (eurusd), the crypto
      // assets at 0.023-0.037. Before PH-24.17 the same metric read 0.08-0.15.
      expect(
        report.gapOverRange.median,
        `${id} opens ${report.gapOverRange.median.toFixed(4)} of a candle from the previous close`,
      ).toBeLessThanOrEqual(0.09);
      expect(
        report.gapOverRange.shareAboveQuarter,
        `${id} has ${(report.gapOverRange.shareAboveQuarter * 100).toFixed(1)}% of candles gapping past a quarter of their range`,
        // Worst 8.1% (gbpusd) at PH-34's rates, against 16-31% before PH-24.17.
      ).toBeLessThanOrEqual(0.1);
    },
    900_000,
  );
});
