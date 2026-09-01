// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The claim this subphase exists to make: **several processes, one leader.**
 *
 * Nothing in a single-process suite can test it. The in-memory store's
 * atomicity argument was "the critical section contains no `await`", which is
 * true and says nothing about a second process; the SQLite store replaces it
 * with `BEGIN IMMEDIATE`, and the difference between that and a deferred
 * transaction is invisible until two processes race.
 *
 * Measured: swapping `BEGIN IMMEDIATE` for `BEGIN` leaves every other test in
 * this package green. That is what this file is for.
 *
 * **It runs against `dist/`**, because a child process cannot use Vitest's
 * module resolution. `npm run build` therefore precedes it — the same ordering
 * the lint step already depends on (ADR-0009) — and a missing build fails
 * loudly rather than skipping, because a test that quietly does not run is the
 * defect this project has found more often than any other.
 */

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const storeModule = path.join(repoRoot, 'packages/runtime/dist/sqliteStore.js');

const directories: string[] = [];
async function scratch(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-sqlite-race-'));
  directories.push(directory);
  return directory;
}

afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/**
 * A child that opens the shared database and tries to lead one asset.
 *
 * It reports one JSON line: what the store told it, and the token if it won.
 * Nothing is coordinated between children beyond the barrier instant — they
 * are started together and left to race.
 */
const CHILD = `
import { SqliteCoordinatedStore } from ${JSON.stringify(storeModule)};

const [, , file, holder, roundsRaw, startAtRaw] = process.argv;
const rounds = Number(roundsRaw);
const startAt = Number(startAtRaw);

class FixedClock {
  now() {
    return 1776000000000;
  }
}

// A barrier, so the children contend rather than arriving in turn. Sleeping
// alone would let the operating system schedule them apart, which is exactly
// the interleaving that hides the defect — so it sleeps until the last few
// milliseconds and spins only for those.
//
// The spin is short on purpose. Six processes burning a core each for 400ms
// made the rest of the unit suite busier, and a PH-13 Monte Carlo test that had
// always sat at half its timeout went over it. Cost here is not free to anyone
// else.
const spinFrom = startAt - 3;
if (Date.now() < spinFrom) {
  await new Promise((resolve) => setTimeout(resolve, spinFrom - Date.now()));
}
while (Date.now() < startAt) {
  /* spin */
}

const store = new SqliteCoordinatedStore(file, new FixedClock());
const granted = {};
const errors = [];
try {
  // Many rounds on many assets. One round is not enough: the winner of a single
  // race commits before the losers open their transactions, so nothing
  // contends and a deferred transaction looks identical to an immediate one.
  // Measured: a single-round version of this test passed with a deferred
  // transaction, which is exactly the defect it was written to catch.
  for (let round = 0; round < rounds; round += 1) {
    const assetId = 'a' + round;
    try {
      const outcome = await store.acquire(assetId, holder);
      if (outcome.kind === 'granted') {
        granted[assetId] = outcome.grant.token;
        // A winner also writes, so a store that granted twice leaves two
        // writers in the record rather than only two rows in the lease table.
        await store.appendTicks(assetId, outcome.grant.token, [
          { sequence: 1, instant: 1776000000000, price: 1 },
        ]);
      }
    } catch (error) {
      errors.push(round + ': ' + String(error && error.message));
    }
  }
} finally {
  store.close();
}
process.stdout.write(JSON.stringify({ holder, granted, errors }));
`;

interface ChildResult {
  readonly holder: string;
  /** Assets this child was granted, and the token it got. */
  readonly granted: Record<string, number>;
  readonly errors: readonly string[];
}

async function race(children: number, rounds: number): Promise<ChildResult[]> {
  if (!existsSync(storeModule)) {
    throw new Error(
      `This test drives child processes against ${path.relative(repoRoot, storeModule)}, which ` +
        `does not exist. Run \`npm run build\` first — the same ordering \`npm run lint\` ` +
        `already requires.`,
    );
  }
  const directory = await scratch();
  const script = path.join(directory, 'child.mjs');
  const file = path.join(directory, 'venue.db');
  await writeFile(script, CHILD, 'utf8');

  // Far enough ahead that every child is spinning on the barrier before it lifts.
  const startAt = Date.now() + 300;
  const results = await Promise.all(
    Array.from({ length: children }, (_, index) =>
      run(process.execPath, [script, file, `node-${index}#race`, String(rounds), String(startAt)], {
        timeout: 60_000,
      }).then(({ stdout }) => JSON.parse(stdout) as ChildResult),
    ),
  );
  return results;
}

describe('several processes, one leader', () => {
  const CHILDREN = 6;
  const ROUNDS = 150;

  it('grants each asset to exactly one process, across 900 contended acquisitions', async () => {
    const results = await race(CHILDREN, ROUNDS);

    // Contention is the expected state of a healthy cluster, not a failure.
    // Without `busy_timeout` the loser of every race raises SQLITE_BUSY, and
    // without `BEGIN IMMEDIATE` a deferred transaction cannot upgrade and
    // raises SQLITE_BUSY_SNAPSHOT — which the busy handler does not retry.
    expect(results.flatMap((r) => r.errors)).toEqual([]);

    const winners = new Map<string, string[]>();
    const tokens = new Map<string, number[]>();
    for (const result of results) {
      for (const [assetId, token] of Object.entries(result.granted)) {
        winners.set(assetId, [...(winners.get(assetId) ?? []), result.holder]);
        tokens.set(assetId, [...(tokens.get(assetId) ?? []), token]);
      }
    }

    expect(winners.size).toBe(ROUNDS);
    for (const [assetId, holders] of winners) {
      expect(holders, `${assetId} was granted to ${holders.join(' and ')}`).toHaveLength(1);
    }
    // And no token was issued twice, which is the corruption a lost update
    // produces: two grants that both believe they are current.
    for (const [assetId, issued] of tokens) {
      expect(new Set(issued).size, `${assetId} issued a duplicate token`).toBe(issued.length);
    }
  }, 120_000);

  it("leaves exactly one writer in every asset's record", async () => {
    const results = await race(CHILDREN, 40);
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    const counts = new Map<string, number>();
    for (const result of results) {
      for (const assetId of Object.keys(result.granted)) {
        counts.set(assetId, (counts.get(assetId) ?? 0) + 1);
      }
    }
    expect([...counts.values()].filter((count) => count !== 1)).toEqual([]);
    expect(counts.size).toBe(40);
  }, 120_000);
});
