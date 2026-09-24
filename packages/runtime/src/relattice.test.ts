// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  logPrice,
  MasterKeyring,
  SteppableClock,
  type Tick,
} from '@otc/core';
import { ASSET_CATALOGUE, LATTICE_BEFORE_PH37, type RegisteredAsset } from '@otc/engine';
import { MemoryStateStore } from './fileStore.js';
import type { HostedMarket } from './hosted.js';
import { checkpointMarket, resumeMarket } from './resume.js';

/**
 * A price is an integer, and an integer means nothing without its quantum.
 *
 * PH-37 changes every asset's lattice, and a market that resumes across that
 * change takes a seam — the personality fingerprint covers the quantum, so it
 * always did. What it did *not* do was carry the price across: a seam continues
 * from the last published price, and that price read on a lattice twelve times
 * coarser is a twelfth of the price. A broker would have seen EUR/USD open at
 * 1.0128 instead of 1.1631.
 */
const keyring = MasterKeyring.forTesting('relattice-spec');
const base = ASSET_CATALOGUE[0]!;
const GENESIS = epochMillis(1_776_000_000_000);
const COARSER = 12;

/** The same asset, publishing on a lattice `factor` times coarser. */
function onCoarserLattice(asset: RegisteredAsset, factor: number): RegisteredAsset {
  const instrument = {
    ...asset.instrument,
    logQuantum: asset.instrument.logQuantum * factor,
  };
  return { ...asset, instrument };
}

/** Advance in steps inside the catch-up bound until `count` ticks have landed. */
function pump(market: HostedMarket, clock: SteppableClock, count: number): Tick[] {
  const ticks: Tick[] = [];
  while (ticks.length < count) {
    clock.advance(durationMillis(5_000));
    ticks.push(...market.advance());
  }
  return ticks;
}

function options(asset: RegisteredAsset, store: MemoryStateStore, clock: SteppableClock) {
  return {
    asset,
    keyring,
    environment: 'test' as const,
    clock,
    store,
    genesisInstant: GENESIS,
  };
}

describe('a seam onto a different lattice keeps the price it continues from', () => {
  it('re-expresses the last published price instead of reinterpreting it', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(options(base, store, clock));
    let published = 0;
    while (published < 40) {
      clock.advance(durationMillis(5_000));
      published += first.market.advance().length;
    }
    const last = first.market.lastPublishedState!;
    await store.save(checkpointMarket(first.market, base.definition.id, epochMillis(clock.now())));

    // The same market, recalibrated onto a coarser lattice: a seam by
    // construction, because the fingerprint covers the quantum.
    const coarse = onCoarserLattice(base, COARSER);
    const second = await resumeMarket(options(coarse, store, clock));
    expect(second.outcome.kind).toBe('seam');

    // What the prices *mean* is what has to match, so both are read back
    // through their own quanta. Within half a new quantum, which is the most a
    // rounding onto a coarser lattice can move a price.
    const before = last.price * base.instrument.logQuantum;
    const after = second.market.lastPublishedState!.price * coarse.instrument.logQuantum;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(coarse.instrument.logQuantum / 2);

    // And the market goes on from there rather than from a twelfth of it.
    let ticks = second.market.advance();
    while (ticks.length === 0) {
      clock.advance(durationMillis(5_000));
      ticks = second.market.advance();
    }
    const opened = ticks[0]!.price * coarse.instrument.logQuantum;
    expect(Math.abs(opened - before)).toBeLessThan(
      Math.abs(before) * 0.01 + coarse.instrument.logQuantum * 50,
    );
  });

  it('converts a checkpoint that predates the field, which is every upgrade (PH-37.2)', async () => {
    // **The case the first version of this got wrong.** `logQuantum` in the
    // checkpoint and the lattice change that needs it ship together, so on the
    // upgrade that matters no checkpoint declares one. Believed rather than
    // checked, it moved thirty live markets by a median of 31.7% and as much as
    // 1,474%. The release carries the lattice it moved from, and this is the
    // path that reads it.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(options(base, store, clock));
    let published = 0;
    while (published < 40) {
      clock.advance(durationMillis(5_000));
      published += first.market.advance().length;
    }
    const last = first.market.lastPublishedState!;
    const record = checkpointMarket(first.market, base.definition.id, epochMillis(clock.now()));
    // Exactly what a checkpoint written before the field looks like.
    const { logQuantum: _dropped, ...older } = record;
    await store.save(older);

    const coarse = onCoarserLattice(base, COARSER);
    const second = await resumeMarket(options(coarse, store, clock));
    expect(second.outcome.kind).toBe('seam');
    const before = last.price * LATTICE_BEFORE_PH37[base.definition.id]!;
    const after = second.market.lastPublishedState!.price * coarse.instrument.logQuantum;
    // Within half a new quantum of where it was, read through each lattice.
    expect(Math.abs(after - before)).toBeLessThanOrEqual(coarse.instrument.logQuantum / 2);
  });

  it('converts on the path with no checkpoint at all (Cycle Audit 12)', async () => {
    // `seamPastRecord`: the record holds ticks and no checkpoint names the
    // asset, because the process that served them died inside its first
    // checkpoint interval. It took the record's integer verbatim, so a
    // reopening onto a coarser lattice reopened the market at a different
    // price — live, not merely rendered.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const coarse = onCoarserLattice(base, COARSER);
    const published = {
      sequence: 4_096,
      instant: epochMillis(GENESIS - 60_000),
      price: logPrice(-1_877),
    };
    const { market, outcome } = await resumeMarket({
      ...options(coarse, store, clock),
      published,
    });
    expect(outcome.kind).toBe('seam');
    const before = published.price * LATTICE_BEFORE_PH37[base.definition.id]!;
    // **What the market publishes, not what it reports.** The first version of
    // this read `lastPublishedState`, which the same change also converts — so
    // planting the defect back on the engine's start price left it green. A
    // guard that cannot fail on the defect it names is worth nothing; this
    // reads the first tick a broker would receive.
    const published5s = pump(market, clock, 1);
    const after = published5s[0]!.price * coarse.instrument.logQuantum;
    // One tick of ordinary movement away from where it continued, no more.
    expect(Math.abs(after - before)).toBeLessThan(coarse.instrument.logQuantum * 50);
    // And what the market reports agrees with what it published: the same
    // change converts both, so this is the half the first version tested and
    // the line above is the half that can fail on the defect.
    const last = published5s[published5s.length - 1]!;
    expect(market.lastPublishedState!.price).toBe(last.price);
  });

  it('ships a previous lattice for every asset, finer than the one in force', () => {
    // The table answers for checkpoints nothing else can describe, so a wrong
    // or stale entry is silent: it would convert a price to somewhere nobody
    // published. What is checkable without the old catalogue in hand is that it
    // covers the catalogue and that every entry is the *finer* lattice the
    // coarsening moved from — measured across the thirty at x12 to x16.
    for (const a of ASSET_CATALOGUE) {
      const previous = LATTICE_BEFORE_PH37[a.definition.id];
      expect(previous, `${a.definition.id} has no previous lattice`).toBeDefined();
      const factor = a.instrument.logQuantum / previous!;
      expect(factor, `${a.definition.id} coarsened by ${String(factor)}`).toBeGreaterThan(4);
      expect(factor, `${a.definition.id} coarsened by ${String(factor)}`).toBeLessThan(40);
    }
    expect(Object.keys(LATTICE_BEFORE_PH37)).toHaveLength(ASSET_CATALOGUE.length);
  });

  it('records the lattice it published on, so the conversion has something to read', async () => {
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const { market } = await resumeMarket(options(base, store, clock));
    clock.advance(durationMillis(10_000));
    market.advance();
    const record = checkpointMarket(market, base.definition.id, epochMillis(clock.now()));
    expect(record.logQuantum).toBe(base.instrument.logQuantum);
  });

  it('leaves a market on an unchanged lattice exactly where it was', async () => {
    // The conversion must be invisible when nothing changed: a resume on the
    // same lattice is a continuation, not a seam, and no price moves.
    const store = new MemoryStateStore();
    const clock = new SteppableClock(GENESIS);
    const first = await resumeMarket(options(base, store, clock));
    let published = 0;
    while (published < 20) {
      clock.advance(durationMillis(5_000));
      published += first.market.advance().length;
    }
    const last = first.market.lastPublishedState!;
    await store.save(checkpointMarket(first.market, base.definition.id, epochMillis(clock.now())));
    const second = await resumeMarket(options(base, store, clock));
    expect(second.outcome.kind).toBe('resumed');
    expect(second.market.lastPublishedState!.price).toBe(last.price);
  });
});
