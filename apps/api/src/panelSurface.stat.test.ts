// Invariant evidence: INV-002 (shared market), INV-004 (timeframe observer independence), INV-003 (single underlying stream).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foldCandles, timeframe as timeframeById, type Candle } from '@otc/core';
import { LiveBarBuilder, toBars, type HistoryCandle } from '@otc/chart';

/**
 * PH-18 verified where it will actually be wrong: across the process boundary.
 *
 * Every piece has its own tests. What none of them can show is that the panel
 * and the engine agree — that the bars a chart draws are the bars the record
 * holds, that switching timeframe re-reads one record rather than fetching a
 * different one, and that the live stream continues the history rather than
 * restating it.
 *
 * So this boots the **real service**, provisions a market with real history
 * through `OTC_BACKFILL_DAYS`, and drives the real client-side conversion over
 * HTTP. The two times this project found an architectural boundary defect —
 * PH-5.3's restart, PH-8.2's browser build — it was by running the real thing
 * across a real boundary rather than reasoning about the pieces either side.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const entry = path.join(repoRoot, 'apps/api/dist/main.js');
const SECRET = 'd'.repeat(64);
/** The slowest asset: provisioning it is 2.3M ticks rather than 22.8M. */
const ASSET = 'spx';
const BACKFILL_DAYS = 2;

const started: ChildProcess[] = [];
const directories: string[] = [];
let port = 0;

afterAll(async () => {
  for (const child of started) if (child.exitCode === null) child.kill('SIGKILL');
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function boot(basePort: number): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = basePort + attempt;
    try {
      await bootOn(candidate);
      return candidate;
    } catch (error) {
      if (!String((error as Error).message).includes('EADDRINUSE')) throw error;
    }
  }
  throw new Error(`no free port from ${basePort}`);
}

async function bootOn(candidate: number): Promise<void> {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-panel-'));
  directories.push(stateDir);
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      OTC_STATE_DIR: stateDir,
      OTC_HISTORY_DB: path.join(stateDir, 'history.db'),
      OTC_MASTER_SECRET: SECRET,
      OTC_BACKFILL_DAYS: String(BACKFILL_DAYS),
      PORT: String(candidate),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(child);
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  // Provisioning five assets over two days is minutes of generation before the
  // listener opens, which is the point: a market is not served until it has the
  // past it was promised.
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`service exited (${child.exitCode}):\n${output.slice(-2_000)}`);
    }
    try {
      if ((await fetch(`http://127.0.0.1:${candidate}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`service never became healthy:\n${output.slice(-2_000)}`);
}

async function getJson<T>(pathname: string): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  if (!response.ok) throw new Error(`${response.status} from ${pathname}`);
  return (await response.json()) as T;
}

interface CatalogueRow {
  id: string;
  displayName: string;
  live: boolean;
  logQuantum: number;
  referencePrice: number;
  displayPrecision: number;
  dispersion: { quarterlyPercent: number };
}

function historyPath(timeframe: string, from: number, to: number): string {
  return `/markets/${ASSET}/history?timeframe=${timeframe}&from=${from}&to=${to}`;
}

describe('the panel and the engine agree across the process boundary', () => {
  let window: { from: number; to: number };

  beforeAll(async () => {
    port = await boot(4310);
    const now = Date.now();
    window = { from: now - BACKFILL_DAYS * 86_400_000, to: now };
  }, 900_000);

  it('serves a catalogue the panel can render', async () => {
    const rows = await getJson<CatalogueRow[]>('/catalogue');
    const asset = rows.find((row) => row.id === ASSET);
    expect(asset).toBeDefined();
    expect(asset!.live).toBe(true);
    expect(asset!.dispersion.quarterlyPercent).toBeGreaterThan(0);
    console.info(
      `catalogue: ${rows.length} assets, ${rows.filter((row) => row.live).length} hosted — ` +
        rows
          .map((row) => `${row.id} ${(100 * row.dispersion.quarterlyPercent).toFixed(1)}%`)
          .join(', '),
    );
  }, 120_000);

  it('serves the history the provisioning produced', async () => {
    const body = await getJson<{ candles: HistoryCandle[] }>(
      historyPath('1h', window.from, window.to),
    );
    // Two days of hourly bars, less whichever hour is still open.
    expect(body.candles.length).toBeGreaterThanOrEqual(44);
    expect(body.candles.length).toBeLessThanOrEqual(48);
    for (let i = 1; i < body.candles.length; i += 1) {
      expect(body.candles[i]!.openInstant - body.candles[i - 1]!.openInstant).toBe(3_600_000);
    }
  }, 120_000);

  it('answers every timeframe from one record', async () => {
    // INV-004 across the HTTP boundary. The panel switches timeframe by asking
    // for a different view; if the views disagreed, the market would depend on
    // how it was looked at, which is the invariant.
    const fine = await getJson<{ candles: Candle[] }>(historyPath('5m', window.from, window.to));
    const coarse = await getJson<{ candles: Candle[] }>(historyPath('1h', window.from, window.to));
    const folded = foldCandles(timeframeById('1h'), fine.candles);

    // Aligned by open instant, not by index. Both series are filtered to the
    // same window, but the hour containing `from` starts before it: the coarse
    // tier drops that bar and the fine tier keeps whatever minutes of it fall
    // inside the window, so the two arrays are offset. Comparing by position
    // was the first attempt and it compared different hours to each other.
    const byInstant = new Map(coarse.candles.map((candle) => [candle.openInstant, candle]));
    // The first and last hours a window touches are partial in the fine series —
    // `from` and `to` do not land on hour boundaries — so those two are dropped
    // by position. Every hour between them must be present in the coarse tier
    // and identical to it, field for field. Skipping mismatches instead would
    // have made this assertion unfalsifiable.
    const inner = folded.slice(1, -1);
    expect(inner.length).toBeGreaterThan(40);
    for (const bar of inner) {
      expect(byInstant.get(bar.openInstant), `hour ${bar.openInstant}`).toEqual(bar);
    }
  }, 120_000);

  it('refuses a timeframe it cannot serve rather than coarsening it', async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}${historyPath('1s', window.from, window.to)}`,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('tick record');
  }, 120_000);

  it('draws bars that are the record, converted', async () => {
    // The client-side conversion, run against real server output. Every number
    // on the screen has to be a number the record holds.
    const [rows, body] = await Promise.all([
      getJson<CatalogueRow[]>('/catalogue'),
      getJson<{ candles: HistoryCandle[] }>(historyPath('1h', window.from, window.to)),
    ]);
    const asset = rows.find((row) => row.id === ASSET)!;
    const bars = toBars(body.candles, asset);
    expect(bars).toHaveLength(body.candles.length);
    for (const [index, bar] of bars.entries()) {
      const candle = body.candles[index]!;
      expect(bar.time).toBe(Math.floor(candle.openInstant / 1000));
      expect(bar.high).toBeGreaterThanOrEqual(bar.low);
      // Monotone conversion: the ordering of the integers is the ordering of
      // the prices, so an extreme cannot be lost in the change of units.
      if (candle.high > candle.low) expect(bar.high).toBeGreaterThan(bar.low);
    }
  }, 120_000);

  it('goes on recording after the provisioning ends', async () => {
    // The other half of the user-facing requirement: ninety days of past *and*
    // everything from here on. Provisioning wrote the past; this is the venue
    // folding what it publishes into the same tier, on the checkpoint cadence.
    //
    // A minute bar closes on the wall clock, so this waits for one. There is no
    // shortcut: the thing under test is that time passing produces a stored bar.
    const head = async (): Promise<number> => {
      const body = await getJson<{ candles: HistoryCandle[] }>(
        historyPath('1m', Date.now() - 3_600_000, Date.now() + 60_000),
      );
      const last = body.candles[body.candles.length - 1];
      return last === undefined ? 0 : last.openInstant;
    };

    const before = await head();
    expect(before).toBeGreaterThan(0);
    const deadline = Date.now() + 150_000;
    let after = before;
    while (after <= before && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      after = await head();
    }
    console.info(
      `live persistence: head advanced ${((after - before) / 1000).toFixed(0)}s ` +
        `in ${((Date.now() - (deadline - 150_000)) / 1000).toFixed(0)}s of wall clock`,
    );
    expect(after).toBeGreaterThan(before);
  }, 300_000);

  it('continues the history with the live stream instead of restating it', async () => {
    // The join, over a real socket. The last stored bar belongs to the record;
    // the builder must leave it alone and open the next one.
    const [rows, body] = await Promise.all([
      getJson<CatalogueRow[]>('/catalogue'),
      getJson<{ candles: HistoryCandle[] }>(historyPath('1m', window.to - 7_200_000, window.to)),
    ]);
    const asset = rows.find((row) => row.id === ASSET)!;
    const lastStored = body.candles[body.candles.length - 1]!;
    const builder = new LiveBarBuilder(60_000, asset, lastStored.openInstant);

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/markets/${ASSET}/stream`, {
      signal: controller.signal,
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let drawn = 0;
    const deadline = Date.now() + 90_000;
    try {
      while (drawn < 3 && Date.now() < deadline) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += decoder.decode(chunk.value, { stream: true });
        const frames = buffered.split('\n\n');
        buffered = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (line === undefined) continue;
          const tick = JSON.parse(line.slice(6)) as {
            sequence: number;
            instant: number;
            price: number;
          };
          const bar = builder.accept(tick as never);
          if (bar === null) continue;
          drawn += 1;
          // Never the stored bar's bucket: that one is the record's.
          expect(bar.time * 1000).toBeGreaterThan(lastStored.openInstant);
        }
      }
    } finally {
      controller.abort();
    }
    expect(drawn).toBeGreaterThan(0);
  }, 180_000);
});
