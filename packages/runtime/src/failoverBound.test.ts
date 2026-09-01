// Invariant evidence: INV-008 (continuous market state), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { DEFAULT_CHECKPOINT_INTERVAL_MS, LeaderSession } from './failover.js';
import { DEFAULT_MAX_CATCH_UP_MS } from './hosted.js';
import { DEFAULT_LEASE_TERM_MS, MemoryCoordinatedStore } from './lease.js';

/**
 * **Cycle Audit 5, finding 1.** A routine failover killed the asset for good.
 *
 * `resumeMarket` measures how far behind it is from the *checkpoint's* instant,
 * so a successor inherits the full staleness of the record it resumed from. At
 * the shipped defaults that staleness could exceed the catch-up bound before the
 * successor published anything — and then nothing ever moved `lastPublished`
 * forward, so every subsequent advance threw and the gap grew without bound. No
 * seam, no lost lease, no error an operator would see: `apps/api` discarded the
 * failure list entirely.
 *
 * Every PH-14 test that exercised a failover set `maxCatchUpMs` to a day, so
 * ADR-0010's bound — the phase's only defence against publishing an unobserved
 * interval — was switched off in every verification of the phase that creates
 * unobserved intervals.
 *
 * These tests run at the **production defaults**. That is the whole point.
 */

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('failover-bound-spec');
const asset = ASSET_CATALOGUE[0]!;
const ASSET = asset.definition.id;

function base(store: MemoryCoordinatedStore, clock: SteppableClock, holder: string) {
  return {
    asset,
    keyring,
    environment: 'test' as const,
    clock,
    store,
    holder,
    genesisInstant: GENESIS,
    // No `maxCatchUpMs`: the default is the subject.
  };
}

describe('the checkpoint cadence is inside the catch-up bound', () => {
  it('checkpoints more often than a market may fall behind', () => {
    // A cadence longer than the bound guarantees that some failover resumes
    // from a checkpoint already too stale to catch up from.
    expect(DEFAULT_CHECKPOINT_INTERVAL_MS).toBeLessThan(DEFAULT_MAX_CATCH_UP_MS);
  });
});

describe('a failover past the catch-up bound seams instead of wedging', () => {
  it('publishes after a takeover that waits out the lease term', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);

    const first = await LeaderSession.takeOver(base(store, clock, 'api-1#aa'));
    if (first.kind !== 'led') throw new Error('expected to lead');
    for (let step = 0; step < 8; step += 1) {
      clock.advance(durationMillis(5_000));
      await first.session.advance(clock.now());
    }
    const headBefore = await store.recordHead(ASSET);
    expect(headBefore).not.toBeNull();

    // The node dies. Its lease expires; a successor takes over one term later,
    // which is longer than the catch-up bound by construction.
    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS + 5_000));
    const second = await LeaderSession.takeOver(base(store, clock, 'api-2#bb'));
    if (second.kind !== 'led') throw new Error('expected the successor to lead');

    let published = 0;
    for (let step = 0; step < 20; step += 1) {
      clock.advance(durationMillis(5_000));
      published += (await second.session.advance(clock.now())).ticks.length;
    }

    // The asset must still be producing a market.
    expect(published).toBeGreaterThan(0);
    expect(await store.recordHead(ASSET)).toBeGreaterThan(headBefore!);
  });

  it('records the discontinuity rather than hiding it', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);

    const first = await LeaderSession.takeOver(base(store, clock, 'api-1#aa'));
    if (first.kind !== 'led') throw new Error('expected to lead');
    for (let step = 0; step < 8; step += 1) {
      clock.advance(durationMillis(5_000));
      await first.session.advance(clock.now());
    }

    clock.advance(durationMillis(DEFAULT_LEASE_TERM_MS + 60_000));
    const second = await LeaderSession.takeOver(base(store, clock, 'api-2#bb'));
    if (second.kind !== 'led') throw new Error('expected the successor to lead');

    // ADR-0010's rule, applied where it was missing: an interval nobody
    // observed is refused, and the record shows the gap.
    expect(second.session.recovery.kind).toBe('seam');
    for (let step = 0; step < 5; step += 1) {
      clock.advance(durationMillis(5_000));
      await second.session.advance(clock.now());
    }
    expect(await store.seams(ASSET)).toHaveLength(1);
  });

  it('a graceful handover inside the bound still resumes, without a seam', async () => {
    const clock = new SteppableClock(GENESIS);
    const store = new MemoryCoordinatedStore(clock);

    const first = await LeaderSession.takeOver(base(store, clock, 'api-1#aa'));
    if (first.kind !== 'led') throw new Error('expected to lead');
    for (let step = 0; step < 8; step += 1) {
      clock.advance(durationMillis(5_000));
      await first.session.advance(clock.now());
    }
    await first.session.release();

    const second = await LeaderSession.takeOver(base(store, clock, 'api-2#bb'));
    if (second.kind !== 'led') throw new Error('expected the successor to lead');
    expect(second.session.recovery.kind).toBe('resumed');

    let published = 0;
    for (let step = 0; step < 10; step += 1) {
      clock.advance(durationMillis(5_000));
      published += (await second.session.advance(clock.now())).ticks.length;
    }
    expect(published).toBeGreaterThan(0);
    expect(await store.seams(ASSET)).toEqual([]);
  });
});
