// Invariant evidence: INV-002 (shared market), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, SteppableClock, type Tick } from '@otc/core';
import { FollowerMarket, ReplicationGapError } from './follower.js';
import type { RecordEntry, SeamMarker } from './replication.js';
import { MemoryCoordinatedStore } from './lease.js';

const GENESIS = epochMillis(1_776_000_000_000);
const ASSET = 'eurusd';

function tick(sequence: number, price = 100_000 + sequence): Tick {
  return {
    sequence,
    instant: epochMillis(GENESIS + sequence * 1_000),
    price: logPrice(price),
  };
}

function ticks(from: number, to: number): Tick[] {
  const out: Tick[] = [];
  for (let s = from; s <= to; s += 1) out.push(tick(s));
  return out;
}

/** Ticks as record entries, which is what a follower is given. */
function entries(from: number, to: number): RecordEntry[] {
  return ticks(from, to).map((t) => ({ kind: 'tick', tick: t }));
}

function seamEntry(seam: SeamMarker): RecordEntry {
  return { kind: 'seam', seam };
}

async function ledStore(): Promise<{ store: MemoryCoordinatedStore; token: number }> {
  const store = new MemoryCoordinatedStore(new SteppableClock(GENESIS));
  const outcome = await store.acquire(ASSET, 'api-1#aa');
  if (outcome.kind !== 'granted') throw new Error('expected a grant');
  return { store, token: outcome.grant.token };
}

describe('a follower applies only what continues it', () => {
  it('starts empty and reports no head', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    expect(follower.head).toBeNull();
    expect(follower.oldestRetained).toBeNull();
    expect(follower.retained).toEqual([]);
  });

  it('applies a contiguous run', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    expect(follower.head).toBe(5);
    expect(follower.retained).toEqual(ticks(1, 5));
  });

  it('refuses a gap rather than closing it', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 3));
    expect(() => follower.apply([{ kind: 'tick', tick: tick(5) }])).toThrow(ReplicationGapError);
  });

  it('refuses a tick it has already applied', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 3));
    expect(() => follower.apply([{ kind: 'tick', tick: tick(3) }])).toThrow(ReplicationGapError);
  });

  it('accepts an empty batch', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply([]);
    expect(follower.head).toBeNull();
  });

  it('adopts whatever sequence the record starts at', () => {
    // A leader resuming after a crash starts beyond its leased sequence block,
    // so a record's first tick is routinely not sequence 1.
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(5_378, 5_380));
    expect(follower.head).toBe(5_380);
  });

  it.each([0, -1, 1.5])('refuses a retention window of %s', (retainTicks) => {
    expect(() => new FollowerMarket({ assetId: ASSET, retainTicks })).toThrow(RangeError);
  });
});

describe('a follower pulls from the record', () => {
  it('catches up in one pull and then applies nothing', async () => {
    const { store, token } = await ledStore();
    await store.appendTicks(ASSET, token, ticks(1, 40));
    const follower = new FollowerMarket({ assetId: ASSET });
    expect(await follower.pull(store)).toBe(40);
    expect(await follower.pull(store)).toBe(0);
    expect(follower.head).toBe(40);
  });

  it('catches up across several bounded pulls', async () => {
    const { store, token } = await ledStore();
    await store.appendTicks(ASSET, token, ticks(1, 100));
    const follower = new FollowerMarket({ assetId: ASSET });
    let pulls = 0;
    while ((await follower.pull(store, 10)) > 0) pulls += 1;
    expect(pulls).toBe(10);
    expect(follower.retained).toEqual(ticks(1, 100));
  });

  it('pulls nothing from an asset with no record', async () => {
    const { store } = await ledStore();
    const follower = new FollowerMarket({ assetId: ASSET });
    expect(await follower.pull(store)).toBe(0);
    expect(follower.head).toBeNull();
  });
});

describe('behind, impossible and evicted are different answers', () => {
  it('serves what it holds', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    const result = follower.serve(3, 5);
    expect(result.kind).toBe('entries');
    if (result.kind !== 'entries') throw new Error('unreachable');
    expect(result.entries).toEqual(entries(3, 5));
  });

  it('treats one past its head as "everything, then wait"', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    expect(follower.serve(6, 5)).toEqual({ kind: 'entries', entries: [] });
  });

  it('says lagging — not unknown — when the record is ahead of it', () => {
    // The client read sequence 8 from the leader and reconnected here. It is
    // holding a real record; this node is the one behind. Telling it that it
    // holds something the feed never produced would send a correct client to
    // reset a correct history.
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    const result = follower.serve(8, 20);
    expect(result).toEqual({ kind: 'lagging', followerHead: 5, recordHead: 20 });
  });

  it('says lagging when it holds nothing at all and the record does', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    expect(follower.serve(1, 20)).toEqual({ kind: 'lagging', followerHead: null, recordHead: 20 });
  });

  it('says unknown when the request is past the record itself', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    const result = follower.serve(22, 20);
    expect(result).toEqual({ kind: 'unknown', requested: 22, recordHead: 20 });
  });

  it('accepts one past the record head, which means "send me what comes next"', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 20));
    expect(follower.serve(21, 20)).toEqual({ kind: 'entries', entries: [] });
  });

  it('says unknown for anything but the first sequence when nothing is recorded', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    expect(follower.serve(1, null)).toEqual({ kind: 'entries', entries: [] });
    expect(follower.serve(2, null)).toEqual({ kind: 'unknown', requested: 2, recordHead: null });
  });

  it('says evicted when the sequence existed but has fallen out of the window', () => {
    const follower = new FollowerMarket({ assetId: ASSET, retainTicks: 10 });
    follower.apply(entries(1, 30));
    expect(follower.oldestRetained).toBe(21);
    expect(follower.serve(5, 30)).toEqual({ kind: 'evicted', requested: 5, oldestRetained: 21 });
  });

  it('keeps its head after eviction, so a lag is still reported as a lag', () => {
    const follower = new FollowerMarket({ assetId: ASSET, retainTicks: 10 });
    follower.apply(entries(1, 30));
    expect(follower.head).toBe(30);
    expect(follower.serve(45, 60)).toEqual({
      kind: 'lagging',
      followerHead: 30,
      recordHead: 60,
    });
  });

  it.each([0, -1, 2.5])('refuses a request for sequence %s', (from) => {
    const follower = new FollowerMarket({ assetId: ASSET });
    expect(() => follower.serve(from, 10)).toThrow(RangeError);
  });
});

describe('priceAt reads the record and never invents', () => {
  it('reports the last tick at or before the instant', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    expect(follower.priceAt(epochMillis(GENESIS + 3_000))).toBe(tick(3).price);
    expect(follower.priceAt(epochMillis(GENESIS + 3_500))).toBe(tick(3).price);
    expect(follower.priceAt(epochMillis(GENESIS + 99_000))).toBe(tick(5).price);
  });

  it('returns null before its first tick rather than extrapolating backwards', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(10, 15));
    expect(follower.priceAt(epochMillis(GENESIS + 5_000))).toBeNull();
  });

  it('returns null when it holds nothing', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    expect(follower.priceAt(epochMillis(GENESIS))).toBeNull();
  });
});

function seam(lastSequence: number | null, resumesAtSequence: number): SeamMarker {
  return {
    assetId: ASSET,
    lastSequence,
    lastInstant: lastSequence === null ? null : tick(lastSequence).instant,
    resumesAtSequence,
    resumesAtInstant: tick(resumesAtSequence).instant,
    reason: 'snapshot rejected',
  };
}

describe('a follower across a seam', () => {
  it('applies the discontinuity and then the ticks beyond it', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    follower.apply([seamEntry(seam(5, 500))]);
    // The head does not move — the seam's last sequence *is* the head. What
    // moves is where the next tick must land.
    expect(follower.head).toBe(5);
    expect(follower.expectNext).toBe(500);
    follower.apply(entries(500, 503));
    expect(follower.head).toBe(503);
    expect(follower.seams).toHaveLength(1);
  });

  it('refuses a seam that does not continue it', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    expect(() => follower.apply([seamEntry(seam(4, 500))])).toThrow(ReplicationGapError);
    expect(() => follower.apply([seamEntry(seam(null, 500))])).toThrow(ReplicationGapError);
  });

  it('refuses a tick that does not land where the seam said', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    follower.apply([seamEntry(seam(5, 500))]);
    expect(() => follower.apply(entries(6, 7))).toThrow(ReplicationGapError);
    expect(() => follower.apply(entries(501, 502))).toThrow(ReplicationGapError);
  });

  it('hands a client the seam rather than two runs of ticks', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    follower.apply([seamEntry(seam(5, 500))]);
    follower.apply(entries(500, 502));

    const all = follower.serve(1, 502);
    if (all.kind !== 'entries') throw new Error('expected entries');
    expect(all.entries.map((e) => e.kind)).toEqual([
      'tick',
      'tick',
      'tick',
      'tick',
      'tick',
      'seam',
      'tick',
      'tick',
      'tick',
    ]);

    // A client resuming from inside the gap gets the seam first.
    const fromGap = follower.serve(6, 502);
    if (fromGap.kind !== 'entries') throw new Error('expected entries');
    expect(fromGap.entries[0]?.kind).toBe('seam');

    // A client already past it does not get it again.
    const fromAfter = follower.serve(501, 502);
    if (fromAfter.kind !== 'entries') throw new Error('expected entries');
    expect(fromAfter.entries.every((e) => e.kind === 'tick')).toBe(true);
  });

  it('reports no price inside the gap', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    follower.apply([seamEntry(seam(5, 500))]);
    follower.apply(entries(500, 502));

    // Nothing was published between the two instants and no node was
    // generating, so there is no price to report there.
    expect(follower.priceAt(tick(250).instant)).toBeNull();
    // The edges are real ticks and answer normally.
    expect(follower.priceAt(tick(5).instant)).toBe(tick(5).price);
    expect(follower.priceAt(tick(500).instant)).toBe(tick(500).price);
  });

  it('still reports the newest price past the newest tick, because idle is not a seam', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    expect(follower.priceAt(epochMillis(GENESIS + 99_000_000))).toBe(tick(5).price);
  });

  it('identifies a contract window that crosses a discontinuity', () => {
    const follower = new FollowerMarket({ assetId: ASSET });
    follower.apply(entries(1, 5));
    follower.apply([seamEntry(seam(5, 500))]);
    follower.apply(entries(500, 502));

    expect(follower.spansSeam(tick(4).instant, tick(501).instant)).toBe(true);
    expect(follower.spansSeam(tick(5).instant, tick(500).instant)).toBe(true);
    expect(follower.spansSeam(tick(1).instant, tick(4).instant)).toBe(false);
    expect(follower.spansSeam(tick(500).instant, tick(502).instant)).toBe(false);
  });

  it('keeps a seam until every tick before it has been evicted', () => {
    const follower = new FollowerMarket({ assetId: ASSET, retainTicks: 5 });
    follower.apply(entries(1, 5));
    follower.apply([seamEntry(seam(5, 500))]);
    follower.apply(entries(500, 502));
    // Three ticks past the seam, five retained: two pre-seam ticks survive, so
    // the seam does too.
    expect(follower.entries.some((e) => e.kind === 'seam')).toBe(true);
    follower.apply(entries(503, 510));
    // Now nothing before the seam remains, and it goes with them.
    expect(follower.retained[0]!.sequence).toBeGreaterThanOrEqual(500);
    expect(follower.entries.some((e) => e.kind === 'seam')).toBe(false);
    // The seam is still reportable — it happened, whatever the window holds.
    expect(follower.seams).toHaveLength(1);
  });
});
