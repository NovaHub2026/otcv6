// Invariant evidence: INV-002 (shared market), INV-008 (continuous market state), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
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
  InMemoryCandleHistory,
  MemoryStateStore,
  MemoryTickRecord,
  type CandleHistory,
  type StateStore,
  type TickRecord,
} from '@otc/runtime';
import { HistoryService } from './history.service.js';
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
): VenueService {
  return new VenueService(
    store,
    keyring(),
    clock,
    [asset],
    5_000,
    new PublicationService([asset], 500, {}),
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
