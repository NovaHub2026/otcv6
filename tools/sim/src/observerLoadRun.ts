import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeObserverLoad, runObserverLoad } from './observerLoad.js';

/**
 * PH-22.1's evidence run: how many observers this engine actually holds.
 *
 * A deliberate act, like `venueScale.ts` beside it — minutes long, run on a
 * quiet machine, recorded under `docs/evidence/`. The gate guards the harness's
 * own contract through `observerLoad.test.ts`; this produces the number.
 *
 * It boots its own engine into a temporary state directory, so it measures a
 * process it owns and can attribute CPU to by pid, and it sweeps observer
 * counts across three orders of magnitude. Every run reports refusals, gaps and
 * duplicates beside the throughput, because a run that dropped a third of its
 * connections is a different experiment and not a smaller one.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SWEEP = (process.env['OTC_LOAD_SWEEP'] ?? '1,10,100,500,1000,2000')
  .split(',')
  .map((entry) => Number.parseInt(entry.trim(), 10))
  .filter((entry) => Number.isSafeInteger(entry) && entry > 0);
const HOLD_MS = Number.parseInt(process.env['OTC_LOAD_HOLD_MS'] ?? '20000', 10);
const WARMUP_MS = Number.parseInt(process.env['OTC_LOAD_WARMUP_MS'] ?? '20000', 10);
const SECRET = 'a'.repeat(64);

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port'));
        return;
      }
      const { port } = address;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error(`engine did not answer /health within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function main(): Promise<void> {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-load-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const engine = spawn(process.execPath, [path.join(repoRoot, 'apps/api/dist/main.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      OTC_BIND: '127.0.0.1',
      OTC_STATE_DIR: stateDir,
      OTC_HISTORY_DB: path.join(stateDir, 'history.db'),
      OTC_MASTER_SECRET: SECRET,
      OTC_BACKFILL_DAYS: '0',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });

  try {
    await waitForHealth(baseUrl);
    const catalogue = (await (await fetch(`${baseUrl}/catalogue`)).json()) as {
      id: string;
      live: boolean;
    }[];
    const assetIds = catalogue.filter((asset) => asset.live).map((asset) => asset.id);
    if (assetIds.length === 0) throw new Error('no live assets to observe');

    console.info(
      `engine pid ${String(engine.pid)} on ${baseUrl}, ${String(assetIds.length)} assets`,
    );
    console.info(`sweep: ${SWEEP.join(', ')} observers, ${String(HOLD_MS / 1000)}s window each\n`);

    // **Warm the engine before the first size.** A freshly booted market has not
    // drawn its first ticks, so the smallest size measures a colder engine than
    // the largest — which is exactly what the first two runs of this instrument
    // showed, as a rise in ticks per observer that cannot be real: an
    // observer's tick count is a property of its asset, not of how many other
    // observers exist. That is PH-21.2's archetype-rotation mistake in a new
    // instrument, and read uncorrected it says "delivery improves under load".
    process.stdout.write('warming up... ');
    await runObserverLoad({ baseUrl, assetIds, observers: 4, holdMs: WARMUP_MS });
    console.info('done\n');

    // Interleaved and reversed on the second pass, so residual warm-up or drift
    // cannot masquerade as a size effect (CA7-24's lesson).
    for (const observers of [...SWEEP, ...[...SWEEP].reverse()]) {
      const report = await runObserverLoad({
        baseUrl,
        assetIds,
        observers,
        holdMs: HOLD_MS,
        ...(engine.pid === undefined ? {} : { enginePid: engine.pid }),
      });
      // Per observer **inside the window**: the only figure comparable across
      // sizes, because every size gets the same window on the same engine.
      const perObserver = report.established === 0 ? 0 : report.ticksInWindow / report.established;
      const engineCpuPerTick =
        report.engineCpuSeconds === null || report.ticksInWindow === 0
          ? null
          : (report.engineCpuSeconds * 1e6) / report.ticksInWindow;
      console.info(`--- ${String(observers)} observers ---`);
      console.info(describeObserverLoad(report));
      console.info(
        `ticks per observer (window) ${perObserver.toFixed(1)}` +
          (engineCpuPerTick === null
            ? ''
            : `   engine µs per delivered tick ${engineCpuPerTick.toFixed(1)}`),
      );
      console.info('');
      if (!report.complete) {
        console.info('stopping the sweep: the engine stopped establishing every observer\n');
        break;
      }
    }
  } finally {
    if (engine.pid !== undefined) {
      try {
        process.kill(-engine.pid, 'SIGKILL');
      } catch {
        engine.kill('SIGKILL');
      }
    }
    await rm(stateDir, { recursive: true, force: true });
  }
}

await main();
