import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ObserverLoadReport } from './observerLoad.js';

/**
 * The observer fleet (PH-30.3): ten thousand observers on one venue, from
 * several processes, with the venue's memory measured at every size.
 *
 *   npm run observer:fleet -- [--sizes 1000,2500,5000,10000] [--workers 8] [--hold 20000] [--per-connection 8] [--arrival 2] [--out report.md]
 *
 * `CYCLE-8-OBSERVER-LOAD.md` stopped at two thousand from one process because
 * the harness had become what was measured. Here each worker holds its share
 * — one connection per eight assets, the shape a page has since PH-30.2 —
 * and reports gaps, duplicates and latency; the driver adds them up and reads
 * `/metrics` for connections, subscribers and resident memory. The size the
 * machine holds is the headline, and what stopped it is named.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const SECRET = 'b'.repeat(64);

interface Options {
  readonly sizes: readonly number[];
  readonly workers: number;
  readonly holdMs: number;
  readonly perConnection: number;
  /** Milliseconds between one worker's connection attempts: the fleet's arrival rate is the workers over this. */
  readonly arrivalMs: number;
  readonly out: string | null;
}

export function parseFleetArgs(argv: readonly string[]): Options {
  const options = {
    sizes: [1_000, 2_500, 5_000, 10_000],
    workers: 8,
    holdMs: 20_000,
    perConnection: 8,
    arrivalMs: 2,
    out: null as string | null,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new RangeError(`${String(flag)} needs a value.`);
    if (flag === '--sizes')
      options.sizes = value
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isSafeInteger(n) && n > 0);
    else if (flag === '--workers') options.workers = Number(value);
    else if (flag === '--hold') options.holdMs = Number(value);
    else if (flag === '--per-connection') options.perConnection = Number(value);
    else if (flag === '--arrival') options.arrivalMs = Number(value);
    else if (flag === '--out') options.out = value;
    else throw new RangeError(`Unknown option ${String(flag)}.`);
  }
  if (options.sizes.length === 0) throw new RangeError('--sizes must name at least one size.');
  for (const [name, n] of [
    ['--workers', options.workers],
    ['--hold', options.holdMs],
    ['--per-connection', options.perConnection],
    ['--arrival', options.arrivalMs],
  ] as const) {
    if (!Number.isSafeInteger(n) || n < 1)
      throw new RangeError(`${name} must be a positive integer.`);
  }
  return options;
}

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function metric(baseUrl: string, name: string): Promise<number | null> {
  const text = await (await fetch(`${baseUrl}/metrics`)).text();
  const line = text.split('\n').find((l) => l.startsWith(`${name} `));
  return line === undefined ? null : Number(line.slice(name.length + 1));
}

interface Sample {
  readonly connections: number | null;
  readonly subscribers: number | null;
  readonly residentBytes: number | null;
}
async function sample(baseUrl: string): Promise<Sample> {
  return {
    connections: await metric(baseUrl, 'otc_stream_connections'),
    subscribers: await metric(baseUrl, 'otc_stream_subscribers'),
    residentBytes: await metric(baseUrl, 'otc_process_resident_bytes'),
  };
}

function worker(
  baseUrl: string,
  assets: readonly string[],
  observers: number,
  holdMs: number,
  perConnection: number,
  arrivalMs: number,
): Promise<ObserverLoadReport> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(here, 'observerFleetWorker.js'),
        baseUrl,
        assets.join(','),
        String(observers),
        String(holdMs),
        String(perConnection),
        String(arrivalMs),
      ],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`worker exited ${String(code)}`));
      try {
        resolve(JSON.parse(out.trim().split('\n').pop() ?? '') as ObserverLoadReport);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export interface FleetRow {
  readonly observers: number;
  readonly workers: number;
  readonly established: number;
  readonly gaps: number;
  readonly duplicates: number;
  readonly ticksInWindow: number;
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly during: Sample;
  readonly after: Sample;
  readonly complete: boolean;
  /** Why observers were not established, added up over the workers. */
  readonly refused: readonly { readonly reason: string; readonly count: number }[];
}

export function renderFleet(
  rows: readonly FleetRow[],
  baseline: Sample,
  commit: string,
  machine: string,
): string {
  const mb = (b: number | null): string => (b === null ? '—' : (b / 1_048_576).toFixed(0));
  const lines = [
    '# Ten thousand observers, from several processes (PH-30.3)',
    '',
    'Type: EVIDENCE (generated by `npm run observer:fleet`)',
    `Commit: \`${commit}\``,
    `Machine: ${machine}`,
    `Venue at rest: RSS ${mb(baseline.residentBytes)} MB, ${String(baseline.connections)} connections`,
    '',
    '| observers | workers | established | connections | subscribers | RSS during (MB) | RSS after (MB) | MB per connection | ticks in window | gaps | duplicates | p50 | p99 | complete |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => {
      const refused =
        r.refused.length === 0
          ? ''
          : ` — refused: ${r.refused.map((x) => `${String(x.count)} × ${x.reason}`).join('; ')}`;
      const perConnection =
        r.during.residentBytes === null ||
        baseline.residentBytes === null ||
        r.during.connections === null ||
        r.during.connections === 0
          ? '—'
          : (
              (r.during.residentBytes - baseline.residentBytes) /
              1_048_576 /
              r.during.connections
            ).toFixed(3);
      return `| ${String(r.observers)} | ${String(r.workers)} | ${String(r.established)} | ${String(r.during.connections)} | ${String(r.during.subscribers)} | ${mb(r.during.residentBytes)} | ${mb(r.after.residentBytes)} | ${perConnection} | ${String(r.ticksInWindow)} | ${String(r.gaps)} | ${String(r.duplicates)} | ${r.p50Ms.toFixed(0)}ms | ${r.p99Ms.toFixed(0)}ms | ${r.complete ? 'yes' : `**no**${refused}`} |`;
    }),
    '',
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const options = parseFleetArgs(process.argv.slice(2));
  const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-fleet-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const engine = spawn(process.execPath, [path.join(repoRoot, 'apps/api/dist/main.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      OTC_BIND: '127.0.0.1',
      OTC_STATE_DIR: stateDir,
      OTC_MASTER_SECRET: SECRET,
      OTC_BACKFILL_DAYS: '0',
      OTC_RATE_LIMIT_PER_MINUTE: '0',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });
  const rows: FleetRow[] = [];
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      try {
        if ((await fetch(`${baseUrl}/health/ready`)).ok) break;
      } catch {
        /* not up */
      }
      if (Date.now() > deadline) throw new Error('the engine never became ready');
      await new Promise((r) => setTimeout(r, 250));
    }
    const catalogue = (await (await fetch(`${baseUrl}/catalogue`)).json()) as {
      id: string;
      live: boolean;
    }[];
    const assets = catalogue.filter((a) => a.live).map((a) => a.id);
    const baseline = await sample(baseUrl);
    const { execFileSync } = await import('node:child_process');
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot })
      .toString()
      .trim();
    const { cpus, totalmem } = await import('node:os');
    const machine = `${String(cpus().length)} cores, ${(totalmem() / 1_073_741_824).toFixed(1)} GB`;
    console.info(
      `engine pid ${String(engine.pid)} on ${baseUrl}, ${String(assets.length)} assets; ${machine}; baseline RSS ${String(baseline.residentBytes)}`,
    );
    for (const size of options.sizes) {
      const workers = Math.min(options.workers, size);
      const share = Math.floor(size / workers);
      const shares = Array.from(
        { length: workers },
        (_, i) => share + (i < size - share * workers ? 1 : 0),
      );
      console.info(`--- ${String(size)} observers over ${String(workers)} workers ---`);
      // Sampled once every worker has connected and the window is well under
      // way: the connect phase is the share at the worker's arrival cadence.
      const duringAt = Date.now() + share * options.arrivalMs + Math.floor(options.holdMs * 0.6);
      const reports = Promise.all(
        shares.map((n) =>
          worker(baseUrl, assets, n, options.holdMs, options.perConnection, options.arrivalMs),
        ),
      );
      let during: Sample = baseline;
      const sampler = (async (): Promise<void> => {
        while (Date.now() < duringAt) await new Promise((r) => setTimeout(r, 500));
        during = await sample(baseUrl);
      })();
      const done = await reports;
      await sampler;
      const after = await sample(baseUrl);
      const established = done.reduce((s, r) => s + r.established, 0);
      const latencies = done.map((r) => r.latencyMs);
      const row: FleetRow = {
        observers: size,
        workers,
        established,
        gaps: done.reduce((s, r) => s + r.gaps, 0),
        duplicates: done.reduce((s, r) => s + r.duplicates, 0),
        ticksInWindow: done.reduce((s, r) => s + r.ticksInWindow, 0),
        p50Ms: Math.max(...latencies.map((l) => l.p50)),
        p99Ms: Math.max(...latencies.map((l) => l.p99)),
        during,
        after,
        complete: done.every((r) => r.complete) && established === size,
        refused: [
          ...done
            .flatMap((r) => r.refused)
            .reduce(
              (m, { reason, count }) => m.set(reason, (m.get(reason) ?? 0) + count),
              new Map<string, number>(),
            ),
        ].map(([reason, count]) => ({ reason, count })),
      };
      rows.push(row);
      console.info(
        `established ${String(established)}/${String(size)}, connections ${String(during.connections)}, RSS ${String(during.residentBytes)}, gaps ${String(row.gaps)}, dups ${String(row.duplicates)}, p99 ${row.p99Ms.toFixed(0)}ms`,
      );
      if (!row.complete) {
        console.info(
          `stopping: the fleet could not be established whole — ${row.refused.map((r) => `${String(r.count)} × ${r.reason}`).join('; ') || 'no refusal was recorded'}`,
        );
        break;
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    const text = renderFleet(rows, baseline, commit, machine);
    if (options.out !== null) await writeFile(options.out, text);
    else process.stdout.write(text);
  } finally {
    if (engine.pid !== undefined) {
      try {
        process.kill(-engine.pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    }
    await new Promise((r) => setTimeout(r, 1_500));
    await rm(stateDir, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] !== undefined && /observerFleet\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  void main().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exit(1);
    },
  );
}
