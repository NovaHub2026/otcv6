// Invariant evidence: INV-002 (shared market), INV-009 (reproducible settlement), INV-010 (private generator state).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { LeaderSession, SqliteCoordinatedStore } from '@otc/runtime';
import {
  buildAnchor,
  commit,
  commitmentIsPruneable,
  extendsAnchor,
  journalIsPruneable,
  partitionForRetention,
  publicKeyHex,
  publishingKeyFromSeed,
  signCommitment,
  signRotation,
  verifyAnchor,
  verifySignedChain,
  type JournalWindow,
  type SignedCommitment,
} from '@otc/distribution';
import { runStandingAssurance, WITHHELD_FAMILY_NAMES, type TickJournal } from '@otc/lab';

/**
 * PH-15's integrated verification: a venue that is actually operated.
 *
 * The three subphases each built one piece — a store two processes can share, a
 * chain that survives a key rotation, a verdict that recomputes its own floor.
 * This runs them together against a real engine, because the phase's claim is
 * about a venue that is left running rather than about three modules that each
 * pass their own tests.
 *
 * It sits in the statistical project by convention — `tools/sim` is where this
 * repository keeps end-to-end evidence runs — and not because it is expensive.
 * Measured at 438ms for an hour of market time on two assets. That is worth
 * stating: the first draft of this comment justified the placement by cost,
 * which would have been a false claim about a cheap test and exactly the kind
 * of unchecked assertion PH-15.1 had to correct one package over.
 */

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('operations-spec');
const STEP_MS = 5_000;
const STEPS = 700; // just under an hour of market time per asset
const WINDOW_TICKS = 64;
const TEST_CATCH_UP_MS = 86_400_000;

const KEY_A = publishingKeyFromSeed('a1'.repeat(32));
const KEY_B = publishingKeyFromSeed('b2'.repeat(32));

const directories: string[] = [];
async function scratch(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-operations-'));
  directories.push(directory);
  return directory;
}

afterAll(async () => {
  await Promise.all(directories.map((d) => rm(d, { recursive: true, force: true })));
});

/** Commit a record in fixed windows, signing each with whichever key is in force. */
function chainOver(
  assetId: string,
  ticks: readonly Tick[],
  rotateAfterWindows: number,
): SignedCommitment[] {
  const chain: SignedCommitment[] = [];
  let previousRoot = '';
  for (let start = 0; start + WINDOW_TICKS <= ticks.length; start += WINDOW_TICKS) {
    const window = ticks.slice(start, start + WINDOW_TICKS);
    const commitment = commit(assetId, window, previousRoot);
    previousRoot = commitment.root;
    const key = chain.length < rotateAfterWindows ? KEY_A : KEY_B;
    chain.push(signCommitment(commitment, key));
  }
  return chain;
}

describe('a venue that is operated, not just built', () => {
  it('runs on a shared store, publishes across a key rotation, and reports an honest floor', async () => {
    const clock = new SteppableClock(GENESIS);
    const file = path.join(await scratch(), 'venue.db');
    const store = new SqliteCoordinatedStore(file, clock);
    const assets = ASSET_CATALOGUE.slice(0, 2);

    // ---- PH-15.1: the venue runs on a store two processes could share -------
    const sessions = [];
    for (const asset of assets) {
      const result = await LeaderSession.takeOver({
        asset,
        keyring,
        environment: 'test',
        clock,
        store,
        holder: 'api-1#operations',
        genesisInstant: GENESIS,
        maxCatchUpMs: TEST_CATCH_UP_MS,
      });
      if (result.kind !== 'led') throw new Error(`expected to lead ${asset.definition.id}`);
      sessions.push(result.session);
    }

    for (let step = 0; step < STEPS; step += 1) {
      clock.advance(durationMillis(STEP_MS));
      for (const session of sessions) await session.advance(clock.now());
      if (step % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
    }

    // The record survives the process that wrote it, which is the whole point
    // of replacing the in-memory reference.
    for (const session of sessions) await session.release();
    store.close();
    const reopened = new SqliteCoordinatedStore(file, clock);

    const records = new Map<string, Tick[]>();
    for (const asset of assets) {
      const assetId = asset.definition.id;
      const entries = await reopened.readRecord(assetId, 1, 1_000_000);
      const ticks = entries.flatMap((entry) => (entry.kind === 'tick' ? [entry.tick] : []));
      expect(ticks.length).toBeGreaterThan(WINDOW_TICKS * 4);
      records.set(assetId, ticks);
    }

    // ---- PH-15.2: the chain survives a rotation ----------------------------
    const chains = [...records].map(([assetId, ticks]) => chainOver(assetId, ticks, 2));
    // The rotation names the head in force for every asset when it was signed.
    // **Cycle Audit 5, F-3**: without that, "follows the rotation" means only
    // "appears later in the array the verifier was handed".
    const rotation = signRotation(
      {
        toPublicKey: publicKeyHex(KEY_B),
        epoch: 1,
        reason: 'scheduled quarterly rotation',
        heads: chains.map((chain) => ({
          assetId: chain[0]!.commitment.assetId,
          root: chain[1]!.commitment.root,
        })),
      },
      KEY_A,
    );
    for (const chain of chains) {
      expect(chain.length).toBeGreaterThan(3);
      // Signed by two different keys, and verified from the genesis key alone.
      expect(new Set(chain.map((link) => link.publicKey)).size).toBe(2);
      expect(verifySignedChain(chain, publicKeyHex(KEY_A), [rotation])).toBeNull();
      // Without the rotation log the successor is unattested, and refusing is
      // right: an operator who could rotate silently could hand over to anyone.
      expect(verifySignedChain(chain, publicKeyHex(KEY_A))).not.toBeNull();
    }

    // ---- PH-15.2: the anchor agrees, and extends -------------------------
    const anchor = buildAnchor(chains, clock.now());
    expect(verifyAnchor(anchor, chains)).toBeNull();

    const longer = [...records].map(([assetId, ticks]) => chainOver(assetId, ticks, 2));
    expect(extendsAnchor(anchor, buildAnchor(longer, clock.now() + 1), longer)).toBeNull();
    // A record that lost a window is not an extension of one that had it.
    // The chain is required: **Cycle Audit 5, F-1** showed the anchors alone
    // cannot bear the append-only claim once the record has grown.
    const truncated = chains.map((chain) => chain.slice(0, chain.length - 1));
    expect(
      extendsAnchor(anchor, buildAnchor(truncated, clock.now() + 1), truncated),
    ).not.toBeNull();

    // And the anchor's identity claim is checked against the genesis key and
    // the rotation log, rather than against a field the same party supplied.
    expect(
      verifyAnchor(anchor, chains, {
        genesisPublicKey: publicKeyHex(KEY_A),
        rotations: [rotation],
      }),
    ).toBeNull();

    // ---- PH-15.2: retention keeps what a dispute could reach --------------
    const windows: JournalWindow[] = [...records].map(([assetId, ticks]) => ({
      assetId,
      fromSequence: ticks[0]!.sequence,
      toSequence: ticks[ticks.length - 1]!.sequence,
      newestInstant: ticks[ticks.length - 1]!.instant,
    }));
    const fresh = partitionForRetention(windows, clock.now());
    expect(fresh.pruneable).toEqual([]);
    const aged = partitionForRetention(windows, clock.now() + 200 * 24 * 60 * 60 * 1000);
    expect(aged.retained).toEqual([]);
    // And no age makes a commitment discardable.
    for (const chain of chains) {
      for (const link of chain) {
        expect(commitmentIsPruneable(link.commitment, clock.now() + 1e12)).toBe(false);
      }
    }
    expect(journalIsPruneable(windows[0]!, clock.now())).toBe(false);

    // ---- PH-15.3: the standing verdict, with the floor it earned ----------
    for (const [assetId, ticks] of records) {
      const journal: TickJournal = {
        instrumentId: assetId,
        logQuantum: 1e-5,
        ticks,
      };
      const verdict = runStandingAssurance({
        assetId,
        journal,
        at: clock.now(),
        familyNames: [...WITHHELD_FAMILY_NAMES],
      });

      // An hour of market time is nowhere near enough power to say `clean` at
      // the margin the payout implies, and the report says so rather than
      // borrowing confidence from PH-3's 327-day run.
      expect(verdict.outcome).toBe('undecided');
      expect(verdict.horizons).toHaveLength(8);
      for (const horizon of verdict.horizons) {
        expect(horizon.detectionFloorPp).toBeGreaterThan(0);
      }
      // The 30-second horizon has the most windows and therefore the finest
      // floor, which is the shape PH-11 established.
      const fastest = verdict.horizons[0]!;
      const slowest = verdict.horizons[verdict.horizons.length - 1]!;
      expect(fastest.horizon).toBe('30s');
      expect(fastest.trials).toBeGreaterThan(slowest.trials);
      expect(fastest.detectionFloorPp).toBeLessThan(slowest.detectionFloorPp);

      // And it refuses to speak without the withheld families.
      expect(() =>
        runStandingAssurance({
          assetId,
          journal,
          at: clock.now(),
          familyNames: ['second-of-minute'],
        }),
      ).toThrow();
    }

    reopened.close();
  }, 600_000);
});
