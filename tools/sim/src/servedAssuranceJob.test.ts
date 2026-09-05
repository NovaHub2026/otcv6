// Invariant evidence: INV-006 (no exploitable directional rules).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';

/**
 * PH-25.3, acceptance 4: an `exploitable` verdict is a non-zero exit.
 *
 * The job is a command; the only way to watch its exit code is to run it. A
 * venue is faked with `node:http` — the catalogue, the market view, the
 * stream — serving a record whose direction is the Thue–Morse parity of its
 * hour, and the job is spawned against it exactly as a scheduler would spawn
 * it. A venue that refuses everything is the other case: a failure the job
 * names, not a verdict.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '../dist/servedAssuranceJob.js');
const GENESIS = 1_776_000_000_000;
const ASSET = 'wire-otc';

function predictableByTheClock(hours: number, ticksPerHour = 60): Tick[] {
  const parity = (n: number): number => {
    let bits = 0;
    for (let v = n; v > 0; v >>= 1) bits ^= v & 1;
    return bits;
  };
  const out: Tick[] = [];
  let price = 0;
  const interval = 3_600_000 / ticksPerHour;
  for (let hour = 0; hour < hours; hour += 1) {
    const step = parity(hour) === 0 ? 1 : -1;
    for (let k = 0; k < ticksPerHour; k += 1) {
      price += step;
      out.push({
        sequence: out.length + 1,
        instant: epochMillis(GENESIS + Math.round((hour * ticksPerHour + k) * interval)),
        price: logPrice(price),
      });
    }
  }
  return out;
}

const servers: Server[] = [];
const directories: string[] = [];
afterAll(async () => {
  for (const server of servers) server.close();
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

/** A venue that serves one asset's record, or refuses every resume, or closes mid-read. */
function venue(
  ticks: readonly Tick[],
  refuseAll = false,
  closeAfter: number | null = null,
): Promise<string> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://venue');
    if (url.pathname === '/catalogue') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify([
          {
            id: ASSET,
            family: 'forex',
            logQuantum: 1e-5,
            displayPrecision: 5,
            referencePrice: 1,
            live: true,
            retired: false,
          },
        ]),
      );
      return;
    }
    if (url.pathname === `/markets/${ASSET}`) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: ASSET, sequence: ticks.length }));
      return;
    }
    if (url.pathname === `/markets/${ASSET}/stream`) {
      const from = Number(url.searchParams.get('from') ?? '1');
      if (refuseAll) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'this venue serves no history' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      let served = 0;
      for (const tick of ticks) {
        if (tick.sequence < from) continue;
        if (closeAfter !== null && served >= closeAfter) break;
        response.write(`id: ${String(tick.sequence)}\ndata: ${JSON.stringify(tick)}\n\n`);
        served += 1;
      }
      response.write(
        `event: close\ndata: ${JSON.stringify({
          reason: closeAfter === null ? 'record ends' : 'client fell behind during replay',
        })}\n\n`,
      );
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(
        `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}`,
      );
    });
  });
}

function run(args: readonly string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('exit', (code) => {
      resolve({ code, stderr });
    });
  });
}

describe('the job as a scheduler runs it', () => {
  it('exits 2 and writes **exploitable** for a venue serving a leak', async () => {
    const base = await venue(predictableByTheClock(600));
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-served-job-'));
    directories.push(directory);
    const out = path.join(directory, 'verdict.md');
    const { code, stderr } = await run(['--base', base, '--out', out, '--max-ticks', '36000']);
    expect(code, stderr).toBe(2);
    const text = await readFile(out, 'utf8');
    expect(text).toContain('**exploitable**');
    expect(text).toContain(`Venue: \`${base}\``);
    expect(text).toContain('Assets: 1 — 1 exploitable, 0 failed');
    expect(stderr).toMatch(/wire-otc: 36000 ticks, exploitable/);
  }, 120_000);

  it('exits 1 and names the failure for a venue that refuses everything', async () => {
    const base = await venue(predictableByTheClock(1), true);
    const { code, stderr } = await run(['--base', base]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/wire-otc: FAILED — .*400/);
  }, 60_000);

  it('exits 1 and records no verdict when the venue closes the read short (CA9 a4-01)', async () => {
    // The venue's 1 MB replay cap ends a long replay with a `close` that blames
    // the client; the job used to take the fragment as the retained window and
    // grade it. A read that did not reach the window's end is a failure with
    // the count in it, not a record.
    const base = await venue(predictableByTheClock(600), false, 1_000);
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-served-job-short-'));
    directories.push(directory);
    const out = path.join(directory, 'verdict.md');
    const { code, stderr } = await run(['--base', base, '--out', out, '--max-ticks', '36000']);
    expect(code, stderr).toBe(1);
    expect(stderr).toMatch(/wire-otc: FAILED — .*ended by close.*1000 of the 36000 ticks/);
    const text = await readFile(out, 'utf8');
    expect(text).toContain('**failed**');
    expect(text).toContain('Assets: 1 — 0 exploitable, 1 failed');
    expect(text).not.toContain('**exploitable**');
  }, 60_000);

  it('exits 1 without a venue', async () => {
    const { code, stderr } = await run(['--base', 'http://127.0.0.1:1']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/fetch failed|ECONNREFUSED/);
  }, 60_000);
});
