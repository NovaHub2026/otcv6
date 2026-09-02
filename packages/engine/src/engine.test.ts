// Invariant evidence: INV-008 (continuous market state), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import {
  epochMillis,
  logPrice,
  MasterKeyring,
  parseCursor,
  type InstrumentSpec,
  type RandomSource,
  type Tick,
} from '@otc/core';
import { PoissonArrivalModel } from './arrival.js';
import { CascadeMagnitudeModel, DEFAULT_CASCADE } from './cascade.js';
import { logUnitsPerRelativeMove, MarketEngine } from './engine.js';
import type { MagnitudeModel } from './magnitude.js';

const instrument: InstrumentSpec = {
  id: 'engine-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const keyring = MasterKeyring.forTesting('engine-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'engine', purpose, keyEpoch: 0 });

function build(maxTicks?: number, magnitude?: MagnitudeModel): MarketEngine {
  const cascade = derive('cascade');
  const shock = derive('shock');
  const arrival = derive('arrival');
  return new MarketEngine({
    instrument,
    magnitude: magnitude ?? new CascadeMagnitudeModel(1e-5, DEFAULT_CASCADE, cascade, shock),
    arrival: new PoissonArrivalModel(1_000, arrival),
    streams: {
      sign: derive('sign'),
      rounding: derive('rounding'),
      models: { cascade, shock, arrival },
    },
    start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
    ...(maxTicks === undefined ? {} : { maxTicks }),
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

describe('tick generation', () => {
  it('produces a well-ordered stream on the canonical lattice', () => {
    const ticks = drain(build(), 20_000);
    expect(ticks).toHaveLength(20_000);
    // Counted inside the loop, asserted once after it: 60,000 matcher calls
    // were ~1.5 s of overhead in a 20 s budget (out-of-band audit, a2-07).
    let misnumbered = 0;
    let unsafe = 0;
    let unordered = 0;
    for (let i = 0; i < ticks.length; i += 1) {
      if (ticks[i]!.sequence !== i + 1) misnumbered += 1;
      if (!Number.isSafeInteger(ticks[i]!.price)) unsafe += 1;
      if (i > 0 && !(ticks[i]!.instant > ticks[i - 1]!.instant)) unordered += 1;
    }
    expect({ misnumbered, unsafe, unordered }).toEqual({ misnumbered: 0, unsafe: 0, unordered: 0 });
  });

  it('honours a tick limit', () => {
    const engine = build(500);
    expect(drain(engine, 10_000)).toHaveLength(500);
    expect(engine.next()).toBeNull();
  });

  it('runs unbounded when no limit is given', () => {
    expect(drain(build(), 5_000)).toHaveLength(5_000);
  });

  it('is reproducible from identical streams', () => {
    const a = drain(build(2_000), 2_000);
    const b = drain(build(2_000), 2_000);
    expect(a).toEqual(b);
  });

  it('moves in both directions', () => {
    const ticks = drain(build(), 20_000);
    let up = 0;
    let down = 0;
    for (let i = 1; i < ticks.length; i += 1) {
      const delta = ticks[i]!.price - ticks[i - 1]!.price;
      if (delta > 0) up += 1;
      else if (delta < 0) down += 1;
    }
    // A fair coin: roughly balanced, and both directions actually occur.
    expect(up).toBeGreaterThan(1_000);
    expect(down).toBeGreaterThan(1_000);
    expect(Math.abs(up - down) / (up + down)).toBeLessThan(0.05);
  });
});

describe('the sign is applied after quantisation', () => {
  it('rounds the magnitude, never the signed price', () => {
    // Rounding a magnitude is symmetric; rounding a signed price is not, and
    // that asymmetry is worth up to 22 percentage points of edge (ADR-0004).
    // A constant magnitude of exactly half a step must therefore round up and
    // down with equal frequency regardless of direction.
    const halfStep: MagnitudeModel = {
      advance: () => instrument.logQuantum * 0.5,
      snapshot: () => null,
      restore: () => undefined,
    };
    const ticks = drain(build(40_000, halfStep), 40_000);
    let upOne = 0;
    let downOne = 0;
    let zero = 0;
    for (let i = 1; i < ticks.length; i += 1) {
      const delta = ticks[i]!.price - ticks[i - 1]!.price;
      if (delta === 1) upOne += 1;
      else if (delta === -1) downOne += 1;
      else if (delta === 0) zero += 1;
      else throw new Error(`unexpected increment ${delta}`);
    }
    // Half the draws round to one step and half to zero; of those that move,
    // the direction is a fair coin.
    expect(zero / ticks.length).toBeGreaterThan(0.45);
    expect(zero / ticks.length).toBeLessThan(0.55);
    expect(Math.abs(upOne - downOne) / (upOne + downOne)).toBeLessThan(0.05);
  });
});

describe('validation of model output', () => {
  it('rejects a negative magnitude', () => {
    const negative: MagnitudeModel = {
      advance: () => -1,
      snapshot: () => null,
      restore: () => undefined,
    };
    expect(() => build(10, negative).next()).toThrow(RangeError);
  });

  it('rejects a non-finite magnitude', () => {
    const infinite: MagnitudeModel = {
      advance: () => Number.POSITIVE_INFINITY,
      snapshot: () => null,
      restore: () => undefined,
    };
    expect(() => build(10, infinite).next()).toThrow(RangeError);
  });

  it('rejects a sub-millisecond arrival interval', () => {
    const engine = new MarketEngine({
      instrument,
      magnitude: new CascadeMagnitudeModel(1e-5, DEFAULT_CASCADE, derive('c'), derive('s')),
      arrival: {
        nextIntervalMs: () => 0,
        snapshot: () => null,
        restore: () => undefined,
      },
      streams: { sign: derive('sign'), rounding: derive('rounding'), models: {} },
      start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
    });
    expect(() => engine.next()).toThrow(RangeError);
  });
});

describe('snapshot and replay', () => {
  it('records the position of every stream, not only the ones it draws from', () => {
    // Recording the models' latent state without their cursors produces a
    // snapshot that looks complete and cannot actually be restored.
    const engine = build();
    drain(engine, 1_000);
    const snapshot = engine.snapshot();
    expect(Object.keys(snapshot.cursors).sort()).toEqual([
      'arrival',
      'cascade',
      'rounding',
      'shock',
      'sign',
    ]);
    for (const cursor of Object.values(snapshot.cursors)) {
      expect(() => parseCursor(cursor)).not.toThrow();
    }
    expect(snapshot.sequence).toBe(1_000);
  });

  it('reproduces a continuation exactly, from a fresh engine', () => {
    const reference = build();
    drain(reference, 3_000);
    const snapshot = reference.snapshot();
    const expected = drain(reference, 500);

    // A brand-new engine at position zero, restored purely from the snapshot.
    const restored = build();
    restored.restore(snapshot);
    expect(restored.sequence).toBe(3_000);
    expect(restored.price).toBe(snapshot.price);
    expect(drain(restored, 500)).toEqual(expected);
  });

  it('round-trips repeatedly from the same snapshot', () => {
    const engine = build();
    drain(engine, 1_500);
    const snapshot = engine.snapshot();
    const first = drain(engine, 200);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fresh = build();
      fresh.restore(snapshot);
      expect(drain(fresh, 200)).toEqual(first);
    }
  });

  it('rejects a snapshot that is missing a stream', () => {
    const engine = build();
    drain(engine, 100);
    const snapshot = engine.snapshot();
    const { cascade: _dropped, ...withoutCascade } = snapshot.cursors;
    expect(() => engine.restore({ ...snapshot, cursors: withoutCascade })).toThrow(RangeError);
  });

  it('rejects a snapshot referencing an unknown stream', () => {
    const engine = build();
    drain(engine, 100);
    const snapshot = engine.snapshot();
    expect(() =>
      engine.restore({ ...snapshot, cursors: { ...snapshot.cursors, phantom: '0:0' } }),
    ).toThrow(RangeError);
  });

  it('exposes the current price and sequence without generating', () => {
    const engine = build();
    drain(engine, 42);
    expect(engine.sequence).toBe(42);
    expect(Number.isSafeInteger(engine.price)).toBe(true);
  });
});

describe('helpers', () => {
  it('converts a relative move to log units', () => {
    expect(logUnitsPerRelativeMove(0)).toBe(0);
    expect(logUnitsPerRelativeMove(0.01)).toBeCloseTo(0.00995, 5);
    expect(() => logUnitsPerRelativeMove(-1)).toThrow(RangeError);
  });
});
