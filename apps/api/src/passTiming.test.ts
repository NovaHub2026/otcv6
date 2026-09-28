// Invariant evidence: INV-008 (continuous market state).
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord, type MarketStateRecord } from '@otc/runtime';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { SLOW_PASS_MS, VenueService } from './venue.service.js';

/**
 * PH-40.5 — where a pass spends its time.
 *
 * After some boots on the development machine a pass took ten to sixteen
 * seconds, past the catch-up bound once, with the cause not established. The
 * next occurrence has to name its phase; this is the test that it does.
 */
const assets = ASSET_CATALOGUE.slice(0, 3);
const GENESIS = epochMillis(1_776_000_000_000);

/** A store whose every save costs the clock `costMs` once `slow` is set. */
class SlowSaves extends MemoryStateStore {
  slow = false;
  constructor(
    private readonly clock: SteppableClock,
    private readonly costMs: number,
  ) {
    super();
  }

  override save(record: MarketStateRecord): Promise<void> {
    if (this.slow) this.clock.advance(durationMillis(this.costMs));
    return super.save(record);
  }
}

async function venue(store: MemoryStateStore, clock: SteppableClock): Promise<VenueService> {
  const service = new VenueService(
    store,
    MasterKeyring.fromSecret('pass-timing-spec', new Uint8Array(32).fill(61)),
    clock,
    [...assets],
    5_000,
    new PublicationService([...assets], 20, {}),
    null,
    GENESIS,
    0,
    null,
    null,
    null,
    new MemoryTickRecord(),
  );
  await service.start();
  return service;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a pass says where it spent its time (PH-40.5)', () => {
  it('keeps the slowest of each phase, and counts nothing slow on a quiet venue', async () => {
    const clock = new SteppableClock(GENESIS);
    const v = await venue(new SlowSaves(clock, 0), clock);
    for (let i = 0; i < 20; i += 1) {
      clock.advance(durationMillis(1_000));
      await v.tick();
    }
    expect(v.counters.slowPasses).toBe(0);
    expect(Object.keys(v.counters.passPhaseMaxMs)).toEqual([
      'advance',
      'record',
      'publish',
      'checkpoint',
    ]);
    await v.stop();
  });

  it('names a slow checkpoint as the phase, in the metrics and once in the log', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const clock = new SteppableClock(GENESIS);
    const store = new SlowSaves(clock, 2_000);
    const v = await venue(store, clock);
    for (let i = 0; i < 6; i += 1) {
      clock.advance(durationMillis(1_000));
      await v.tick();
    }
    // Three markets, two seconds a save: the next checkpoint is a six-second phase.
    store.slow = true;
    for (let i = 0; i < 6; i += 1) {
      clock.advance(durationMillis(1_000));
      await v.tick();
    }
    store.slow = false;
    expect(v.counters.passPhaseMaxMs.checkpoint).toBeGreaterThanOrEqual(6_000);
    expect(v.counters.passPhaseMaxMs.checkpoint).toBeGreaterThanOrEqual(SLOW_PASS_MS);
    expect(v.counters.passPhaseMaxMs.advance).toBeLessThan(1_000);
    expect(v.counters.slowPasses).toBeGreaterThanOrEqual(1);
    const metrics = await new MarketController(v).metrics();
    expect(metrics).toMatch(/otc_pass_checkpoint_max_seconds [6-9]\.\d{3}/);
    expect(metrics).toMatch(/otc_slow_passes_total [1-9]/);
    const slow = warn.mock.calls.filter(([message]) => String(message).startsWith('SLOW PASS'));
    expect(slow).toHaveLength(1);
    expect(String(slow[0]![0])).toMatch(/checkpoint [6-9]\.\ds/);
    // And which part of the checkpoint: here the saves, not the trim or the history.
    expect(String(slow[0]![0])).toMatch(
      /\(checkpoint: save [6-9]\.\ds, trim 0\.\ds, history 0\.\ds\)/,
    );
    await v.stop();
  });
});
