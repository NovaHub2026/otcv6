import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { runObserverLoad, type ObserverLoadReport, describeObserverLoad } from './observerLoad.js';

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
  behave: (response: ServerResponse, index: number, url: string) => void,
): Promise<string> {
  let index = 0;
  const server = createServer((request, response) => {
    behave(response, index, request.url ?? '');
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

describe('the three options that produced the headline tables (a3)', () => {
  /**
   * **Cycle Audit 8 (a3).** `assetsPerConnection`, `resumeBack` and `arrivalMs`
   * turn this harness into the multiplexing experiment and the reconnect-storm
   * experiment — the two that produced PH-22.2's and PH-22.3's tables. No file
   * in the repository passed any of them and no test set them, so three plants
   * against those code paths survived: the tables were produced by a script
   * that is not here, and a regression that silently stopped multiplexing, or
   * silently resumed at the live edge, would have changed nothing visible.
   */
  it('multiplexes onto one connection, asks for every asset, and keys gaps per asset', async () => {
    const asked: string[] = [];
    const baseUrl = await serverThat((response, index, url) => {
      asked.push(url);
      sse(response);
      // One connection carrying three interleaved series, with a hole in one.
      for (const [asset, sequences] of [
        ['eurusd', [1, 2, 3]],
        ['gbpjpy', [1, 2, 3]],
        ['btcusd', [1, 3]],
      ] as const) {
        for (const sequence of sequences) {
          response.write(
            `data: ${JSON.stringify({ asset, sequence, instant: Date.now(), price: 1 })}\n\n`,
          );
        }
      }
      void index;
      response.end();
    });
    const report = await load(baseUrl, 2, {
      assetIds: ['eurusd', 'gbpjpy', 'btcusd'],
      assetsPerConnection: 3,
    });
    expect(report.established).toBe(2);
    // One request per observer, on the multiplexed route, naming all three.
    expect(asked).toHaveLength(2);
    for (const url of asked) {
      expect(url, 'the harness fell back to the single-asset route').toContain('/markets/stream?');
      expect(url).toContain('assets=eurusd,gbpjpy,btcusd');
    }
    // The hole in btcusd is a gap; the interleaving of the other two is not.
    expect(report.gaps, 'per-asset keying lost the real gap or invented one').toBe(2);
    expect(report.duplicates).toBe(0);
  });

  it('resumes from a sequence behind the live edge rather than at it', async () => {
    const asked: string[] = [];
    const baseUrl = await serverThat((response, _index, url) => {
      asked.push(url);
      // The probe the harness makes to find the live edge answers JSON; the
      // stream that follows answers SSE.
      if (!url.includes('/stream')) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ id: 'eurusd', sequence: 9_000 }));
        return;
      }
      sse(response);
      response.write(frame(1));
      response.end();
    });
    const report = await load(baseUrl, 1, { resumeBack: 500 });
    expect(report.established).toBe(1);
    // It probed for the live edge and then asked from 500 behind it.
    expect(
      asked.some((url) => !url.includes('/stream')),
      'no probe was made',
    ).toBe(true);
    const stream = asked.find((url) => url.includes('/stream'));
    expect(stream, 'no stream was opened').toBeDefined();
    expect(stream!, 'the harness resumed at the live edge instead of behind it').toContain(
      'from=8500',
    );
    expect(stream!).toContain('onGap=live');
  });

  it('spreads arrivals over a window instead of opening every observer at once', async () => {
    const openedAt: number[] = [];
    const baseUrl = await serverThat((response, _index, _url) => {
      openedAt.push(Date.now());
      sse(response);
      response.write(frame(1));
      response.end();
    });
    const report = await load(baseUrl, 6, { arrivalMs: 600 });
    expect(report.established).toBe(6);
    expect(openedAt).toHaveLength(6);
    const spread = Math.max(...openedAt) - Math.min(...openedAt);
    expect(spread, 'every observer arrived at once; the storm was not spread').toBeGreaterThan(150);
  });
});

describe('the harness says when the server cut the fleet short (a3)', () => {
  it('counts a close frame, and says the fleet did not see the whole stream', async () => {
    // **Cycle Audit 8 (a3).** A client resuming further back than the replay
    // ceiling is cut off mid-replay: the server writes `event: close` and ends
    // the response. The parser read only frames carrying a numeric `sequence`,
    // so the close was discarded and `response.on('end')` settled the
    // observation as complete — a storm in which every observer was truncated
    // reported a healthy fleet with zero gaps.
    const baseUrl = await serverThat((response) => {
      sse(response);
      response.write(frame(1));
      response.write(
        `event: close\ndata: ${JSON.stringify({ reason: 'client fell behind during replay' })}\n\n`,
      );
      response.end();
    });
    const report = await load(baseUrl, 4);
    expect(report.established).toBe(4);
    expect(report.closeEvents, 'the close frames were discarded').toBe(4);
    expect(report.gapEvents).toBe(0);
    expect(describeObserverLoad(report)).toMatch(/TRUNCATED/);
  });

  it('counts a gap frame the same way, and keeps counting the ticks after it', async () => {
    const baseUrl = await serverThat((response) => {
      sse(response);
      response.write(frame(1));
      response.write(`event: gap\ndata: ${JSON.stringify({ asset: 'eurusd', requested: 1 })}\n\n`);
      response.write(frame(2));
      response.end();
    });
    const report = await load(baseUrl, 3);
    expect(report.gapEvents).toBe(3);
    expect(report.closeEvents).toBe(0);
    expect(report.ticksDelivered, 'the ticks around the gap were lost too').toBe(6);
    expect(describeObserverLoad(report)).toMatch(/TRUNCATED/);
  });

  it('says nothing about truncation when the server delivered the whole stream', async () => {
    const baseUrl = await serverThat((response) => {
      sse(response);
      response.write(frame(1));
      response.write(frame(2));
      response.end();
    });
    const report = await load(baseUrl, 2);
    expect(report.gapEvents).toBe(0);
    expect(report.closeEvents).toBe(0);
    expect(describeObserverLoad(report)).not.toMatch(/TRUNCATED/);
  });
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
