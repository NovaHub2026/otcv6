// Invariant evidence: INV-002 (shared market), INV-008 (continuous market state), INV-009 (reproducible settlement).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord, MIN_REOPEN_INTERVAL_MS } from '@otc/runtime';
import type { EngineAccess } from './engineAccess.js';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/**
 * A market that its catch-up bound refuses reopens itself (ADR-0020).
 *
 * The outage these tests reproduce is the one this machine keeps producing: a
 * host suspends, the process comes back hours behind the clock, and every
 * market refuses every advance for the life of the process. The refusal is
 * right — publishing the missing interval at once would invent a stretch of
 * market nobody observed, and at thirty seconds that stretch is a whole
 * contract (ADR-0010) — but its only exit was a person restarting the service.
 *
 * What a restart does is reopen the market at the clock from its last published
 * price, on a keystream nothing has been drawn from, past its lease, leaving
 * the gap recorded as a seam. These tests hold the automatic version to exactly
 * that, and to its bounds: nothing else reopens, and nothing reopens twice in a
 * row without publishing in between.
 */
const asset = ASSET_CATALOGUE[0]!;
const ID = asset.definition.id;
const GENESIS = epochMillis(1_776_000_000_000);
const OUTAGE_MS = 3 * 60 * 60 * 1_000;
const directories: string[] = [];

afterAll(async () => {
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

interface Venue {
  readonly service: VenueService;
  readonly controller: MarketController;
  readonly clock: SteppableClock;
  readonly record: MemoryTickRecord;
  readonly store: MemoryStateStore;
  readonly engine: EngineAccess;
}

async function venue(options: { autoReopen?: boolean; publishing?: boolean } = {}): Promise<Venue> {
  const clock = new SteppableClock(GENESIS);
  const record = new MemoryTickRecord();
  const store = new MemoryStateStore();
  const directory = options.publishing ? await mkdtemp(path.join(tmpdir(), 'otc-reopen-')) : null;
  if (directory !== null) directories.push(directory);
  let engine: EngineAccess | null = null;
  const service = new VenueService(
    store,
    MasterKeyring.fromSecret('venue-reopen-spec', new Uint8Array(32).fill(23)),
    clock,
    [asset],
    5_000,
    new PublicationService(
      [asset],
      20,
      directory === null
        ? {}
        : { OTC_PUBLICATION_DIR: directory, OTC_PUBLISHING_KEY: '23'.repeat(32) },
    ),
    null,
    GENESIS,
    0,
    null,
    null,
    null,
    record,
    undefined,
    (access) => {
      engine = access;
    },
    options.autoReopen ?? true,
  );
  await service.start();
  return {
    service,
    controller: new MarketController(service),
    clock,
    record,
    store,
    engine: engine!,
  };
}

/** Run the venue normally for `seconds`, one pass a second, as the scheduler does. */
async function run(v: Venue, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i += 1) {
    v.clock.advance(durationMillis(1_000));
    await v.service.tick();
  }
}

/** A venue that has served, then lost its host for three hours, then passed once. */
async function afterAnOutage(options: { autoReopen?: boolean } = {}): Promise<Venue> {
  const v = await venue(options);
  await run(v, 60);
  v.clock.advance(durationMillis(OUTAGE_MS));
  await v.service.tick();
  return v;
}

describe('a market past its catch-up bound reopens itself (ADR-0020)', () => {
  it('serves prices again, from where it stopped, without inventing the outage', async () => {
    const v = await afterAnOutage();
    const before = (await v.record.tail(ID, 1))[0]!;
    await run(v, 30);
    const after = (await v.record.tail(ID, 1))[0]!;

    expect(v.service.stalledMarkets, 'the market is still stalled').toEqual([]);
    expect(v.service.notReadyReason).toBeNull();
    expect(after.sequence, 'nothing was published after the reopening').toBeGreaterThan(
      before.sequence,
    );
    // The outage is not generated: the first tick after it lands at the clock,
    // three hours on, not at the instant the market stopped.
    expect(after.instant).toBeGreaterThan(GENESIS + OUTAGE_MS);
    await v.service.stop();
  });

  it('records the gap as a seam, and refuses a price inside it', async () => {
    const v = await afterAnOutage();
    await run(v, 30);
    const seams = (await v.controller.seams(ID)) as {
      lastSequence: number;
      lastInstant: number;
      resumesAtSequence: number;
      resumesAtInstant: number;
    }[];
    expect(seams, 'the reopening left no seam in the record').toHaveLength(1);
    const seam = seams[0]!;
    // Both sides are real published ticks, and the gap between them is the
    // outage: this is what a broker reads before settling anything near it.
    expect(seam.resumesAtInstant - seam.lastInstant).toBeGreaterThan(OUTAGE_MS);
    const inside = Math.floor((seam.lastInstant + seam.resumesAtInstant) / 2);
    await expect(v.controller.priceAt(ID, String(inside))).rejects.toBeInstanceOf(
      ConflictException,
    );
    // And the prices either side of it are answered, so a contract that does
    // not span the gap settles exactly as before.
    const last = (await v.controller.priceAt(ID, String(seam.lastInstant))) as {
      sequence: number;
    };
    expect(last.sequence).toBe(seam.lastSequence);
    await v.service.stop();
  });

  it('carries the price across, so no observer sees a jump it cannot explain', async () => {
    const v = await afterAnOutage();
    const held: Tick[] = [...(await v.record.since(ID, 1, 1_000_000))];
    const last = held[held.length - 1]!;
    await run(v, 30);
    const all = await v.record.since(ID, 1, 1_000_000);
    const first = all.find((tick) => tick.sequence > last.sequence)!;
    // The reopened market starts *at* the last published price. The first tick
    // it draws moves from there like any other tick, so the distance is a
    // step's distance rather than a jump to somewhere nobody published.
    const steps = Math.abs(first.price - last.price);
    const typical = Math.abs(last.price - held[held.length - 20]!.price);
    expect(steps).toBeLessThanOrEqual(Math.max(typical, 1) * 5);
    await v.service.stop();
  });

  it('counts itself where an operator reads it', async () => {
    const v = await afterAnOutage();
    await run(v, 5);
    const metrics = await v.controller.metrics();
    expect(metrics).toMatch(/otc_market_reopenings_total 1/);
    expect(metrics).toMatch(/otc_markets_stalled 0/);
    await v.service.stop();
  });

  it('is off when an operator switches it off', async () => {
    const v = await afterAnOutage({ autoReopen: false });
    await run(v, 5);
    expect(v.service.stalledMarkets.map((m) => m.assetId)).toEqual([ID]);
    const metrics = await v.controller.metrics();
    expect(metrics).toMatch(/otc_market_reopenings_total 0/);
    await v.service.stop();
  });

  it('seals the commitment chain at the gap instead of bridging it', async () => {
    // A chain that ran straight through would attest a range nobody published.
    // What `prime` does when it finds a seam in the record at boot has to
    // happen here too, while the process runs: the chain is sealed at the last
    // sequence before the gap and restarted after it by a link that binds the
    // sealed head, so a verifier sees the interval where it is.
    const v = await venue({ publishing: true });
    await run(v, 60);
    v.clock.advance(durationMillis(OUTAGE_MS));
    await v.service.tick();
    await run(v, 90);
    const seams = (await v.controller.seams(ID)) as { lastSequence: number }[];
    expect(seams).toHaveLength(1);
    const inside = seams[0]!.lastSequence + 1;
    await expect(v.controller.proofFor(ID, String(inside))).rejects.toThrow(
      /committed nothing in|not in any committed window/,
    );
    // And a sequence from before the gap is still proved: the sealed chain
    // stands, which is the whole point of sealing rather than discarding it.
    const proof = (await v.controller.proofFor(ID, String(seams[0]!.lastSequence - 5))) as {
      sequence: number;
    };
    expect(proof.sequence).toBe(seams[0]!.lastSequence - 5);
    await v.service.stop();
  });
});

describe('the bounds on an automatic reopening', () => {
  it('reopens for the catch-up bound and for nothing else', async () => {
    // The other failures a market can refuse an advance with mean this venue
    // and its record disagree about what was served. A seam there would paper
    // over a disagreement somebody has to look at, so only the catch-up bound
    // — which no later advance can clear — reopens anything (ADR-0020).
    const v = await venue();
    await run(v, 30);
    const market = v.engine.hostedMarket(ID)!;
    (market as unknown as { advanceTo: () => never }).advanceTo = (): never => {
      throw new RangeError('the record and this market disagree');
    };
    v.clock.advance(durationMillis(1_000));
    await v.service.tick();
    expect(v.service.stalledMarkets.map((m) => m.assetId)).toEqual([ID]);
    expect(v.service.stalledMarkets[0]!.reason).toMatch(/disagree/);
    const metrics = await v.controller.metrics();
    expect(metrics, 'a failure that is not the catch-up bound reopened a market').toMatch(
      /otc_market_reopenings_total 0/,
    );
    await v.service.stop();
  });

  it('does not reopen twice without publishing in between', async () => {
    const v = await afterAnOutage();
    // A second outage before the reopened market has published anything: a
    // process that starves on every pass must stall by name rather than write
    // a seam per pass, which would make the record unreadable while the venue
    // looked healthy.
    v.clock.advance(durationMillis(OUTAGE_MS));
    await v.service.tick();
    expect(v.service.stalledMarkets.map((m) => m.assetId)).toEqual([ID]);
    const metrics = await v.controller.metrics();
    expect(metrics).toMatch(/otc_market_reopenings_total 1/);
    await v.service.stop();
  });

  it('does not reopen again inside the minimum interval', async () => {
    const v = await afterAnOutage();
    // It published, so the first bound is satisfied. The second is the spacing:
    // a process losing the CPU for twenty seconds at a time, over and over, is
    // not a host that suspended — it is a process that cannot keep up, and the
    // honest report of that is a stall an operator sees.
    await run(v, 5);
    expect(v.service.stalledMarkets).toEqual([]);
    const sinceReopening = 5_000 + 20_000;
    expect(sinceReopening).toBeLessThan(MIN_REOPEN_INTERVAL_MS);
    v.clock.advance(durationMillis(20_000));
    await v.service.tick();
    expect(v.service.stalledMarkets.map((m) => m.assetId)).toEqual([ID]);
    const metrics = await v.controller.metrics();
    expect(metrics).toMatch(/otc_market_reopenings_total 1/);
    await v.service.stop();
  });

  it('reopens again once both bounds are satisfied', async () => {
    // A host that suspends twice still comes back by itself the second time:
    // the spacing is measured on the clock, and an outage long enough to need a
    // reopening has itself moved the clock well past the minimum.
    const v = await afterAnOutage();
    await run(v, Math.ceil(MIN_REOPEN_INTERVAL_MS / 1_000) + 5);
    v.clock.advance(durationMillis(OUTAGE_MS));
    await v.service.tick();
    // Stalled on the pass that took the seam, and it has to be: the market has
    // been armed again but has served nothing yet, and nothing may report a
    // market as running until it has (PH-39). It clears on the tick that lands.
    expect(v.service.stalledMarkets.map((m) => m.assetId)).toEqual([ID]);
    await run(v, 30);
    expect(v.service.stalledMarkets, 'the second outage did not come back').toEqual([]);
    const metrics = await v.controller.metrics();
    expect(metrics).toMatch(/otc_market_reopenings_total 2/);
    const seams = (await v.controller.seams(ID)) as unknown[];
    expect(seams, 'two outages, two seams').toHaveLength(2);
    await v.service.stop();
  });
});

/**
 * The reopening has to survive a starvation that outlives it (PH-39).
 *
 * Found on the live venue on 2026-09-25, not in a test. Thirty markets stalled
 * past their catch-up bound, reopened themselves as ADR-0020 says they should —
 * sixty reopenings, recorded — and stalled again twenty-two seconds later under
 * the same load. Twenty-three minutes on, with the machine idle, they were still
 * stalled and the record's head had not moved. The venue needed an operator.
 *
 * The cause was the first of ADR-0020's two bounds: a market is reopened, enters
 * `awaitingFirstTick`, and if the process is still starved on the next pass it
 * never publishes — so it stays in that set for ever and every later reopening
 * is refused, including the ones that would have succeeded once the load passed.
 * The guard outlived the condition it guards against.
 */
describe('a market that starved before its first tick', () => {
  it('comes back by itself once the starvation passes', async () => {
    const v = await afterAnOutage();
    // The second starvation arrives before the reopened market has published
    // anything, which is what a load spike does to a venue sharing its host.
    v.clock.advance(durationMillis(OUTAGE_MS));
    await v.service.tick();
    expect(
      v.service.stalledMarkets.map((m) => m.assetId),
      'a pass that served nothing must stall by name',
    ).toEqual([ID]);
    const before = (await v.record.tail(ID, 1))[0]!;

    // The load passes and the venue is healthy again: a pass a second, for half
    // a minute. Nobody restarts anything.
    await run(v, 30);

    expect(v.service.stalledMarkets, 'the market never came back on its own').toEqual([]);
    const after = (await v.record.tail(ID, 1))[0]!;
    expect(after.sequence, 'nothing was published after the starvation passed').toBeGreaterThan(
      before.sequence,
    );
    await v.service.stop();
  });

  it('records one seam for one outage, however many passes starved inside it', async () => {
    const v = await afterAnOutage();
    // Three more starved passes before the first tick. Nothing was served in any
    // of them, so there is one discontinuity, not four: a pass that published
    // nothing has nothing to be discontinuous with.
    for (let i = 0; i < 3; i += 1) {
      v.clock.advance(durationMillis(OUTAGE_MS));
      await v.service.tick();
    }
    await run(v, 30);

    expect(v.service.stalledMarkets).toEqual([]);
    const seams = (await v.controller.seams(ID)) as { lastSequence: number }[];
    expect(seams, 'a pass that served nothing recorded a discontinuity of its own').toHaveLength(1);
    // And one seam **ceremony**, which is the part the record cannot show: three
    // more of them would have evicted every subscriber three more times, sealed
    // the chain three more times and counted three more outages, all for one
    // outage that never ended.
    const metrics = await v.controller.metrics();
    expect(metrics, 'a starved pass counted itself as an outage of its own').toMatch(
      /otc_market_reopenings_total 1/,
    );
    expect(metrics, 'the re-armings are not where an operator reads them').toMatch(
      /otc_market_rearms_total 3/,
    );
    // And the record is readable across it: one gap, both of whose sides are
    // ticks somebody was served.
    const held = await v.record.since(ID, 1, 1_000_000);
    const jumps = held.filter(
      (tick, index) => index > 0 && tick.sequence !== held[index - 1]!.sequence + 1,
    );
    expect(jumps, 'more than one sequence jump reached the record').toHaveLength(1);
    await v.service.stop();
  });

  it('is not reported healthy while it is publishing nothing', async () => {
    // Cycle Audit 6's finding, from the other side: whatever the runtime does to
    // recover, a market that is not publishing must say so where an operator
    // reads it. A recovery that hides itself is worse than the stall.
    const v = await afterAnOutage();
    v.clock.advance(durationMillis(OUTAGE_MS));
    await v.service.tick();

    const metrics = await v.controller.metrics();
    expect(metrics, 'a starved market counted itself as running').toMatch(/otc_markets_stalled 1/);
    expect(metrics, 'a pass that served nothing counted itself as a reopening').toMatch(
      /otc_market_reopenings_total 1/,
    );
    const health = v.controller.health() as {
      status: string;
      stalled: { assetId: string }[];
    };
    expect(health.status).toBe('degraded');
    expect(health.stalled.map((s) => s.assetId)).toEqual([ID]);
    await v.service.stop();
  });
});

describe('a reopening whose reserved sequence moved', () => {
  it('takes a whole seam rather than a silent re-arming', async () => {
    // Awaiting its *first recorded* tick is not the same as having served
    // nothing. A market whose ticks the record refuses carries a later last
    // published tick, so the sequence it will resume at is no longer the one the
    // feed and the commitment chain were told about. Re-arming silently there
    // would leave both describing a window the market has left.
    const v = await afterAnOutage();
    const append = v.record.append.bind(v.record);
    let refusing = true;
    (v.record as unknown as { append: typeof append }).append = (batches) =>
      append(refusing ? batches.filter((batch) => batch.assetId !== ID) : batches);

    await run(v, 5);
    refusing = false;
    v.clock.advance(durationMillis(OUTAGE_MS));
    await v.service.tick();

    const metrics = await v.controller.metrics();
    expect(metrics, 'a moved window was re-armed silently').toMatch(
      /otc_market_reopenings_total 2/,
    );
    await run(v, 30);
    expect(v.service.stalledMarkets, 'and it still has to come back').toEqual([]);
    await v.service.stop();
  });
});

describe('what a reopening leaves for the next boot and for an operator', () => {
  it('does not refresh the checkpoint of a market that has published nothing', async () => {
    // Cycle Audit 10's rule, on the path it was never applied to. A checkpoint is
    // a claim that this market was here at this instant, and `checkpoint()`
    // skips a market only while it is stalled — so a reopening that cleared the
    // stall let a fresh `savedAt` be written for a market whose last published
    // tick was hours old, in the same pass, because a clock jump past the bound
    // is also a clock jump past the checkpoint cadence. The next boot then reads
    // that checkpoint as current and resumes instead of seaming.
    const v = await venue();
    await run(v, 60);
    const healthy = (await v.store.load(ID))!.savedAt;

    v.clock.advance(durationMillis(OUTAGE_MS));
    await v.service.tick();

    expect(
      (await v.store.load(ID))!.savedAt,
      'a market that has served nothing had its checkpoint refreshed',
    ).toBe(healthy);
    // And it is refreshed as soon as it publishes, so nothing is frozen for
    // longer than the outage itself.
    await run(v, 10);
    expect(v.service.stalledMarkets).toEqual([]);
    expect((await v.store.load(ID))!.savedAt).toBeGreaterThan(healthy);
    await v.service.stop();
  });

  it('says how long it is since a pass completed, which is what the bound measures', async () => {
    const v = await venue();
    await run(v, 5);
    const healthy = await v.controller.metrics();
    const seconds = /otc_seconds_since_last_pass ([0-9.]+)/.exec(healthy)?.[1];
    expect(seconds, 'the venue does not say how late its own loop is').toBeDefined();
    expect(Number(seconds)).toBeLessThan(2);

    // A host that stops giving this process the CPU is exactly a clock that has
    // moved without a pass, and this is the only number that says so before
    // every market is past its bound.
    v.clock.advance(durationMillis(14_000));
    const late = await v.controller.metrics();
    expect(Number(/otc_seconds_since_last_pass ([0-9.]+)/.exec(late)?.[1])).toBeGreaterThan(13);
    expect(late, 'nothing has stalled yet, and that is the point').toMatch(/otc_markets_stalled 0/);
    await v.service.stop();
  });

  it('names the re-arming in the reason an operator reads', async () => {
    const v = await afterAnOutage();
    for (let i = 0; i < 2; i += 1) {
      v.clock.advance(durationMillis(OUTAGE_MS));
      await v.service.tick();
    }
    const [stalled] = v.service.stalledMarkets;
    expect(stalled?.assetId).toBe(ID);
    expect(stalled?.reason, 'the reason says only how far behind it is').toMatch(/re-armed 2x/);
    const metrics = await v.controller.metrics();
    expect(metrics).toMatch(/otc_market_rearms_total 2/);
    await v.service.stop();
  });
});
