// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream), INV-008 (continuous market state), INV-009 (reproducible settlement), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, logPrice, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE, type RegisteredAsset } from '@otc/engine';
import { LeaderSession, LeadershipLostError } from './failover.js';
import { FollowerMarket } from './follower.js';
import { StaleFenceError } from './fence.js';
import { MemoryCoordinatedStore } from './lease.js';
import type { RecordEntry } from './replication.js';
import type { MarketStateRecord } from './state.js';

/**
 * PH-14's integrated verification: a cluster that actually loses nodes.
 *
 * The three subphases each proved their own mechanism. This proves them
 * together, which is the only place the phase's claim can be tested: nodes
 * competing for leases, leaders dying without releasing anything, successors
 * taking over from whatever the record holds, and followers serving throughout.
 *
 * The claim is the product's most visible promise — same asset, same moment,
 * same price, whichever node you reach — and it is asserted at every step
 * rather than at the end, because a divergence that heals is still a
 * divergence somebody was served.
 */

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('cluster-spec');
const TEST_CATCH_UP_MS = 86_400_000;
const STEP_MS = 5_000;
const STEPS = 90;

class SimNode {
  readonly sessions = new Map<string, LeaderSession>();
  readonly followers = new Map<string, FollowerMarket>();
  alive = true;

  constructor(readonly id: string) {}

  /**
   * Crash: nothing is released, nothing is cleaned up, the leases just stop
   * being renewed.
   *
   * The sessions are handed back rather than dropped, so the caller can keep
   * driving them as a *zombie*: a process that is gone as far as the cluster is
   * concerned and still holds live objects that believe they lead. That is the
   * two-leaders hazard PH-14 §9 names, and it is only real if something
   * actually tries it.
   */
  crash(): LeaderSession[] {
    this.alive = false;
    const abandoned = [...this.sessions.values()];
    this.sessions.clear();
    return abandoned;
  }

  follower(assetId: string): FollowerMarket {
    let follower = this.followers.get(assetId);
    if (follower === undefined) {
      follower = new FollowerMarket({ assetId });
      this.followers.set(assetId, follower);
    }
    return follower;
  }
}

function optionsFor(
  node: SimNode,
  asset: RegisteredAsset,
  store: MemoryCoordinatedStore,
  clock: SteppableClock,
  boot: number,
) {
  return {
    asset,
    keyring,
    environment: 'test' as const,
    clock,
    store,
    // Per process, not per node: a restarted process must not be able to claim
    // its predecessor's live lease (PH-14.1 §6).
    holder: `${node.id}#boot-${boot}`,
    genesisInstant: GENESIS,
    maxCatchUpMs: TEST_CATCH_UP_MS,
    checkpointIntervalMs: 20_000,
  };
}

/**
 * Damage a checkpoint so the next takeover must seam rather than resume.
 *
 * Without this every crash in the run resumes cleanly, the seam path is never
 * reached, and the assertion that every sequence jump is accounted for by a
 * recorded seam is vacuously true on both sides. An integrated verification
 * that cannot reach half the failover logic is not one.
 */
async function damageCheckpoint(store: MemoryCoordinatedStore, assetId: string): Promise<boolean> {
  const record = await store.load(assetId);
  if (record === null || record.pending === null) return false;
  const damaged: MarketStateRecord = {
    ...record,
    snapshot: { ...record.snapshot, sequence: record.pending.sequence + 7 },
  };
  await store.save(damaged);
  return true;
}

/** The record as ticks, with the seams that separate them. */
async function readAll(
  store: MemoryCoordinatedStore,
  assetId: string,
): Promise<readonly RecordEntry[]> {
  return store.readRecord(assetId, 1, 1_000_000);
}

describe('a cluster that loses nodes still publishes one market', () => {
  it('holds INV-002 across three nodes, five assets and four failovers', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const nodes = [new SimNode('api-1'), new SimNode('api-2'), new SimNode('api-3')];
    const assets = ASSET_CATALOGUE;
    const boots = new Map(nodes.map((node) => [node.id, 0]));

    /** Steps at which a node crashes, and which one. */
    const crashes = new Map<number, string>([
      [20, 'api-1'],
      [38, 'api-2'],
      [56, 'api-3'],
      [72, 'api-1'],
    ]);
    /** Steps at which a crashed node comes back. */
    const revivals = new Map<number, string>([
      [30, 'api-1'],
      [48, 'api-2'],
      [66, 'api-3'],
      [82, 'api-1'],
    ]);

    let failovers = 0;
    let seamsSeen = 0;
    let damagedAsset: string | null = null;
    /**
     * Sessions belonging to a process that stopped, and the step it wakes at.
     *
     * Modelled as a *pause*, not as a loop that keeps running. The first draft
     * kept driving the abandoned sessions every step and measured zero
     * refusals, because `advance` renews before it generates — a process that
     * can still reach the store is not a zombie, it is the leader, and it is
     * right that it keeps leading.
     *
     * The hazard is the other one: a process suspended past its term — a
     * stop-the-world pause, a descheduled VM, a partition that heals — that
     * wakes believing it still leads and flushes everything it has. Fencing
     * exists for exactly that, and it is only tested if something tries it.
     */
    let paused: { readonly sessions: LeaderSession[]; readonly wakeAt: number } | null = null;
    let zombieRefusals = 0;
    let fenceRefusals = 0;
    /** How far each follower has been verified against the record. */
    const verified = new Map<string, number>();

    for (let step = 0; step < STEPS; step += 1) {
      clock.advance(durationMillis(STEP_MS));

      const crashing = crashes.get(step);
      if (crashing !== undefined) {
        const abandoned = nodes.find((n) => n.id === crashing)?.crash() ?? [];
        // Wakes five steps later: 25 seconds, comfortably past the 15-second
        // term, so every one of its writes must be refused.
        paused = { sessions: abandoned, wakeAt: step + 5 };
        // One crash in the run also takes the checkpoint with it, so the
        // successor has to seam and the seam path is part of this verification.
        if (step === 38) {
          for (const asset of assets) {
            if (await damageCheckpoint(store, asset.definition.id)) {
              damagedAsset = asset.definition.id;
              break;
            }
          }
        }
      }
      const reviving = revivals.get(step);
      if (reviving !== undefined) {
        const node = nodes.find((n) => n.id === reviving)!;
        node.alive = true;
        boots.set(node.id, boots.get(node.id)! + 1);
      }

      // The suspended process wakes and flushes. Every write must be refused,
      // and the record must be untouched by it.
      if (paused !== null && step === paused.wakeAt) {
        for (const zombie of paused.sessions) {
          const headBefore = await store.recordHead(zombie.assetId);

          // Defence one: the session renews before it generates, so it stops
          // without ever spending a keystream position.
          await expect(zombie.advance(clock.now())).rejects.toBeInstanceOf(LeadershipLostError);
          zombieRefusals += 1;

          // Defence two, reached only by going round the first: a direct write
          // under the token the woken process still believes in. The two are
          // independent and only one of them is exercised by the path above —
          // removing the fence entirely left this test green until the write
          // below was added.
          await expect(
            store.appendTicks(zombie.assetId, zombie.token, [
              {
                sequence: (headBefore ?? 0) + 1,
                instant: clock.now(),
                price: logPrice(1),
              },
            ]),
          ).rejects.toBeInstanceOf(StaleFenceError);
          fenceRefusals += 1;

          expect(await store.recordHead(zombie.assetId)).toBe(headBefore);
        }
        paused = null;
      }

      for (const node of nodes) {
        if (!node.alive) continue;
        for (const asset of assets) {
          const assetId = asset.definition.id;
          const session = node.sessions.get(assetId);
          if (session !== undefined) {
            try {
              const advance = await session.advance(clock.now());
              if (advance.seam !== null) seamsSeen += 1;
            } catch (error) {
              // The only expected failure: this node no longer leads. Anything
              // else is a defect and must not be swallowed.
              if (!(error instanceof LeadershipLostError)) throw error;
              node.sessions.delete(assetId);
            }
            continue;
          }
          const result = await LeaderSession.takeOver(
            optionsFor(node, asset, store, clock, boots.get(node.id)!),
          );
          if (result.kind === 'led') {
            node.sessions.set(assetId, result.session);
            failovers += 1;
          } else {
            await node.follower(assetId).pull(store);
          }
        }
      }

      // Single writer, checked at every step rather than argued for: no two
      // live nodes hold a session for the same asset.
      for (const asset of assets) {
        const assetId = asset.definition.id;
        const leaders = nodes.filter((n) => n.alive && n.sessions.has(assetId));
        expect(leaders.length).toBeLessThanOrEqual(1);
      }

      // Every follower is a prefix of the record, checked incrementally so the
      // whole run stays linear.
      for (const node of nodes) {
        for (const [assetId, follower] of node.followers) {
          const key = `${node.id}:${assetId}`;
          const record = await readAll(store, assetId);
          const ticks = record.flatMap((e) => (e.kind === 'tick' ? [e.tick] : []));
          const from = verified.get(key) ?? 0;
          const held = follower.retained;
          expect(held.length).toBeLessThanOrEqual(ticks.length);
          for (let index = from; index < held.length; index += 1) {
            const mine = held[index]!;
            const authoritative = ticks[index]!;
            if (
              mine.sequence !== authoritative.sequence ||
              mine.instant !== authoritative.instant ||
              mine.price !== authoritative.price
            ) {
              throw new Error(
                `Divergence on ${node.id} for ${assetId} at index ${index}: follower has ` +
                  `(${mine.sequence}, ${mine.instant}, ${mine.price}), the record has ` +
                  `(${authoritative.sequence}, ${authoritative.instant}, ${authoritative.price}).`,
              );
            }
          }
          verified.set(key, held.length);
        }
      }

      if (step % 15 === 0) await new Promise((resolve) => setImmediate(resolve));
    }

    // The run has to have exercised what it claims to exercise.
    expect(failovers).toBeGreaterThan(assets.length);
    let totalTicks = 0;

    for (const asset of assets) {
      const assetId = asset.definition.id;
      const record = await readAll(store, assetId);
      const ticks = record.flatMap((e) => (e.kind === 'tick' ? [e.tick] : []));
      const seams = await store.seams(assetId);
      totalTicks += ticks.length;
      expect(ticks.length).toBeGreaterThan(30);

      // No sequence twice, ever, however many nodes led it.
      const seen = new Set<number>();
      for (const tick of ticks) {
        expect(seen.has(tick.sequence)).toBe(false);
        seen.add(tick.sequence);
      }

      // Sequences increase, and every jump is accounted for by a recorded seam.
      const jumps: number[] = [];
      for (let index = 1; index < ticks.length; index += 1) {
        const previous = ticks[index - 1]!.sequence;
        const current = ticks[index]!.sequence;
        expect(current).toBeGreaterThan(previous);
        if (current !== previous + 1) jumps.push(previous);
      }
      expect(jumps).toEqual(seams.map((seam) => seam.lastSequence));

      // Instants never move backwards, across every takeover.
      for (let index = 1; index < ticks.length; index += 1) {
        expect(ticks[index]!.instant).toBeGreaterThanOrEqual(ticks[index - 1]!.instant);
      }
    }

    expect(totalTicks).toBeGreaterThan(200);
    // The damaged checkpoint really did force a seam, so the jump-accounting
    // assertion above compared two non-empty lists on at least one asset.
    expect(damagedAsset).not.toBeNull();
    expect(seamsSeen).toBe(1);
    expect(await store.seams(damagedAsset!)).toHaveLength(1);
    // The two-leaders hazard was actually attempted, repeatedly, and refused
    // every time. An untried hazard is not a tested one.
    expect(zombieRefusals).toBeGreaterThanOrEqual(assets.length);
    expect(fenceRefusals).toBe(zombieRefusals);
  });

  it('a follower reaching any node answers the price identically to the record', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);
    const asset = ASSET_CATALOGUE[0]!;
    const assetId = asset.definition.id;
    const leader = new SimNode('api-1');
    const watchers = [new SimNode('api-2'), new SimNode('api-3')];

    const first = await LeaderSession.takeOver(optionsFor(leader, asset, store, clock, 0));
    if (first.kind !== 'led') throw new Error('expected to lead');
    let session: LeaderSession | null = first.session;

    for (let step = 0; step < 60; step += 1) {
      clock.advance(durationMillis(STEP_MS));
      if (step === 25) session = null; // the leader dies
      if (step === 32) {
        const taken = await LeaderSession.takeOver(
          optionsFor(watchers[0]!, asset, store, clock, 0),
        );
        if (taken.kind !== 'led') throw new Error('expected the successor to lead');
        session = taken.session;
      }
      if (session !== null) await session.advance(clock.now());
      for (const watcher of watchers) await watcher.follower(assetId).pull(store);
    }

    const record = await readAll(store, assetId);
    const ticks = record.flatMap((e) => (e.kind === 'tick' ? [e.tick] : []));
    expect(ticks.length).toBeGreaterThan(30);

    const authoritative = (instant: number): number | null => {
      let answer: number | null = null;
      for (const tick of ticks) {
        if (tick.instant > instant) break;
        answer = tick.price;
      }
      return answer;
    };

    const last = ticks[ticks.length - 1]!.instant;
    const stride = Math.max(1, Math.floor((last - GENESIS) / 400));
    for (const watcher of watchers) {
      const follower = watcher.follower(assetId);
      expect(follower.retained).toEqual(ticks);
      for (let instant: number = GENESIS; instant <= last; instant += stride) {
        const at = epochMillis(instant);
        // Inside a recorded seam a follower reports nothing, which is not a
        // disagreement with the record — it is a refusal to answer for a window
        // in which no node was generating.
        if (follower.priceAt(at) === null && follower.seams.length > 0) continue;
        expect(follower.priceAt(at)).toBe(authoritative(instant));
      }
    }
  });
});
