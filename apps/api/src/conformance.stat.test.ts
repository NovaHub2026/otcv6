// Invariant evidence: INV-009 (reproducible settlement) — the broker's checklist passes against the shipped service.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { conformance, renderConformance } from '@otc/client';

/**
 * PH-29.3: `npm run conformance` against the venue this repository ships,
 * production-composed, with a record and publication on — the run a broker
 * makes against its own deployment, made here against a spawned one.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '../dist/main.js');
const SECRET = 'cd'.repeat(32);
const started: ChildProcess[] = [];
const directories: string[] = [];
afterAll(async () => {
  for (const child of started) if (child.exitCode === null) child.kill('SIGKILL');
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function boot(port: number): Promise<{ base: string; output: () => string }> {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-conformance-'));
  directories.push(stateDir);
  const nonce = randomUUID();
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      OTC_STATE_DIR: stateDir,
      OTC_PUBLICATION_DIR: path.join(stateDir, 'publication'),
      OTC_PUBLISHING_KEY: 'ef'.repeat(32),
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
    if (child.exitCode !== null)
      throw new Error(`service exited (${child.exitCode}):\n${output.slice(-2_000)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (
        response.ok &&
        ((await response.json()) as { bootNonce: string | null }).bootNonce === nonce
      ) {
        return { base: `http://127.0.0.1:${port}`, output: () => output };
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`service never became healthy:\n${output.slice(-2_000)}`);
}

describe('the shipped venue conforms to its own contract', () => {
  it('passes every check of the conformance suite, proof included', async () => {
    const running = await boot(34_601);
    // Enough ticks for the fastest market to close a few 500-tick windows
    // would take minutes; the publication window is the default here, so the
    // proof check reports "not yet committed" honestly unless one has closed.
    await new Promise((resolve) => setTimeout(resolve, 45_000));
    const report = await conformance({
      baseUrl: running.base,
      ticks: 60,
      signal: AbortSignal.timeout(300_000),
    });
    const failed = report.checks.filter((c) => !c.ok);
    expect(failed, renderConformance(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.assets.length).toBe(30);
    console.log(renderConformance(report));
  }, 400_000);
});
