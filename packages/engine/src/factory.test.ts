// Invariant evidence: INV-008 (continuous market state).
import { describe, expect, it } from 'vitest';
import {
  CursorLease,
  epochMillis,
  formatCursor,
  logPrice,
  MasterKeyring,
  parseCursor,
  ProductionStreamFromTestKeyringError,
  type InstrumentSpec,
  type Tick,
} from '@otc/core';
import {
  createMarketEngine,
  defaultConfigFor,
  ENGINE_STREAM_PURPOSES,
  type MarketEngineConfig,
} from './factory.js';
import type { MarketEngine } from './engine.js';

const instrument: InstrumentSpec = {
  id: 'factory-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const config: MarketEngineConfig = defaultConfigFor(instrument);
const keyring = MasterKeyring.forTesting('factory-spec');
const START = { instant: epochMillis(1_776_000_000_000), price: logPrice(0) };

function build(overrides: Partial<Parameters<typeof createMarketEngine>[0]> = {}): MarketEngine {
  return createMarketEngine({
    config,
    keyring,
    environment: 'test',
    start: START,
    ...overrides,
  });
}

function drain(engine: MarketEngine, count: number): Tick[] {
  const out: Tick[] = [];
  for (let i = 0; i < count; i += 1) {
    const tick = engine.next();
    if (tick === null) break;
    out.push(tick);
  }
  return out;
}

describe('the canonical engine', () => {
  it('is built from configuration alone', () => {
    const ticks = drain(build(), 5_000);
    expect(ticks).toHaveLength(5_000);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!.sequence).toBe(ticks[i - 1]!.sequence + 1);
      expect(ticks[i]!.instant).toBeGreaterThan(ticks[i - 1]!.instant);
    }
  });

  it('names every stream in its snapshot', () => {
    const engine = build();
    drain(engine, 100);
    expect(Object.keys(engine.snapshot().cursors).sort()).toEqual(
      [...ENGINE_STREAM_PURPOSES].sort(),
    );
  });

  it('honours a tick limit', () => {
    expect(drain(build({ maxTicks: 250 }), 10_000)).toHaveLength(250);
  });

  it('is reproducible', () => {
    expect(drain(build(), 2_000)).toEqual(drain(build(), 2_000));
  });
});

describe('stream isolation', () => {
  it('gives two instruments independent streams', () => {
    const other = defaultConfigFor({ ...instrument, id: 'other-otc' });
    const a = drain(build(), 2_000).map((t) => t.price);
    const b = drain(build({ config: other }), 2_000).map((t) => t.price);
    expect(a).not.toEqual(b);
    // Not merely different: cryptographically independent keys, so the two
    // series share no structure at all.
    expect(new Set([...a, ...b]).size).toBeGreaterThan(new Set(a).size);
  });

  it('gives two environments independent streams', () => {
    const a = drain(build({ environment: 'test' }), 1_000).map((t) => t.price);
    const b = drain(build({ environment: 'simulation' }), 1_000).map((t) => t.price);
    expect(a).not.toEqual(b);
  });

  it('gives two key epochs independent streams', () => {
    const a = drain(build({ keyEpoch: 0 }), 1_000).map((t) => t.price);
    const b = drain(build({ keyEpoch: 1 }), 1_000).map((t) => t.price);
    expect(a).not.toEqual(b);
  });

  it('cannot produce a production stream from a test keyring', () => {
    // A test keyring's secret comes from a public constant. A production market
    // built on it would be fully predictable to anyone reading the source.
    expect(() => build({ environment: 'production' })).toThrow(
      ProductionStreamFromTestKeyringError,
    );
  });
});

describe('the arrival process runs unclamped', () => {
  it('does not sit pinned to its intensity clamp', () => {
    // The clamp is a backstop, not the mechanism. An earlier configuration
    // normalised excitation against a fixed magnitude that the layered engine
    // exceeded severalfold; the effective branching ratio went above 1, the
    // process ran permanently clamped, and the realized tick rate was three
    // times the configured one — with nothing failing.
    const engine = build();
    const ticks = drain(engine, 60_000);
    const spanMs = ticks[ticks.length - 1]!.instant - ticks[0]!.instant;
    const meanIntervalMs = spanMs / (ticks.length - 1);
    const predicted = config.arrival.baseIntervalMs * (1 - config.arrival.branchingRatio);
    const clamped = config.arrival.baseIntervalMs / config.arrival.maxIntensityMultiplier;

    // Near the predicted stationary mean, and comfortably above the floor the
    // clamp would impose.
    expect(meanIntervalMs).toBeGreaterThan(clamped * 1.5);
    expect(meanIntervalMs).toBeGreaterThan(predicted * 0.4);
    expect(meanIntervalMs).toBeLessThan(predicted * 2.5);
  });
});

describe('restart continuity', () => {
  /**
   * The sequence a runtime performs on restart.
   *
   * The engine resumes at the **leased** cursor rather than the snapshotted one.
   * A crash between emitting a tick and persisting its cursor would otherwise
   * redraw values already used and replay a price sequence observers have seen —
   * which is exactly what §22 forbids.
   */
  it('never reuses a keystream position across a seam', () => {
    const leaseBlocks = 64n;

    const before = build();
    const beforeTicks = drain(before, 4_000);
    const snapshot = before.snapshot();

    // Lease ahead of use, per purpose, and persist the high-water marks.
    const leased: Record<string, string> = {};
    const highWater: Record<string, bigint> = {};
    for (const purpose of ENGINE_STREAM_PURPOSES) {
      const consumed = parseCursor(snapshot.cursors[purpose]!).blockIndex;
      const lease = CursorLease.resume(consumed + leaseBlocks, leaseBlocks);
      highWater[purpose] = lease.startAt;
      leased[purpose] = formatCursor({ blockIndex: lease.startAt, byteOffset: 0 });
    }

    // Crash: only the snapshot and the leased marks survive.
    const after = createMarketEngine({
      config,
      keyring,
      environment: 'test',
      start: { instant: snapshot.instant, price: snapshot.price },
      cursors: leased,
    });
    const afterTicks = drain(after, 4_000);

    // No keystream position is consumed twice: the resumed engine starts beyond
    // where the crashed one had reached.
    for (const purpose of ENGINE_STREAM_PURPOSES) {
      const consumedBefore = parseCursor(snapshot.cursors[purpose]!).blockIndex;
      expect(highWater[purpose], purpose).toBeGreaterThan(consumedBefore);
    }

    // Continuous in price: the restart does not jump the market.
    const last = beforeTicks[beforeTicks.length - 1]!;
    const first = afterTicks[0]!;
    expect(first.price - last.price).toBeLessThan(2_000);
    expect(first.price - last.price).toBeGreaterThan(-2_000);

    // Non-repeating: the post-seam sequence is not the pre-seam one replayed.
    const tail = beforeTicks.slice(-500).map((t) => t.price - last.price);
    const head = afterTicks.slice(0, 500).map((t) => t.price - last.price);
    expect(head).not.toEqual(tail);
  });

  it('produces a seam that is not visible in the return statistics', () => {
    const leaseBlocks = 64n;
    const before = build();
    const beforeTicks = drain(before, 30_000);
    const snapshot = before.snapshot();

    const leased: Record<string, string> = {};
    for (const purpose of ENGINE_STREAM_PURPOSES) {
      const consumed = parseCursor(snapshot.cursors[purpose]!).blockIndex;
      leased[purpose] = formatCursor({ blockIndex: consumed + leaseBlocks, byteOffset: 0 });
    }
    const after = createMarketEngine({
      config,
      keyring,
      environment: 'test',
      start: { instant: snapshot.instant, price: snapshot.price },
      cursors: leased,
    });
    const afterTicks = drain(after, 30_000);

    const magnitudes = (ticks: Tick[]): number[] => {
      const out: number[] = [];
      for (let i = 1; i < ticks.length; i += 1)
        out.push(Math.abs(ticks[i]!.price - ticks[i - 1]!.price));
      return out;
    };
    const mean = (values: number[]): number =>
      values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

    // Statistics either side of the seam must be consistent. A discontinuity in
    // volatility would be the most visible possible tell that a restart happened.
    const tailMean = mean(magnitudes(beforeTicks.slice(-10_000)));
    const headMean = mean(magnitudes(afterTicks.slice(0, 10_000)));
    expect(headMean).toBeGreaterThan(tailMean * 0.4);
    expect(headMean).toBeLessThan(tailMean * 2.5);
  });
});

describe('the composed model restores exactly', () => {
  // The lease path above deliberately abandons latent state. This is the other
  // path: a snapshot restored into a fresh process, which is what the hosted
  // runtime will do on every deploy. It is the only test that drives
  // ModulatedMagnitudeModel.restore — the composition the canonical engine
  // actually runs. Restoring each component in isolation proves nothing about
  // whether the composition threads state to the right member.
  it('reproduces a continuation bit-for-bit after snapshot and restore', () => {
    const reference = build();
    drain(reference, 5_000);
    const snapshot = reference.snapshot();
    const expected = drain(reference, 1_000);

    const restored = build();
    restored.restore(snapshot);
    expect(restored.sequence).toBe(snapshot.sequence);
    expect(restored.price).toBe(snapshot.price);
    expect(drain(restored, 1_000)).toEqual(expected);
  });

  it('is a test with teeth: without restore the continuation differs', () => {
    // If the assertion above could pass on an engine that ignored the latent
    // state, it would prove nothing. A fresh engine seeked to the same price
    // and instant, but never restored, must diverge.
    const reference = build();
    drain(reference, 5_000);
    const snapshot = reference.snapshot();
    const expected = drain(reference, 1_000);

    const naive = build({ start: { instant: snapshot.instant, price: snapshot.price } });
    expect(drain(naive, 1_000)).not.toEqual(expected);
  });

  it('restores the volatility cascade, not just the price', () => {
    // Latent volatility is the state most likely to be silently dropped: the
    // price and cursors would still line up, and only the *scale* of the
    // continuation would be wrong. Compare realised magnitude either side.
    const reference = build();
    drain(reference, 20_000);
    const snapshot = reference.snapshot();
    const expectedTicks = drain(reference, 2_000);

    const restored = build();
    restored.restore(snapshot);
    const actualTicks = drain(restored, 2_000);

    const meanAbsStep = (ticks: Tick[]): number => {
      let total = 0;
      for (let i = 1; i < ticks.length; i += 1) {
        total += Math.abs(ticks[i]!.price - ticks[i - 1]!.price);
      }
      return total / (ticks.length - 1);
    };
    expect(meanAbsStep(actualTicks)).toBe(meanAbsStep(expectedTicks));
  });
});
