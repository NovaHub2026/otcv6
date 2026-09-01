// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream), INV-008 (continuous market state).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { FollowerMarket } from './follower.js';
import { AssetLease, MemoryCoordinatedStore } from './lease.js';
import { resumeMarket } from './resume.js';
import type { HostedMarket } from './hosted.js';

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('multi-node-spec');
/** These tests declare their catch-up bursts; see the note in `hosted.test.ts`. */
const TEST_CATCH_UP_MS = 86_400_000;

const STEP_MS = 5_000;
const STEPS = 120; // ten minutes of market time per asset
/** Instants sampled per asset when checking price agreement. */
const SAMPLES_PER_ASSET = 250;

interface Node {
  readonly assetId: string;
  readonly market: HostedMarket;
  readonly lease: AssetLease;
  /** Everything the leader has published, in order. The authoritative record. */
  readonly published: Tick[];
}

/**
 * Advance the clock the way a running leader does: renewing first.
 *
 * Written this way because the first draft of these tests did not renew, and
 * the lease expired 15 seconds into a ten-minute run — the fence refused the
 * append and the test failed. That is the mechanism working, and it is worth
 * recording that the correct test had to be shaped around it rather than the
 * other way round.
 */
async function tickClock(clock: SteppableClock, nodes: readonly Node[]): Promise<void> {
  clock.advance(durationMillis(STEP_MS));
  for (const node of nodes) {
    expect(await node.lease.renew()).toBe(true);
  }
}

async function leadEverything(
  store: MemoryCoordinatedStore,
  clock: SteppableClock,
): Promise<Node[]> {
  const nodes: Node[] = [];
  for (const asset of ASSET_CATALOGUE) {
    const assetId = asset.definition.id;
    const lease = await AssetLease.acquire(store, assetId, 'api-1#leader');
    if (!(lease instanceof AssetLease)) throw new Error(`expected to lead ${assetId}`);
    const { market } = await resumeMarket({
      asset,
      keyring,
      environment: 'test',
      clock,
      store,
      genesisInstant: GENESIS,
      maxCatchUpMs: TEST_CATCH_UP_MS,
    });
    nodes.push({ assetId, market, lease, published: [] });
  }
  return nodes;
}

/**
 * A follower's history must be a prefix of the leader's — never a variant.
 *
 * Checked incrementally, from `verifiedThrough` onwards. Re-comparing the whole
 * history every step is quadratic and made the first draft of this test time
 * out at 120 steps; the incremental check sees every tick exactly once, at the
 * moment it is applied, which is where a divergence would appear. The whole
 * history is deep-compared once at the end.
 */
function verifyPrefix(
  follower: FollowerMarket,
  published: readonly Tick[],
  verifiedThrough: number,
): number {
  const held = follower.retained;
  if (held.length > published.length) {
    throw new Error(
      `Follower for ${follower.assetId} holds ${held.length} ticks; the leader published ` +
        `${published.length}. A follower ahead of the record has generated something.`,
    );
  }
  for (let index = verifiedThrough; index < held.length; index += 1) {
    const mine = held[index]!;
    const authoritative = published[index]!;
    if (
      mine.sequence !== authoritative.sequence ||
      mine.instant !== authoritative.instant ||
      mine.price !== authoritative.price
    ) {
      throw new Error(
        `Divergence for ${follower.assetId} at index ${index}: follower has ` +
          `(${mine.sequence}, ${mine.instant}, ${mine.price}), the record has ` +
          `(${authoritative.sequence}, ${authoritative.instant}, ${authoritative.price}).`,
      );
    }
  }
  return held.length;
}

/** The leader's own answer to "the price at instant T". */
function leaderPriceAt(published: readonly Tick[], instant: number): number | null {
  let answer: number | null = null;
  for (const tick of published) {
    if (tick.instant > instant) break;
    answer = tick.price;
  }
  return answer;
}

describe('INV-002 across nodes: one leader, many followers, one market', () => {
  it('every follower holds a prefix of the record and agrees on every instant it covers', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const nodes = await leadEverything(store, clock);

    // Three followers reading at different rates, which is the realistic case
    // and the one where a divergence would first show: a fast follower and a
    // slow one must still never disagree about a tick they both hold.
    const followers = nodes.map((node) => ({
      node,
      fast: new FollowerMarket({ assetId: node.assetId }),
      slow: new FollowerMarket({ assetId: node.assetId }),
      lazy: new FollowerMarket({ assetId: node.assetId }),
      verified: { fast: 0, slow: 0, lazy: 0 },
    }));

    for (let step = 0; step < STEPS; step += 1) {
      await tickClock(clock, nodes);
      for (const entry of followers) {
        const ticks = entry.node.market.advance();
        if (ticks.length > 0) {
          entry.node.published.push(...ticks);
          await store.appendTicks(entry.node.assetId, entry.node.lease.token, ticks);
        }
        // The fast follower keeps up; the slow one reads a bounded window each
        // step and falls behind; the lazy one only reads occasionally.
        await entry.fast.pull(store);
        await entry.slow.pull(store, 3);
        if (step % 17 === 0) await entry.lazy.pull(store);

        entry.verified.fast = verifyPrefix(entry.fast, entry.node.published, entry.verified.fast);
        entry.verified.slow = verifyPrefix(entry.slow, entry.node.published, entry.verified.slow);
        entry.verified.lazy = verifyPrefix(entry.lazy, entry.node.published, entry.verified.lazy);
      }
      // Long enough to matter, short enough to stay in the unit project — but
      // still yielding, because a synchronous driver starves the worker's own
      // RPC channel and the failure looks like a green suite with exit 1 (B-005).
      if (step % 20 === 0) await new Promise((resolve) => setImmediate(resolve));
    }

    for (const entry of followers) {
      expect(entry.node.published.length).toBeGreaterThan(50);
      // The fast follower is current, and current means byte-identical.
      expect(entry.fast.head).toBe(entry.node.published[entry.node.published.length - 1]!.sequence);
      expect(entry.fast.retained).toEqual(entry.node.published);
      // The others are behind, which is the permitted disagreement and the only
      // one: a prefix relationship, never a divergence (PH-7's contract, now
      // across nodes rather than within a process).
      expect(entry.slow.head).toBeLessThanOrEqual(entry.fast.head!);
      expect(entry.lazy.head).toBeLessThanOrEqual(entry.fast.head!);

      // Agreement on price at every instant every follower covers. This follows
      // from the prefix property, and is asserted anyway: PH-7's proof rested on
      // a premise a restart falsifies, which is how this phase began.
      for (const follower of [entry.fast, entry.slow, entry.lazy]) {
        const covered = follower.retained;
        if (covered.length === 0) continue;
        // The full history is deep-compared once, which the incremental check
        // in the loop does not subsume: it proves nothing was rewritten behind
        // the cursor.
        expect(covered).toEqual(entry.node.published.slice(0, covered.length));

        const last = covered[covered.length - 1]!.instant;
        const stride = Math.max(1, Math.floor((last - GENESIS) / SAMPLES_PER_ASSET));
        for (let instant: number = GENESIS; instant <= last; instant += stride) {
          expect(follower.priceAt(epochMillis(instant))).toBe(
            leaderPriceAt(entry.node.published, instant),
          );
        }
      }
    }
  });

  it('a follower never holds a tick the leader did not publish', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const [node] = await leadEverything(store, clock);
    if (node === undefined) throw new Error('no assets');
    const follower = new FollowerMarket({ assetId: node.assetId });

    for (let step = 0; step < 40; step += 1) {
      await tickClock(clock, [node]);
      const ticks = node.market.advance();
      node.published.push(...ticks);
      await store.appendTicks(node.assetId, node.lease.token, ticks);
      await follower.pull(store);
    }

    const published = new Set(node.published.map((t) => `${t.sequence}:${t.instant}:${t.price}`));
    for (const tick of follower.retained) {
      expect(published.has(`${tick.sequence}:${tick.instant}:${tick.price}`)).toBe(true);
    }
    expect(follower.retained.length).toBe(node.published.length);
  });

  it('different assets lead independently, which is where the scale-out comes from', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);

    // Assets split across two nodes, alternating. Neither node can write the
    // other's record, and the two records advance together with no interaction.
    const owners = new Map<string, string>();
    const leases = new Map<string, AssetLease>();
    for (const [index, asset] of ASSET_CATALOGUE.entries()) {
      const assetId = asset.definition.id;
      const holder = index % 2 === 0 ? 'api-1#aa' : 'api-2#bb';
      const lease = await AssetLease.acquire(store, assetId, holder);
      if (!(lease instanceof AssetLease)) throw new Error(`expected to lead ${assetId}`);
      owners.set(assetId, holder);
      leases.set(assetId, lease);
    }
    expect(new Set(owners.values()).size).toBe(2);

    const markets = new Map<string, HostedMarket>();
    for (const asset of ASSET_CATALOGUE) {
      const { market } = await resumeMarket({
        asset,
        keyring,
        environment: 'test',
        clock,
        store,
        genesisInstant: GENESIS,
        maxCatchUpMs: TEST_CATCH_UP_MS,
      });
      markets.set(asset.definition.id, market);
    }

    for (let step = 0; step < 30; step += 1) {
      clock.advance(durationMillis(STEP_MS));
      for (const [assetId, market] of markets) {
        const lease = leases.get(assetId)!;
        expect(await lease.renew()).toBe(true);
        await store.appendTicks(assetId, lease.token, market.advance());
      }
    }

    for (const asset of ASSET_CATALOGUE) {
      expect(await store.recordHead(asset.definition.id)).not.toBeNull();
    }
  });
});
