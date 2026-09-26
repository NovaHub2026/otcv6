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
import { epochMillis, exp, logPrice } from '@otc/core';
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
/**
 * A second key nobody authorised, and the same window signed with it.
 *
 * **Cycle Audit 10 (a2-02).** The suite already had a venue that names a key
 * the client did not expect, which any client catches by comparing two hex
 * strings. It had nothing for the venue that names the **expected** key and
 * signs with another — the only shape in which a forgery is worth attempting,
 * and the one a client that skipped `verifyCommitment` would accept. A refuter
 * built it and measured the consequence: with that check disabled the
 * reference client returned a fabricated tick as `verified: true`, with every
 * one of its tests green.
 */
const FORGER = publishingKeyFromSeed('99'.repeat(32));
export const FORGER_HEX = publicKeyHex(FORGER);
const FORGED = signCommitment(commit('eurusd', WINDOW), FORGER);

export interface Faults {
  version?: string;
  /** End the response after this many ticks without a close frame: a dropped connection. */
  dropAfter?: number;
  /** On a resume, replay the tick before `from` as well: a venue that repeats itself. */
  repeatOnResume?: boolean;
  /**
   * On a resume, tell a gap and continue six sequences later: the frame a venue
   * writes when the sequence asked for has been evicted, or when a seamed boot
   * restarted the feed past it (Cycle Audit 10, a4-02/a8-02).
   */
  gapOnResume?: boolean;
  /** On a resume, begin one sequence after the one asked for, telling no gap. */
  wrongResume?: boolean;
  /** On a resume, drop the third tick of the resumed run, telling no gap. */
  skipOnResume?: boolean;
  extraKey?: boolean;
  skipSequence?: boolean;
  wrongRule?: boolean;
  badProof?: boolean;
  /** Names the expected publisher key and signs the commitment with another (a2-02). */
  forgedSignature?: boolean;
  /**
   * Signs with a key of its own **and names that key**: the self-certifying
   * venue (Cycle Audit 10, a4-03). Every cryptographic step inside the
   * response succeeds; only a key told out of band refuses it.
   */
  rogueKey?: boolean;
  /**
   * A valid, internally consistent proof — of the wrong tick (a4-04). The
   * subject the `agrees with the stream` clause never had: `badProof` breaks
   * inclusion, so removing that clause left the matrix green.
   */
  proofForOtherTick?: boolean;
  /**
   * `/ticks/:sequence` answers the sequence asked for, carrying another
   * tick's instant and price: the contracted keys, the contracted types, the
   * wrong record (a4-04).
   */
  wrongTickContent?: boolean;
  /**
   * `/markets/:id` reports a tick from far behind the live edge — a stale
   * replica or a cache. The tick is a real published one, so the record
   * agrees with it; only the stream says how far behind it is (a4-04).
   */
  staleMarket?: boolean;
  /**
   * Serve a published tick whose stated frame does not produce its own
   * displayPrice: the shape a venue has when it renders a recorded price on
   * the lattice in force *now* rather than the one the tick was written on
   * (PH-38.3, Cycle Audit 12 finding 3).
   */
  latticeMismatch?: boolean;
  /**
   * Render every recorded price on a lattice the venue never published, and
   * render it **coherently** — `displayPrice` derived from the stated frame, so
   * each response is internally perfect. Only the venue's own `/lattices` log
   * contradicts it.
   *
   * This is the attack an independent refuter used to show the first version of
   * the frame check had no teeth: it scored 33/33 exit 0 while showing a broker
   * 1.494102 where the record said 1.155439, a 29.3% error.
   */
  latticeUnanchored?: boolean;
  /**
   * The frame log **agrees with the lie** (Cycle Audit 13, a3-02).
   *
   * Every response internally perfect, rendered on a lattice the venue never
   * published, and `/lattices` declaring that same lattice — so nothing in the
   * venue contradicts anything, and the two legs that compare the venue against
   * its own log cannot see it. A refuter scored this 33 of 33, exit 0.
   *
   * It is not caught, and it cannot be from inside: with one declared frame
   * there is no boundary to test continuity across. What the suite owes a broker
   * is to say so, which is what the `NOT PROVEN` detail is for.
   */
  latticeLogAgrees?: boolean;
  /**
   * A frame log that starts above the record's oldest tick, while every tick is
   * rendered anyway (a3-02). The venue answers a price for a sequence it does
   * not claim to have a frame for — a guess, and the one lie of this family that
   * a single-epoch venue *can* be caught in.
   */
  latticeCoversOnlyTheTail?: boolean;
  /**
   * A frame that begins where no seam resumes (Cycle Audit 13, a5-01).
   *
   * `settle()` cannot express a frame; its only defence against comparing two
   * integers counted in different quanta is the seam list. Four separate
   * mechanisms keep every frame boundary on a seam and none of them was tested
   * as a protection, so this is the fault that names it.
   */
  latticeOffASeam?: boolean;
  noProof?: boolean;
  /**
   * Answer `/markets/:id` with the tick after the newest published one — the
   * tick a venue has drawn and not yet served (Cycle Audit 10, a1-03).
   */
  futureMarket?: boolean;
  /** A venue whose record carries a discontinuity: it lists it, and refuses a price inside it. */
  seamed?: boolean;
}

/** The gap a `seamed` fake venue's record holds: between tick 30 and tick 31. */
export const SEAM = {
  assetId: 'eurusd',
  lastSequence: 30,
  lastInstant: TICKS[29]!.instant,
  resumesAtSequence: 100_031,
  resumesAtInstant: TICKS[30]!.instant,
};

const servers: Server[] = [];
afterAll(() => {
  for (const server of servers) server.close();
});

export async function fakeVenue(faults: Faults = {}): Promise<string> {
  const json = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
  const STALE = TICKS[6]!;
  const market = {
    id: 'eurusd',
    displayName: 'EUR/USD',
    family: 'fx',
    price: faults.staleMarket ? STALE.price : TICKS[59]!.price + (faults.futureMarket ? 3 : 0),
    displayPrice: '1.10000',
    sequence: faults.staleMarket ? STALE.sequence : faults.futureMarket ? 61 : 60,
    instant: faults.staleMarket
      ? STALE.instant
      : TICKS[59]!.instant + (faults.futureMarket ? 400 : 0),
    recovery: null,
    ...(faults.extraKey ? { engineVersion: 1 } : {}),
  };
  // PH-38.3: a published price states the frame it counts in, so a broker that
  // archived integers can render them without one request per tick.
  const FRAME = { logQuantum: 4.044597092506429e-6, referencePrice: 1.1, displayPrecision: 5 };
  const published = (t: Tick): Record<string, unknown> => ({
    sequence: t.sequence,
    instant: t.instant,
    price: t.price,
    logQuantum:
      faults.latticeMismatch || faults.latticeUnanchored || faults.latticeLogAgrees
        ? FRAME.logQuantum * 12.916
        : FRAME.logQuantum,
    referencePrice: FRAME.referencePrice,
    // Coherent with whatever frame is stated, so only an anchor outside the
    // response can tell the unanchored venue from an honest one.
    displayPrice:
      faults.latticeUnanchored || faults.latticeLogAgrees
        ? (FRAME.referencePrice * exp(FRAME.logQuantum * 12.916 * t.price)).toFixed(
            FRAME.displayPrecision,
          )
        : '1.1',
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
    // A venue that has never seamed: the record holds no discontinuity.
    if (p === '/markets/eurusd/seams') return json(response, 200, faults.seamed ? [SEAM] : []);
    if (p === '/markets/eurusd/lattices') {
      const declared = faults.latticeLogAgrees
        ? { ...FRAME, logQuantum: FRAME.logQuantum * 12.916 }
        : FRAME;
      const from = faults.latticeCoversOnlyTheTail ? TICKS[30]! : TICKS[0]!;
      const log = [
        {
          assetId: 'eurusd',
          fromSequence: from.sequence,
          fromInstant: from.instant,
          ...declared,
        },
      ];
      // A second frame beginning one sequence off the seam this venue lists.
      if (faults.latticeOffASeam) {
        log.push({
          assetId: 'eurusd',
          fromSequence: SEAM.resumesAtSequence + 1,
          fromInstant: SEAM.resumesAtInstant,
          ...FRAME,
        });
      }
      return json(response, 200, log);
    }
    if (p.startsWith('/markets/eurusd/ticks/')) {
      const sequence = Number(p.split('/').pop());
      const tick = TICKS.find((t) => t.sequence === sequence);
      if (tick === undefined) return json(response, 404, { message: 'not in the record' });
      // The contracted keys and types either way; the wrong record when asked
      // for it (a4-04).
      const answered = faults.wrongTickContent ? TICKS[(sequence + 6) % 60]! : tick;
      return json(response, 200, {
        assetId: 'eurusd',
        ...published(answered),
        sequence: tick.sequence,
      });
    }
    if (p === '/markets/eurusd/price') {
      const at = Number(url.searchParams.get('at'));
      if (at > TICKS[59]!.instant) return json(response, 400, { message: 'future' });
      if (faults.seamed && at > SEAM.lastInstant && at < SEAM.resumesAtInstant) {
        return json(response, 409, { message: 'inside a recorded discontinuity' });
      }
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
      const proof = proveInclusion(
        WINDOW,
        faults.proofForOtherTick ? (sequence === 20 ? 19 : sequence + 1) : sequence,
      );
      return json(response, 200, {
        assetId: 'eurusd',
        sequence,
        publisherPublicKey: faults.rogueKey ? FORGER_HEX : HEX,
        commitment: faults.forgedSignature || faults.rogueKey ? FORGED : SIGNED,
        proof: faults.badProof ? { ...proof, price: proof.price + 1 } : proof,
        linksRead: 1,
      });
    }
    if (p === '/markets/eurusd/stream') {
      const asked = Number(url.searchParams.get('from') ?? '1');
      const resuming = asked > 1;
      let from = faults.repeatOnResume && resuming ? asked - 1 : asked;
      if (faults.wrongResume && resuming) from = asked + 1;
      if (from > 60) {
        response.writeHead(400).end('never published');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      // A venue that tells the gap it is about to leave, as the contract's
      // `gap` frame: the ticks that follow come from `resumesAt`, not from
      // what the client last held.
      const told = faults.gapOnResume === true && resuming;
      if (told) {
        from = Math.min(asked + 6, 60);
        response.write(
          `event: gap\ndata: ${JSON.stringify({ requested: asked, reason: 'evicted', resumesAt: from })}\n\n`,
        );
      }
      let written = 0;
      for (const t of TICKS.filter((t) => t.sequence >= from)) {
        if (faults.skipSequence && t.sequence === 30) continue;
        if (faults.skipOnResume && resuming && t.sequence === from + 2) continue;
        if (!told && faults.dropAfter !== undefined && written >= faults.dropAfter && from < 40) {
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
    const base = await fakeVenue();
    const report = await conformance({ baseUrl: base, ticks: 40, publisherPublicKey: HEX });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.venueVersion).toBe(API_VERSION);
    expect(report.publisherKeyPinned).toBe(true);
    expect(report.checks.map((c) => c.name)).toContain(
      'proof verifies against the publisher key and agrees with the stream',
    );
    expect(report.checks.map((c) => c.name)).toContain(
      'the record answers the ticks the stream delivered',
    );
    expect(renderConformance(report)).toMatch(/^# Conformance — PASS/);
    expect(renderConformance(report)).toContain('Publisher key: told to this run');
  });

  /**
   * **Cycle Audit 10, a4-03.** The run a broker actually makes — no key told —
   * still passes a faithful venue, and must never call what it did there
   * "verified against the publisher key": the only key it had came from the
   * same response as the signature. An auditor put a venue behind a proxy
   * that signed with a key of its own and named it, and got `ok: true` under
   * that name. The row is named for what it checked, the report says the key
   * was not told, and the same venue is refused when it is.
   */
  it('names a proof it could only check against the venue’s own key, and refuses it when told the key (a4-03)', async () => {
    const rogue = await fakeVenue({ rogueKey: true });
    const blind = await conformance({ baseUrl: rogue, ticks: 40 });
    expect(blind.ok).toBe(true);
    expect(blind.publisherKeyPinned).toBe(false);
    expect(blind.checks.map((c) => c.name)).toContain(
      'proof verifies against the key the venue names (not independent) and agrees with the stream',
    );
    expect(blind.checks.map((c) => c.name)).not.toContain(
      'proof verifies against the publisher key and agrees with the stream',
    );
    expect(renderConformance(blind)).toContain('**not told to this run**');
    const told = await conformance({ baseUrl: rogue, ticks: 40, publisherPublicKey: HEX });
    expect(told.ok).toBe(false);
    expect(told.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      'proof verifies against the publisher key and agrees with the stream',
    ]);
    // And a venue that signs with the honest key while naming another is
    // refused too: the two must be the same key.
    const mismatch = await conformance({
      baseUrl: await fakeVenue(),
      ticks: 40,
      publisherPublicKey: FORGER_HEX,
    });
    expect(mismatch.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      'proof verifies against the publisher key and agrees with the stream',
    ]);
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
      'proof verifies against the key the venue names (not independent) and agrees with the stream',
    ],
    [
      'a commitment signed by a key that is not the one it names (a2-02)',
      { forgedSignature: true },
      'proof verifies against the key the venue names (not independent) and agrees with the stream',
    ],
    // **Cycle Audit 10, a4-04.** A valid proof of the wrong tick: the
    // `agrees with the stream` clause had no fault of its own, and removing
    // it left this matrix green.
    [
      'a valid proof of a tick nobody asked about (a4-04)',
      { proofForOtherTick: true },
      'proof verifies against the key the venue names (not independent) and agrees with the stream',
    ],
    // The record contradicting its own stream, in the two shapes a proxy, a
    // cache or a stale replica produces it (a4-04). Both answered exactly the
    // contracted keys and types, and both passed until content was compared.
    [
      'a record answering one sequence with another tick’s price (a4-04)',
      { wrongTickContent: true },
      'the record answers the ticks the stream delivered',
    ],
    [
      'a market reporting a tick from far behind its own stream (a4-04)',
      { staleMarket: true },
      'the market is not behind the ticks it streamed',
    ],
    // PH-38.3: the venue renders a recorded tick on a lattice that is not the
    // one it says the tick counts in — what every read route did before this
    // subphase, on 30 of 30 live assets.
    [
      'a recorded price rendered on a lattice other than its own (CA12 finding 3)',
      { latticeMismatch: true },
      'a recorded price states the frame it counts in',
    ],
    // The refuter's attack: every response internally perfect, contradicted
    // only by the venue's own frame log. The first version of the check scored
    // this 33/33 exit 0.
    [
      'a venue rendering every recorded price coherently on a lattice it never published',
      { latticeUnanchored: true },
      'a recorded price states the frame it counts in',
    ],
    // a3-02: the leg that has teeth on a venue with one declared frame. A tick
    // below the oldest frame the venue declares must not be rendered at all —
    // there is no frame for it, so a price there is a guess.
    [
      'a venue rendering ticks from below the oldest frame it declares (a3-02)',
      { latticeCoversOnlyTheTail: true },
      'a recorded price states the frame it counts in',
    ],
    // a5-01: a frame boundary that is not a seam is a frame change settlement
    // cannot see, and the venue must be caught declaring one.
    [
      'a venue declaring a frame from a sequence where no seam resumes (a5-01)',
      { seamed: true, latticeOffASeam: true },
      'a recorded price states the frame it counts in',
    ],
    [
      'a market serving the tick it has drawn but not published (a1-03)',
      { futureMarket: true },
      'the price the market reports is one the record already carries',
    ],
    // **Cycle Audit 10.** The resume check had no fault of its own: replacing
    // its whole predicate with `true` left this matrix green. One fault for
    // each half of what its name claims — the run begins where it was asked to,
    // and the run is a run.
    [
      'a resume that begins one sequence late',
      { wrongResume: true },
      'stream resumes exactly from M+1',
    ],
    [
      'a resume that drops a tick from the middle of the resumed run',
      { skipOnResume: true },
      'stream resumes exactly from M+1',
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

  /**
   * **Cycle Audit 13, a3-02.** A venue whose frame log agrees with its own
   * misrendering passes every leg that compares the venue against that log, and
   * with one declared frame there is no boundary to test continuity across. The
   * suite cannot catch it from inside — so what it owes a broker is to stop
   * printing a line that reads like a proven pass.
   */
  it('does not call the frame check proven when the only independent leg could not run', async () => {
    const liar = await conformance({
      baseUrl: await fakeVenue({ latticeLogAgrees: true }),
      ticks: 40,
    });
    const detail = liar.checks.find(
      (c) => c.name === 'a recorded price states the frame it counts in',
    )?.detail;
    expect(detail, 'a coherent liar was reported as a proven pass').toMatch(/NOT PROVEN/);

    // And an honest venue with one frame says the same thing, because the same
    // leg did not run for it either. The line describes the evidence, not the
    // venue's honesty.
    const honest = await conformance({ baseUrl: await fakeVenue({}), ticks: 40 });
    expect(honest.ok).toBe(true);
    expect(
      honest.checks.find((c) => c.name === 'a recorded price states the frame it counts in')
        ?.detail,
    ).toMatch(/NOT PROVEN/);
  });

  it('reports a venue that does not answer at all', async () => {
    const report = await conformance({ baseUrl: 'http://127.0.0.1:1', ticks: 5 }).catch(() => null);
    expect(report === null || !report.ok).toBe(true);
  });
});
