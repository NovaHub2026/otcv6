// Invariant evidence: INV-008 (continuous market state), INV-002 (shared market).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

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
}

const started: ChildProcess[] = [];
const directories: string[] = [];

afterAll(async () => {
  for (const child of started) if (child.exitCode === null) child.kill('SIGKILL');
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function boot(stateDir: string, port: number): Promise<Running> {
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
  await waitForHealth(port, child);
  return { child, port };
}

async function waitForHealth(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = 'never responded';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service exited early (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
      lastError = `status ${response.status}`;
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
