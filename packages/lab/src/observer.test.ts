import { describe, expect, it } from 'vitest';
import {
  allTimeframes,
  epochMillis,
  foldTicks,
  logPrice,
  MasterKeyring,
  timeframe,
  type InstrumentSpec,
  type Tick,
} from '@otc/core';
import { fixtureByName } from '@otc/fixtures';
import { buildObserverDataset, datasetFromTicks, toPublicInstrument } from './observer.js';

const instrument: InstrumentSpec = {
  id: 'obs-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

function ticks(count: number, gapMs = 1_000): Tick[] {
  const out: Tick[] = [];
  let price = 0;
  let instant = 1_776_000_000_000;
  for (let i = 0; i < count; i += 1) {
    instant += gapMs;
    price += ((i * 7919) % 21) - 10;
    out.push({ instant: epochMillis(instant), sequence: i + 1, price: logPrice(price) });
  }
  return out;
}

const source = (count: number) =>
  fixtureByName('symmetricControl').create({
    instrument,
    keyring: MasterKeyring.forTesting('observer-spec'),
    env: 'test',
    ticks: count,
    startInstant: epochMillis(1_776_000_000_000),
    meanIntervalMs: 1_000,
    strength: 0,
  });

describe('the observer boundary', () => {
  it('exposes only public instrument fields', () => {
    const publicSpec = toPublicInstrument(instrument);
    expect(Object.keys(publicSpec).sort()).toEqual([
      'displayPrecision',
      'family',
      'id',
      'logQuantum',
      'referencePrice',
    ]);
  });

  it('carries no source, keyring, cursor or model state', async () => {
    const dataset = await buildObserverDataset({ source: source(2_000), maxTicks: 2_000 });
    const serialised = JSON.stringify(Object.keys(dataset));
    for (const forbidden of ['keyring', 'source', 'cursor', 'secret', 'state', 'stream']) {
      expect(serialised.toLowerCase()).not.toContain(forbidden);
    }
    // Nothing on the object graph can reach a generator.
    expect(Object.getOwnPropertyNames(dataset)).not.toContain('source');
  });
});

describe('dataset construction', () => {
  it('drains a source up to the cap', async () => {
    const dataset = await buildObserverDataset({ source: source(5_000), maxTicks: 1_000 });
    expect(dataset.tickCount).toBe(1_000);
  });

  it('stops when the source is exhausted', async () => {
    const dataset = await buildObserverDataset({ source: source(700), maxTicks: 10_000 });
    expect(dataset.tickCount).toBe(700);
  });

  it('builds from a tick array', () => {
    const dataset = datasetFromTicks(instrument, ticks(500));
    expect(dataset.tickCount).toBe(500);
    expect(dataset.firstInstant).toBe(1_776_000_001_000);
    expect(dataset.lastInstant).toBe(1_776_000_500_000);
  });

  it('rejects a dataset too short to attack', () => {
    expect(() => datasetFromTicks(instrument, ticks(1))).toThrow(RangeError);
    expect(() => datasetFromTicks(instrument, [])).toThrow(RangeError);
  });

  it('rejects instants that move backwards', () => {
    const bad = ticks(5);
    bad[3] = { ...bad[3]!, instant: epochMillis(1) };
    expect(() => datasetFromTicks(instrument, bad)).toThrow(RangeError);
  });

  it('rejects an invalid cap', async () => {
    await expect(buildObserverDataset({ source: source(10), maxTicks: 0 })).rejects.toThrow(
      RangeError,
    );
    await expect(buildObserverDataset({ source: source(10), maxTicks: 1.5 })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('candles', () => {
  const dataset = datasetFromTicks(instrument, ticks(20_000));

  it('agree with the substrate aggregation on every timeframe', () => {
    for (const tf of allTimeframes()) {
      expect(dataset.candles(tf.id), tf.id).toEqual(foldTicks(timeframe(tf.id), ticks(20_000)));
    }
  });

  it('are cached, returning the same instance', () => {
    expect(dataset.candles('1m')).toBe(dataset.candles('1m'));
  });
});

describe('price in force at an instant', () => {
  const list = ticks(1_000, 1_000);
  const dataset = datasetFromTicks(instrument, list);

  it('returns the last tick at or before the instant', () => {
    for (const index of [0, 1, 17, 500, 999]) {
      const tick = list[index]!;
      expect(dataset.priceAt(tick.instant)!.index).toBe(index);
      // Half a second later, still the same tick.
      expect(dataset.priceAt(epochMillis(tick.instant + 500))!.index).toBe(index);
    }
  });

  it('returns null before the first tick', () => {
    expect(dataset.priceAt(epochMillis(1))).toBeNull();
    expect(dataset.priceAt(epochMillis(list[0]!.instant - 1))).toBeNull();
  });

  it('holds the last price beyond the end', () => {
    const beyond = dataset.priceAt(epochMillis(list[999]!.instant + 999_999))!;
    expect(beyond.index).toBe(999);
  });

  it('agrees with a naive linear search across random instants', () => {
    // A binary search is easy to get subtly wrong at the boundaries, and the
    // consequence would be settling on the wrong tick.
    const naive = (instant: number): number | null => {
      let best: number | null = null;
      for (let i = 0; i < list.length; i += 1) {
        if (list[i]!.instant <= instant) best = i;
        else break;
      }
      return best;
    };
    let state = 987_654_321;
    for (let trial = 0; trial < 5_000; trial += 1) {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      const instant = 1_776_000_000_000 + (state % 1_100_000);
      const expected = naive(instant);
      const actual = dataset.priceAt(epochMillis(instant));
      expect(actual === null ? null : actual.index, `at ${instant}`).toBe(expected);
    }
  });

  it('finds the first tick at or after an instant', () => {
    expect(dataset.entryIndexAt(epochMillis(1))).toBe(0);
    expect(dataset.entryIndexAt(list[10]!.instant)).toBe(10);
    expect(dataset.entryIndexAt(epochMillis(list[10]!.instant - 1))).toBe(10);
    expect(dataset.entryIndexAt(epochMillis(list[999]!.instant + 1))).toBeNull();
  });
});
