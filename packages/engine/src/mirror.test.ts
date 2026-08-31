// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import {
  epochMillis,
  logPrice,
  MasterKeyring,
  type InstrumentSpec,
  type RandomSource,
} from '@otc/core';
import { PoissonArrivalModel } from './arrival.js';
import {
  DEFAULT_DURATION_COUPLING,
  DEFAULT_HAWKES,
  DurationCouplingModulator,
  HawkesArrivalModel,
} from './hawkes.js';
import { CascadeMagnitudeModel, DEFAULT_CASCADE } from './cascade.js';
import { ModulatedMagnitudeModel } from './modulator.js';
import { DEFAULT_REGIMES, VolatilityRegimeModulator } from './regime.js';
import { DEFAULT_STRUCTURE, StructurePhaseModulator } from './structure.js';
import { MarketEngine } from './engine.js';
import type { MagnitudeContext, MagnitudeModel } from './magnitude.js';
import { runMirrorTest, SignInvertingStream } from './mirror.js';

/**
 * The primary structural gate for the whole project.
 *
 * ADR-0003 guarantees P(up) = P(down) exactly, on one precondition: the
 * magnitude and timing engine never observes a sign. The mirror test checks that
 * precondition directly — negate the sign source and every latent variable must
 * continue bit-identically while every increment is exactly negated.
 */

const instrument: InstrumentSpec = {
  id: 'mirror-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const keyring = MasterKeyring.forTesting('mirror-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'mirror', purpose, keyEpoch: 0 });

function buildEngine(signSource: RandomSource, magnitude?: MagnitudeModel): MarketEngine {
  const cascade = derive('cascade');
  const shock = derive('shock');
  const arrival = derive('arrival');
  return new MarketEngine({
    instrument,
    magnitude: magnitude ?? new CascadeMagnitudeModel(1e-5, DEFAULT_CASCADE, cascade, shock),
    arrival: new PoissonArrivalModel(1_000, arrival),
    streams: {
      sign: signSource,
      rounding: derive('rounding'),
      models: { cascade, shock, arrival },
    },
    start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
  });
}

describe('the mirror test passes on the real engine', () => {
  it('negating the sign source negates every increment and changes nothing else', () => {
    const result = runMirrorTest(
      (sign) => buildEngine(sign),
      () => derive('sign'),
      { burnInTicks: 20_000, compareTicks: 5_000 },
    );
    expect(result.divergences).toEqual([]);
    expect(result.mirrored).toBe(true);
    expect(result.steps).toBe(5_000);
  });

  it('holds from many different interior points', () => {
    // A test run from a symmetric initial state passes vacuously: with no
    // accumulated asymmetry there is nothing for a sign-reading mechanism to
    // have latched onto. Randomising the burn-in is what makes it meaningful.
    for (const burnInTicks of [1, 137, 2_500, 9_001, 40_000]) {
      const result = runMirrorTest(
        (sign) => buildEngine(sign),
        () => derive('sign'),
        { burnInTicks, compareTicks: 400 },
      );
      expect(result.divergences, `burn-in ${burnInTicks}`).toEqual([]);
    }
  });

  it('rejects invalid options', () => {
    const build = (sign: RandomSource) => buildEngine(sign);
    const source = () => derive('sign');
    expect(() => runMirrorTest(build, source, { burnInTicks: 0, compareTicks: 10 })).toThrow(
      RangeError,
    );
    expect(() => runMirrorTest(build, source, { burnInTicks: 10, compareTicks: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('the mirror test passes with every layer active', () => {
  /** The full PH-3.2 stack: cascade, volatility regime, structure phase. */
  function layeredEngine(signSource: RandomSource): MarketEngine {
    const cascade = derive('cascade');
    const shock = derive('shock');
    const arrival = derive('arrival');
    const regimeStream = derive('regime');
    const structureStream = derive('structure');
    const magnitude = new ModulatedMagnitudeModel(
      new CascadeMagnitudeModel(1e-5, DEFAULT_CASCADE, cascade, shock),
      [
        new VolatilityRegimeModulator(DEFAULT_REGIMES, regimeStream),
        new StructurePhaseModulator(DEFAULT_STRUCTURE, structureStream),
      ],
    );
    return new MarketEngine({
      instrument,
      magnitude,
      arrival: new PoissonArrivalModel(1_000, arrival),
      streams: {
        sign: signSource,
        rounding: derive('rounding'),
        models: { cascade, shock, arrival, regime: regimeStream, structure: structureStream },
      },
      start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
    });
  }

  it('regimes and structure phases do not break the symmetry', () => {
    // The structure layer's transition hazard depends on path length per unit
    // time. That is a reflection-invariant quantity, and this is what proves it.
    const result = runMirrorTest(layeredEngine, () => derive('sign'), {
      burnInTicks: 30_000,
      compareTicks: 5_000,
    });
    expect(result.divergences).toEqual([]);
    expect(result.mirrored).toBe(true);
  });

  it('holds from several interior points with the full stack', () => {
    for (const burnInTicks of [500, 12_000, 60_000]) {
      const result = runMirrorTest(layeredEngine, () => derive('sign'), {
        burnInTicks,
        compareTicks: 300,
      });
      expect(result.divergences, `burn-in ${burnInTicks}`).toEqual([]);
    }
  });
});

describe('the mirror test passes with the complete stack', () => {
  /** Cascade, regime, structure, duration coupling and self-exciting arrivals. */
  function fullEngine(signSource: RandomSource): MarketEngine {
    const cascade = derive('cascade');
    const shock = derive('shock');
    const arrival = derive('arrival');
    const regimeStream = derive('regime');
    const structureStream = derive('structure');
    const magnitude = new ModulatedMagnitudeModel(
      new CascadeMagnitudeModel(1e-5, DEFAULT_CASCADE, cascade, shock),
      [
        new VolatilityRegimeModulator(DEFAULT_REGIMES, regimeStream),
        new StructurePhaseModulator(DEFAULT_STRUCTURE, structureStream),
        new DurationCouplingModulator(DEFAULT_DURATION_COUPLING, 5_000),
      ],
    );
    return new MarketEngine({
      instrument,
      magnitude,
      arrival: new HawkesArrivalModel(DEFAULT_HAWKES, arrival),
      streams: {
        sign: signSource,
        rounding: derive('rounding'),
        models: { cascade, shock, arrival, regime: regimeStream, structure: structureStream },
      },
      start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
    });
  }

  it('self-exciting arrivals and duration coupling do not break the symmetry', () => {
    // Arrivals are excited by MAGNITUDE, not by the signed return. An
    // excitation driven by the sign would be a timing analogue of the leverage
    // effect, and this is what proves it is not one.
    const result = runMirrorTest(fullEngine, () => derive('sign'), {
      burnInTicks: 30_000,
      compareTicks: 5_000,
    });
    expect(result.divergences).toEqual([]);
    expect(result.mirrored).toBe(true);
  });

  it('holds from several interior points with the complete stack', () => {
    for (const burnInTicks of [800, 15_000, 50_000]) {
      const result = runMirrorTest(fullEngine, () => derive('sign'), {
        burnInTicks,
        compareTicks: 300,
      });
      expect(result.divergences, `burn-in ${burnInTicks}`).toEqual([]);
    }
  });
});

describe('the mirror test catches sign-reading mechanisms', () => {
  // Without these, the gate could be vacuous: a check that never fails proves
  // nothing about the checks that pass.

  /**
   * The leverage effect, smuggled in.
   *
   * This is not a strawman. It is the single most likely defect to reach this
   * codebase: one of the most robust stylized facts in real markets, a
   * three-line change, still an exact martingale — and worth 2.9 percentage
   * points of directional edge.
   *
   * It cannot read a sign from `MagnitudeContext`, because the type has no room
   * for one. So it does what a real contributor would do to get around that:
   * it keeps its own copy.
   */
  class LeverageMagnitudeModel implements MagnitudeModel {
    #boost = 1;
    #lastSign = 1;

    constructor(private readonly inner: MagnitudeModel) {}

    /** The back door: something outside tells it which way the price went. */
    observeSign(sign: number): void {
      this.#lastSign = sign;
    }

    advance(context: MagnitudeContext): number {
      this.#boost = this.#boost * 0.95 + (this.#lastSign < 0 ? 1.6 : 1) * 0.05;
      return this.inner.advance(context) * this.#boost;
    }

    snapshot(): unknown {
      return { inner: this.inner.snapshot(), boost: this.#boost, lastSign: this.#lastSign };
    }

    restore(state: unknown): void {
      const typed = state as { inner: unknown; boost: number; lastSign: number };
      this.inner.restore(typed.inner);
      this.#boost = typed.boost;
      this.#lastSign = typed.lastSign;
    }
  }

  it('catches a magnitude model that observes the sign', () => {
    const result = runMirrorTest(
      (sign) => {
        const leverage = new LeverageMagnitudeModel(
          new CascadeMagnitudeModel(1e-5, DEFAULT_CASCADE, derive('cascade'), derive('shock')),
        );
        // Wire the back door: the sign source tells the model what it drew.
        const observing: RandomSource = {
          ...sign,
          label: sign.label,
          nextBoolean: () => {
            const value = sign.nextBoolean();
            leverage.observeSign(value ? 1 : -1);
            return value;
          },
          nextUint32: () => sign.nextUint32(),
          nextUint64: () => sign.nextUint64(),
          nextFloat64: () => sign.nextFloat64(),
          nextBoundedUint32: (b: number) => sign.nextBoundedUint32(b),
          nextBytes: (n: number) => sign.nextBytes(n),
          position: () => sign.position(),
          seek: (c) => sign.seek(c),
        };
        return buildEngine(observing, leverage);
      },
      () => derive('sign'),
      { burnInTicks: 500, compareTicks: 200 },
    );
    expect(result.mirrored).toBe(false);
    expect(result.divergences.length).toBeGreaterThan(0);
  });

  it('catches a magnitude model that reads the price level', () => {
    // The other class of defect, and the one PH-2 showed a conventional attack
    // battery cannot see: volatility keyed to the absolute price.
    class LevelAnchoredModel implements MagnitudeModel {
      #price = 0;

      constructor(private readonly inner: MagnitudeModel) {}

      observePrice(price: number): void {
        this.#price = price;
      }

      advance(context: MagnitudeContext): number {
        const phase = (((this.#price % 4_000) + 4_000) % 4_000) / 4_000;
        return this.inner.advance(context) * (1 + 0.8 * (1 - 2 * Math.abs(2 * phase - 1)));
      }

      snapshot(): unknown {
        return { inner: this.inner.snapshot(), price: this.#price };
      }

      restore(state: unknown): void {
        const typed = state as { inner: unknown; price: number };
        this.inner.restore(typed.inner);
        this.#price = typed.price;
      }
    }

    const result = runMirrorTest(
      (sign) => {
        const model = new LevelAnchoredModel(
          new CascadeMagnitudeModel(1e-5, DEFAULT_CASCADE, derive('cascade'), derive('shock')),
        );
        const engine = buildEngine(sign, model);
        // The back door: after each tick, tell the model where the price is.
        const originalNext = engine.next.bind(engine);
        Object.assign(engine, {
          next: () => {
            const tick = originalNext();
            if (tick !== null) model.observePrice(tick.price);
            return tick;
          },
        });
        return engine;
      },
      () => derive('sign'),
      { burnInTicks: 2_000, compareTicks: 500 },
    );
    expect(result.mirrored).toBe(false);
  });
});

describe('SignInvertingStream', () => {
  it('inverts only the coin', () => {
    const a = derive('invert-a');
    const b = new SignInvertingStream(derive('invert-a'));
    for (let i = 0; i < 200; i += 1) {
      expect(b.nextBoolean()).toBe(!a.nextBoolean());
    }
  });

  it('passes every other draw through unchanged', () => {
    const a = derive('invert-b');
    const b = new SignInvertingStream(derive('invert-b'));
    for (let i = 0; i < 200; i += 1) {
      expect(b.nextFloat64()).toBe(a.nextFloat64());
      expect(b.nextUint32()).toBe(a.nextUint32());
      expect(b.nextUint64()).toBe(a.nextUint64());
      expect(b.nextBoundedUint32(37)).toBe(a.nextBoundedUint32(37));
      expect(Array.from(b.nextBytes(5))).toEqual(Array.from(a.nextBytes(5)));
    }
    expect(b.position()).toEqual(a.position());
    expect(b.label).toContain('#mirrored');
  });

  it('seeks the underlying stream', () => {
    const inner = derive('invert-c');
    const wrapper = new SignInvertingStream(inner);
    inner.nextUint32();
    const cursor = inner.position();
    wrapper.seek({ blockIndex: 0n, byteOffset: 0 });
    expect(inner.position()).toEqual({ blockIndex: 0n, byteOffset: 0 });
    expect(cursor).not.toEqual(inner.position());
  });
});
