import { Agent, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';

/**
 * An instrument for holding many observers against one engine, and for saying
 * so when it cannot.
 *
 * ## The failure mode of this instrument is reassurance
 *
 * A load harness that opens two thousand sockets and receives nothing on
 * eighteen hundred of them reports a **better** number than one that works:
 * less server CPU, lower latency, no backpressure. Every conclusion drawn from
 * it is then inverted, and nothing in the output looks wrong.
 *
 * This project has produced that shape of defect four times — a gate config in
 * no TypeScript program, six browser tests passing while launching no browser,
 * a storage run reporting 0.00 GB from bars it had written, a glob whose
 * deletion removed the only browser coverage with every step still green. So
 * this module counts what it *received*, not what it opened, and every quantity
 * it reports is one it can be wrong about loudly.
 *
 * ## What it refuses to assume
 *
 * - **A connection is established when a byte arrives**, never when a socket
 *   opens. An accepted socket that never delivers is the exact thing that must
 *   not be laundered into a connection count.
 * - **A run with refusals is a different experiment**, not the same experiment
 *   at a lower count. It is reported as incomplete.
 * - **The server's cost is the server's process**, read from `/proc`. A harness
 *   that reports its own CPU as the server's is the classic form of this
 *   mistake, and a run where the harness is the busier process is marked
 *   instrument-bound and its latency figures are not usable.
 * - **Latency is `receivedAt − tick.instant`.** Every tick carries the engine's
 *   own instant, so this is end to end including server queueing, needs no
 *   server instrumentation, and needs no clock agreement beyond one machine.
 * - **Gaps and duplicates are counted per connection.** This is INV-002 under
 *   load: two observers of one asset hold the same ticks or the market is not
 *   shared. A throughput figure hides a silent gap; this does not.
 */

export interface ObserverLoadOptions {
  /** Engine base URL, e.g. `http://127.0.0.1:7300`. */
  readonly baseUrl: string;
  /** Asset ids to spread the observers across, in rotation. */
  readonly assetIds: readonly string[];
  /** How many observers to open. */
  readonly observers: number;
  /** How long to hold them, once every one that will connect has. */
  readonly holdMs: number;
  /** The engine's pid, so its cost is attributed to it and not to this process. */
  readonly enginePid?: number;
  /** How long to wait for an observer's first byte before calling it refused. */
  readonly connectTimeoutMs?: number;
}

export interface ObserverLoadReport {
  readonly attempted: number;
  /** Observers that received at least one byte. Never "sockets opened". */
  readonly established: number;
  /** Observers that never delivered, by reason. */
  readonly refused: readonly { readonly reason: string; readonly count: number }[];
  readonly ticksDelivered: number;
  /** Sequence discontinuities, per observer, summed. INV-002 under load. */
  readonly gaps: number;
  /** Sequences delivered twice to one observer. */
  readonly duplicates: number;
  /** `receivedAt - tick.instant`, in milliseconds. */
  readonly latencyMs: {
    readonly p50: number;
    readonly p90: number;
    readonly p99: number;
    readonly max: number;
  };
  readonly engineCpuSeconds: number | null;
  readonly harnessCpuSeconds: number;
  readonly wallSeconds: number;
  /** The measurement window: after the last observer settled, before any closed. */
  readonly windowSeconds: number;
  /** Ticks delivered inside that window — the only throughput figure that compares across sizes. */
  readonly ticksInWindow: number;
  /** True when this harness outworked the engine: the latency figures are not usable. */
  readonly instrumentBound: boolean;
  /** True when every attempted observer was established and held to the end. */
  readonly complete: boolean;
}

interface ObserverState {
  established: boolean;
  ticks: number;
  gaps: number;
  duplicates: number;
  lastSequence: number | null;
  failure: string | null;
}

/** Total CPU seconds a pid has used, from `/proc`, or null where that is unavailable. */
export async function processCpuSeconds(pid: number): Promise<number | null> {
  try {
    const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8');
    // `comm` may contain spaces and parentheses; everything after the last `)`
    // is positional, and utime/stime are fields 14 and 15 of the whole line.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    // USER_HZ is 100 on every Linux this runs on; `getconf CLK_TCK` confirms it.
    return (utime + stime) / 100;
  } catch {
    return null;
  }
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[index]!;
}

/**
 * Open `observers` streams, hold them, and report what actually arrived.
 *
 * Every observer is a separate HTTP request on its own socket: `maxSockets`
 * is unbounded and keep-alive is off, because pooling would quietly serialise
 * the very concurrency being measured.
 */
export async function runObserverLoad(options: ObserverLoadOptions): Promise<ObserverLoadReport> {
  const connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
  const agent = new Agent({ keepAlive: false, maxSockets: Infinity, maxFreeSockets: 0 });
  const states: ObserverState[] = [];
  const latencies: number[] = [];
  const started = Date.now();
  const harnessCpuAtStart = process.cpuUsage();
  const engineCpuAtStart =
    options.enginePid === undefined ? null : await processCpuSeconds(options.enginePid);

  /** Closes handed back by `open`, so the hold is a phase rather than a per-observer timer. */
  const closers: (() => void)[] = [];

  const open = (index: number): Promise<void> =>
    new Promise((resolve) => {
      const state: ObserverState = {
        established: false,
        ticks: 0,
        gaps: 0,
        duplicates: 0,
        lastSequence: null,
        failure: null,
      };
      states[index] = state;
      const assetId = options.assetIds[index % options.assetIds.length]!;
      const url = new URL(`${options.baseUrl}/markets/${assetId}/stream`);
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const timer = setTimeout(() => {
        if (!state.established) {
          state.failure = 'no first byte within the connect timeout';
          request.destroy();
          settle();
        }
      }, connectTimeoutMs);

      const request = httpRequest(
        { hostname: url.hostname, port: url.port, path: url.pathname, agent, method: 'GET' },
        (response) => {
          if (response.statusCode !== 200) {
            state.failure = `HTTP ${String(response.statusCode)}`;
            clearTimeout(timer);
            response.destroy();
            settle();
            return;
          }
          let buffer = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            // Established on the first byte, not on the socket: an accepted
            // connection that never delivers is the failure this must not hide.
            if (!state.established) {
              state.established = true;
              clearTimeout(timer);
              settle();
            }
            buffer += chunk;
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
              if (line !== undefined) {
                try {
                  const tick = JSON.parse(line.slice(6)) as {
                    sequence?: number;
                    instant?: number;
                  };
                  if (typeof tick.sequence === 'number' && typeof tick.instant === 'number') {
                    state.ticks += 1;
                    latencies.push(Date.now() - tick.instant);
                    if (state.lastSequence !== null) {
                      if (tick.sequence === state.lastSequence) state.duplicates += 1;
                      else if (tick.sequence !== state.lastSequence + 1) state.gaps += 1;
                    }
                    state.lastSequence = tick.sequence;
                  }
                } catch {
                  state.failure = 'unparseable frame';
                }
              }
              boundary = buffer.indexOf('\n\n');
            }
          });
          response.on('error', (error: Error) => {
            if (!state.established) state.failure = `stream error: ${error.message}`;
          });
          response.on('end', settle);
        },
      );
      request.on('error', (error: Error) => {
        if (state.failure === null) state.failure = `connect: ${error.message}`;
        clearTimeout(timer);
        settle();
      });
      request.end();

      // **Establishment and hold are separate phases (PH-22.1).** The first
      // version resolved this promise only after `connectTimeout + hold`, so
      // the run began measuring the moment the first socket opened and every
      // size measured a differently warmed engine. It showed: 6.0, 16.6 and
      // 23.0 ticks per observer at 1, 10 and 50 — a rise that cannot be real,
      // because an observer's tick count is a property of its asset. That is
      // PH-21.2's archetype-rotation mistake in a new instrument, and it would
      // have been read as "delivery improves under load".
      //
      // So `open` resolves on establishment or failure, and the hold happens
      // once, for everybody, after the last one has settled.
      closers.push(() => {
        clearTimeout(timer);
        request.destroy();
      });
    });

  await Promise.all(Array.from({ length: options.observers }, (_, index) => open(index)));

  // The measurement window: every observer that will connect has, and the
  // engine has been running for the same length of time for every size.
  const windowStart = Date.now();
  const before = states.map((state) => state.ticks);
  await new Promise((resolve) => setTimeout(resolve, options.holdMs));
  const windowSeconds = (Date.now() - windowStart) / 1000;
  const deliveredInWindow = states.reduce(
    (sum, state, index) => sum + (state.ticks - (before[index] ?? 0)),
    0,
  );
  for (const close of closers) close();
  agent.destroy();

  const wallSeconds = (Date.now() - started) / 1000;
  const harnessCpu = process.cpuUsage(harnessCpuAtStart);
  const harnessCpuSeconds = (harnessCpu.user + harnessCpu.system) / 1e6;
  const engineCpuAtEnd =
    options.enginePid === undefined ? null : await processCpuSeconds(options.enginePid);
  const engineCpuSeconds =
    engineCpuAtStart === null || engineCpuAtEnd === null ? null : engineCpuAtEnd - engineCpuAtStart;

  const reasons = new Map<string, number>();
  for (const state of states) {
    if (state.established) continue;
    const reason = state.failure ?? 'no first byte and no error';
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  latencies.sort((a, b) => a - b);
  const established = states.filter((state) => state.established).length;

  return {
    attempted: options.observers,
    established,
    refused: [...reasons].map(([reason, count]) => ({ reason, count })),
    ticksDelivered: states.reduce((sum, state) => sum + state.ticks, 0),
    gaps: states.reduce((sum, state) => sum + state.gaps, 0),
    duplicates: states.reduce((sum, state) => sum + state.duplicates, 0),
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p90: percentile(latencies, 0.9),
      p99: percentile(latencies, 0.99),
      max: latencies.length === 0 ? Number.NaN : latencies[latencies.length - 1]!,
    },
    engineCpuSeconds,
    harnessCpuSeconds,
    wallSeconds,
    windowSeconds,
    ticksInWindow: deliveredInWindow,
    // The harness outworked the engine, so the latency it measured is partly
    // its own scheduling. Reported, never quietly used (CA6-01).
    instrumentBound: engineCpuSeconds !== null && harnessCpuSeconds > engineCpuSeconds,
    complete: established === options.observers,
  };
}

/** One line per quantity, so a wrong number is visible in the report and not only in a total. */
export function describeObserverLoad(report: ObserverLoadReport): string {
  const lines = [
    `attempted        ${String(report.attempted)}`,
    `established      ${String(report.established)}`,
    `ticks delivered  ${String(report.ticksDelivered)}`,
    `gaps             ${String(report.gaps)}`,
    `duplicates       ${String(report.duplicates)}`,
    `latency ms       p50 ${report.latencyMs.p50.toFixed(0)}  p90 ${report.latencyMs.p90.toFixed(0)}  p99 ${report.latencyMs.p99.toFixed(0)}  max ${report.latencyMs.max.toFixed(0)}`,
    `engine cpu       ${report.engineCpuSeconds === null ? 'unavailable' : `${report.engineCpuSeconds.toFixed(2)}s`}`,
    `harness cpu      ${report.harnessCpuSeconds.toFixed(2)}s`,
    `wall             ${report.wallSeconds.toFixed(1)}s`,
    `window           ${report.windowSeconds.toFixed(1)}s, ${String(report.ticksInWindow)} ticks`,
  ];
  for (const { reason, count } of report.refused) {
    lines.push(`REFUSED ${String(count)}  ${reason}`);
  }
  if (report.instrumentBound) {
    lines.push('INSTRUMENT-BOUND — the harness outworked the engine; latency is not usable');
  }
  if (!report.complete) {
    lines.push('INCOMPLETE — not every attempted observer was established');
  }
  return lines.join('\n');
}
