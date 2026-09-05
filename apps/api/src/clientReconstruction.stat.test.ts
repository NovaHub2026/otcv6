// Invariant evidence: INV-002 (shared market), INV-004 (timeframe observer independence).
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { reduceToColumns, TickWindow, windowExtremes } from '@otc/chart';
import { ASSET_CATALOGUE } from '@otc/engine';

/**
 * The join.
 *
 * PH-7 tested the server. PH-8.1 and PH-8.2 tested the reduction and the client
 * window. Nothing tested them *together*, and the two times this project found a
 * real architectural boundary — PH-5.3's restart, PH-8.2's browser build — it was
 * by running the real thing across a real boundary rather than reasoning about
 * the pieces either side of it.
 *
 * So this drives a real API process over HTTP into a real `TickWindow`, drops the
 * connection mid-stream, resumes by sequence, and requires the reconstruction to
 * equal the server's own record.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const entry = path.join(repoRoot, 'apps/api/dist/main.js');
const SECRET = 'c'.repeat(64);
/** The fastest tape in the catalogue, derived rather than named (PH-26.3). */
const FASTEST = [...ASSET_CATALOGUE].sort(
  (a, b) => a.evidence.meanIntervalMs - b.evidence.meanIntervalMs,
)[0]!.definition.id;
const ASSET = FASTEST; // the fastest asset, so the test does not spend its life waiting

const started: ChildProcess[] = [];
const directories: string[] = [];

afterAll(async () => {
  for (const child of started) if (child.exitCode === null) child.kill('SIGKILL');
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

/**
 * Boot the service on a port nothing else holds.
 *
 * The port was a hard-coded constant per test, and a run of the full gate hit
 * `EADDRINUSE` on it — reproducibly, on a clean tree, while `ss` showed the port
 * free between runs. Whatever holds it, a test that fails because a number was
 * taken is testing the machine rather than the code. It now walks forward until
 * a port binds, and returns the one it got.
 */
async function boot(basePort: number): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = basePort + attempt;
    try {
      await bootOn(port);
      return port;
    } catch (error) {
      if (!String((error as Error).message).includes('EADDRINUSE')) throw error;
    }
  }
  throw new Error(`no free port from ${basePort}`);
}

async function bootOn(port: number): Promise<void> {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-join-'));
  directories.push(stateDir);
  // A nonce `/health` echoes, so a foreign engine on this port is not mistaken
  // for the child (a6-14).
  const nonce = randomUUID();
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      OTC_STATE_DIR: stateDir,
      OTC_MASTER_SECRET: SECRET,
      OTC_BOOT_NONCE: nonce,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(child);
  // Keep what the child said. A test that reports `service exited (1)` and
  // throws the reason away costs an hour every time it fires, which is the
  // diagnosis cost this project keeps paying elsewhere for the same reason.
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`service exited (${child.exitCode}):\n${output.slice(-2_000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const health = (await response.json()) as { bootNonce: string | null };
        if (health.bootNonce === nonce) return;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`service never became healthy:\n${output.slice(-2_000)}`);
}

/**
 * Consume the SSE stream into a real TickWindow, exactly as a browser would.
 *
 * Appends one tick at a time so a contiguity violation names the offending
 * sequence rather than a batch.
 */
async function streamInto(
  port: number,
  window: TickWindow,
  count: number,
  from?: number,
): Promise<void> {
  const controller = new AbortController();
  const query = from === undefined ? '' : `?from=${String(from)}`;
  const response = await fetch(`http://127.0.0.1:${port}/markets/${ASSET}/stream${query}`, {
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`stream returned ${response.status}`);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let taken = 0;
  try {
    while (taken < count) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      const frames = buffered.split('\n\n');
      buffered = frames.pop() ?? '';
      for (const frame of frames) {
        if (frame.includes('event: close')) continue;
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (line === undefined) continue;
        const raw = JSON.parse(line.slice(6)) as {
          sequence: number;
          instant: number;
          price: number;
        };
        const tick: Tick = {
          sequence: raw.sequence,
          instant: epochMillis(raw.instant),
          price: logPrice(raw.price),
        };
        window.append([tick]);
        taken += 1;
        if (taken >= count) break;
      }
    }
  } finally {
    controller.abort();
  }
}

describe('a client reconstructs the server record exactly', () => {
  it('survives a mid-stream disconnection and resumes without a hole', async () => {
    const port = await boot(34_301);

    const window = new TickWindow({ capacity: 10_000 });
    await streamInto(port, window, 60);
    const afterFirst = window.range!;
    expect(afterFirst.newest - afterFirst.oldest).toBe(59);

    // Drop the connection, then resume from exactly where we stopped. The window
    // itself refuses anything that does not continue it, so a server that
    // resumed from the wrong place would fail here rather than be papered over.
    await streamInto(port, window, 60, window.resumeFrom);

    const range = window.range!;
    expect(range.oldest).toBe(afterFirst.oldest);
    expect(range.newest).toBe(afterFirst.newest + 60);

    // Contiguous end to end across the disconnection.
    const { instants, prices } = window.series();
    expect(prices).toHaveLength(120);
    for (let i = 1; i < instants.length; i += 1) {
      expect(instants[i]!).toBeGreaterThanOrEqual(instants[i - 1]!);
    }

    // And it agrees with what the server itself reports right now.
    const view = (await (await fetch(`http://127.0.0.1:${port}/markets/${ASSET}`)).json()) as {
      sequence: number;
    };
    expect(view.sequence).toBeGreaterThanOrEqual(range.newest);
  }, 240_000);

  it('renders what it received, preserving every extreme', async () => {
    // The full path: server -> HTTP -> window -> reduction. The rendered columns
    // must still contain the window's true high and low, at any resolution.
    const port = await boot(34_301);

    const window = new TickWindow();
    await streamInto(port, window, 150);
    const { instants, prices } = window.series();
    const span = window.span!;
    const to = epochMillis(span.to + 1);
    const truth = windowExtremes(instants, prices, span.from, to)!;

    for (const columns of [7, 40, 300]) {
      const reduced = reduceToColumns(instants, prices, { from: span.from, to, columns });
      expect(reduced.length).toBeGreaterThan(0);
      expect(Math.max(...reduced.map((c) => c.high)), `high lost at ${columns}`).toBe(truth.high);
      expect(Math.min(...reduced.map((c) => c.low)), `low lost at ${columns}`).toBe(truth.low);
      expect(reduced.reduce((n, c) => n + c.tickCount, 0)).toBe(truth.count);
    }
  }, 240_000);

  it('two clients of the same server hold the same market', async () => {
    // INV-002 end to end: two independent HTTP clients, two independent windows.
    const port = await boot(34_301);

    const first = new TickWindow();
    const second = new TickWindow();
    await Promise.all([streamInto(port, first, 80), streamInto(port, second, 80)]);

    const a = first.range!;
    const b = second.range!;
    const overlapFrom = Math.max(a.oldest, b.oldest);
    const overlapTo = Math.min(a.newest, b.newest);
    expect(overlapTo - overlapFrom).toBeGreaterThan(20);

    const seriesA = first.series();
    const seriesB = second.series();
    let compared = 0;
    for (let sequence = overlapFrom; sequence <= overlapTo; sequence += 1) {
      const priceA = seriesA.prices[sequence - a.oldest]!;
      const priceB = seriesB.prices[sequence - b.oldest]!;
      expect(priceA, `clients disagreed at sequence ${sequence}`).toBe(priceB);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(20);
  }, 240_000);
});
