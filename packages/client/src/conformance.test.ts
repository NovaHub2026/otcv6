import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import {
  commit,
  proveInclusion,
  publishingKeyFromSeed,
  publicKeyHex,
  signCommitment,
} from '@otc/distribution';
import type { Tick } from '@otc/core';
import { epochMillis, logPrice } from '@otc/core';
import { conformance, renderConformance } from './conformance.js';
import { API_VERSION, contractDigest } from './contract.js';

/**
 * A faithful venue in forty lines, and every way to make it unfaithful: the
 * suite is only worth having if each check fails for the reason it names.
 */
const KEY = publishingKeyFromSeed('88'.repeat(32));
export const HEX = publicKeyHex(KEY);
export const TICKS: Tick[] = Array.from({ length: 60 }, (_, i) => ({
  sequence: i + 1,
  instant: epochMillis(1_776_000_000_000 + (i + 1) * 400),
  price: logPrice(1000 + ((i * 7) % 11)),
}));
const WINDOW = TICKS.slice(0, 20);
const SIGNED = signCommitment(commit('eurusd', WINDOW), KEY);

export interface Faults {
  version?: string;
  /** End the response after this many ticks without a close frame: a dropped connection. */
  dropAfter?: number;
  /** On a resume, replay the tick before `from` as well: a venue that repeats itself. */
  repeatOnResume?: boolean;
  extraKey?: boolean;
  skipSequence?: boolean;
  wrongRule?: boolean;
  badProof?: boolean;
  noProof?: boolean;
}

const servers: Server[] = [];
afterAll(() => {
  for (const server of servers) server.close();
});

export async function fakeVenue(faults: Faults = {}): Promise<string> {
  const json = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
  const market = {
    id: 'eurusd',
    displayName: 'EUR/USD',
    family: 'fx',
    price: TICKS[59]!.price,
    displayPrice: '1.10000',
    sequence: 60,
    instant: TICKS[59]!.instant,
    recovery: null,
    ...(faults.extraKey ? { engineVersion: 1 } : {}),
  };
  const published = (t: Tick): Record<string, unknown> => ({
    sequence: t.sequence,
    instant: t.instant,
    price: t.price,
    displayPrice: '1.1',
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const p = url.pathname;
    if (p === '/health') {
      return json(response, 200, {
        status: 'ok',
        assets: 1,
        stalled: [],
        bootNonce: null,
        apiVersion: faults.version ?? API_VERSION,
        ready: true,
      });
    }
    if (p === '/health/live') return json(response, 200, { live: true });
    if (p === '/health/ready') return json(response, 200, { ready: true });
    if (p === '/metrics') {
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      response.end('# TYPE otc_markets_hosted gauge\notc_markets_hosted 1\notc_ready 1\n');
      return;
    }
    if (p === '/contract')
      return json(response, 200, { version: API_VERSION, digest: contractDigest(), routes: [] });
    if (p === '/markets') return json(response, 200, [market]);
    if (p === '/markets/eurusd') return json(response, 200, market);
    if (p === '/catalogue')
      return json(response, 200, [
        {
          seat: null,
          id: 'eurusd',
          displayName: 'EUR/USD',
          family: 'fx',
          live: true,
          retired: false,
          referencePrice: 1.1,
          displayPrecision: 5,
          logQuantum: 1e-5,
          meanIntervalMs: 400,
          tieRate: 0.1,
          excessKurtosis: 3,
          dispersion: {},
        },
      ]);
    if (p === '/archetypes') return json(response, 200, []);
    if (p === '/registrations') return json(response, 200, []);
    if (p === '/registrations/1') return json(response, 404, { message: 'no' });
    if (p === '/markets/eurusd/history')
      return json(response, 200, {
        assetId: 'eurusd',
        timeframe: '1m',
        from: 0,
        to: 1,
        candles: [],
      });
    if (p === '/markets/eurusd/ticks/1')
      return json(response, 200, { assetId: 'eurusd', ...published(TICKS[0]!) });
    if (p === '/markets/eurusd/price') {
      const at = Number(url.searchParams.get('at'));
      if (at > TICKS[59]!.instant) return json(response, 400, { message: 'future' });
      let found: Tick | null = null;
      for (const t of TICKS) if (faults.wrongRule ? t.instant < at : t.instant <= at) found = t;
      if (found === null) return json(response, 404, { message: 'before' });
      return json(response, 200, {
        assetId: 'eurusd',
        at,
        rule: 'last-tick-at-or-before',
        ...published(found),
      });
    }
    if (p.startsWith('/markets/eurusd/proof/')) {
      if (faults.noProof) return json(response, 404, { message: 'not publishing' });
      const sequence = Number(p.split('/').pop());
      if (sequence > 20) return json(response, 409, { message: 'not yet' });
      const proof = proveInclusion(WINDOW, sequence);
      return json(response, 200, {
        assetId: 'eurusd',
        sequence,
        publisherPublicKey: HEX,
        commitment: SIGNED,
        proof: faults.badProof ? { ...proof, price: proof.price + 1 } : proof,
        linksRead: 1,
      });
    }
    if (p === '/markets/eurusd/stream') {
      const asked = Number(url.searchParams.get('from') ?? '1');
      const from = faults.repeatOnResume && asked > 1 ? asked - 1 : asked;
      if (from > 60) {
        response.writeHead(400).end('never published');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      let written = 0;
      for (const t of TICKS.filter((t) => t.sequence >= from)) {
        if (faults.skipSequence && t.sequence === 30) continue;
        if (faults.dropAfter !== undefined && written >= faults.dropAfter && from < 40) {
          response.end(); // dropped mid-stream, no close frame
          return;
        }
        response.write(`id: ${String(t.sequence)}\ndata: ${JSON.stringify(t)}\n\n`);
        written += 1;
      }
      response.write('event: close\ndata: {"reason":"end of tape"}\n\n');
      response.end();
      return;
    }
    json(response, 404, { message: `no route ${p}` });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${String(address.port)}`;
}

describe('the conformance suite (PH-29.3)', () => {
  it('passes a faithful venue, check by check', async () => {
    const report = await conformance({ baseUrl: await fakeVenue(), ticks: 40 });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.venueVersion).toBe(API_VERSION);
    expect(report.checks.map((c) => c.name)).toContain(
      'proof verifies against the publisher key and agrees with the stream',
    );
    expect(renderConformance(report)).toMatch(/^# Conformance — PASS/);
  });

  it.each([
    ['another contract version', { version: '0.9.0' }, 'contract version'],
    ['a response key the contract does not name', { extraKey: true }, 'GET /markets'],
    [
      'a stream that skips a sequence',
      { skipSequence: true },
      'stream delivers contiguous, non-decreasing ticks',
    ],
    [
      'a price route with the wrong rule',
      { wrongRule: true },
      'price at an instant is the last tick at or before it',
    ],
    [
      'a proof that does not verify',
      { badProof: true },
      'proof verifies against the publisher key and agrees with the stream',
    ],
  ] as const)('fails a venue with %s, naming the check', async (_what, faults, name) => {
    const report = await conformance({ baseUrl: await fakeVenue(faults), ticks: 40 });
    expect(report.ok).toBe(false);
    const failed = report.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toContain(name);
    expect(renderConformance(report)).toMatch(/^# Conformance — FAIL/);
  });

  it('passes a venue that does not publish, and says so', async () => {
    const report = await conformance({ baseUrl: await fakeVenue({ noProof: true }), ticks: 40 });
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === 'proof')?.detail).toMatch(/does not publish/);
  });

  it('reports a venue that does not answer at all', async () => {
    const report = await conformance({ baseUrl: 'http://127.0.0.1:1', ticks: 5 }).catch(() => null);
    expect(report === null || !report.ok).toBe(true);
  });
});
