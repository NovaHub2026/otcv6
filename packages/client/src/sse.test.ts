import { createServer, type Server } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { readStream, SseParser } from './sse.js';

const servers: Server[] = [];
afterAll(() => {
  for (const server of servers) server.close();
});

/** A venue that writes what it is told to write, then holds the socket open. */
async function venue(
  frames: (from: number | null, onGap: string | null) => string,
): Promise<string> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    if (!/^\/markets\/[^/]+\/stream$/.test(url.pathname)) {
      response.writeHead(404).end('no');
      return;
    }
    const from = url.searchParams.get('from');
    const body = frames(from === null ? null : Number(from), url.searchParams.get('onGap'));
    if (body.startsWith('REFUSE ')) {
      response.writeHead(400, { 'content-type': 'text/plain' }).end(body.slice(7));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    // In two chunks, split mid-line, so the parser's carry is exercised.
    const cut = Math.floor(body.length / 2);
    response.write(body.slice(0, cut));
    setTimeout(() => response.write(body.slice(cut)), 20);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${String(address.port)}`;
}

const tick = (s: number): string =>
  `id: ${String(s)}\ndata: ${JSON.stringify({ sequence: s, instant: 1_776_000_000_000 + s * 500, price: 1000 + s })}\n\n`;

describe('the SSE parser', () => {
  it('assembles events across chunks, joins data lines, ignores comments and tolerates CRLF', () => {
    const parser = new SseParser();
    expect(parser.push(':hello\r\nevent: gap\r\ndata: {"a":\r\ndata: 1}\r\n')).toEqual([]);
    expect(parser.push('\r\ndata: x\n\nid: 7\ndata: y\n\n')).toEqual([
      { event: 'gap', data: '{"a":\n1}', id: null },
      { event: null, data: 'x', id: null },
      { event: null, data: 'y', id: '7' },
    ]);
  });
});

describe('readStream holds the stream contract', () => {
  it('reads ticks until the rule, keeps gaps and closes, and returns a refusal rather than throwing', async () => {
    const base = await venue((from, onGap) => {
      if (from === 999) return 'REFUSE never published';
      const gap =
        from !== null && from < 5 && onGap === 'live'
          ? `event: gap\ndata: ${JSON.stringify({ requested: from, reason: 'evicted', resumesAt: 5 })}\n\n`
          : '';
      return gap + [5, 6, 7, 8].map(tick).join('') + `event: close\ndata: {"reason":"done"}\n\n`;
    });
    const read = await readStream({ baseUrl: base, assetId: 'eurusd', from: 5, ticks: 3 });
    expect(read.ticks.map((t) => t.sequence)).toEqual([5, 6, 7]);
    expect(read.endedBy).toBe('rule');
    expect(read.status).toBe(200);
    const told = await readStream({
      baseUrl: base,
      assetId: 'eurusd',
      from: 1,
      onGap: 'live',
      ticks: 10,
    });
    expect(told.gaps).toEqual([{ requested: 1, reason: 'evicted', resumesAt: 5 }]);
    expect(told.ticks.map((t) => t.sequence)).toEqual([5, 6, 7, 8]);
    expect(told.closes).toEqual(['done']);
    expect(told.endedBy).toBe('close');
    const refused = await readStream({ baseUrl: base, assetId: 'eurusd', from: 999, ticks: 1 });
    expect(refused).toMatchObject({ status: 400, refusal: 'never published', ticks: [] });
  });

  it('refuses a tick frame without three integer fields', async () => {
    const base = await venue(() => `data: {"sequence":1,"price":2}\n\n`);
    await expect(readStream({ baseUrl: base, assetId: 'x', ticks: 1 })).rejects.toThrow(
      /three integer fields/,
    );
  });
});
