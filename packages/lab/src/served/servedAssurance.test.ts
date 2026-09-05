// Invariant evidence: INV-006 (no exploitable directional rules), INV-002 (shared market).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type Tick } from '@otc/core';
import { joinServedRecords, seamIndicesOf, servedAssurance } from './servedAssurance.js';
import { readServedRecord, type ServedRecord } from './servedRecord.js';

/**
 * PH-25.2: the battery through the wire.
 *
 * `standing.test.ts` proved the verdict on ticks handed to it in-process. The
 * question here is whether anything is lost between a socket and that call —
 * a leak served as frames must still be a leak, and a fair record must not
 * become one.
 */

const GENESIS = 1_776_000_000_000;

const CATALOGUE_ROW = {
  id: 'wire-otc',
  displayName: 'Wire',
  family: 'forex',
  logQuantum: 1e-5,
  displayPrecision: 5,
  referencePrice: 1,
};

/** A record whose direction is the Thue–Morse parity of its hour (CA5-06). */
function predictableByTheClock(hours: number, ticksPerHour = 60): Tick[] {
  const parity = (n: number): number => {
    let bits = 0;
    for (let v = n; v > 0; v >>= 1) bits ^= v & 1;
    return bits;
  };
  const out: Tick[] = [];
  let price = 0;
  const interval = 3_600_000 / ticksPerHour;
  for (let hour = 0; hour < hours; hour += 1) {
    const step = parity(hour) === 0 ? 1 : -1;
    for (let k = 0; k < ticksPerHour; k += 1) {
      price += step;
      out.push({
        sequence: out.length + 1,
        instant: epochMillis(GENESIS + Math.round((hour * ticksPerHour + k) * interval)),
        price: logPrice(price),
      });
    }
  }
  return out;
}

/** A fair walk under seed, at the same cadence. */
function fair(count: number, seed: string, intervalMs = 60_000): Tick[] {
  const source = MasterKeyring.forTesting(seed).derive({
    env: 'test',
    asset: 'wire',
    purpose: 'walk',
    keyEpoch: 0,
  });
  const out: Tick[] = [];
  let price = 0;
  for (let index = 0; index < count; index += 1) {
    price += source.nextFloat64() < 0.5 ? 1 : -1;
    out.push({
      sequence: index + 1,
      instant: epochMillis(GENESIS + index * intervalMs),
      price: logPrice(price),
    });
  }
  return out;
}

/** The same ticks with the sequences after `index` moved up by five: a jump. */
function withAJumpAt(ticks: readonly Tick[], index: number): Tick[] {
  return ticks.map((t, i) => (i >= index ? { ...t, sequence: t.sequence + 5 } : t));
}

/** Serve ticks as the venue would: one frame each, in chunks of many. */
function wire(ticks: readonly Tick[], chunk = 500): typeof fetch {
  return (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/catalogue')) {
      return Promise.resolve(new Response(JSON.stringify([CATALOGUE_ROW]), { status: 200 }));
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < ticks.length; at += chunk) {
          const frames = ticks
            .slice(at, at + chunk)
            .map((t) => `id: ${String(t.sequence)}\ndata: ${JSON.stringify(t)}\n\n`)
            .join('');
          controller.enqueue(encoder.encode(frames));
        }
        controller.close();
      },
    });
    return Promise.resolve(new Response(stream, { status: 200 }));
  };
}

const served = (ticks: readonly Tick[]): Promise<ServedRecord> =>
  readServedRecord({
    baseUrl: 'http://venue',
    assetId: CATALOGUE_ROW.id,
    stopAfter: { ticks: ticks.length },
    fetch: wire(ticks),
  });

const SMALL = { minimumBucketSamples: 25 } as const;

describe('the battery through the wire', () => {
  it('calls a leak served as frames exploitable', async () => {
    // With a seam in the record — a jump the venue did not explain — so the
    // withheld seam family is built from the record itself and every family
    // is available: `exploitable` here cannot be `undecided` for the wrong
    // reason (standing.test.ts makes the same point with hand-fed indices).
    const record = await served(withAJumpAt(predictableByTheClock(600), 1_000));
    const reference = await served(predictableByTheClock(600, 61));
    expect(record.ticks).toHaveLength(36_000);
    expect(record.discontinuities).toHaveLength(1);
    const verdict = await servedAssurance(record, { at: GENESIS, reference, battery: SMALL });
    expect(verdict.withheldUnavailable).toEqual([]);
    expect(verdict.outcome).toBe('exploitable');
    expect(Math.abs(verdict.worstZ ?? 0)).toBeGreaterThan(10);
  }, 300_000);

  it('does not call a fair record served the same way exploitable', async () => {
    const record = await served(fair(36_000, 'fair-wire'));
    const reference = await served(fair(36_000, 'fair-reference'));
    const verdict = await servedAssurance(record, { at: GENESIS, reference, battery: SMALL });
    // A record with no seam has nothing for the seam family to test, and the
    // verdict says so rather than running it on nothing (which keeps it from
    // `clean`, correctly: a partial independence claim is not the same claim).
    expect(verdict.withheldUnavailable).toEqual(['wh-seam-proximity']);
    expect(verdict.outcome).not.toBe('exploitable');
    expect(verdict.hypothesesTested).toBeGreaterThan(0);
    // The verdict carries its own floor, per horizon.
    expect(verdict.horizons.length).toBeGreaterThan(0);
    for (const horizon of verdict.horizons) expect(horizon.detectionFloorPp).toBeGreaterThan(0);
  }, 300_000);
});

describe('the seams the battery is given are the record’s own', () => {
  it('reads seam indices from discontinuities and told gaps, never from the caller', async () => {
    const ticks = fair(40, 'seams');
    // A jump after the tenth tick, and a told gap before the thirtieth.
    const jumped = ticks.map((t, i) => (i >= 10 ? { ...t, sequence: t.sequence + 5 } : t));
    const frames = jumped.map((t) => `id: ${String(t.sequence)}\ndata: ${JSON.stringify(t)}\n\n`);
    frames.splice(30, 0, `event: gap\ndata: ${JSON.stringify({ requested: 1, reason: 'x' })}\n\n`);
    const record = await readServedRecord({
      baseUrl: 'http://venue',
      assetId: CATALOGUE_ROW.id,
      stopAfter: { ticks: 40 },
      onGap: 'live',
      fetch: (input) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/catalogue')) {
          return Promise.resolve(new Response(JSON.stringify([CATALOGUE_ROW]), { status: 200 }));
        }
        return Promise.resolve(new Response(frames.join(''), { status: 200 }));
      },
    });
    expect(record.discontinuities).toEqual([{ afterSequence: 10, nextSequence: 16 }]);
    expect(record.gaps).toHaveLength(1);
    expect(seamIndicesOf(record)).toEqual([10, 30]);
  });

  it('joins a read before a restart with the read after it, keeping the seam', async () => {
    const ticks = fair(30, 'join');
    const before = await readServedRecord({
      baseUrl: 'http://venue',
      assetId: CATALOGUE_ROW.id,
      stopAfter: { ticks: 10 },
      fetch: wire(ticks),
    });
    // The venue seamed: the record resumes past a reserved block.
    const resumed = ticks.slice(10).map((t) => ({ ...t, sequence: t.sequence + 1_000 }));
    const after = await readServedRecord({
      baseUrl: 'http://venue',
      assetId: CATALOGUE_ROW.id,
      from: 11,
      stopAfter: { ticks: 20 },
      fetch: wire(resumed),
    });
    const joined = joinServedRecords(before, after);
    expect(joined.ticks).toHaveLength(30);
    expect(joined.discontinuities).toEqual([{ afterSequence: 10, nextSequence: 1_011 }]);
    expect(seamIndicesOf(joined)).toEqual([10]);
    expect(Array.from(joined.dataset().prices)).toEqual(ticks.map((t) => t.price));
    // A gap told at the start of the later read is a seam at the join, not at
    // index zero: the venue refused `from` and was asked to be told (PH-25.1's
    // finding a is exactly this shape after a restart).
    const toldFrames = [
      `event: gap\ndata: ${JSON.stringify({ requested: 11, reason: 'retained window starts at 1011', resumesAt: 1_011 })}\n\n`,
      ...resumed.map((t) => `id: ${String(t.sequence)}\ndata: ${JSON.stringify(t)}\n\n`),
    ];
    const told = await readServedRecord({
      baseUrl: 'http://venue',
      assetId: CATALOGUE_ROW.id,
      from: 11,
      onGap: 'live',
      stopAfter: { ticks: 20 },
      fetch: (input) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/catalogue')) {
          return Promise.resolve(new Response(JSON.stringify([CATALOGUE_ROW]), { status: 200 }));
        }
        return Promise.resolve(new Response(toldFrames.join(''), { status: 200 }));
      },
    });
    expect(told.gaps[0]!.afterSequence).toBeNull();
    // Alone, a told gap before the first tick is not a seam inside the record
    // (CA9 a8-07): there is nothing before it, and the seam family is
    // unavailable rather than built on nothing.
    expect(seamIndicesOf(told)).toEqual([]);
    const toldAlone = await servedAssurance(told, { at: GENESIS, battery: SMALL });
    expect(toldAlone.withheldUnavailable).toContain('wh-seam-proximity');
    // An earlier read that held no tick — closed before its first frame —
    // still contributes what it was told (CA9 a8-08).
    const empty: ServedRecord = {
      ...before,
      ticks: [],
      gaps: [{ requested: 11, reason: 'r', resumesAt: null, afterSequence: null }],
      closes: [{ reason: 'server shutting down', afterSequence: null }],
      bytes: 7,
      requestedFrom: 11,
    };
    const fromEmpty = joinServedRecords(empty, told);
    expect(fromEmpty.gaps).toHaveLength(2);
    expect(fromEmpty.closes).toHaveLength(1);
    expect(fromEmpty.bytes).toBe(7 + told.bytes);
    expect(() => joinServedRecords({ ...empty, requestedFrom: 3 }, told)).toThrow(/held no tick/);
    const joinedByGap = joinServedRecords(before, told);
    expect(joinedByGap.gaps[0]!.afterSequence).toBe(10);
    expect(joinedByGap.discontinuities).toEqual([]);
    expect(seamIndicesOf(joinedByGap)).toEqual([10]);

    // A read that did not ask for the continuation is not a continuation.
    const elsewhere = await readServedRecord({
      baseUrl: 'http://venue',
      assetId: CATALOGUE_ROW.id,
      from: 12,
      stopAfter: { ticks: 5 },
      fetch: wire(resumed),
    });
    expect(() => joinServedRecords(before, elsewhere)).toThrow(/does not continue/);
  });
});
