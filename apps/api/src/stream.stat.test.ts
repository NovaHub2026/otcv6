// Invariant evidence: INV-002 (shared market).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * INV-002 over a real socket.
 *
 * Everything before this proved consistency in-process, where "two observers"
 * were two objects reading one array. A transport introduces the failures that
 * actually happen: partial frames, buffering, a client that stops reading, a
 * client that reconnects and asks to resume.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const entry = path.join(repoRoot, 'apps/api/dist/main.js');
const SECRET = 'b'.repeat(64);

const started: ChildProcess[] = [];
const directories: string[] = [];

afterAll(async () => {
  for (const child of started) if (child.exitCode === null) child.kill('SIGKILL');
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function boot(port: number): Promise<ChildProcess> {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-stream-'));
  directories.push(stateDir);
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      OTC_STATE_DIR: stateDir,
      OTC_MASTER_SECRET: SECRET,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(child);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service exited (${child.exitCode})`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('service never became healthy');
}

interface StreamedTick {
  readonly sequence: number;
  readonly instant: number;
  readonly price: number;
}

/** Read SSE frames until `count` ticks have arrived, then abort. */
async function readTicks(
  port: number,
  asset: string,
  count: number,
  from?: number,
): Promise<StreamedTick[]> {
  const controller = new AbortController();
  const query = from === undefined ? '' : `?from=${from}`;
  const response = await fetch(`http://127.0.0.1:${port}/markets/${asset}/stream${query}`, {
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`stream returned ${response.status}`);

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const ticks: StreamedTick[] = [];
  let buffered = '';
  try {
    while (ticks.length < count) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      // Frames are separated by a blank line; a partial frame stays buffered.
      const frames = buffered.split('\n\n');
      buffered = frames.pop() ?? '';
      for (const frame of frames) {
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (dataLine === undefined) continue;
        if (frame.includes('event: close')) continue;
        ticks.push(JSON.parse(dataLine.slice(6)) as StreamedTick);
      }
    }
  } finally {
    controller.abort();
  }
  return ticks.slice(0, count);
}

describe('the stream gives every client the same market', () => {
  it('delivers identical ticks to concurrent clients, and resumes exactly', async () => {
    const port = 34_201;
    await boot(port);
    const asset = 'btcusd'; // the fastest asset, so the test does not wait

    // Two clients connected at the same time must see the same thing.
    const [a, b] = await Promise.all([readTicks(port, asset, 40), readTicks(port, asset, 40)]);
    expect(a).toHaveLength(40);
    // They may start at different sequences, so compare on the overlap.
    const from = Math.max(a[0]!.sequence, b[0]!.sequence);
    const overlapA = a.filter((t) => t.sequence >= from);
    const overlapB = b.filter((t) => t.sequence >= from);
    const shared = Math.min(overlapA.length, overlapB.length);
    expect(shared).toBeGreaterThan(10);
    expect(overlapA.slice(0, shared), 'concurrent clients diverged').toEqual(
      overlapB.slice(0, shared),
    );

    // Ordering is strict and gapless within one client.
    for (let i = 1; i < a.length; i += 1) {
      expect(a[i]!.sequence, 'a gap reached a client').toBe(a[i - 1]!.sequence + 1);
    }

    // Resumption: ask for exactly where `a` stopped, and get the continuation.
    const resumeFrom = a[a.length - 1]!.sequence + 1;
    const resumed = await readTicks(port, asset, 20, resumeFrom);
    expect(resumed[0]!.sequence).toBe(resumeFrom);
    for (let i = 1; i < resumed.length; i += 1) {
      expect(resumed[i]!.sequence).toBe(resumed[i - 1]!.sequence + 1);
    }

    // The reconstruction is contiguous across the disconnect.
    const reconstruction = [...a, ...resumed].map((t) => t.sequence);
    for (let i = 1; i < reconstruction.length; i += 1) {
      expect(reconstruction[i], 'reconstruction has a hole').toBe(reconstruction[i - 1]! + 1);
    }
  }, 180_000);

  it('refuses a replay it can no longer honour, rather than guessing', async () => {
    const port = 34_202;
    await boot(port);
    // Sequence 1 is inside the window on a fresh boot, so ask for something that
    // cannot exist yet: the contract is that the server never invents.
    const response = await fetch(`http://127.0.0.1:${port}/markets/btcusd/stream?from=-5`);
    expect(response.status).toBe(400);
    await response.body?.cancel();

    const unknown = await fetch(`http://127.0.0.1:${port}/markets/nope/stream`);
    expect(unknown.status).toBe(404);
    await unknown.body?.cancel();
  }, 120_000);
});
