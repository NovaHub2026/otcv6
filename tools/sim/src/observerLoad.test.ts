import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { runObserverLoad, type ObserverLoadReport } from './observerLoad.js';

/**
 * The instrument, watched failing.
 *
 * PH-22.1 §5: a load harness is not finished until it has been pointed at a
 * server that is broken in each way that matters and has said so. The failure
 * mode of this instrument is **reassurance** — a harness that opens sockets and
 * receives nothing reports less server CPU, lower latency and no backpressure
 * than one that works, and every conclusion drawn from it is inverted.
 *
 * Each test here is one of those broken servers. None of them involves the real
 * engine: what is under test is the harness's own contract, at a scale that
 * finishes in a second.
 */
const running: { servers: Server[]; children: ChildProcess[] } = { servers: [], children: [] };

afterEach(async () => {
  for (const child of running.children) child.kill('SIGKILL');
  running.children = [];
  await Promise.all(
    running.servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
  running.servers = [];
});

/** A server that behaves however the test says, on a port the OS chooses. */
async function serverThat(
  behave: (response: ServerResponse, index: number) => void,
): Promise<string> {
  let index = 0;
  const server = createServer((_request, response) => {
    behave(response, index);
    index += 1;
  });
  running.servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${String(address.port)}`;
}

/** An SSE frame carrying a tick the harness will parse. */
function frame(sequence: number, instant = Date.now()): string {
  return `id: ${String(sequence)}\ndata: ${JSON.stringify({ sequence, instant, price: 1 })}\n\n`;
}

function sse(response: ServerResponse): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
}

const load = (baseUrl: string, observers: number, extra = {}): Promise<ObserverLoadReport> =>
  runObserverLoad({
    baseUrl,
    assetIds: ['eurusd'],
    observers,
    holdMs: 150,
    connectTimeoutMs: 800,
    ...extra,
  });

describe('the harness counts what arrived, not what it opened', () => {
  it('reports a healthy server as complete, with no gaps and no duplicates', async () => {
    const baseUrl = await serverThat((response) => {
      sse(response);
      let sequence = 1;
      const timer = setInterval(() => {
        response.write(frame(sequence));
        sequence += 1;
      }, 10);
      response.on('close', () => {
        clearInterval(timer);
      });
    });
    const report = await load(baseUrl, 8);
    expect(report.established).toBe(8);
    expect(report.complete).toBe(true);
    expect(report.refused).toEqual([]);
    expect(report.gaps).toBe(0);
    expect(report.duplicates).toBe(0);
    expect(report.ticksDelivered).toBeGreaterThan(8);
  });

  it('does not count a socket that opened and delivered nothing (PLANT 2)', async () => {
    // The failure that reports *better* numbers than a working server: accepted,
    // silent, fast, no backpressure. A harness that counted this as established
    // would launder it into a connection count and invert every conclusion.
    const baseUrl = await serverThat((response) => {
      sse(response);
      // ...and never writes a byte.
    });
    const report = await load(baseUrl, 6);
    expect(report.established).toBe(0);
    expect(report.complete).toBe(false);
    expect(report.refused.map((entry) => entry.count).reduce((a, b) => a + b, 0)).toBe(6);
    expect(report.refused[0]?.reason).toMatch(/no first byte/);
  });

  it('does not count a flushed 200 that never carries a tick (PLANT 2b)', async () => {
    // The discrimination the test above does *not* make, found by planting.
    //
    // Marking an observer established when the response callback fires — on
    // headers rather than on a byte — passed every other test in this file,
    // because Node does not put headers on the wire until the first `write`.
    // So a silent server never reaches the callback at all and the plant was
    // unreachable rather than caught.
    //
    // `flushHeaders()` is the case that separates them, and it is not exotic:
    // it is what a server does when it has accepted a subscription and has
    // nothing to send yet. Established must mean **a tick arrived**.
    const baseUrl = await serverThat((response) => {
      sse(response);
      response.flushHeaders();
      // ...and then nothing, for the life of the connection.
    });
    const report = await load(baseUrl, 5);
    expect(report.established, 'a flushed 200 with no ticks is not an observer').toBe(0);
    expect(report.ticksDelivered).toBe(0);
    expect(report.complete).toBe(false);
    expect(report.refused.reduce((sum, entry) => sum + entry.count, 0)).toBe(5);
  });

  it('counts refusals by reason rather than pretending the run was smaller (PLANT 1)', async () => {
    // A run with refusals is a different experiment, not the same experiment at
    // a lower connection count.
    const limit = 3;
    const baseUrl = await serverThat((response, index) => {
      if (index >= limit) {
        response.writeHead(503);
        response.end();
        return;
      }
      sse(response);
      let sequence = 1;
      const timer = setInterval(() => {
        response.write(frame(sequence));
        sequence += 1;
      }, 10);
      response.on('close', () => {
        clearInterval(timer);
      });
    });
    const report = await load(baseUrl, 7);
    expect(report.established).toBe(limit);
    expect(report.complete).toBe(false);
    const refused = report.refused.reduce((sum, entry) => sum + entry.count, 0);
    expect(refused).toBe(7 - limit);
    expect(report.refused.some((entry) => entry.reason.includes('503'))).toBe(true);
  });

  it('counts a dropped tick as a gap (PLANT 3)', async () => {
    // INV-002 under load: two observers of one asset hold the same ticks, or the
    // market is not shared. A throughput figure hides this; a gap count does not.
    const baseUrl = await serverThat((response) => {
      sse(response);
      let sequence = 1;
      const timer = setInterval(() => {
        // Every fourth sequence is skipped.
        if (sequence % 4 !== 0) response.write(frame(sequence));
        sequence += 1;
      }, 10);
      response.on('close', () => {
        clearInterval(timer);
      });
    });
    const report = await load(baseUrl, 4);
    expect(report.established).toBe(4);
    expect(report.gaps).toBeGreaterThan(0);
  });

  it('counts a repeated sequence as a duplicate, not as delivery', async () => {
    const baseUrl = await serverThat((response) => {
      sse(response);
      let sequence = 1;
      const timer = setInterval(() => {
        response.write(frame(sequence));
        response.write(frame(sequence));
        sequence += 1;
      }, 10);
      response.on('close', () => {
        clearInterval(timer);
      });
    });
    const report = await load(baseUrl, 4);
    expect(report.duplicates).toBeGreaterThan(0);
    expect(report.gaps).toBe(0);
  });

  it('marks a run instrument-bound when the harness outworks the engine (PLANT 5)', async () => {
    // CA6-01's rule, applied to a new instrument: a harness that measures its
    // own scheduling and reports it as the server's latency is the classic
    // form of this mistake. An idle process stands in for an engine doing
    // nothing while the harness does all the work.
    const idle = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    running.children.push(idle);
    const baseUrl = await serverThat((response) => {
      sse(response);
      let sequence = 1;
      const timer = setInterval(() => {
        response.write(frame(sequence));
        sequence += 1;
      }, 2);
      response.on('close', () => {
        clearInterval(timer);
      });
    });
    const report = await load(baseUrl, 12, { enginePid: idle.pid });
    expect(report.engineCpuSeconds).not.toBeNull();
    expect(report.instrumentBound, 'an idle engine and a busy harness is instrument-bound').toBe(
      true,
    );
  });

  it('reports latency from the tick instant, so server queueing is inside it', async () => {
    // `receivedAt - tick.instant`: end to end, no server instrumentation, no
    // clock agreement needed beyond one machine. A tick stamped 300 ms ago must
    // read as at least 300 ms of latency.
    const baseUrl = await serverThat((response) => {
      sse(response);
      let sequence = 1;
      const timer = setInterval(() => {
        response.write(frame(sequence, Date.now() - 300));
        sequence += 1;
      }, 10);
      response.on('close', () => {
        clearInterval(timer);
      });
    });
    const report = await load(baseUrl, 4);
    expect(report.latencyMs.p50).toBeGreaterThanOrEqual(295);
  });
});
