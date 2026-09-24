// Invariant evidence: INV-009 (reproducible settlement), INV-003 (single underlying stream).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from './fileStore.js';
import { checkpointMarket, resumeMarket } from './resume.js';

/**
 * A market checkpointed before its first tick resumes as the same market.
 *
 * **PH-37.1 broke this and the record caught it.** The arrival model's running
 * average of magnitude is seeded by the *first* magnitude rather than by an
 * absolute constant, so whether it has observed one is part of its state — and
 * it was not in the snapshot. A market whose checkpoint predates its first tick
 * came back believing it had observed, blended where the original replaced, and
 * published the same price four milliseconds late. `VenueService` refused it as
 * a fork in the record, which is what two streams claiming one asset is.
 *
 * The window is small and every new asset passes through it: a registration
 * checkpoints when it is hosted, and the first tick follows.
 */
const keyring = MasterKeyring.forTesting('replay-before-first-tick');
const asset = ASSET_CATALOGUE[0]!;
const GENESIS = epochMillis(1_776_000_000_000);

function options(store: MemoryStateStore, clock: SteppableClock) {
  return {
    asset,
    keyring,
    environment: 'test' as const,
    clock,
    store,
    genesisInstant: GENESIS,
  };
}

/** Advance in steps inside the catch-up bound until `count` ticks have landed. */
function pump(
  market: { advance: () => readonly Tick[] },
  clock: SteppableClock,
  count: number,
): Tick[] {
  const ticks: Tick[] = [];
  while (ticks.length < count) {
    clock.advance(durationMillis(5_000));
    ticks.push(...market.advance());
  }
  return ticks;
}

describe('a checkpoint taken before the first tick', () => {
  it('replays the same ticks, to the millisecond', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(options(store, clock));
    // Checkpointed with nothing published, which is where every registration
    // leaves a market.
    expect(first.market.lastPublishedState).toBeNull();
    await store.save(checkpointMarket(first.market, asset.definition.id, epochMillis(clock.now())));
    const original = pump(first.market, clock, 12);

    const replayClock = new SteppableClock(GENESIS);
    const resumed = await resumeMarket(options(store, replayClock));
    expect(resumed.outcome.kind).toBe('resumed');
    const replayed = pump(resumed.market, replayClock, 12);

    expect(replayed.map((t) => [t.sequence, t.instant, t.price])).toEqual(
      original.map((t) => [t.sequence, t.instant, t.price]),
    );
  });
});
