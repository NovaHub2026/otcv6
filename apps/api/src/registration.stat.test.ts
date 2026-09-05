// Invariant evidence: INV-003 (one stream per asset), INV-007 (assets differ), INV-009 (records reproduce).
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ASSET_CATALOGUE } from '@otc/engine';

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
/** The operator's write credential. Public by construction: this is a test. */
const TOKEN = 'registration-test-token-'.padEnd(32, 'r');
const JSON_HEADERS = { 'content-type': 'application/json' };
const WRITE_HEADERS = { ...JSON_HEADERS, authorization: `Bearer ${TOKEN}` };

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

/**
 * Boot the service and wait for *this* child to answer.
 *
 * **a6-14.** The first healthy `/health` on the port used to be taken as the
 * child's; a foreign engine already listening there answers at once. The child
 * is given a nonce and `/health` echoes it, so a service that answers without
 * it is somebody else's.
 */
async function boot(
  stateDir: string,
  port: number,
  env: Record<string, string> = { OTC_ADMIN_TOKEN: TOKEN },
): Promise<ChildProcess> {
  const nonce = randomUUID();
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      OTC_ADMIN_TOKEN: '',
      ...env,
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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`service exited (${child.exitCode}):\n${output.slice(-2_000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const health = (await response.json()) as { bootNonce: string | null };
        if (health.bootNonce === nonce) return child;
      }
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
    headers: WRITE_HEADERS,
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

/**
 * Two compiled assets to rename and retire, derived rather than named
 * (PH-26.3): the first in the catalogue, and the slowest tape — which ticks
 * slowly enough that sampling immediately finds no sequence, the property the
 * retire flow waits on.
 */
const RENAMED = ASSET_CATALOGUE[0]!.definition.id;
/** A third compiled asset nothing in this file may change: the write-surface test's subject. */
const UNTOUCHED = ASSET_CATALOGUE[2]!.definition.id;
const RETIRED = [...ASSET_CATALOGUE].sort(
  (a, b) => b.evidence.meanIntervalMs - a.evidence.meanIntervalMs,
)[0]!.definition.id;

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
    // The first compiled asset was never registered here and is administered all the same.
    const renamed = await fetch(`http://127.0.0.1:${port}/assets/${RENAMED}`, {
      method: 'PATCH',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ displayName: 'Euro / Dollar' }),
    });
    expect(renamed.status).toBe(200);
    expect((await catalogue(port)).find((e) => e.id === RENAMED)).toBeDefined();

    // Everything that decided what already happened is refused by name.
    for (const field of ['id', 'logQuantum', 'referencePrice', 'traits']) {
      const response = await fetch(`http://127.0.0.1:${port}/assets/${RENAMED}`, {
        method: 'PATCH',
        headers: WRITE_HEADERS,
        body: JSON.stringify({ [field]: 1 }),
      });
      expect(response.status, field).toBe(400);
      expect(JSON.stringify(await response.json()), field).toContain(field);
    }

    // Retire a market that is actually publishing, not one that has not started.
    // The slowest tape ticks slowly enough that sampling immediately finds no sequence.
    const deadline = Date.now() + 120_000;
    let before: { sequence: number | null } = { sequence: null };
    while (Date.now() < deadline && before.sequence === null) {
      before = (await (await fetch(`http://127.0.0.1:${port}/markets/${RETIRED}`)).json()) as {
        sequence: number | null;
      };
      if (before.sequence === null) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const retired = await fetch(`http://127.0.0.1:${port}/assets/${RETIRED}/retire`, {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: '{}',
    });
    expect(retired.status).toBe(201);

    // No longer hosted, and the record it published is untouched: the history
    // endpoint still answers, because retiring stops generation and says nothing
    // about the past (INV-009).
    const after = await catalogue(port);
    expect(after.find((e) => e.id === RETIRED)?.live).toBe(false);
    const to = Date.now();
    const history = await fetch(
      `http://127.0.0.1:${port}/markets/${RETIRED}/history?timeframe=1h&from=${to - 86_400_000}&to=${to}`,
    );
    expect(history.status, 'a retired market keeps its record').toBe(200);

    // Final, and final across a restart. A market resumed after a gap would
    // either invent the interval or seam the record.
    expect(
      (
        await fetch(`http://127.0.0.1:${port}/assets/${RETIRED}/retire`, {
          method: 'POST',
          headers: WRITE_HEADERS,
          body: '{}',
        })
      ).status,
    ).toBe(409);
    started[started.length - 1]!.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const second = await freePort();
    await boot(stateDir, second);
    const survived = (await catalogue(second)).find((e) => e.id === RETIRED);
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
      id: RENAMED,
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

    const metal = { id: 'x', archetypeId: 'metal', displayName: 'x', referencePrice: 1 };
    for (const [body, expected] of [
      [{ archetypeId: 'metal', displayName: 'x', referencePrice: 1 }, /id must be a string/],
      [{ ...metal, archetypeId: 'nope' }, /Unknown archetype/],
      [{ ...metal, displayName: '' }, /displayName/],
      [{ ...metal, referencePrice: -1 }, /referencePrice/],
      [{ ...metal, dispersion: -0.2 }, /dispersion/],
      // A malformed id is the request's fault: 400, never 409 (a6-08).
      [{ ...metal, id: 'X-BAD' }, /must match/],
      [{ ...metal, id: 'a'.repeat(52) }, /maximum is 51/],
      // `null` is not "not supplied", and an unknown field is not ignored (a6-07).
      [{ ...metal, dispersion: null }, /dispersion .* null/],
      // The body is compared as JSON text, so the quotes around the name are escaped.
      [{ ...metal, drift: 5 }, /Unknown field \\"drift\\"/],
      [{ ...metal, displayName: 'n'.repeat(65) }, /most a name may hold is 64/],
    ] as const) {
      const response = await post(port, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(response.body), JSON.stringify(body)).toMatch(expected);
    }
  }, 180_000);

  it('closes the write surface to anything but the operator, whatever the origin (a6-01)', async () => {
    // Measured before this existed: `curl -X POST /assets/<id>/retire -H
    // 'Origin: http://evil.example'` answered 201 and the market was retired
    // for good. A request with no body and no custom header is one a browser
    // sends without a preflight, so CORS never saw it; and CORS only ever
    // decided who may *read* an answer.
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-auth-'));
    directories.push(stateDir);
    const port = await freePort();
    await boot(stateDir, port);
    const retire = `http://127.0.0.1:${port}/assets/${UNTOUCHED}/retire`;
    const evil = { Origin: 'http://evil.example' };

    const simple = await fetch(retire, { method: 'POST', headers: evil });
    expect(simple.status, 'the simple request a page can send').toBe(403);
    expect(await simple.text()).toMatch(/Authorization: Bearer/);

    const wrong = await fetch(retire, {
      method: 'POST',
      headers: { ...evil, ...JSON_HEADERS, authorization: 'Bearer not-the-operator-token-at-all' },
    });
    expect(wrong.status, 'the wrong token').toBe(403);

    const text = await fetch(retire, {
      method: 'POST',
      headers: { ...evil, authorization: `Bearer ${TOKEN}`, 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(text.status, 'the right token with a body a browser would not preflight').toBe(415);

    const still = (await catalogue(port)).find((entry) => entry.id === UNTOUCHED);
    expect(still?.live, 'nothing above retired anything').toBe(true);

    const genuine = await fetch(retire, {
      method: 'POST',
      headers: { ...evil, ...WRITE_HEADERS },
      body: '{}',
    });
    expect(genuine.status, 'the operator, from any origin').toBe(201);

    // Reads never needed a credential and still do not.
    expect((await fetch(`http://127.0.0.1:${port}/catalogue`, { headers: evil })).status).toBe(200);
  }, 180_000);

  it('boots without a token with every write refused by name, and refuses a token too short to be one', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-notoken-'));
    directories.push(stateDir);
    const port = await freePort();
    await boot(stateDir, port, {});
    const refused = await fetch(`http://127.0.0.1:${port}/assets/${RENAMED}`, {
      method: 'PATCH',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ displayName: 'Nope' }),
    });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toMatch(/OTC_ADMIN_TOKEN is not set/);
    expect((await fetch(`http://127.0.0.1:${port}/markets`)).status, 'reads are unaffected').toBe(
      200,
    );

    await expect(boot(stateDir, await freePort(), { OTC_ADMIN_TOKEN: 'short' })).rejects.toThrow(
      /OTC_ADMIN_TOKEN is 5 characters/,
    );
  }, 180_000);
});
