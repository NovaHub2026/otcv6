// Invariant evidence: INV-008 (continuous market state), INV-002 (shared market).
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ASSET_CATALOGUE } from '@otc/engine';

/** The fastest tape in the catalogue, derived rather than named (PH-26.3). */
const FASTEST = [...ASSET_CATALOGUE].sort(
  (a, b) => a.evidence.meanIntervalMs - b.evidence.meanIntervalMs,
)[0]!.definition.id;

/**
 * The phase's acceptance: a restart across a **real process boundary**.
 *
 * Everything before this proved continuity in-process, where the "restart" was a
 * new object in the same heap. That is a materially weaker claim: it cannot
 * catch state that lives in a module-level variable, a snapshot that fails to
 * round-trip through JSON, or a store that never actually reached the disk.
 *
 * So this spawns the service, lets it publish, kills it with SIGKILL — no
 * shutdown hook, no final checkpoint, the worst case the design has to survive —
 * and starts it again on the same state directory.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const entry = path.join(repoRoot, 'apps/api/dist/main.js');

// A fixed 32-byte secret so both boots are the same market. Public by
// construction: this is a test.
const SECRET = 'a'.repeat(64);

interface Running {
  readonly child: ChildProcess;
  readonly port: number;
  /** Everything the child has written to stdout and stderr so far. */
  readonly output: () => string;
}

const started: ChildProcess[] = [];
const directories: string[] = [];

afterAll(async () => {
  for (const child of started) if (child.exitCode === null) child.kill('SIGKILL');
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function boot(stateDir: string, port: number): Promise<Running> {
  // A nonce `/health` echoes, so a foreign engine on this fixed port is not
  // mistaken for the child (a6-14).
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
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  await waitForHealth(port, child, nonce);
  return { child, port, output: () => output };
}

async function waitForHealth(port: number, child: ChildProcess, nonce: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = 'never responded';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service exited early (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const health = (await response.json()) as { bootNonce: string | null };
        if (health.bootNonce === nonce) return;
        lastError = `a service without this boot's nonce is answering on ${port}`;
      } else {
        lastError = `status ${response.status}`;
      }
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`service never became healthy: ${lastError}`);
}

interface MarketView {
  readonly id: string;
  readonly price: number | null;
  readonly sequence: number | null;
  readonly recovery: { kind: string; reason?: string } | null;
}

async function markets(port: number): Promise<MarketView[]> {
  const response = await fetch(`http://127.0.0.1:${port}/markets`);
  return (await response.json()) as MarketView[];
}

/** Poll until every market has published at least `minSequence` ticks. */
async function waitForTicks(port: number, minSequence: number): Promise<MarketView[]> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const view = await markets(port);
    if (view.every((m) => (m.sequence ?? -1) >= minSequence)) return view;
    if (Date.now() > deadline) {
      throw new Error(`markets never reached sequence ${minSequence}: ${JSON.stringify(view)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe('the venue survives being killed', () => {
  it('resumes every market and never restarts its sequence', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-restart-'));
    directories.push(stateDir);

    const first = await boot(stateDir, 34_101);
    const before = await waitForTicks(first.port, 3);
    expect(before.length).toBeGreaterThanOrEqual(5);
    for (const market of before) {
      expect(market.recovery?.kind, `${market.id} first boot`).toBe('fresh');
    }

    // Give the checkpoint cadence (5s) time to write at least once.
    await new Promise((resolve) => setTimeout(resolve, 7_000));
    const atKill = await markets(first.port);

    // SIGKILL: no shutdown hook, no final checkpoint.
    first.child.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(first.child.exitCode ?? first.child.signalCode).toBeTruthy();

    const second = await boot(stateDir, 34_102);
    const after = await markets(second.port);

    for (const market of after) {
      const previous = atKill.find((m) => m.id === market.id)!;
      // Resumed, not fresh: a fresh start here would mean the state directory
      // was not read, and the market would silently begin again at genesis.
      expect(market.recovery?.kind, `${market.id} recovery`).toBe('resumed');
      // The sequence continues. It may have advanced further while catching up,
      // but it must never go backwards — that would be a second, different
      // market published under the same asset id.
      expect(market.sequence, `${market.id} sequence`).toBeGreaterThanOrEqual(
        previous.sequence ?? 0,
      );
    }
  }, 180_000);

  it('shuts down once on SIGTERM, exits 0, closes the history, and tells its stream clients', async () => {
    // **a6-09.** Two handlers raced on SIGTERM — this file's own and Nest's —
    // so the final checkpoint ran twice from one pid, the process died by
    // signal (143) rather than exiting, and the SQLite history was never
    // closed: a multi-megabyte WAL beside a 4 KB database at every shutdown.
    // A connected stream client is the other half: the listener's close waits
    // for active connections, and a live market's clients are all active.
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-sigterm-'));
    directories.push(stateDir);
    const running = await boot(stateDir, 34_104);
    await waitForTicks(running.port, 1);

    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${running.port}/markets/${FASTEST}/stream`, {
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let received = '';
    const drained = (async (): Promise<void> => {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        received += decoder.decode(chunk.value, { stream: true });
      }
    })().catch(() => undefined);

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      running.child.on('exit', (code, signal) => {
        resolve({ code, signal });
      }),
    );
    running.child.kill('SIGTERM');
    const outcome = await Promise.race([
      exited,
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          reject(new Error(`still running 20 s after SIGTERM:\n${running.output().slice(-2_000)}`));
        }, 20_000),
      ),
    ]);
    // Exited, not killed: the shutdown ran to its end.
    expect(outcome, running.output().slice(-2_000)).toEqual({ code: 0, signal: null });
    await drained;
    controller.abort();
    // The client was told, in the stream's own vocabulary, rather than dropped.
    expect(received).toContain('event: close');
    expect(received).toContain('server shutting down');
    // One checkpoint, one close.
    expect(running.output()).toContain('candle history closed');
    expect(running.output()).not.toMatch(/ENOENT|ERROR/);
    // A closed SQLite connection checkpoints and removes its WAL; a WAL left
    // behind is the signature of a database that was never closed.
    await expect(access(path.join(stateDir, 'history.db'))).resolves.toBeUndefined();
    await expect(access(path.join(stateDir, 'history.db-wal'))).rejects.toThrow();
  }, 120_000);

  it('refuses to start without a master secret', async () => {
    // The runtime must never invent a secret: doing so would produce a different
    // market on every boot and make settlement irreproducible (INV-009).
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-nosecret-'));
    directories.push(stateDir);
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, OTC_STATE_DIR: stateDir, OTC_MASTER_SECRET: '', PORT: '34103' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    started.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/OTC_MASTER_SECRET/);
  }, 60_000);
});
