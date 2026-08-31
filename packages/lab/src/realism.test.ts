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

function toDataset(prices: number[]) {
  const ticks: Tick[] = prices.map((price, i) => ({
    instant: epochMillis(1_776_000_000_000 + i * 1_000),
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
