import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type InstrumentSpec, type Tick } from '@otc/core';
import { datasetFromTicks } from './observer.js';
import { assessRealism, formatRealismReport } from './realism.js';

const instrument: InstrumentSpec = {
  id: 'realism-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

function toDataset(prices: number[], intervalMs = 1_000) {
  const ticks: Tick[] = prices.map((price, i) => ({
    instant: epochMillis(1_776_000_000_000 + i * intervalMs),
    sequence: i + 1,
    price: logPrice(price),
  }));
  return datasetFromTicks(instrument, ticks);
}

const stream = (purpose: string) =>
  MasterKeyring.forTesting('realism-spec').derive({
    env: 'test',
    asset: 'realism',
    purpose,
    keyEpoch: 0,
  });

/** Constant volatility, independent signs: the memoryless walk. */
function whiteNoiseWalk(n: number): number[] {
  const s = stream('white');
  const prices = [0];
  for (let i = 1; i < n; i += 1) {
    prices.push(prices[i - 1]! + (s.nextBoolean() ? 1 : -1) * (1 + s.nextBoundedUint32(3)));
  }
  return prices;
}

/** Sign-blind magnitudes with a slow volatility state: clustering without drift. */
function clusteredWalk(n: number): number[] {
  const magnitude = stream('cluster-mag');
  const sign = stream('cluster-sign');
  const prices = [0];
  let logVol = 0;
  for (let i = 1; i < n; i += 1) {
    logVol = logVol * 0.999 + 0.04 * (magnitude.nextFloat64() * 2 - 1);
    const scale = Math.max(1, Math.round(10 * Math.exp(logVol * 3)));
    const step = 1 + magnitude.nextBoundedUint32(scale);
    prices.push(prices[i - 1]! + (sign.nextBoolean() ? 1 : -1) * step);
  }
  return prices;
}

describe('metric declarations', () => {
  const report = assessRealism(toDataset(whiteNoiseWalk(60_000)));

  it('gives every metric a target range and a rationale', () => {
    expect(report.metrics.length).toBeGreaterThan(10);
    for (const m of report.metrics) {
      expect(m.name.length).toBeGreaterThan(5);
      expect(m.description.length).toBeGreaterThan(15);
      expect(m.rationale.length).toBeGreaterThan(40);
      expect(m.targetMax).toBeGreaterThan(m.targetMin);
      expect(m.pass).toBe(m.value >= m.targetMin && m.value <= m.targetMax);
    }
  });

  it('has unique metric names', () => {
    const names = report.metrics.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the memoryless walk is unexploitable and implausible', () => {
  const report = assessRealism(toDataset(whiteNoiseWalk(120_000)));

  it('fails realism overall', () => {
    expect(report.plausible).toBe(false);
    expect(report.failed.length).toBeGreaterThan(3);
  });

  it('fails precisely the metrics that distinguish a market from noise', () => {
    expect(report.failed).toContain('absolute-return-autocorrelation-lag1');
    expect(report.failed).toContain('excess-kurtosis');
    expect(report.failed).toContain('volatility-regime-range');
  });

  it('still passes the metrics that are integrity requirements', () => {
    // The point of the whole subphase: passing the attack battery is not enough.
    expect(report.failed).not.toContain('return-autocorrelation-lag1');
    expect(report.failed).not.toContain('mean-run-length');
  });
});

describe('a ratio of noise is not a number (a4-07)', () => {
  const white = assessRealism(toDataset(whiteNoiseWalk(120_000)));
  const metric = (name: string) => white.metrics.find((m) => m.name === name)!;

  it('does not evaluate the clustering ratios when there is no clustering to take a ratio of', () => {
    // On a memoryless walk the lag-1 clustering is noise around zero, and the
    // ratio of two noise terms is Cauchy: nine of forty seeds passed
    // `absolute-return-decay-is-slow` by landing in its band by accident.
    for (const name of ['volatility-clustering-dominance', 'absolute-return-decay-is-slow']) {
      expect(metric(name).value, name).toBeNaN();
      expect(metric(name).pass, name).toBe(false);
      expect(metric(name).notEvaluated, name).toContain('below the 0.05');
    }
  });

  it('does not evaluate aggregational gaussianity when the tick kurtosis fails its own band', () => {
    expect(metric('excess-kurtosis').pass).toBe(false);
    expect(metric('aggregational-gaussianity').value).toBeNaN();
    expect(metric('aggregational-gaussianity').notEvaluated).toContain('below the 1.5');
  });

  it('evaluates them on a market that has the clustering and the tails', () => {
    const clustered = assessRealism(toDataset(clusteredWalk(120_000)));
    const value = (name: string) => clustered.metrics.find((m) => m.name === name)!;
    expect(value('absolute-return-autocorrelation-lag1').pass).toBe(true);
    expect(value('volatility-clustering-dominance').notEvaluated).toBeUndefined();
    expect(Number.isFinite(value('volatility-clustering-dominance').value)).toBe(true);
    expect(value('absolute-return-decay-is-slow').notEvaluated).toBeUndefined();
    expect(Number.isFinite(value('absolute-return-decay-is-slow').value)).toBe(true);
  });

  it('prints a metric it did not evaluate as such, rather than as NaN', () => {
    const text = formatRealismReport(white);
    expect(text).toContain('not evaluated:');
    expect(text).not.toContain('NaN');
  });

  it('labels the tick-scale integrity bands as ADR-0003 requirements, not realism (a4-08)', () => {
    // Real tick data would fail both: bid-ask bounce gives ACF(1) of -0.1 to
    // -0.3 and same-sign runs well under 2. The bands are right for this
    // product and wrong as a description of markets, and must say so.
    for (const name of ['return-autocorrelation-lag1', 'mean-run-length']) {
      expect(metric(name).rationale, name).toContain('ADR-0003');
      expect(metric(name).rationale, name).toContain('Do not widen');
    }
  });
});

describe('a clustered walk is plausible where the memoryless one is not', () => {
  const clustered = assessRealism(toDataset(clusteredWalk(120_000)));
  const white = assessRealism(toDataset(whiteNoiseWalk(120_000)));

  it('has volatility clustering', () => {
    const value = (r: typeof clustered, name: string) =>
      r.metrics.find((m) => m.name === name)!.value;
    expect(value(clustered, 'absolute-return-autocorrelation-lag1')).toBeGreaterThan(
      value(white, 'absolute-return-autocorrelation-lag1'),
    );
    expect(value(clustered, 'excess-kurtosis')).toBeGreaterThan(value(white, 'excess-kurtosis'));
    expect(value(clustered, 'volatility-regime-range')).toBeGreaterThan(
      value(white, 'volatility-regime-range'),
    );
  });

  it('passes more metrics than the memoryless walk', () => {
    expect(clustered.passed).toBeGreaterThan(white.passed);
  });
});

describe('metrics respond to injected structure', () => {
  it('detects return autocorrelation', () => {
    // Signs that persist: the sign process is no longer a fair coin.
    const s = stream('persistent');
    const prices = [0];
    let direction = 1;
    for (let i = 1; i < 120_000; i += 1) {
      if (s.nextFloat64() > 0.75) direction = -direction;
      prices.push(prices[i - 1]! + direction * (1 + s.nextBoundedUint32(3)));
    }
    const report = assessRealism(toDataset(prices));
    expect(report.failed).toContain('return-autocorrelation-lag1');
    expect(report.failed).toContain('mean-run-length');
  });

  it('detects a degenerate fixed tick size', () => {
    const s = stream('fixed-step');
    const prices = [0];
    for (let i = 1; i < 60_000; i += 1) {
      prices.push(prices[i - 1]! + (s.nextBoolean() ? 1 : -1));
    }
    const report = assessRealism(toDataset(prices));
    // Every tick the same size is the most obvious possible tell.
    expect(report.failed).toContain('tick-size-dispersion');
  });

  it('detects a market that barely moves', () => {
    const s = stream('frozen');
    const prices = [0];
    for (let i = 1; i < 60_000; i += 1) {
      prices.push(prices[i - 1]! + (s.nextFloat64() < 0.1 ? (s.nextBoolean() ? 1 : -1) : 0));
    }
    const report = assessRealism(toDataset(prices));
    expect(report.failed).toContain('unchanged-tick-fraction');
  });
});

describe('a tick window is not a span of market time (Cycle Audit 8, a5)', () => {
  /** The metrics whose window is counted in ticks, and the count each uses. */
  const WINDOWED: Record<string, number> = {
    'return-autocorrelation-lag1': 1,
    'return-autocorrelation-lag10': 10,
    'absolute-return-autocorrelation-lag1': 1,
    'absolute-return-long-memory': 500,
    'volatility-clustering-dominance': 1,
    'absolute-return-decay-is-slow': 50,
    'aggregational-gaussianity': 60,
    'displacement-heterogeneity': 300,
    'volatility-regime-range': 300,
  };

  const prices = clusteredWalk(120_000);
  const secondly = assessRealism(toDataset(prices));
  const quarterly = assessRealism(toDataset(prices, 250));
  const find = (report: typeof secondly, name: string) =>
    report.metrics.find((m) => m.name === name)!;

  it('reports the market time each tick-indexed window covered', () => {
    for (const [name, ticks] of Object.entries(WINDOWED)) {
      const m = find(secondly, name);
      expect(m.measuredOver, name).toEqual({ ticks, marketTimeMs: ticks * 1_000 });
    }
  });

  it('reports no window for the metrics that have none', () => {
    for (const name of ['excess-kurtosis', 'mean-run-length', 'tick-size-dispersion']) {
      expect(find(secondly, name).measuredOver, name).toBeUndefined();
    }
  });

  it('answers the same band over a quarter of the market time when a tick is a quarter', () => {
    // PH-24.17, exactly: the same published prices at four times the tick rate.
    // Every value below is identical and every verdict holds, because none of
    // these measurements can see time at all — what changed is the span of
    // market they were asked about, which is why the report now says it.
    for (const [name, ticks] of Object.entries(WINDOWED)) {
      const before = find(secondly, name);
      const after = find(quarterly, name);
      expect(after.value, name).toBe(before.value);
      expect(after.pass, name).toBe(before.pass);
      expect(after.measuredOver, name).toEqual({ ticks, marketTimeMs: ticks * 250 });
    }
  });

  it('prints the span on the line the band is printed on', () => {
    const text = formatRealismReport(secondly);
    expect(text).toContain('over 500 ticks = 500.0s of market time');
    expect(formatRealismReport(quarterly)).toContain('over 500 ticks = 125.0s of market time');
  });
});

describe('reporting', () => {
  it('formats a readable report', () => {
    const text = formatRealismReport(assessRealism(toDataset(whiteNoiseWalk(30_000))));
    expect(text).toContain('REALISM:');
    expect(text).toContain('target');
    expect(text).toContain('excess-kurtosis');
  });

  it('counts passes and failures consistently', () => {
    const report = assessRealism(toDataset(clusteredWalk(60_000)));
    expect(report.passed + report.failed.length).toBe(report.metrics.length);
    expect(report.plausible).toBe(report.failed.length === 0);
  });
});
