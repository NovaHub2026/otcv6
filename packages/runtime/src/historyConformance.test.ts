// Invariant evidence: INV-004 (timeframe observer independence), INV-009 (reproducible settlement).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, foldTicks, logPrice, timeframe as timeframeById, type Tick } from '@otc/core';
import {
  HistoryError,
  HistoryRecorder,
  HISTORY_BASE_TIMEFRAME,
  HISTORY_ROLLUP_TIMEFRAME,
  InMemoryCandleHistory,
  readTimeframe,
  refreshRollup,
  type CandleHistory,
} from './history.js';
import { SqliteCandleHistory } from './sqliteHistory.js';

/**
 * One battery, both implementations.
 *
 * The in-memory history is the reference and the SQLite one is what ships, so
 * the interesting failures are the ones where they differ: a `WITHOUT ROWID`
 * primary key that silently reorders, an integer column that widens a branded
 * price, a partial batch left behind by a failed append. None of those can be
 * found by testing either alone, and PH-14 established this shape for the lease
 * store for exactly that reason.
 */

const ORIGIN = 1_776_000_000_000;
const directories: string[] = [];
const opened: SqliteCandleHistory[] = [];

afterAll(async () => {
  for (const history of opened) history.close();
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function onDisk(): Promise<CandleHistory> {
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-history-'));
  directories.push(directory);
  const history = new SqliteCandleHistory(path.join(directory, 'history.db'));
  opened.push(history);
  return history;
}

function ticks(count: number, everyMs = 6_000): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: i + 1,
    instant: epochMillis(ORIGIN + i * everyMs),
    price: logPrice(1_000 + (((i * 37) % 23) - 11) * 3 + (i % 5)),
  }));
}

const stream = ticks(3_600); // six hours
const recorder = new HistoryRecorder();
recorder.accept(stream);
const base = recorder.drain();

const IMPLEMENTATIONS: readonly [string, () => Promise<CandleHistory>][] = [
  ['in memory', () => Promise.resolve(new InMemoryCandleHistory())],
  ['on disk', onDisk],
];

describe.each(IMPLEMENTATIONS)('a %s candle history', (_name, open) => {
  it('returns what it was given, unchanged', async () => {
    const history = await open();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base);
    const read = await history.read(
      'eurusd',
      HISTORY_BASE_TIMEFRAME,
      epochMillis(0),
      epochMillis(ORIGIN + 86_400_000),
    );
    expect(read).toEqual(base);
  });

  it('answers a window with exactly the bars inside it', async () => {
    const history = await open();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base);
    const from = base[10]!.openInstant;
    const to = base[20]!.openInstant;
    const read = await history.read('eurusd', HISTORY_BASE_TIMEFRAME, from, to);
    // Half-open: the bar at `from` is in, the bar at `to` is not.
    expect(read).toEqual(base.slice(10, 20));
  });

  it('reports the head, and null before anything is stored', async () => {
    const history = await open();
    expect(await history.head('eurusd', HISTORY_BASE_TIMEFRAME)).toBeNull();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base);
    expect(await history.head('eurusd', HISTORY_BASE_TIMEFRAME)).toBe(
      base[base.length - 1]!.openInstant,
    );
  });

  it('keeps assets and tiers apart', async () => {
    const history = await open();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base);
    const hours = await refreshRollup(history, 'eurusd');
    expect(hours).toBeGreaterThan(0);
    expect(await history.head('gbpjpy', HISTORY_BASE_TIMEFRAME)).toBeNull();
    expect(await history.head('eurusd', HISTORY_ROLLUP_TIMEFRAME)).not.toBeNull();
  });

  it('appends across calls', async () => {
    const history = await open();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base.slice(0, 30));
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base.slice(30));
    const read = await history.read(
      'eurusd',
      HISTORY_BASE_TIMEFRAME,
      epochMillis(0),
      epochMillis(ORIGIN + 86_400_000),
    );
    expect(read).toEqual(base);
  });

  it('refuses a candle that does not follow the head', async () => {
    const history = await open();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base);
    await expect(history.append('eurusd', HISTORY_BASE_TIMEFRAME, [base[0]!])).rejects.toThrow(
      HistoryError,
    );
  });

  it('leaves nothing behind when a batch is refused part way', async () => {
    // The batch is validated inside the write, so a bad candle in the middle
    // rolls back what came before it. A half-written history is one that no
    // longer matches the ticks it came from, and nothing downstream can tell.
    const history = await open();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base.slice(0, 5));
    await expect(
      history.append('eurusd', HISTORY_BASE_TIMEFRAME, [base[5]!, base[6]!, base[0]!]),
    ).rejects.toThrow(HistoryError);
    expect(await history.head('eurusd', HISTORY_BASE_TIMEFRAME)).toBe(base[4]!.openInstant);
  });

  it('refuses a bar filed under the wrong tier', async () => {
    const history = await open();
    await expect(history.append('eurusd', HISTORY_ROLLUP_TIMEFRAME, [base[0]!])).rejects.toThrow(
      /is a 1m bar/,
    );
  });

  it('refuses a tier it does not store', async () => {
    const history = await open();
    await expect(history.append('eurusd', '5m', [])).rejects.toThrow(/stores 1m and 1h only/);
    await expect(history.read('eurusd', '1s', epochMillis(0), epochMillis(ORIGIN))).rejects.toThrow(
      HistoryError,
    );
    await expect(history.head('eurusd', '1d')).rejects.toThrow(HistoryError);
  });

  it('serves a folded timeframe that agrees with folding the ticks', async () => {
    // The end-to-end claim: ticks folded to minutes, stored, read back, folded
    // again — and the answer is the one the ticks would have given directly.
    const history = await open();
    await history.append('eurusd', HISTORY_BASE_TIMEFRAME, base);
    await refreshRollup(history, 'eurusd');
    const read = await readTimeframe(
      history,
      'eurusd',
      '15m',
      epochMillis(0),
      epochMillis(ORIGIN + 86_400_000),
    );
    const direct = foldTicks(timeframeById('15m'), stream);
    expect(read.slice(0, -1)).toEqual(direct.slice(0, read.length - 1));
    expect(read.length).toBeGreaterThan(20);
  });
});
