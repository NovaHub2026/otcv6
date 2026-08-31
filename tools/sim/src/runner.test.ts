import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type InstrumentSpec } from '@otc/core';
import { fixtureByName } from '@otc/fixtures';
import { ALL_TIMEFRAME_IDS, runSimulation, runSimulationAsync } from './runner.js';

const instrument: InstrumentSpec = {
  id: 'runner-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const source = (ticks: number) =>
  fixtureByName('symmetricControl').create({
    instrument,
    keyring: MasterKeyring.forTesting('runner-spec'),
    env: 'test',
    ticks,
    startInstant: epochMillis(1_776_000_000_000),
    meanIntervalMs: 1_000,
    strength: 0,
  });

describe('runSimulation', () => {
  it('drives a source to exhaustion', () => {
    const result = runSimulation({ source: source(5_000) });
    expect(result.tickCount).toBe(5_000);
    expect(result.prices).toHaveLength(5_000);
    expect(result.instants).toHaveLength(5_000);
    expect(result.instrumentId).toBe('runner-otc');
    expect(result.lastInstant).toBeGreaterThan(result.firstInstant);
  });

  it('does not retain ticks unless asked', () => {
    expect(runSimulation({ source: source(1_000) }).ticks).toHaveLength(0);
    expect(runSimulation({ source: source(1_000), retainTicks: true }).ticks).toHaveLength(1_000);
  });

  it('folds candles on every requested timeframe', () => {
    const result = runSimulation({ source: source(20_000), timeframes: ALL_TIMEFRAME_IDS });
    for (const id of ALL_TIMEFRAME_IDS) {
      const candles = result.candles.get(id)!;
      expect(candles.length, id).toBeGreaterThan(0);
      expect(
        candles.reduce((sum, c) => sum + c.tickCount, 0),
        id,
      ).toBe(20_000);
    }
  });

  it('handles an immediately exhausted source', () => {
    const empty = { instrument, next: () => null };
    const result = runSimulation({ source: empty, timeframes: ['1m'] });
    expect(result.tickCount).toBe(0);
    expect(result.prices).toHaveLength(0);
    expect(result.candles.get('1m')).toEqual([]);
  });
});

describe('runSimulationAsync equals runSimulation', () => {
  // The chunked runner reopens each partially-filled candle in the next chunk,
  // so its merge logic has to stitch them back together. If that were wrong, a
  // long run would silently produce different candles from a short one.
  // Pairs rather than a single stream length: very small chunks are the
  // interesting case for the merge logic, and pathological for a long stream.
  it.each([
    [1_000, 1],
    [1_000, 7],
    [20_000, 999],
    [20_000, 5_000],
    [20_000, 20_000],
    [20_000, 1_000_000],
  ])('agrees for a %i-tick stream in chunks of %i', async (streamTicks, chunkTicks) => {
    const expected = runSimulation({ source: source(streamTicks), timeframes: ALL_TIMEFRAME_IDS });
    const actual = await runSimulationAsync(
      { source: source(streamTicks), timeframes: ALL_TIMEFRAME_IDS },
      chunkTicks,
    );
    expect(actual.tickCount).toBe(expected.tickCount);
    expect(Array.from(actual.prices)).toEqual(Array.from(expected.prices));
    expect(Array.from(actual.instants)).toEqual(Array.from(expected.instants));
    expect(actual.firstInstant).toBe(expected.firstInstant);
    expect(actual.lastInstant).toBe(expected.lastInstant);
    for (const id of ALL_TIMEFRAME_IDS) {
      expect(actual.candles.get(id), `${id} at chunk ${chunkTicks}`).toEqual(
        expected.candles.get(id),
      );
    }
  });

  it('retains ticks across chunks when asked', async () => {
    const result = await runSimulationAsync({ source: source(3_000), retainTicks: true }, 256);
    expect(result.ticks).toHaveLength(3_000);
    for (let i = 1; i < result.ticks.length; i += 1) {
      expect(result.ticks[i]!.sequence).toBe(result.ticks[i - 1]!.sequence + 1);
    }
  });

  it('handles an immediately exhausted source', async () => {
    const result = await runSimulationAsync({ source: { instrument, next: () => null } });
    expect(result.tickCount).toBe(0);
  });

  it('rejects an invalid chunk size', async () => {
    await expect(runSimulationAsync({ source: source(10) }, 0)).rejects.toThrow(RangeError);
    await expect(runSimulationAsync({ source: source(10) }, 1.5)).rejects.toThrow(RangeError);
  });
});
