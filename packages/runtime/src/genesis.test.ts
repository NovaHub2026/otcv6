// Invariant evidence: INV-006 (no deterministic exploitable directional rules), INV-009 (reproducible settlement), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  logPrice,
  MasterKeyring,
  SteppableClock,
  type Tick,
} from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { backfillMarket } from './backfill.js';
import { MemoryStateStore } from './fileStore.js';
import { START_EPOCH_SPAN, startKeyEpoch } from './genesis.js';
import type { HostedMarket } from './hosted.js';
import { InMemoryCandleHistory } from './history.js';
import { checkpointMarket, resumeMarket } from './resume.js';

/**
 * A market that starts again must not start the same market again.
 *
 * Found in a broker's deployment of `v2.0.0` on 2026-09-22: every one of the
 * thirty assets, on a five-minute chart, drew the same figure over and over —
 * a jump to one level, the same climb, the same spike to the same high, the
 * same fall. The engine is a martingale and each piece of that chart was a
 * fair walk; what repeated was the walk itself. Every fresh genesis derived
 * its streams at key epoch 0 and started at lattice 0, so under one secret a
 * market started from an empty state directory was **the same market, tick for
 * tick and interval for interval**, shifted only in time. Measured on the
 * shipped build: two production processes started twenty seconds apart agreed
 * on the first thirty ticks of EUR/USD, BTC and NVDA exactly.
 *
 * That is a directional leak of the most complete kind (INV-006): anyone who
 * recorded one run holds the next. It needs no restart the operator notices —
 * a container restarted by its policy, a state directory on no volume, or two
 * replicas behind one balancer is enough — and the conventional battery cannot
 * see it, because within one run nothing is wrong.
 *
 * These tests compare the **directions** of two markets tick for tick. Two
 * independent fair walks agree on about half; a replay agrees on all of them.
 */
const keyring = MasterKeyring.forTesting('genesis-spec');
/** The slowest tape in the catalogue, derived rather than named: a cheap backfill. */
const asset = [...ASSET_CATALOGUE].sort(
  (a, b) => b.evidence.meanIntervalMs - a.evidence.meanIntervalMs,
)[0]!;
const GENESIS = epochMillis(1_776_000_000_000);
/** The broker's own gap: two starts twenty seconds apart. */
const LATER = epochMillis(GENESIS + 20_000);
const TICKS = 400;
const CATCH_UP_MS = 86_400_000;

/** Signed steps of the first `count` ticks published after `start`, one per tick. */
function stepsOf(market: HostedMarket, clock: SteppableClock, count: number): number[] {
  const ticks: Tick[] = [];
  let previous = market.lastPublishedState?.price ?? null;
  while (ticks.length < count) {
    clock.advance(durationMillis(60_000));
    ticks.push(...market.advance());
  }
  const steps: number[] = [];
  for (const tick of ticks.slice(0, count)) {
    if (previous !== null) steps.push(tick.price - previous);
    previous = tick.price;
  }
  return steps;
}

/** Of the ticks where both markets moved, the share that moved the same way. */
function directionAgreement(a: readonly number[], b: readonly number[]): number {
  let both = 0;
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] === 0 || b[i] === 0) continue;
    both += 1;
    if (Math.sign(a[i]!) === Math.sign(b[i]!)) same += 1;
  }
  expect(both, 'enough moving ticks to say anything').toBeGreaterThan(TICKS / 2);
  return same / both;
}

/**
 * Four standard errors above a half at this sample size, and a replay reads 1.
 * The streams are seeded, so the reading is a fixed number, not a flake.
 */
const INDEPENDENT = 0.6;

function options(store: MemoryStateStore, clock: SteppableClock, genesisInstant = clock.now()) {
  return {
    asset,
    keyring,
    environment: 'test' as const,
    clock,
    store,
    genesisInstant,
    maxCatchUpMs: CATCH_UP_MS,
  };
}

describe('a market started at another instant is another market', () => {
  it('two fresh starts of one asset under one secret do not replay each other', async () => {
    const firstClock = new SteppableClock(GENESIS);
    const first = await resumeMarket(options(new MemoryStateStore(), firstClock));
    const secondClock = new SteppableClock(LATER);
    const second = await resumeMarket(options(new MemoryStateStore(), secondClock));
    expect(first.outcome.kind).toBe('fresh');
    expect(second.outcome.kind).toBe('fresh');
    expect(second.market.keyEpoch).not.toBe(first.market.keyEpoch);

    const agreement = directionAgreement(
      stepsOf(first.market, firstClock, TICKS),
      stepsOf(second.market, secondClock, TICKS),
    );
    expect(agreement).toBeLessThan(INDEPENDENT);
  });

  it('two backfills of one asset under one secret do not replay each other', async () => {
    // A backfill is a genesis too, and the worse one: its past is generated in
    // one go, so every boot on an empty directory rewrote the same days and
    // then joined the live market at the same point of the same walk — the
    // same level, every time.
    const span = 3_600_000;
    const run = async (genesis: number) => {
      const result = await backfillMarket({
        asset,
        keyring,
        environment: 'test',
        genesisInstant: epochMillis(genesis),
        targetInstant: epochMillis(genesis + span),
        store: new MemoryStateStore(),
        history: new InMemoryCandleHistory(),
      });
      return result;
    };
    const first = await run(GENESIS);
    const second = await run(LATER);
    expect(second.market.keyEpoch).not.toBe(first.market.keyEpoch);
    const steps = (ticks: readonly Tick[]) =>
      ticks.slice(1).map((t, i) => t.price - ticks[i]!.price);
    const agreement = directionAgreement(
      steps(first.retainedTicks.slice(0, TICKS + 1)),
      steps(second.retainedTicks.slice(0, TICKS + 1)),
    );
    expect(agreement).toBeLessThan(INDEPENDENT);
  });

  it('two seams taken from the same checkpoint do not replay each other', async () => {
    // The shape of a backup restored twice, or onto two machines: one record,
    // declared unusable twice. Both seams used to take `keyEpoch + 1` from the
    // same record, floor their cursors on the same leases and open at the same
    // price — the same increments, from the same level.
    const clock = new SteppableClock(GENESIS);
    const origin = await resumeMarket(options(new MemoryStateStore(), clock));
    clock.advance(durationMillis(600_000));
    origin.market.advance();
    const record = { ...checkpointMarket(origin.market, asset.definition.id, clock.now()) };
    // Anything that makes the record unusable takes the seam; the reason is not
    // what this asserts.
    const unusable = { ...record, leasedBlocks: {} };

    const seam = async (at: number) => {
      const store = new MemoryStateStore();
      await store.save(unusable);
      const seamClock = new SteppableClock(epochMillis(at));
      const result = await resumeMarket(options(store, seamClock));
      expect(result.outcome.kind).toBe('seam');
      return { ...result, clock: seamClock };
    };
    const first = await seam(clock.now() + 60_000);
    const second = await seam(clock.now() + 80_000);
    expect(second.market.keyEpoch).not.toBe(first.market.keyEpoch);
    const agreement = directionAgreement(
      stepsOf(first.market, first.clock, TICKS),
      stepsOf(second.market, second.clock, TICKS),
    );
    expect(agreement).toBeLessThan(INDEPENDENT);
  });

  it('two reopenings past the same record do not replay each other', async () => {
    // No checkpoint, a published record: the a6-06 recovery. It used to open on
    // key epoch 1 whatever the instant, so two of them were one market.
    const published: Tick = {
      sequence: 407,
      instant: epochMillis(GENESIS + 120_000),
      price: logPrice(1_234),
    };
    const reopen = async (at: number) => {
      const clock = new SteppableClock(epochMillis(at));
      const result = await resumeMarket({
        ...options(new MemoryStateStore(), clock, GENESIS),
        published,
      });
      expect(result.outcome.kind).toBe('seam');
      return { ...result, clock };
    };
    const first = await reopen(GENESIS + 600_000);
    const second = await reopen(GENESIS + 620_000);
    expect(second.market.keyEpoch).not.toBe(first.market.keyEpoch);
    const agreement = directionAgreement(
      stepsOf(first.market, first.clock, TICKS),
      stepsOf(second.market, second.clock, TICKS),
    );
    expect(agreement).toBeLessThan(INDEPENDENT);
  });

  it('is still the same market when it resumes, which is what a key epoch is for', async () => {
    // The other half of the contract (INV-009): a checkpoint says which
    // keystream its cursors index, and resuming it continues that keystream.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(options(store, clock));
    clock.advance(durationMillis(600_000));
    first.market.advance();
    await store.save(checkpointMarket(first.market, asset.definition.id, clock.now()));

    const resumedClock = new SteppableClock(clock.now());
    const resumed = await resumeMarket(options(store, resumedClock));
    expect(resumed.outcome.kind).toBe('resumed');
    expect(resumed.market.keyEpoch).toBe(first.market.keyEpoch);
    clock.advance(durationMillis(60_000));
    resumedClock.advance(durationMillis(60_000));
    expect(resumed.market.advance()).toEqual(first.market.advance());
  });
});

describe('the key epoch a keystream starts on', () => {
  it('is the start instant, scaled so that each instant owns a run of epochs', () => {
    expect(startKeyEpoch(GENESIS)).toBe(GENESIS * START_EPOCH_SPAN);
    expect(startKeyEpoch(LATER) - startKeyEpoch(GENESIS)).toBe(20_000 * START_EPOCH_SPAN);
  });

  it('never repeats or goes back within one market, even on a clock that did not move', () => {
    const first = startKeyEpoch(GENESIS);
    expect(startKeyEpoch(GENESIS, first)).toBe(first + 1);
    expect(startKeyEpoch(epochMillis(GENESIS - 5_000), first + 1)).toBe(first + 2);
    // A legacy market, started on epoch 0 before this rule, moves onto the
    // instant's run at its first seam rather than onto epoch 1.
    expect(startKeyEpoch(LATER, 0)).toBe(startKeyEpoch(LATER));
  });

  it('refuses an instant whose epochs it cannot represent exactly', () => {
    expect(() => startKeyEpoch(epochMillis(-1))).toThrow(RangeError);
    expect(() => startKeyEpoch(epochMillis(1.5))).toThrow(RangeError);
    expect(() => startKeyEpoch(epochMillis(Number.MAX_SAFE_INTEGER))).toThrow(RangeError);
  });

  it('writes the epoch into the first checkpoint, so a resume indexes the same keystream', async () => {
    const clock = new SteppableClock(GENESIS);
    const { market } = await resumeMarket(options(new MemoryStateStore(), clock));
    clock.advance(durationMillis(60_000));
    market.advance();
    expect(checkpointMarket(market, asset.definition.id, clock.now()).keyEpoch).toBe(
      startKeyEpoch(GENESIS),
    );
  });
});
