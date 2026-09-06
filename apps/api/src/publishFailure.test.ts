import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import {
  DEFAULT_LOCK_RENEWAL_MS,
  MemoryStateStore,
  MemoryTickRecord,
  type MarketStateRecord,
  type StateStore,
} from '@otc/runtime';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/**
 * A pass that fails must be visible, and must not be silently permanent
 * (a3-06, a6-05).
 *
 * `tick()` recorded the pass first and then published it, and the publish loop
 * had no per-asset isolation: one throw abandoned every asset after it, and
 * `schedule()` caught the rejection, wrote `tick failed: ...` and dropped it.
 * The record already held those ticks, so `append` — a comparing append —
 * never returned them as fresh again, and the feed, the commitment chain and
 * the candle history never saw them. Measured on the release build: 900+ ticks
 * recorded, **zero bytes served in eight seconds**, 6,795 failed passes, and
 * `/health` answering `{"status":"ok","stalled":[]}` with `otc_markets_stalled`
 * 0 throughout, on a venue that never recovered on its own.
 */

const GENESIS = epochMillis(1_776_000_000_000);
const first = ASSET_CATALOGUE[0]!;
const second = ASSET_CATALOGUE[1]!;

/** A store that can be made to refuse, so a pass can be made to throw whole. */
class ArmableStore implements StateStore {
  readonly #inner = new MemoryStateStore();
  #refusal: string | null = null;

  refuseWith(message: string | null): void {
    this.#refusal = message;
  }

  load(assetId: string): Promise<MarketStateRecord | null> {
    return this.#inner.load(assetId);
  }

  save(record: MarketStateRecord): Promise<void> {
    if (this.#refusal !== null) return Promise.reject(new Error(this.#refusal));
    return this.#inner.save(record);
  }

  list(): Promise<readonly string[]> {
    return this.#inner.list();
  }
}

function build(options: { assets?: readonly (typeof first)[]; checkpointEveryMs?: number } = {}): {
  service: VenueService;
  clock: SteppableClock;
  controller: MarketController;
  store: ArmableStore;
} {
  const clock = new SteppableClock(GENESIS);
  const store = new ArmableStore();
  const assets = [...(options.assets ?? [first])];
  const service = new VenueService(
    store,
    MasterKeyring.fromSecret('publish-failure-spec', new Uint8Array(32).fill(11)),
    clock,
    assets,
    options.checkpointEveryMs ?? 5_000,
    new PublicationService(assets, 500, {}),
    null,
    GENESIS,
    0,
    null,
    null,
    null,
    new MemoryTickRecord(),
  );
  return { service, clock, controller: new MarketController(service), store };
}

/** Read one Prometheus sample out of the metrics text. */
async function sample(controller: MarketController, name: string): Promise<number | undefined> {
  const text = await controller.metrics();
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;
    const match = /^([a-z_]+) (-?\d+(?:\.\d+)?)$/.exec(line);
    if (match !== null && match[1] === name) return Number(match[2]);
  }
  return undefined;
}

/**
 * Put the feed's window out of step with the record.
 *
 * That disagreement is what two writers on one state directory produce: one
 * process's appends land in the shared record, the other's `append` returns
 * them as already-recorded, and its feed is then asked for a sequence it
 * cannot follow. Reached here by moving the feed rather than the record —
 * fabricating ticks into a shared record would be refused as a fork, which is
 * a different path with its own guard — and the refusal is the same one, from
 * the same line of `TickFeed.publish`, in the same words the auditors read out
 * of the release build's log:
 *
 *   `Feed for eurjpy-otc received sequence 811 after 94: a gap or reordering
 *   here would reach every observer.`
 */
function desyncFeed(service: VenueService, assetId: string): void {
  const served = service.feed.since(assetId, 1);
  const last = served[served.length - 1]!;
  // Contiguous, because the feed refuses a gap from anyone — including a test.
  const run: Tick[] = [];
  for (let i = 1; i <= 500; i += 1) run.push({ ...last, sequence: last.sequence + i });
  service.feed.publish(assetId, run);
}

describe('a market whose publish path refuses is unserving, and says so (a3-06)', () => {
  it('names the asset in /health, refuses readiness, and counts it in otc_markets_stalled', async () => {
    const { service, clock, controller } = build();
    await service.start();
    clock.advance(durationMillis(2_000));
    await service.tick();
    expect(service.feed.since(first.definition.id, 1).length).toBeGreaterThan(0);
    expect(controller.health()).toMatchObject({ status: 'ok', stalled: [] });

    desyncFeed(service, first.definition.id);
    clock.advance(durationMillis(2_000));
    // The pass itself completes: the refusal belongs to one market, not to the
    // process. Before the fix this rejected, and nothing below was true.
    await service.tick();

    expect(service.stalledMarkets.map((m) => m.assetId)).toEqual([first.definition.id]);
    expect(service.stalledMarkets[0]!.reason).toMatch(/refused by the publish path/);
    expect(controller.health()).toMatchObject({ status: 'degraded', ready: false });
    expect(service.isReady, 'a venue serving nothing called itself ready').toBe(false);
    expect(service.notReadyReason).toContain(first.definition.id);
    expect(await sample(controller, 'otc_markets_stalled')).toBe(1);
    await service.stop();
  });

  it('counts no tick it did not publish', async () => {
    const { service, clock, controller } = build();
    await service.start();
    clock.advance(durationMillis(2_000));
    await service.tick();

    desyncFeed(service, first.definition.id);
    const before = (await sample(controller, 'otc_ticks_published_total'))!;
    clock.advance(durationMillis(2_000));
    await service.tick();

    // `ticksPublished += ticks.length` ran on the line *before* `feed.publish`,
    // so the counter an operator watches climbed on every tick no observer
    // received — 9,144 against a feed frozen at sequence 94, measured.
    expect(
      await sample(controller, 'otc_ticks_published_total'),
      'the counter counted ticks the feed refused',
    ).toBe(before);
    await service.stop();
  });

  it('does not take the rest of the pass down with it', async () => {
    const { service, clock } = build({ assets: [first, second] });
    await service.start();
    clock.advance(durationMillis(4_000));
    await service.tick();

    desyncFeed(service, first.definition.id);
    const survivor = second.definition.id;
    const before = service.feed.since(survivor, 1).length;
    clock.advance(durationMillis(4_000));
    await service.tick();

    // The loop had no isolation, unlike `advanceDetailed` directly above it:
    // every asset after the throwing one lost its batch to the record with
    // nothing else ever seeing it.
    expect(
      service.feed.since(survivor, 1).length,
      'a second market lost its batch to the first one throwing',
    ).toBeGreaterThan(before);
    expect(service.stalledMarkets.map((m) => m.assetId)).toEqual([first.definition.id]);
    await service.stop();
  });
});

describe('a pass that throws whole reaches the operator surface (a3-06)', () => {
  it('is degraded on the first, unready on the third, and counted on every one', async () => {
    const { service, clock, controller, store } = build({ checkpointEveryMs: 1_000 });
    await service.start();
    store.refuseWith('ENOSPC: no space left on device');

    for (let i = 1; i <= 3; i += 1) {
      clock.advance(durationMillis(2_000));
      await expect(service.tick()).rejects.toThrow(/ENOSPC/);
      expect(controller.health(), 'a venue whose passes all threw still answered ok').toMatchObject(
        { status: 'degraded' },
      );
      expect(await sample(controller, 'otc_tick_pass_failures_total')).toBe(i);
      // One failure is a transient; three in a row is a process that is not
      // completing a pass at all.
      expect(service.isReady).toBe(i < 3);
    }
    expect(service.notReadyReason).toMatch(/3 consecutive publish passes have failed/);
    expect(service.notReadyReason).toContain('ENOSPC');
    expect(await sample(controller, 'otc_ready')).toBe(0);

    // And it clears: a monitor permanently red about a fixed fault is a monitor
    // an operator learns to ignore (CA7-15).
    store.refuseWith(null);
    clock.advance(durationMillis(2_000));
    await service.tick();
    expect(controller.health()).toMatchObject({ status: 'ok', ready: true });
    expect(await sample(controller, 'otc_tick_pass_failures_total')).toBe(3);
    await service.stop();
  });
});

describe('a venue that loses the state directory stops publishing (a6-05)', () => {
  it('goes degraded and unready, and publishes nothing more', async () => {
    const { service, clock, controller } = build({ checkpointEveryMs: 1_000 });
    let renewals = 0;
    service.holdWriterLock({
      holder: 'test-host/4242',
      renew: () => {
        renewals += 1;
        return Promise.resolve(false);
      },
    });
    await service.start();
    clock.advance(durationMillis(2_000));
    await service.tick();

    expect(renewals, 'the venue never renewed the state directory’s lock').toBe(1);
    expect(service.lostWriterLock, 'a refused renewal left no trace on the venue').toMatch(
      /writer lock was lost by test-host\/4242/,
    );
    expect(
      controller.health(),
      'a process whose directory belongs to somebody else answered ok and ready',
    ).toMatchObject({ status: 'degraded', ready: false });
    expect(service.notReadyReason).toMatch(/writer lock was lost/);
    expect(await sample(controller, 'otc_ready')).toBe(0);

    // Both processes reported `ok` and a climbing counter while neither served
    // anything. A superseded process publishes nothing at all.
    const served = service.feed.since(first.definition.id, 1).length;
    const counted = (await sample(controller, 'otc_ticks_published_total'))!;
    clock.advance(durationMillis(4_000));
    await service.tick();
    expect(
      service.feed.since(first.definition.id, 1).length,
      'a process that no longer holds the state directory went on publishing',
    ).toBe(served);
    expect(
      await sample(controller, 'otc_ticks_published_total'),
      'a superseded process went on counting ticks',
    ).toBe(counted);
    await service.stop();
  });
});

/**
 * The two entry points are the only places a lock can be taken, and neither is
 * imported by a test — `main.ts` calls `process.exit`, and composing it would
 * bind a port. So the wiring is asserted as source, the way `bind.test.ts` and
 * `composition.test.ts` assert theirs.
 */
const source = (file: string): string =>
  readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');

describe('every entry point takes the state directory before it starts (a3-07)', () => {
  it.each(['main.ts', 'lab/lab.main.ts'])('%s acquires the lock, then starts', (file) => {
    const text = source(file);
    const acquire = text.indexOf('StateDirectoryLock.acquire');
    const hold = text.indexOf('holdWriterLock');
    const start = text.indexOf('venue.start()');
    expect(acquire, `${file} never acquires the state directory's lock`).toBeGreaterThan(-1);
    expect(hold, `${file} never hands the lock to the venue`).toBeGreaterThan(-1);
    expect(acquire, `${file} starts publishing before it takes the directory`).toBeLessThan(start);
    expect(hold, `${file} starts publishing before the venue can renew`).toBeLessThan(start);
    // A refused start is a refused start: a warning would leave the second
    // writer running, which is the whole failure.
    expect(text, `${file} does not refuse a locked directory`).toMatch(
      /DirectoryLockedError[\s\S]{0,200}process\.exit\(1\)/,
    );
  });

  it('renews often enough that a live holder is never mistaken for an abandoned one', () => {
    // The venue renews on its checkpoint cadence; the lock expires after a
    // term. If the cadence ever grew past the renewal budget, a healthy process
    // would let its own lock go stale and a second one would adopt it.
    const cadence = /checkpointEveryMs = ([\d_]+)/.exec(source('venue.service.ts'))?.[1];
    expect(cadence, 'the checkpoint cadence is no longer a literal default').toBeDefined();
    expect(Number(cadence!.replaceAll('_', ''))).toBeLessThanOrEqual(DEFAULT_LOCK_RENEWAL_MS);
  });
});
