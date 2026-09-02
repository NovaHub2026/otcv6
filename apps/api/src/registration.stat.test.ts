// Invariant evidence: INV-003 (one stream per asset), INV-007 (assets differ), INV-009 (records reproduce).
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Creating an asset, end to end, against a service in its own process.
 *
 * The pipeline is unit-tested and the registry is unit-tested. What neither can
 * see is the part that only exists once a service is running: an asset created
 * at 11:00 has to reach the venue, the history recorder and the publisher
 * *together*, appear in the catalogue, start printing ticks without a restart,
 * and still be there after one.
 *
 * That last clause is the one worth spending a process boundary on. An asset
 * the venue is publishing but the registry never stored would vanish at the next
 * deploy, taking a market that had already printed prices with it — and nothing
 * short of a real restart can falsify it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const entry = path.join(repoRoot, 'apps/api/dist/main.js');
const SECRET = 'c'.repeat(64);

const started: ChildProcess[] = [];
const directories: string[] = [];

afterAll(async () => {
  for (const child of started) if (child.exitCode === null) child.kill('SIGKILL');
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function boot(stateDir: string, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, OTC_STATE_DIR: stateDir, OTC_MASTER_SECRET: SECRET, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(child);
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`service exited (${child.exitCode}):\n${output.slice(-2_000)}`);
    }
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`never became healthy:\n${output.slice(-2_000)}`);
}

interface JobView {
  readonly state: string;
  readonly stage: string | null;
  readonly reason: string | null;
  readonly assetId: string | null;
}

async function post(port: number, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}/assets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Submit and wait for the job to finish, whatever it decides. */
async function register(port: number, brief: unknown): Promise<JobView> {
  const submitted = await post(port, brief);
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  const jobId = (submitted.body as { job: string }).job;
  const deadline = Date.now() + 180_000;
  for (;;) {
    const view = (await (
      await fetch(`http://127.0.0.1:${port}/registrations/${jobId}`)
    ).json()) as JobView;
    if (view.state !== 'queued' && view.state !== 'running') return view;
    if (Date.now() > deadline) throw new Error(`job never finished: ${JSON.stringify(view)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function catalogue(
  port: number,
): Promise<{ id: string; live: boolean; logQuantum: number }[]> {
  return (await (await fetch(`http://127.0.0.1:${port}/catalogue`)).json()) as {
    id: string;
    live: boolean;
    logQuantum: number;
  }[];
}

describe('an asset created from the panel', () => {
  it('is registered, hosted without a restart, and still there after one', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-register-'));
    directories.push(stateDir);
    const port = await freePort();
    await boot(stateDir, port);

    const before = await catalogue(port);
    expect(before.some((entry) => entry.id === 'testmetal')).toBe(false);

    // `metal` is the cheapest family to register — a 61-hour fit span at a
    // moderate tick rate — which is the only reason it is the one used here.
    const job = await register(port, {
      id: 'testmetal',
      archetypeId: 'metal',
      displayName: 'Test Metal',
      referencePrice: 1_900,
    });
    expect(job.state, `${job.stage ?? ''}: ${job.reason ?? ''}`).toBe('registered');
    expect(job.assetId).toBe('testmetal');

    const after = await catalogue(port);
    const created = after.find((entry) => entry.id === 'testmetal');
    expect(created, 'the new asset is in the catalogue').toBeDefined();
    // Hosted, not merely registered: the venue took it while running.
    expect(created!.live).toBe(true);
    expect(created!.logQuantum).toBeGreaterThan(0);

    // And it is actually publishing. A market in the catalogue that never prints
    // a tick is an entry in a list, not a market.
    const deadline = Date.now() + 60_000;
    let sequence = -1;
    while (Date.now() < deadline && sequence < 2) {
      const view = (await (await fetch(`http://127.0.0.1:${port}/markets/testmetal`)).json()) as {
        sequence: number | null;
      };
      sequence = view.sequence ?? -1;
      if (sequence < 2) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(sequence, 'the created market publishes ticks').toBeGreaterThanOrEqual(2);

    // The restart. Everything above could be true of an asset held only in one
    // process's memory.
    started[started.length - 1]!.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const second = await freePort();
    await boot(stateDir, second);
    const survived = (await catalogue(second)).find((entry) => entry.id === 'testmetal');
    expect(survived, 'the asset survived a restart').toBeDefined();
    expect(survived!.live).toBe(true);
    // Bit-identical lattice. A quantum that came back different would mean the
    // asset had been re-solved rather than read, and every settlement recorded
    // against the first one would be unreproducible (INV-009).
    expect(survived!.logQuantum).toBe(created!.logQuantum);
  }, 600_000);

  it('is renamed, retired, and stays retired across a restart', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-retire-'));
    directories.push(stateDir);
    const port = await freePort();
    await boot(stateDir, port);

    // Renaming a *compiled* asset, which is the case an overlay exists for:
    // `eurusd` was never registered here and is administered all the same.
    const renamed = await fetch(`http://127.0.0.1:${port}/assets/eurusd`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Euro / Dollar' }),
    });
    expect(renamed.status).toBe(200);
    expect((await catalogue(port)).find((e) => e.id === 'eurusd')).toBeDefined();

    // Everything that decided what already happened is refused by name.
    for (const field of ['id', 'logQuantum', 'referencePrice', 'traits']) {
      const response = await fetch(`http://127.0.0.1:${port}/assets/eurusd`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: 1 }),
      });
      expect(response.status, field).toBe(400);
      expect(JSON.stringify(await response.json()), field).toContain(field);
    }

    // Retire a market that is actually publishing, not one that has not started.
    // `spx` ticks slowly enough that sampling immediately finds no sequence.
    const deadline = Date.now() + 120_000;
    let before: { sequence: number | null } = { sequence: null };
    while (Date.now() < deadline && before.sequence === null) {
      before = (await (await fetch(`http://127.0.0.1:${port}/markets/spx`)).json()) as {
        sequence: number | null;
      };
      if (before.sequence === null) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const retired = await fetch(`http://127.0.0.1:${port}/assets/spx/retire`, { method: 'POST' });
    expect(retired.status).toBe(201);

    // No longer hosted, and the record it published is untouched: the history
    // endpoint still answers, because retiring stops generation and says nothing
    // about the past (INV-009).
    const after = await catalogue(port);
    expect(after.find((e) => e.id === 'spx')?.live).toBe(false);
    const to = Date.now();
    const history = await fetch(
      `http://127.0.0.1:${port}/markets/spx/history?timeframe=1h&from=${to - 86_400_000}&to=${to}`,
    );
    expect(history.status, 'a retired market keeps its record').toBe(200);

    // Final, and final across a restart. A market resumed after a gap would
    // either invent the interval or seam the record.
    expect(
      (await fetch(`http://127.0.0.1:${port}/assets/spx/retire`, { method: 'POST' })).status,
    ).toBe(409);
    started[started.length - 1]!.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const second = await freePort();
    await boot(stateDir, second);
    const survived = (await catalogue(second)).find((e) => e.id === 'spx');
    expect(survived?.live, 'a retired market is not resumed').toBe(false);
    expect(before.sequence, 'it had been publishing before').not.toBeNull();
  }, 300_000);

  it('refuses a duplicate id without running a solve', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-register-'));
    directories.push(stateDir);
    const port = await freePort();
    await boot(stateDir, port);

    const started_ = Date.now();
    const response = await post(port, {
      id: 'eurusd',
      archetypeId: 'major-fx',
      displayName: 'Duplicate',
      referencePrice: 1.1,
    });
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toMatch(/already registered/i);
    // Immediately, not after a calibration: the identity stage needs no
    // simulation and an operator who mistyped should hear so at once.
    expect(Date.now() - started_).toBeLessThan(5_000);
  }, 180_000);

  it('refuses a body that is not a brief, naming the field', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-register-'));
    directories.push(stateDir);
    const port = await freePort();
    await boot(stateDir, port);

    for (const [body, expected] of [
      [{ archetypeId: 'metal', displayName: 'x', referencePrice: 1 }, /id must be a string/],
      [{ id: 'x', archetypeId: 'nope', displayName: 'x', referencePrice: 1 }, /Unknown archetype/],
      [{ id: 'x', archetypeId: 'metal', displayName: '', referencePrice: 1 }, /displayName/],
      [{ id: 'x', archetypeId: 'metal', displayName: 'x', referencePrice: -1 }, /referencePrice/],
      [
        { id: 'x', archetypeId: 'metal', displayName: 'x', referencePrice: 1, dispersion: -0.2 },
        /dispersion/,
      ],
      [
        { id: 'X-BAD', archetypeId: 'metal', displayName: 'x', referencePrice: 1 },
        /must match|filename/,
      ],
    ] as const) {
      const response = await post(port, body);
      expect(response.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(response.body), JSON.stringify(body)).toMatch(expected);
    }
  }, 180_000);
});
