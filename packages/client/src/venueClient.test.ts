import { describe, expect, it } from 'vitest';
import { fakeVenue, HEX, SEAM, TICKS } from './conformance.test.js';
import { ContractViolation, isRefusal, VenueClient, type StreamEvent } from './venueClient.js';

describe('the reference client (PH-29.4)', () => {
  it('reads every route through the contract, and returns listed refusals as values', async () => {
    const client = new VenueClient({ baseUrl: await fakeVenue() });
    expect((await client.health()).apiVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await client.markets()).map((m) => m.id)).toEqual(['eurusd']);
    const market = await client.market('eurusd');
    expect(isRefusal(market)).toBe(false);
    const tick = await client.tick('eurusd', 1);
    expect(tick).toMatchObject({ assetId: 'eurusd', sequence: 1, price: TICKS[0]!.price });
    const price = await client.priceAt('eurusd', TICKS[10]!.instant + 1);
    expect(price).toMatchObject({ sequence: 11, rule: 'last-tick-at-or-before' });
    const future = await client.priceAt('eurusd', TICKS[59]!.instant + 86_400_000);
    expect(isRefusal(future) && future.status).toBe(400);
    const missing = await client.history('eurusd', '1m', 0, 1);
    expect(isRefusal(missing)).toBe(false);
  });

  /**
   * **Cycle Audit 10, a4-01 / a1-01.** A broker fills `settle()`'s `seams` from
   * here. Before contract 2.0.0 there was nothing to fill it from, and a price
   * inside a gap nobody generated came back `200`.
   */
  it("reads the record's discontinuities, and takes a price inside one as a refusal (PH-31)", async () => {
    const client = new VenueClient({ baseUrl: await fakeVenue({ seamed: true }) });
    const seams = await client.seams('eurusd');
    expect(isRefusal(seams)).toBe(false);
    if (isRefusal(seams)) return;
    expect(seams).toEqual([SEAM]);
    // The two instants `settle()` takes, straight off the answer.
    expect(
      seams.map((s) => ({ lastInstant: s.lastInstant, resumesAtInstant: s.resumesAtInstant })),
    ).toEqual([{ lastInstant: SEAM.lastInstant, resumesAtInstant: SEAM.resumesAtInstant }]);
    // A 409 is a refusal the contract lists, so it is a value and not a
    // ContractViolation: a client that threw here would have no way to tell a
    // seam from a broken venue.
    const inside = await client.priceAt('eurusd', SEAM.lastInstant + 1);
    expect(isRefusal(inside) && inside.status).toBe(409);
    // Both boundary instants are still prices.
    expect(isRefusal(await client.priceAt('eurusd', SEAM.lastInstant))).toBe(false);
    expect(isRefusal(await client.priceAt('eurusd', SEAM.resumesAtInstant))).toBe(false);
    // And a venue that never seamed answers an empty list.
    const none = await new VenueClient({ baseUrl: await fakeVenue() }).seams('eurusd');
    expect(none).toEqual([]);
  });

  it('verifies a proof against the publisher key, and refuses one that does not verify', async () => {
    const client = new VenueClient({ baseUrl: await fakeVenue(), publisherPublicKey: HEX });
    const proof = await client.proof('eurusd', 7);
    expect(isRefusal(proof)).toBe(false);
    if (isRefusal(proof)) return;
    expect(proof.verified).toBe(true);
    expect(proof.proof.sequence).toBe(7);
    const later = await client.proof('eurusd', 25);
    expect(isRefusal(later) && later.status).toBe(409);
    const bad = new VenueClient({
      baseUrl: await fakeVenue({ badProof: true }),
      publisherPublicKey: HEX,
    });
    await expect(bad.proof('eurusd', 7)).rejects.toThrow(ContractViolation);
    const otherKey = new VenueClient({
      baseUrl: await fakeVenue(),
      publisherPublicKey: 'ab'.repeat(32),
    });
    await expect(otherKey.proof('eurusd', 7)).rejects.toThrow(/another publisher key|not signed/);
  });

  it('throws a ContractViolation naming the route and the departure', async () => {
    const client = new VenueClient({ baseUrl: await fakeVenue({ extraKey: true }) });
    await expect(client.markets()).rejects.toThrow(
      /GET \/markets departed from contract .*engineVersion/,
    );
  });

  it('subscribes across a told gap and a dropped connection with no repeat and no hole', async () => {
    const client = new VenueClient({ baseUrl: await fakeVenue({ dropAfter: 12 }) });
    const events: StreamEvent[] = [];
    let ended = '';
    const run = async (): Promise<void> => {
      const iterator = client.subscribe('eurusd', { from: 1, reconnects: 10 });
      for (;;) {
        const next = await iterator.next();
        if (next.done) {
          ended = next.value;
          return;
        }
        events.push(next.value);
      }
    };
    await run();
    const sequences = events
      .filter((e) => e.kind === 'tick')
      .map((e) => (e as { tick: { sequence: number } }).tick.sequence);
    expect(sequences[0]).toBe(1);
    expect(sequences[sequences.length - 1]).toBe(60);
    for (let i = 1; i < sequences.length; i += 1) expect(sequences[i]).toBe(sequences[i - 1]! + 1);
    // Dropped after every twelve ticks while the resume point is below 40 —
    // resumed from 13, 25, 37 and 49 — then the tape ran to its close.
    const reconnects = events
      .filter((e) => e.kind === 'reconnected')
      .map((e) => (e as { from: number }).from);
    expect(reconnects).toEqual([13, 25, 37, 49]);
    expect(ended).toBe('end of tape');
  });

  it('never yields a tick twice when a venue repeats itself on a resume', async () => {
    const client = new VenueClient({
      baseUrl: await fakeVenue({ dropAfter: 12, repeatOnResume: true }),
    });
    const sequences: number[] = [];
    const iterator = client.subscribe('eurusd', { from: 1, reconnects: 10 });
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      if (next.value.kind === 'tick') sequences.push(next.value.tick.sequence);
    }
    expect(sequences).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it('refuses a stream that skips a sequence without telling a gap', async () => {
    const client = new VenueClient({ baseUrl: await fakeVenue({ skipSequence: true }) });
    const iterator = client.subscribe('eurusd', { from: 1 });
    await expect(
      (async () => {
        for (;;) {
          const next = await iterator.next();
          if (next.done) return next.value;
        }
      })(),
    ).rejects.toThrow(/sequence 31 after 29 with no gap told/);
  });

  it('gives up after the reconnect budget', async () => {
    const client = new VenueClient({ baseUrl: await fakeVenue({ dropAfter: 5 }) });
    const iterator = client.subscribe('eurusd', { from: 1, reconnects: 1 });
    let result = '';
    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }
    expect(result).toBe('reconnect budget spent');
  });
});
