import type { TimeframeId } from '@otc/core';
import type { ObserverDataset } from './observer.js';

/**
 * Does this behave like a market at all?
 *
 * The attack battery has a trivial solution: a market that never moves passes
 * every attack, and so does a memoryless white-noise walk. Both are named
 * anti-goals (`PROJECT_INTRODUCTION.md` 31.1 and 31.7), and without this gate the
 * cheapest way to pass PH-2 is to build something worthless.
 *
 * The two batteries are opposing constraints. Only together do they say anything.
 *
 * Target ranges come from the stylized facts of real markets and from the
 * anti-goals. They have not moved since the commit that introduced them —
 * `906e398`, 2026-08-31, which is also the commit that introduced
 * `packages/engine` — so what the record supports is that no band has been
 * tuned to the engine *since*, not that the bands were set before a candidate
 * market existed. An earlier version of this comment claimed the latter; the
 * out-of-band audit (a4-06) found the repository unable to show it.
 *
 * Two of the bands are not realism at all. `return-autocorrelation-lag1` and
 * `mean-run-length` are ADR-0003 integrity requirements at tick scale: real
 * tick data carries bid-ask bounce, which ADR-0003 §4 bans because it is
 * tradeable, and a future reader must not "fix" those bands toward the market
 * they describe (a4-08). Their rationales say so.
 */

export interface RealismMetric {
  readonly name: string;
  readonly description: string;
  /** Why the target range is what it is. */
  readonly rationale: string;
  readonly value: number;
  readonly targetMin: number;
  readonly targetMax: number;
  readonly pass: boolean;
  /**
   * Why the metric was not evaluated, when it was not. The value is then NaN
   * and the metric fails — a ratio whose denominator has not cleared its own
   * band is a ratio of noise, and reporting a number for it is worse than
   * reporting none (a4-07).
   */
  readonly notEvaluated?: string;
}

export interface RealismReport {
  readonly metrics: readonly RealismMetric[];
  readonly passed: number;
  readonly failed: readonly string[];
  /** Every metric inside its target range. */
  readonly plausible: boolean;
  readonly elapsedSeconds: number;
}

export interface RealismOptions {
  /** Timeframe whose candles are examined for morphology. Default '1m'. */
  readonly candleTimeframe?: TimeframeId;
  /** Ticks per window when measuring displacement heterogeneity. Default 300. */
  readonly windowTicks?: number;
}

function metric(
  name: string,
  description: string,
  rationale: string,
  value: number,
  targetMin: number,
  targetMax: number,
): RealismMetric {
  return {
    name,
    description,
    rationale,
    value,
    targetMin,
    targetMax,
    pass: Number.isFinite(value) && value >= targetMin && value <= targetMax,
  };
}

/**
 * A ratio metric, evaluated only when the quantity it is a ratio *of* is itself
 * inside its own band.
 *
 * **Out-of-band audit, a4-07.** Forty seeds of a memoryless walk: the ratio of
 * absolute-return autocorrelation at lag 50 to lag 1 read 1240.1, −3571.0 and
 * −1242.3, and passed its band on 9 of 40 — because the ratio of two noise
 * terms is Cauchy, and P(Cauchy ∈ [0.15, 1.2]) is 0.23. The overall verdict was
 * never affected (0 of 40 plausible), but the metric values were meaningless
 * and "fails exactly seven metrics" was a property of one seed.
 */
function ratioMetric(
  name: string,
  description: string,
  rationale: string,
  numerator: number,
  denominator: number,
  guard: { readonly name: string; readonly value: number; readonly floor: number },
  targetMin: number,
  targetMax: number,
): RealismMetric {
  if (!(guard.value >= guard.floor)) {
    return {
      ...metric(name, description, rationale, Number.NaN, targetMin, targetMax),
      notEvaluated:
        `${guard.name} is ${guard.value.toFixed(4)}, below the ${guard.floor} its own band ` +
        'requires, so this ratio would be noise over noise',
    };
  }
  return metric(name, description, rationale, numerator / denominator, targetMin, targetMax);
}

function autocorrelation(values: Float64Array, lag: number): number {
  const n = values.length;
  if (n <= lag + 2) return Number.NaN;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += values[i]!;
  mean /= n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n - lag; i += 1) {
    numerator += (values[i]! - mean) * (values[i + lag]! - mean);
  }
  for (let i = 0; i < n; i += 1) {
    const d = values[i]! - mean;
    denominator += d * d;
  }
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

function excessKurtosis(values: Float64Array): number {
  const n = values.length;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += values[i]!;
  mean /= n;
  let m2 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i += 1) {
    const d = values[i]! - mean;
    const d2 = d * d;
    m2 += d2;
    m4 += d2 * d2;
  }
  m2 /= n;
  m4 /= n;
  return m2 === 0 ? Number.NaN : m4 / (m2 * m2) - 3;
}

function quantile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

export function assessRealism(
  dataset: ObserverDataset,
  options: RealismOptions = {},
): RealismReport {
  const started = process.hrtime.bigint();
  const candleTimeframe = options.candleTimeframe ?? '1m';
  const windowTicks = options.windowTicks ?? 300;
  const n = dataset.tickCount;

  const returns = new Float64Array(Math.max(0, n - 1));
  const absolute = new Float64Array(returns.length);
  for (let i = 1; i < n; i += 1) {
    const delta = dataset.prices[i]! - dataset.prices[i - 1]!;
    returns[i - 1] = delta;
    absolute[i - 1] = Math.abs(delta);
  }

  const metrics: RealismMetric[] = [];

  // --- First moment: no linear predictability ---------------------------------
  metrics.push(
    metric(
      'return-autocorrelation-lag1',
      'Autocorrelation of tick returns at lag 1.',
      'ADR-0003 integrity requirement at tick scale, not a description of real markets: ' +
        'real tick returns carry bid-ask bounce (ACF(1) of -0.1 to -0.3), which ADR-0003 §4 ' +
        'bans because it is directly tradeable. Do not widen this band toward realism.',
      Math.abs(autocorrelation(returns, 1)),
      0,
      0.02,
    ),
  );
  metrics.push(
    metric(
      'return-autocorrelation-lag10',
      'Autocorrelation of tick returns at lag 10.',
      'As above, at a longer lag, where a slower momentum rule would show up.',
      Math.abs(autocorrelation(returns, 10)),
      0,
      0.02,
    ),
  );

  // --- Second moment: clustering and long memory ------------------------------
  const absAcf1 = autocorrelation(absolute, 1);
  const absAcf50 = autocorrelation(absolute, 50);
  const absAcf500 = autocorrelation(absolute, 500);

  metrics.push(
    metric(
      'absolute-return-autocorrelation-lag1',
      'Autocorrelation of absolute returns at lag 1.',
      'Volatility clustering: large moves follow large moves. The most robust stylized ' +
        'fact there is, and absent from a memoryless walk.',
      absAcf1,
      0.05,
      0.95,
    ),
  );
  metrics.push(
    metric(
      'absolute-return-long-memory',
      'Autocorrelation of absolute returns at lag 500.',
      'Real volatility dependence decays slowly — hyperbolically rather than ' +
        'exponentially. Still positive at lag 500 is the signature of that long memory.',
      absAcf500,
      0.01,
      0.95,
    ),
  );
  // Both ratios are ratios *of* the lag-1 clustering, so neither means anything
  // unless that clustering has cleared its own band first.
  const clusteringGuard = {
    name: 'absolute-return autocorrelation at lag 1',
    value: absAcf1,
    floor: 0.05,
  };
  metrics.push(
    ratioMetric(
      'volatility-clustering-dominance',
      'Ratio of absolute-return autocorrelation to return autocorrelation, at lag 1.',
      'The defining asymmetry of a real market: strong dependence in the second moment, ' +
        'none in the first. A single number that a white-noise walk cannot fake.',
      absAcf1,
      Math.max(1e-6, Math.abs(autocorrelation(returns, 1))),
      clusteringGuard,
      5,
      Number.POSITIVE_INFINITY,
    ),
  );
  metrics.push(
    ratioMetric(
      'absolute-return-decay-is-slow',
      'Ratio of absolute-return autocorrelation at lag 50 to lag 1.',
      'Exponential decay would collapse this ratio toward zero. Real markets retain a ' +
        'substantial fraction of the dependence fifty steps out.',
      absAcf50,
      absAcf1,
      clusteringGuard,
      0.15,
      1.2,
    ),
  );

  // --- Tails ------------------------------------------------------------------
  const tickKurtosis = excessKurtosis(returns);
  metrics.push(
    metric(
      'excess-kurtosis',
      'Excess kurtosis of tick returns.',
      'Real high-frequency returns are strongly leptokurtic. A Gaussian walk sits at 0; ' +
        'the acceptable band is wide because it varies enormously by asset and sampling rate.',
      tickKurtosis,
      1.5,
      200,
    ),
  );

  // Aggregational gaussianity: kurtosis falls as returns are aggregated.
  const aggregate = 60;
  const aggregatedCount = Math.floor(returns.length / aggregate);
  const aggregated = new Float64Array(aggregatedCount);
  for (let b = 0; b < aggregatedCount; b += 1) {
    let sum = 0;
    for (let i = b * aggregate; i < (b + 1) * aggregate; i += 1) sum += returns[i]!;
    aggregated[b] = sum;
  }
  metrics.push(
    ratioMetric(
      'aggregational-gaussianity',
      'Ratio of aggregated excess kurtosis to tick excess kurtosis.',
      'Summing returns pulls the distribution toward normal. A model whose tails do not ' +
        'thin under aggregation is producing them by a mechanism real markets do not have.',
      excessKurtosis(aggregated),
      tickKurtosis,
      { name: 'tick excess kurtosis', value: tickKurtosis, floor: 1.5 },
      0,
      0.85,
    ),
  );

  // --- Regimes and heterogeneity ---------------------------------------------
  const windows = Math.floor((n - 1) / windowTicks);
  const displacement = new Float64Array(windows);
  const windowVolatility = new Float64Array(windows);
  for (let w = 0; w < windows; w += 1) {
    let sum = 0;
    let squares = 0;
    for (let i = w * windowTicks; i < (w + 1) * windowTicks; i += 1) {
      sum += returns[i]!;
      squares += returns[i]! * returns[i]!;
    }
    displacement[w] = Math.abs(sum);
    windowVolatility[w] = Math.sqrt(squares / windowTicks);
  }
  const sortedDisplacement = Float64Array.from(displacement).sort();
  const sortedVolatility = Float64Array.from(windowVolatility).sort();

  metrics.push(
    metric(
      'displacement-heterogeneity',
      'Ratio of the 99th to the 50th percentile of absolute window displacement.',
      'What a viewer reads as alternating trend and consolidation. A driftless Gaussian ' +
        'walk sits near 3.9; a market with regimes sits well above it.',
      quantile(sortedDisplacement, 0.99) / Math.max(1e-9, quantile(sortedDisplacement, 0.5)),
      4.5,
      100,
    ),
  );
  metrics.push(
    metric(
      'volatility-regime-range',
      'Ratio of the 95th to the 5th percentile of window volatility.',
      'Whether quiet and violent periods actually differ. Constant volatility gives a ' +
        'ratio near 1.3 from sampling noise alone; real markets vary severalfold.',
      quantile(sortedVolatility, 0.95) / Math.max(1e-9, quantile(sortedVolatility, 0.05)),
      2,
      100,
    ),
  );

  // --- Sign behaviour ---------------------------------------------------------
  let runs = 0;
  let currentDirection = 0;
  let signedTicks = 0;
  for (let i = 0; i < returns.length; i += 1) {
    const direction = returns[i]! === 0 ? 0 : returns[i]! > 0 ? 1 : -1;
    if (direction === 0) continue;
    signedTicks += 1;
    if (direction !== currentDirection) {
      runs += 1;
      currentDirection = direction;
    }
  }
  metrics.push(
    metric(
      'mean-run-length',
      'Mean length of same-signed tick runs.',
      'ADR-0003 integrity requirement at tick scale, not a description of real markets: a ' +
        'fair-coin sign process gives exactly 2, real tick data runs well under it because of ' +
        'bid-ask bounce, and a value away from 2 here means the sign carries exploitable ' +
        'persistence or alternation. Do not widen this band toward realism.',
      signedTicks / Math.max(1, runs),
      1.85,
      2.15,
    ),
  );

  // --- Candle morphology ------------------------------------------------------
  const candles = dataset.candles(candleTimeframe);
  let doji = 0;
  let fullBodied = 0;
  let twoSidedWicks = 0;
  let usable = 0;
  for (const candle of candles) {
    const range = candle.high - candle.low;
    if (range === 0) continue;
    usable += 1;
    const body = Math.abs(candle.close - candle.open) / range;
    if (body < 0.2) doji += 1;
    if (body > 0.8) fullBodied += 1;
    const upper = candle.high - Math.max(candle.open, candle.close);
    const lower = Math.min(candle.open, candle.close) - candle.low;
    if (upper > 0 && lower > 0) twoSidedWicks += 1;
  }
  const usableCandles = Math.max(1, usable);
  metrics.push(
    metric(
      'candle-shape-diversity',
      'Fraction of candles that are neither near-doji nor near-full-bodied.',
      'The engine must produce the whole morphology range rather than one shape. ' +
        'Anti-goal 31.2 is a library of scripted templates, and templates concentrate here.',
      1 - (doji + fullBodied) / usableCandles,
      0.25,
      0.95,
    ),
  );
  metrics.push(
    metric(
      'two-sided-wick-fraction',
      'Fraction of candles with both an upper and a lower wick.',
      'Price must move both ways inside a bar. A path that only ever advances toward its ' +
        'close produces one-sided candles and trivially reveals its own direction.',
      twoSidedWicks / usableCandles,
      0.3,
      1,
    ),
  );

  // --- Microstructure ---------------------------------------------------------
  let zeroTicks = 0;
  const magnitudes = new Float64Array(absolute.length);
  magnitudes.set(absolute);
  for (let i = 0; i < absolute.length; i += 1) if (absolute[i]! === 0) zeroTicks += 1;
  const sortedMagnitudes = magnitudes.sort();
  metrics.push(
    metric(
      'tick-size-dispersion',
      'Ratio of the 90th to the 50th percentile of absolute tick size.',
      'Tick magnitudes must vary. A fixed step size is the most obvious possible tell, ' +
        'and it also makes the lattice itself a tradeable signal.',
      quantile(sortedMagnitudes, 0.9) / Math.max(1e-9, quantile(sortedMagnitudes, 0.5)),
      1.5,
      50,
    ),
  );
  metrics.push(
    metric(
      'unchanged-tick-fraction',
      'Fraction of ticks that leave the price unchanged.',
      'Some are natural on a discrete lattice. Too many mean the quote grid is coarse ' +
        'relative to volatility, which makes ties frequent and the grid exploitable.',
      zeroTicks / Math.max(1, absolute.length),
      0,
      0.35,
    ),
  );

  const failed = metrics.filter((m) => !m.pass).map((m) => m.name);
  return {
    metrics,
    passed: metrics.length - failed.length,
    failed,
    plausible: failed.length === 0,
    elapsedSeconds: Number(process.hrtime.bigint() - started) / 1e9,
  };
}

export function formatRealismReport(report: RealismReport): string {
  const lines = [
    report.plausible
      ? `REALISM: plausible (${report.passed}/${report.metrics.length})`
      : `REALISM: IMPLAUSIBLE (${report.passed}/${report.metrics.length}) — failed: ${report.failed.join(', ')}`,
  ];
  for (const m of report.metrics) {
    const range =
      m.targetMax === Number.POSITIVE_INFINITY
        ? `>= ${m.targetMin}`
        : `${m.targetMin} .. ${m.targetMax}`;
    const value = Number.isFinite(m.value) ? m.value.toFixed(4) : 'n/a';
    lines.push(
      `  ${m.pass ? 'ok  ' : 'FAIL'} ${m.name.padEnd(38)} ${value.padStart(12)}  target ${range}` +
        (m.notEvaluated === undefined ? '' : `  not evaluated: ${m.notEvaluated}`),
    );
  }
  return lines.join('\n');
}
