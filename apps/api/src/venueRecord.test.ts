// Invariant evidence: INV-002 (shared market), INV-008 (continuous market state), INV-009 (reproducible settlement).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  EvictedError,
  proveFromPublication,
  publicKeyHex,
  publishingKeyFromSeed,
  readCommitmentsStream,
  verifyCommitmentsFile,
} from '@otc/distribution';
import {
  durationMillis,
  epochMillis,
  MasterKeyring,
  SteppableClock,
  type Candle,
  type Tick,
} from '@otc/core';
import { ASSET_CATALOGUE, type RegisteredAsset } from '@otc/engine';
import {
  backupStateDirectory,
  FileStateStore,
  stateRefusal,
  verifyStateDirectory,
  HISTORY_DB,
  InMemoryCandleHistory,
  MemoryStateStore,
  MemoryTickRecord,
  RECORD_DB,
  SqliteCandleHistory,
  SqliteTickRecord,
  type CandleHistory,
  type StateStore,
  type TickRecord,
} from '@otc/runtime';
import { HistoryService } from './history.service.js';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/**
 * PH-28.1: the record outlives the process.
 *
 * A "process" here is a `VenueService` over a store, a history and the
 * record; a "kill" is a second service built over a copy of the store and the
 * history as they stood at the last checkpoint, with the record as it stands
 * at the kill — exactly what a `SIGKILL` leaves on disk, since the record is
 * appended before a tick is served and the checkpoint is not. The socket half
 * of the same scenario, against a spawned service, is
 * `servedRecord.stat.test.ts`.
 */
const GENESIS = epochMillis(1_776_000_000_000);
const MINUTE = 60_000;
// The fastest asset, so a few seconds hold several ticks and every minute holds many.
const asset: RegisteredAsset = [...ASSET_CATALOGUE].sort(
  (a, b) => a.evidence.meanIntervalMs - b.evidence.meanIntervalMs,
)[0]!;
const ID = asset.definition.id;

const keyring = (): MasterKeyring =>
  MasterKeyring.fromSecret('ph-28.1', new Uint8Array(32).fill(28));

function venue(
  store: StateStore,
  clock: SteppableClock,
  history: CandleHistory,
  record: TickRecord | null,
  publication: PublicationService = new PublicationService([asset], 500, {}),
): VenueService {
  return new VenueService(
    store,
    keyring(),
    clock,
    [asset],
    5_000,
    publication,
    new HistoryService(history, [asset]),
    GENESIS,
    0,
    null,
    null,
    null,
    record,
    250_000,
  );
}

/** Advance the clock a second at a time and run a pass after each. */
async function run(service: VenueService, clock: SteppableClock, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i += 1) {
    clock.advance(durationMillis(1_000));
    await service.tick();
  }
}

async function copyStore(store: StateStore): Promise<MemoryStateStore> {
  const copy = new MemoryStateStore();
  for (const id of await store.list()) {
    const record = await store.load(id);
    if (record !== null) await copy.save(record);
  }
  return copy;
}

async function copyHistory(history: CandleHistory): Promise<InMemoryCandleHistory> {
  const copy = new InMemoryCandleHistory();
  for (const timeframe of ['1m', '1h'] as const) {
    const bars = await history.read(
      ID,
      timeframe,
      GENESIS,
      epochMillis(GENESIS + 365 * 86_400_000),
    );
    if (bars.length > 0) await copy.append(ID, timeframe, bars);
  }
  return copy;
}

function bars(history: CandleHistory): Promise<readonly Candle[]> {
  return history.read(ID, '1m', GENESIS, epochMillis(GENESIS + 365 * 86_400_000));
}

function sequencesContiguous(ticks: readonly Tick[]): void {
  for (let i = 1; i < ticks.length; i += 1) {
    expect(ticks[i]!.sequence, `at index ${i}`).toBe(ticks[i - 1]!.sequence + 1);
  }
}

/**
 * A first process that ran 123 s: checkpointed at 115 s and killed at 123 s,
 * so a minute boundary (120 s) falls between the checkpoint and the kill.
 */
async function firstProcess(record: TickRecord): Promise<{
  first: VenueService;
  clock: SteppableClock;
  storeAtCheckpoint: MemoryStateStore;
  historyAtCheckpoint: InMemoryCandleHistory;
  served: readonly Tick[];
}> {
  const clock = new SteppableClock(GENESIS);
  const store = new MemoryStateStore();
  const history = new InMemoryCandleHistory();
  const first = venue(store, clock, history, record);
  await first.start();
  await run(first, clock, 115);
  await first.checkpoint();
  const storeAtCheckpoint = await copyStore(store);
  const historyAtCheckpoint = await copyHistory(history);
  // Eight more seconds, published and recorded, never checkpointed.
  await run(first, clock, 8);
  const served = first.feed.since(ID, 1);
  return { first, clock, storeAtCheckpoint, historyAtCheckpoint, served };
}

describe('the record outlives the process (PH-28.1)', () => {
  it('a resume from before the checkpoint is honoured after a kill, and nothing is served twice', async () => {
    const record = new MemoryTickRecord();
    const { first, clock, storeAtCheckpoint, historyAtCheckpoint, served } =
      await firstProcess(record);
    expect(served.length).toBeGreaterThan(100);
    const checkpointSequence = (await storeAtCheckpoint.load(ID))!.lastPublished!.sequence;
    const killSequence = served[served.length - 1]!.sequence;
    expect(killSequence).toBeGreaterThan(checkpointSequence + 3);
    // The record is the served record, tick for tick.
    expect(await record.since(ID, 1, 1_000_000)).toEqual(served);

    const clock2 = new SteppableClock(clock.now());
    const second = venue(storeAtCheckpoint, clock2, historyAtCheckpoint, record);
    await second.start();
    expect(second.recoveryFor(ID)?.kind).toBe('resumed');
    // Finding a, closed: the window the second process serves is the one the
    // first one served, from sequence 1, before it has published anything.
    expect(second.feed.since(ID, 1)).toEqual(served);
    expect(second.feed.since(ID, checkpointSequence - 10)).toEqual(
      served.slice(checkpointSequence - 11),
    );
    expect(second.lastTick(ID)).toEqual(served[served.length - 1]);

    // A subscriber joining at the kill point sees the continuation once: the
    // ticks the resumed market regenerates between the checkpoint and the kill
    // are verified against the record and never delivered again.
    const delivered: Tick[] = [];
    second.feed.subscribe(
      ID,
      {
        deliver: (_id, ticks) => {
          delivered.push(...ticks);
          return true;
        },
        close: () => undefined,
      },
      killSequence + 1,
    );
    await run(second, clock2, 60);
    expect(second.stalledMarkets).toEqual([]);
    expect(delivered.length).toBeGreaterThan(50);
    expect(delivered[0]!.sequence).toBe(killSequence + 1);
    sequencesContiguous(delivered);
    sequencesContiguous(second.feed.since(ID, 1));
    // And the record still equals the feed: what was served is what is held.
    expect(await record.since(ID, 1, 1_000_000)).toEqual(second.feed.since(ID, 1));
    await first.stop();
    await second.stop();
  });

  it('the minute the kill fell in is stored whole, and the candles equal an unkilled run (INV-008)', async () => {
    const record = new MemoryTickRecord();
    const { first, clock, storeAtCheckpoint, historyAtCheckpoint } = await firstProcess(record);
    const secondHistory = historyAtCheckpoint;
    const clock2 = new SteppableClock(clock.now());
    const second = venue(storeAtCheckpoint, clock2, secondHistory, record);
    await second.start();
    await run(second, clock2, 60);
    await second.stop(); // the final checkpoint flushes every closed bar

    // The reference: the same market, never killed, over the same instants.
    const referenceClock = new SteppableClock(GENESIS);
    const referenceHistory = new InMemoryCandleHistory();
    const reference = venue(new MemoryStateStore(), referenceClock, referenceHistory, null);
    await reference.start();
    await run(reference, referenceClock, 123 + 60);
    await reference.stop();

    const stored = await bars(secondHistory);
    const expected = await bars(referenceHistory);
    expect(stored.length).toBeGreaterThanOrEqual(2);
    // Finding c, closed: every minute through the kill is stored, contiguous in
    // sequence, including the one that was open when the process died.
    const killMinute = Math.floor(clock.now() / MINUTE) * MINUTE;
    expect(stored.map((bar) => bar.openInstant)).toContain(killMinute);
    for (let i = 1; i < stored.length; i += 1) {
      expect(stored[i]!.firstSequence, `bar at ${String(stored[i]!.openInstant)}`).toBe(
        stored[i - 1]!.lastSequence + 1,
      );
    }
    expect(stored).toEqual(expected);
    await first.stop();
  });

  it('a recorded tick the market republishes differently is a fork: refused, unhosted, nothing served', async () => {
    const record = new MemoryTickRecord();
    const { first, clock, storeAtCheckpoint, historyAtCheckpoint, served } =
      await firstProcess(record);
    const checkpointSequence = (await storeAtCheckpoint.load(ID))!.lastPublished!.sequence;
    const head = served[served.length - 1]!.sequence;
    // Plant: a tick between the checkpoint and the kill, held at another price.
    record.corrupt(ID, checkpointSequence + 2, served[checkpointSequence + 1]!.price + 7);

    const clock2 = new SteppableClock(clock.now());
    const second = venue(storeAtCheckpoint, clock2, historyAtCheckpoint, record);
    await second.start();
    await run(second, clock2, 5);
    const stalled = second.stalledMarkets;
    expect(stalled.map((m) => m.assetId)).toEqual([ID]);
    expect(stalled[0]!.reason).toMatch(/refused by the record/);
    expect(stalled[0]!.reason).toMatch(/Fork in the record/);
    expect(second.assetIds, 'unhosted').toEqual([]);
    expect(second.feed.retained(ID)?.newest, 'nothing served past the record').toBe(head);
    expect(await record.head(ID), 'the record was not modified').toBe(head);
    await first.stop();
    await second.stop();
  });

  it('the commitment chain continues across the kill, one chain per market (PH-28.3)', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-publication-'));
    const env = { OTC_PUBLICATION_DIR: directory, OTC_PUBLISHING_KEY: '44'.repeat(32) };
    const publishing = (): PublicationService => new PublicationService([asset], 20, env);
    const record = new MemoryTickRecord();
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryStateStore();
    const history = new InMemoryCandleHistory();
    const first = venue(store, clock, history, record, publishing());
    await first.start();
    await run(first, clock, 115);
    await first.checkpoint();
    const storeAtCheckpoint = await copyStore(store);
    const historyAtCheckpoint = await copyHistory(history);
    await run(first, clock, 8);
    const file = path.join(directory, ID, 'commitments.ndjson');
    const beforeKill = await verifyCommitmentsFile(
      file,
      publicKeyHex(publishingKeyFromSeed(env.OTC_PUBLISHING_KEY)),
    );
    expect(beforeKill.ok).toBe(true);
    expect(beforeKill.count).toBeGreaterThan(3);

    const clock2 = new SteppableClock(clock.now());
    const second = venue(storeAtCheckpoint, clock2, historyAtCheckpoint, record, publishing());
    await second.start();
    await run(second, clock2, 60);
    const after = await verifyCommitmentsFile(
      file,
      publicKeyHex(publishingKeyFromSeed(env.OTC_PUBLISHING_KEY)),
    );
    expect(after.ok, JSON.stringify(after.error)).toBe(true);
    expect(after.count).toBeGreaterThan(beforeKill.count + 3);
    // One chain: every window follows the one before it in sequence, across
    // the kill, because the ticks the first process committed nothing for
    // were read back from the record.
    let expected = 1;
    for await (const { signed } of readCommitmentsStream(file)) {
      expect(signed.commitment.fromSequence).toBe(expected);
      expected = signed.commitment.toSequence + 1;
    }
    // `first` is a killed process, and it is stopped only here, after every
    // assertion: a stop now *seals* its open window (Cycle Audit 10, a6-03),
    // and appending it to a file the second process already owns would put a
    // window after windows that follow it. A real kill never reaches `stop`.
    await first.stop();
    await second.stop();
    await rm(directory, { recursive: true, force: true });
  });

  it('a chain the record cannot reach is restarted at an empty root, not bridged (PH-28.3)', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-publication-'));
    const env = { OTC_PUBLICATION_DIR: directory, OTC_PUBLISHING_KEY: '45'.repeat(32) };
    const record = new MemoryTickRecord();
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryStateStore();
    const first = venue(
      store,
      clock,
      new InMemoryCandleHistory(),
      record,
      new PublicationService([asset], 20, env),
    );
    await first.start();
    await run(first, clock, 60);
    await first.checkpoint();
    const storeAtCheckpoint = await copyStore(store);
    const resumedFrom = (await storeAtCheckpoint.load(ID))!.lastPublished!.sequence + 1;
    await run(first, clock, 5);
    await first.stop();
    // The record is gone — a fresh record.db beside a surviving chain file —
    // so the ticks the chain's tip needs cannot be read back.
    const lost = new MemoryTickRecord();
    const clock2 = new SteppableClock(clock.now());
    const publication = new PublicationService([asset], 20, env);
    const second = venue(storeAtCheckpoint, clock2, new InMemoryCandleHistory(), lost, publication);
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await second.start();
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /sealed there and resumed after the gap/,
    );
    errors.mockRestore();
    expect(second.stalledMarkets).toEqual([]);
    await run(second, clock2, 40);
    await second.stop();
    // Two chains in the file, and the break is visible: the second genesis
    // link carries an empty previousRoot. With the record lost, the resumed
    // market's republication of the ticks after its checkpoint could not be
    // deduplicated, so the second chain begins at the resume point and
    // overlaps the first — which is what happened, and what a verifier must
    // be able to see rather than a window that binds a tip it does not follow.
    //
    // **This is the case a resume link cannot state (Cycle Audit 10).** The
    // chain is told to resume after sequence N and the market hands it a tick
    // at or before N: one chain cannot hold two roots over one range, so the
    // publisher falls back to a restart at an empty root and the break is
    // reported **unbound** — which is exactly what an unbound break means.
    const links: {
      previousRoot: string;
      fromSequence: number;
      toSequence: number;
      root: string;
    }[] = [];
    const file = path.join(directory, ID, 'commitments.ndjson');
    for await (const { signed } of readCommitmentsStream(file)) links.push(signed.commitment);
    const genesis = links.map((l, i) => (l.previousRoot === '' ? i : -1)).filter((i) => i >= 0);
    expect(genesis).toHaveLength(2);
    const restart = genesis[1]!;
    // And the file verifies as two chains with the break named (PH-30.4);
    // until then the restart PH-28.3 promised was one the verifier refused.
    const verdict = await verifyCommitmentsFile(
      file,
      publicKeyHex(publishingKeyFromSeed(env.OTC_PUBLISHING_KEY)),
    );
    expect(verdict.ok, JSON.stringify(verdict.error)).toBe(true);
    expect(verdict.breaks).toEqual([
      {
        link: restart,
        afterSequence: links[restart - 1]!.toSequence,
        afterRoot: links[restart - 1]!.root,
        fromSequence: resumedFrom,
        bound: false,
      },
    ]);
    expect(links[restart]!.fromSequence).toBe(resumedFrom);
    expect(links[restart]!.fromSequence).toBeLessThanOrEqual(links[restart - 1]!.toSequence);
    await rm(directory, { recursive: true, force: true });
  });

  it('a backup taken while the venue ticks restores to a venue that resumes and honours a pre-backup resume (PH-28.3)', async () => {
    const live = await mkdtemp(path.join(tmpdir(), 'otc-live-'));
    const target = path.join(await mkdtemp(path.join(tmpdir(), 'otc-backup-')), 'copy');
    const fileVenue = (directory: string, clock: SteppableClock): VenueService =>
      venue(
        new FileStateStore(directory),
        clock,
        new SqliteCandleHistory(path.join(directory, HISTORY_DB)),
        new SqliteTickRecord(path.join(directory, RECORD_DB)),
      );
    const clock = new SteppableClock(GENESIS);
    const first = fileVenue(live, clock);
    await first.start();
    await run(first, clock, 130);
    // Between checkpoints, with the venue mid-run: the copy is per-file
    // consistent and verified on the way out.
    const { manifest, report } = await backupStateDirectory(live, target, clock.now());
    expect(report.problems).toEqual([]);
    const servedAtBackup = first.feed.since(ID, 1);
    expect(manifest.heads[ID]!.record).toBe(servedAtBackup[servedAtBackup.length - 1]!.sequence);
    await run(first, clock, 20);
    await first.stop();

    // Restore is a directory swap with the service stopped, and `main.ts` runs
    // this check before any market resumes — so the copy must pass it exactly
    // as the tool wrote it, manifest and all. Until Cycle Audit 10 (a7-01) it
    // did not: `backup.json` was read as a thirty-first asset and the boot was
    // refused with `record belongs to asset undefined`. This test restored by
    // constructing the venue directly, which is the reason nothing saw it.
    expect(stateRefusal(await verifyStateDirectory(target))).toBeNull();

    // Here the swap is pointing a venue at the copy, with the clock where the
    // backup was taken.
    const restoredClock = new SteppableClock(epochMillis(manifest.takenAt));
    const restored = fileVenue(target, restoredClock);
    await restored.start();
    expect(restored.recoveryFor(ID)?.kind).toBe('resumed');
    expect(restored.feed.since(ID, 1), 'the record the backup held is served').toEqual(
      servedAtBackup,
    );
    await run(restored, restoredClock, 10);
    sequencesContiguous(restored.feed.since(ID, 1));
    expect(restored.stalledMarkets).toEqual([]);
    await restored.stop();
    restored.onApplicationShutdown();
    first.onApplicationShutdown();
    await rm(live, { recursive: true, force: true });
    await rm(path.dirname(target), { recursive: true, force: true });
  });

  it('without a record the venue publishes as it always did', async () => {
    const clock = new SteppableClock(GENESIS);
    const service = venue(new MemoryStateStore(), clock, new InMemoryCandleHistory(), null);
    await service.start();
    await run(service, clock, 10);
    expect(service.feed.since(ID, 1).length).toBeGreaterThan(5);
    expect(service.stalledMarkets).toEqual([]);
    await service.stop();
  });
});

/**
 * PH-30.4. The release run restarted the venue 23 minutes after a clean stop,
 * every market seamed (the checkpoint was past the 15 s catch-up bound), and
 * the venue then published **nothing**: the feed had been primed with the
 * record's pre-seam tail and refused the first post-seam tick as a gap, on
 * every pass, for every asset — "tick failed" thirty times a pass while the
 * record filled. The next boot crashed at priming, because the chain writer
 * folded the record across the seam and the publisher refused the jump. A
 * restart longer than fifteen seconds is what every deploy is.
 */
describe('a restart past the catch-up bound seams the record (PH-30.4)', () => {
  it('the seamed venue publishes from the seam, the chain restarts there, and the next boot primes across the recorded seam', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-publication-'));
    const env = { OTC_PUBLICATION_DIR: directory, OTC_PUBLISHING_KEY: '46'.repeat(32) };
    // A window wide enough that the short seamed process closes none: the
    // third boot then finds the chain's tip before the seam and must fold the
    // record across it.
    const publishing = (): PublicationService => new PublicationService([asset], 100, env);
    const record = new MemoryTickRecord();
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryStateStore();
    const first = venue(store, clock, new InMemoryCandleHistory(), record, publishing());
    await first.start();
    await run(first, clock, 115);
    await first.checkpoint();
    await first.stop();
    const firstHead = (await record.head(ID))!;
    expect(firstHead).toBeGreaterThan(500);

    // Two minutes later: the checkpoint is stale, so the market seams.
    const clock2 = new SteppableClock(epochMillis(clock.now() + 120_000));
    const second = venue(store, clock2, new InMemoryCandleHistory(), record, publishing());
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await second.start();
    expect(second.recoveryFor(ID)?.kind).toBe('seam');
    await run(second, clock2, 2);
    const failed = errors.mock.calls.map((c) => String(c[0])).filter((m) => /tick failed/.test(m));
    expect(failed, failed[0]).toEqual([]);
    // The feed begins at the seam: what it retains is what this process
    // published, and a client resuming from before the seam is told so.
    const retained = second.feed.retained(ID);
    expect(retained).not.toBeNull();
    expect(retained!.oldest).toBeGreaterThan(firstHead);
    expect(retained!.newest).toBeGreaterThan(retained!.oldest);
    const seam = retained!.oldest;
    expect(() => second.feed.since(ID, firstHead)).toThrow(EvictedError);
    expect(second.stalledMarkets).toEqual([]);
    // The record keeps both sides of the seam.
    expect(await record.head(ID)).toBe(retained!.newest);
    expect((await record.since(ID, firstHead, 2)).map((t) => t.sequence)).toEqual([
      firstHead,
      seam,
    ]);
    await second.checkpoint();
    await second.stop();

    // A prompt restart resumes rather than seams, and primes the chain from
    // a tip that lies before the recorded seam.
    const clock3 = new SteppableClock(clock2.now());
    const third = venue(store, clock3, new InMemoryCandleHistory(), record, publishing());
    await third.start();
    expect(third.recoveryFor(ID)?.kind).toBe('resumed');
    await run(third, clock3, 30);
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => /tick failed/.test(m))).toEqual(
      [],
    );
    errors.mockRestore();
    expect(third.stalledMarkets).toEqual([]);
    sequencesContiguous(third.feed.since(ID, seam));
    await third.stop();

    // **One chain, and nothing served outside it (Cycle Audit 10, a6-03 and
    // a6-04).** PH-30.4 restarted the chain at an empty root here, and both
    // halves of that cost the record something permanent. The window open when
    // the first process stopped went with it — 5,749 served ticks across the
    // release run's thirty markets, in no committed window for ever, answering
    // 409 to any proof of them — and the second chain was bound to the first
    // by nothing, so a window deleted from the first chain's tail was
    // indistinguishable from the honest gap.
    const file = path.join(directory, ID, 'commitments.ndjson');
    const verified = await verifyCommitmentsFile(
      file,
      publicKeyHex(publishingKeyFromSeed(env.OTC_PUBLISHING_KEY)),
    );
    expect(verified.ok, JSON.stringify(verified.error)).toBe(true);
    const links: {
      previousRoot: string;
      fromSequence: number;
      toSequence: number;
      root: string;
      resumesAfter?: number;
    }[] = [];
    for await (const { signed } of readCommitmentsStream(file)) links.push(signed.commitment);
    const genesis = links.map((l, i) => (l.previousRoot === '' ? i : -1)).filter((i) => i >= 0);
    expect(genesis).toEqual([0]);
    const resume = links.findIndex((l) => l.resumesAfter !== undefined);
    expect(resume).toBeGreaterThan(0);
    expect(links[resume]!.fromSequence).toBe(seam);
    // The chain is sealed exactly at the record's head, so every tick the first
    // process served is inside a committed window — and the interval the second
    // process resumes after is the outage, not the outage plus a window.
    expect(links[resume]!.resumesAfter).toBe(firstHead);
    expect(links[resume - 1]!.toSequence).toBe(firstHead);
    expect(verified.breaks).toEqual([
      {
        link: resume,
        afterSequence: firstHead,
        afterRoot: links[resume - 1]!.root,
        fromSequence: seam,
        bound: true,
      },
    ]);
    // And the proof of the last tick before the seam is served, rather than
    // `409 not in any committed window`, for ever.
    expect((await proveFromPublication(directory, ID, firstHead)).kind).toBe('proved');
    for (let i = 1; i < links.length; i += 1) {
      if (i === resume) continue;
      expect(links[i]!.fromSequence).toBe(links[i - 1]!.toSequence + 1);
    }
    // The resumed market closed at least one window of its own.
    expect(links.length).toBeGreaterThan(resume);
    expect(links[links.length - 1]!.toSequence).toBeGreaterThanOrEqual(seam + 99);
    await rm(directory, { recursive: true, force: true });
  });
});

/**
 * Cycle Audit 10, a6-03: retirement is the other place the chain stops.
 *
 * Nothing will ever fill a retired market's open window, so leaving it open
 * puts the market's last ticks permanently outside the record's own evidence
 * — the same loss a deploy used to make, minus the deploy.
 */
describe('retiring a market seals its chain (Cycle Audit 10)', () => {
  it('commits the tail it served, so its last tick has a proof', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-retire-'));
    const env = { OTC_PUBLICATION_DIR: directory, OTC_PUBLISHING_KEY: '48'.repeat(32) };
    const record = new MemoryTickRecord();
    const clock = new SteppableClock(GENESIS);
    const service = venue(
      new MemoryStateStore(),
      clock,
      new InMemoryCandleHistory(),
      record,
      // A window wide enough that the run below closes none of its own.
      new PublicationService([asset], 100_000, env),
    );
    await service.start();
    await run(service, clock, 20);
    const head = (await record.head(ID))!;
    expect(head).toBeGreaterThan(50);
    await service.retire(ID);
    const file = path.join(directory, ID, 'commitments.ndjson');
    const verdict = await verifyCommitmentsFile(
      file,
      publicKeyHex(publishingKeyFromSeed(env.OTC_PUBLISHING_KEY)),
    );
    expect(verdict.ok, JSON.stringify(verdict.error)).toBe(true);
    expect(verdict.tip?.toSequence).toBe(head);
    expect((await proveFromPublication(directory, ID, head)).kind).toBe('proved');
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  });
});

/**
 * Cycle Audit 10, a2-04, a3-08 and a8-06.
 *
 * The chain is appended with `appendFileSync` and never fsynced, so ENOSPC or
 * a power loss can leave a partial last line. The refuter measured what that
 * did to this route on a live venue: proofs resolved *before* the torn line
 * still answered 200, and every proof at or beyond it answered
 * `500 {"statusCode":500,"message":"Internal server error"}` — a bare
 * `SyntaxError` out of `proveFromPublication`, naming nothing, for exactly the
 * recent sequences a broker settling asks about.
 */
describe('a chain file cut mid-append answers by name, not with a bare 500 (Cycle Audit 10)', () => {
  it('serves proofs before the damage and refuses past it, naming the line', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'otc-torn-'));
    const env = { OTC_PUBLICATION_DIR: directory, OTC_PUBLISHING_KEY: '47'.repeat(32) };
    const clock = new SteppableClock(GENESIS);
    const service = venue(
      new MemoryStateStore(),
      clock,
      new InMemoryCandleHistory(),
      new MemoryTickRecord(),
      new PublicationService([asset], 20, env),
    );
    await service.start();
    await run(service, clock, 30);
    const controller = new MarketController(service);
    const file = path.join(directory, ID, 'commitments.ndjson');
    const lines = (await readFile(file, 'utf8')).split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(3);
    await writeFile(file, `${lines.slice(0, 2).join('\n')}\n${lines[2]!.slice(0, 180)}`);
    // Window one is whole and still proves.
    expect(await controller.proofFor(ID, '5')).toMatchObject({ assetId: ID, sequence: 5 });
    // The third window is where the file stops being readable, and the refusal
    // says so rather than "Internal server error".
    await expect(controller.proofFor(ID, '45')).rejects.toThrow(
      /The commitment chain for .* cannot be read past line 3: the file is damaged/,
    );
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  });
});
