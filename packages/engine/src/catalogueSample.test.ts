import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import { HEAVY_SUITE_SAMPLE, sampleCatalogue } from './catalogueSample.js';

/**
 * PH-26.1: the sample the heavy suites measure is fixed, stratified, inert
 * when unneeded, and honest about what it left out.
 *
 * Each property here is what a sampling suite's verdict rests on. A sample
 * that rotates makes one gate's verdict about different assets from the next's;
 * one that is not stratified can verify five currency pairs and nothing about
 * crypto; one that is not inert at five assets changes the verdicts this
 * machinery was introduced not to change; one that does not describe itself
 * lets "the catalogue reproduces" stand for "five of thirty do".
 */
interface Fake {
  readonly definition: { readonly id: string; readonly family: string };
}

const fake = (id: string, family: string): Fake => ({ definition: { id, family } });
const idOf = (asset: Fake): string => asset.definition.id;
const stream = (purpose: string): RandomSource =>
  MasterKeyring.forTesting('catalogue-sample-spec').derive({
    env: 'test',
    asset: 'sample',
    purpose,
    keyEpoch: 0,
  });

/** Thirty assets over six strata, in the shape the catalogue of thirty takes. */
const THIRTY: readonly Fake[] = [
  ...['eurusd', 'gbpusd', 'usdjpy', 'audusd', 'usdchf', 'eurgbp'].map((id) => fake(id, 'major-fx')),
  ...['gbpjpy', 'eurjpy'].map((id) => fake(id, 'cross-fx')),
  ...['aapl', 'msft', 'nvda', 'tsla', 'meta', 'amzn', 'pbr', 'nu', 'gmx', 'evx', 'brx'].map((id) =>
    fake(id, 'sector-etf'),
  ),
  ...['btc', 'eth', 'bnb', 'cgx'].map((id) => fake(id, 'major-crypto')),
  ...['sol', 'xrp', 'doge', 'mmx'].map((id) => fake(id, 'alt-crypto')),
  ...['aix', 'tcx', 'scx'].map((id) => fake(id, 'blue-chip-index')),
];

const FIVE: readonly Fake[] = [
  fake('eurusd', 'forex'),
  fake('gbpjpy', 'forex'),
  fake('btcusd', 'crypto'),
  fake('spx', 'index'),
  fake('xauusd', 'commodity'),
];

describe('the size the heavy suites sample at', () => {
  it('is the five the 72-minute measurement of 2026-09-04 was taken at', () => {
    // Not a tautology. The three heavy suites assert their sample against this
    // constant, so a constant that quietly shrank to three would pass every one
    // of them while measuring less — the first plant against PH-26.1 did exactly
    // that and survived. The number is a decision recorded in the phase
    // document; changing it is a phase-document change, and this is where that
    // shows up.
    expect(HEAVY_SUITE_SAMPLE).toBe(5);
  });
});

describe('a catalogue sample', () => {
  it('is inert on a catalogue no larger than the sample: every asset, in order', () => {
    const sample = sampleCatalogue(FIVE, idOf, stream('inert'), { size: HEAVY_SUITE_SAMPLE });
    expect(sample.whole).toBe(true);
    expect(sample.measured).toEqual(FIVE);
    expect(sample.unmeasured).toEqual([]);
    expect(sample.describe()).toMatch(/^measured every asset \(5\)/);
    // And the stream was not even consulted, so the whole-catalogue path cannot
    // depend on it.
    const s = stream('untouched');
    const before = s.position();
    sampleCatalogue(FIVE, idOf, s, { size: 5 });
    expect(s.position()).toEqual(before);
  });

  it('is fixed: the same stream label draws the same assets every time', () => {
    const a = sampleCatalogue(THIRTY, idOf, stream('fixed'), { size: 5 });
    const b = sampleCatalogue(THIRTY, idOf, stream('fixed'), { size: 5 });
    expect(a.measured.map(idOf)).toEqual(b.measured.map(idOf));
    expect(a.measured).toHaveLength(5);
    expect(a.unmeasured).toHaveLength(25);
    expect(a.whole).toBe(false);
  });

  it('is stratified: no stratum is drawn twice before every stratum is drawn once', () => {
    // Six strata and a sample of five: five distinct strata, no repeats.
    const five = sampleCatalogue(THIRTY, idOf, stream('strata'), { size: 5 });
    const strata = five.measured.map((a) => a.definition.family);
    expect(new Set(strata).size).toBe(5);

    // Six strata and a sample of ten: all six represented, four of them reached
    // twice and none three times — the second round starts only after the first
    // is complete.
    const ten = sampleCatalogue(THIRTY, idOf, stream('strata'), { size: 10 });
    const counts = new Map<string, number>();
    for (const asset of ten.measured) {
      counts.set(asset.definition.family, (counts.get(asset.definition.family) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    expect([...counts.values()].filter((n) => n === 2)).toHaveLength(4);
    expect(Math.max(...counts.values())).toBe(2);
  });

  it('draws from every stratum, not only the ones declared first', () => {
    // Across purposes the permutation of strata varies, so a stratum declared
    // last is reached by some sample of five. Thirty-two purposes over six
    // strata: every stratum appears in at least one sample, or the permutation
    // is not a permutation.
    const seen = new Set<string>();
    for (let i = 0; i < 32; i += 1) {
      const sample = sampleCatalogue(THIRTY, idOf, stream(`p${String(i)}`), { size: 5 });
      for (const asset of sample.measured) seen.add(asset.definition.family);
    }
    expect([...seen].sort()).toEqual(
      [
        'alt-crypto',
        'blue-chip-index',
        'cross-fx',
        'major-crypto',
        'major-fx',
        'sector-etf',
      ].sort(),
    );
  });

  it('gives different purposes different draws, so the heavy suites do not all measure the same five', () => {
    const draws = ['lattice-ties', 'recalibration', 'battery'].map((purpose) =>
      sampleCatalogue(THIRTY, idOf, stream(purpose), { size: 5 }).measured.map(idOf).join(','),
    );
    expect(new Set(draws).size).toBeGreaterThan(1);
  });

  it('keeps catalogue order in both halves, and partitions exactly', () => {
    const sample = sampleCatalogue(THIRTY, idOf, stream('order'), { size: 7 });
    const ids = THIRTY.map(idOf);
    const index = (a: Fake): number => ids.indexOf(idOf(a));
    for (const half of [sample.measured, sample.unmeasured]) {
      const positions = half.map(index);
      expect(positions).toEqual([...positions].sort((x, y) => x - y));
    }
    expect([...sample.measured, ...sample.unmeasured].map(idOf).sort()).toEqual([...ids].sort());
  });

  it('says what it did not measure, by name and by count', () => {
    const sample = sampleCatalogue(THIRTY, idOf, stream('describe'), { size: 5 });
    const line = sample.describe();
    expect(line).toMatch(/^measured 5 of 30 assets, stratified over 6 strata: /);
    expect(line).toMatch(/NOT MEASURED BY THIS RUN \(25\): /);
    for (const asset of sample.measured) expect(line).toContain(idOf(asset));
    for (const asset of sample.unmeasured) expect(line).toContain(idOf(asset));
  });

  it('stratifies by family when nothing finer is given, and by the caller’s function when it is', () => {
    const byFamily = sampleCatalogue(THIRTY, idOf, stream('family'), { size: 5 });
    expect(byFamily.strata).toHaveLength(6);
    const byFirstLetter = sampleCatalogue(THIRTY, idOf, stream('family'), {
      size: 5,
      stratumOf: (a) => idOf(a)[0]!,
    });
    expect(byFirstLetter.strata.length).toBeGreaterThan(6);
    expect(new Set(byFirstLetter.measured.map((a) => idOf(a)[0])).size).toBe(5);
  });

  it('refuses a size that is not a positive integer', () => {
    for (const size of [0, -1, 2.5, Number.NaN]) {
      expect(() => sampleCatalogue(THIRTY, idOf, stream('bad'), { size })).toThrow(RangeError);
    }
  });
});
