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
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_CATALOGUE } from './catalogue.js';
import { runMirrorTest, SignInvertingStream } from './mirror.js';

/**
 * The primary structural gate for the whole project.
 *
 * ADR-0003 guarantees P(up) = P(down) exactly, on one precondition: the
 * magnitude and timing engine never observes a sign. The mirror test checks that
 * precondition directly — negate the sign source from an interior snapshot and
 * every latent variable must continue bit-identically while every increment is
 * exactly negated.
 */

/**
 * Where the interior index is drawn from, in ticks.
 *
 * ADR-0003 §6 step 5: randomise `N` per run. The draw comes from this file's
 * own keyring, so a failing `N` is reproducible and reported. The floor is past
 * the first few regime and structure transitions, so the latent state is
 * genuinely asymmetric; the ceiling keeps the origin run inside the unit budget.
 */
const INTERIOR = { min: 1_000, max: 30_000 } as const;

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
      { burnInTicks: INTERIOR, compareTicks: 5_000, interior: derive('interior') },
    );
    expect(result.divergences, `snapshot at ${result.snapshotAt}`).toEqual([]);
    expect(result.mirrored).toBe(true);
    expect(result.steps).toBe(5_000);
    expect(result.snapshotAt).toBeGreaterThanOrEqual(INTERIOR.min);
    expect(result.snapshotAt).toBeLessThanOrEqual(INTERIOR.max);
  });

  it('reflects through the interior price, not through the origin', () => {
    // The property Cycle Audit 7 (a3-01) found missing. The snapshot the two
    // continuations start from must carry an asymmetric price: a harness that
    // inverts the sign from tick 1 compares `p(t)` against `-p(t)`, and any
    // level dependence symmetric about zero is invisible to it.
    const origin = buildEngine(derive('sign'));
    for (let i = 0; i < 2_000; i += 1) origin.next();
    expect(origin.price).not.toBe(0);
    const result = runMirrorTest(
      (sign) => buildEngine(sign),
      () => derive('sign'),
      { burnInTicks: 2_000, compareTicks: 100 },
    );
    expect(result.snapshotAt).toBe(2_000);
    expect(result.mirrored).toBe(true);
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
    // A range with nothing to draw it from would need ambient randomness, and
    // a failing N that cannot be reproduced is not evidence.
    expect(() =>
      runMirrorTest(build, source, { burnInTicks: { min: 10, max: 20 }, compareTicks: 10 }),
    ).toThrow(/interior/);
    expect(() =>
      runMirrorTest(build, source, {
        burnInTicks: { min: 20, max: 10 },
        compareTicks: 10,
        interior: derive('interior'),
      }),
    ).toThrow(RangeError);
  });

  it('draws the interior index from the stream it is given, deterministically', () => {
    const draw = () =>
      runMirrorTest(
        (sign) => buildEngine(sign),
        () => derive('sign'),
        {
          burnInTicks: { min: 100, max: 400 },
          compareTicks: 10,
          interior: derive('interior-fixed'),
        },
      ).snapshotAt;
    const first = draw();
    expect(first).toBeGreaterThanOrEqual(100);
    expect(first).toBeLessThanOrEqual(400);
    expect(draw()).toBe(first);
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
      burnInTicks: INTERIOR,
      compareTicks: 5_000,
      interior: derive('interior'),
    });
    expect(result.divergences, `snapshot at ${result.snapshotAt}`).toEqual([]);
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
      burnInTicks: INTERIOR,
      compareTicks: 5_000,
      interior: derive('interior'),
    });
    expect(result.divergences, `snapshot at ${result.snapshotAt}`).toEqual([]);
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
    // battery cannot see: volatility keyed to the absolute price. This is
    // round-number support and resistance — volatility halves at every
    // multiple of 1,000 lattice steps and peaks halfway between — the mechanism
    // ADR-0003 §4 bans by name, and Cycle Audit 7's plant 20: planted in
    // `engine.ts` it passed 19 of 19 shipped tests under the from-the-origin
    // harness, because the field is symmetric about zero.
    //
    // **Cycle Audit 7, a3-02.** The previous version of this plant stored the
    // price in its own snapshot, so the harness saw `p` against `-p` as a
    // latent-state difference and the test passed without ever observing a
    // mis-negated increment. The plant now persists only what a real layer
    // would, and the assertion is on the increment.
    class LevelAnchoredModel implements MagnitudeModel {
      #price = 0;

      constructor(private readonly inner: MagnitudeModel) {}

      observePrice(price: number): void {
        this.#price = price;
      }

      advance(context: MagnitudeContext): number {
        const distanceToRound = Math.abs((((this.#price % 1_000) + 1_000) % 1_000) - 500);
        return this.inner.advance(context) * (1.5 - distanceToRound / 500);
      }

      snapshot(): unknown {
        return { inner: this.inner.snapshot() };
      }

      restore(state: unknown): void {
        const typed = state as { inner: unknown };
        this.inner.restore(typed.inner);
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
    // Detected as what it is. A latent-state divergence here would mean the
    // plant's bookkeeping was caught rather than its mechanism.
    expect(result.divergences[0]?.kind).toBe('increment');
    expect(result.divergences.some((d) => d.kind === 'increment')).toBe(true);
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

/**
 * Cycle Audit 8 (a1): the window sentence in `mirror.ts` is a measurement.
 *
 * That docstring converts the window every caller runs into market time, and
 * both halves of the conversion rot from opposite directions. The market times
 * read "under an hour" and "about eleven hours" for a cycle after PH-24.17
 * divided the catalogue's tempo — a fixed window in ticks buys less market time
 * when a tick is worth less. The tick bounds then read "10,000 and 120,000"
 * while the largest window any caller ran was 60,300 and the smallest 950.
 *
 * Nothing noticed either, because prose about a precondition is exactly the
 * thing no test reads. This one reads it: it takes the two tick bounds and the
 * two market times out of the paragraph and recomputes them from
 * `ASSET_CATALOGUE` and from the callers' own literals.
 */
describe('the window paragraph in mirror.ts still describes this repository', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '../../..');
  /** The docstring as one line: a claim must not escape a guard by wrapping. */
  const flat = (source: string): string => source.replace(/\n \* ?/g, ' ');
  const doc = flat(readFileSync(path.join(here, 'mirror.ts'), 'utf8'));

  /**
   * Every file that calls `runMirrorTest`, found by searching for the call.
   *
   * The first version of this guard listed three files in `packages/engine` and
   * was blind to the three in `tools/sim` — including `sampledCatalogue`, which
   * holds the widest window in the repository. A guard that enumerates the
   * thing it is checking is a guard that stops checking when the thing grows,
   * which is the defect this whole paragraph is about.
   */
  const callers = (): { file: string; source: string }[] => {
    const found: { file: string; source: string }[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && entry.name !== 'mirror.ts') {
          const source = readFileSync(full, 'utf8');
          // The re-export in `index.ts` names it without calling it.
          if (/runMirrorTest\(/.test(source)) found.push({ file: full, source });
        }
      }
    };
    for (const root of ['packages', 'tools', 'apps']) walk(path.join(repoRoot, root));
    return found;
  };

  /**
   * The widest window a file runs, as `max(burn-in) + max(comparison)`.
   *
   * An upper bound rather than a pairing — mirror.test.ts's 60,000-tick burn-in
   * runs with a 300-tick comparison — and an upper bound is the right shape for
   * a claim that no caller reaches past a number.
   */
  const widestWindow = (source: string): number => {
    const num = (raw: string): number => Number(raw.replace(/_/g, ''));
    /** `const MIRROR_TICKS = 120_000`, so `MIRROR_TICKS / 2` resolves. */
    const constants = new Map<string, number>();
    for (const m of source.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*([\d_]+)\s*;/g))
      constants.set(m[1]!, num(m[2]!));
    const value = (raw: string): number | null => {
      const text = raw.trim();
      if (/^[\d_]+$/.test(text)) return num(text);
      const arithmetic = /^([A-Z_][A-Z0-9_]*)\s*([*/])\s*([\d_]+)$/.exec(text);
      if (arithmetic && constants.has(arithmetic[1]!)) {
        const base = constants.get(arithmetic[1]!)!;
        return arithmetic[2] === '/' ? base / num(arithmetic[3]!) : base * num(arithmetic[3]!);
      }
      return constants.get(text) ?? null;
    };

    const burnIn: number[] = [];
    const compare: number[] = [];
    // `const INTERIOR = { min: N, max: M }` — passed as `burnInTicks: INTERIOR`.
    for (const m of source.matchAll(/const\s+\w+\s*=\s*\{\s*min:\s*([\d_]+),\s*max:\s*([\d_]+)/g))
      burnIn.push(num(m[2]!));
    for (const m of source.matchAll(/burnInTicks:\s*([^,\n}]+)/g)) {
      const resolved = value(m[1]!);
      if (resolved !== null) burnIn.push(resolved);
    }
    for (const m of source.matchAll(/compareTicks:\s*([^,\n}]+)/g)) {
      const resolved = value(m[1]!);
      if (resolved !== null) compare.push(resolved);
    }
    // `for (const burnInTicks of [700, 9_000, 35_000])`.
    for (const m of source.matchAll(/const burnInTicks of \[([^\]]*)\]/g))
      for (const raw of m[1]!.split(',')) burnIn.push(num(raw.trim()));
    if (burnIn.length === 0 || compare.length === 0) return 0;
    return Math.max(...burnIn) + Math.max(...compare);
  };

  it('finds every caller, including the ones outside this package', () => {
    const files = callers().map(({ file }) => path.relative(repoRoot, file));
    // Named because a search that silently found nothing would pass everything
    // below: these three hold the widest windows and were missed once already.
    for (const expected of [
      'tools/sim/src/sampledCatalogue.stat.test.ts',
      'tools/sim/src/multiAsset.stat.test.ts',
      'tools/sim/src/phaseAcceptance.stat.test.ts',
      'packages/engine/src/productionComposition.test.ts',
    ]) {
      expect(files, `the search no longer finds ${expected}`).toContain(expected);
    }
  });

  it('states the ceiling the callers actually reach, in ticks', () => {
    const stated = /reaches past ([\d_]+) ticks/.exec(doc);
    expect(stated, 'the window paragraph no longer states a ceiling in ticks').not.toBeNull();
    const windows = callers().map(({ file, source }) => ({
      file: path.relative(repoRoot, file),
      ticks: widestWindow(source),
    }));
    const widest = windows.reduce((a, b) => (b.ticks > a.ticks ? b : a));
    expect(
      Number(stated![1]),
      `the widest caller window is ${String(widest.ticks)} ticks, in ${widest.file}`,
    ).toBe(widest.ticks);

    // And the production composition's own window, which the paragraph quotes
    // because it is the one that guards the shipped factory.
    const production = windows.find((w) => w.file.endsWith('productionComposition.test.ts'))!;
    const quoted = /production'` — runs ([\d_]+)/.exec(doc);
    expect(quoted, 'the paragraph no longer quotes the production window').not.toBeNull();
    expect(Number(quoted![1]), `productionComposition runs ${String(production.ticks)}`).toBe(
      production.ticks,
    );
  });

  /**
   * ADR-0003 §6 states the same window in the same market time, and it is the
   * copy a reader reaches first. Cycle Audit 8 (a1) found both stale together —
   * so both are checked together, against the same catalogue.
   */
  it('ADR-0003 §6 states the same window and the same market time', () => {
    // Markdown wraps on plain newlines, so a claim spans lines here too.
    const adr = readFileSync(
      path.join(repoRoot, 'docs/decisions/ADR-0003-conditional-sign-symmetry.md'),
      'utf8',
    ).replace(/\s+/g, ' ');
    const widest = Math.max(...callers().map(({ source }) => widestWindow(source)));
    const stated = /(\d[\d,]*) ticks is \*\*([\d.]+) hours\*\*/.exec(adr);
    expect(stated, 'ADR-0003 no longer converts its widest window into hours').not.toBeNull();
    expect(Number(stated![1]!.replace(/,/g, '')), 'ADR-0003 quotes a window no caller runs').toBe(
      widest,
    );

    const measured = ASSET_CATALOGUE.find((a) => a.definition.id === 'btcusd')!.evidence
      .meanIntervalMs;
    const hours = (widest * measured) / 3_600_000;
    expect(
      Math.abs(hours - Number(stated![2])) / hours,
      `the widest window is ${hours.toFixed(2)} h at ${measured.toFixed(1)} ms a tick`,
    ).toBeLessThan(0.1);

    const narrow =
      /the ([\d,]+) of .productionComposition\.test\.ts. is \*\*([\d.]+) minutes\*\*/.exec(adr);
    expect(narrow, 'ADR-0003 no longer converts the production window into minutes').not.toBeNull();
    const minutes = (Number(narrow![1]!.replace(/,/g, '')) * measured) / 60_000;
    expect(
      Math.abs(minutes - Number(narrow![2])) / minutes,
      `the production window is ${minutes.toFixed(1)} min`,
    ).toBeLessThan(0.1);
  });

  it('converts those ticks into market time at the catalogue’s own tempo', () => {
    const interval = /mean interval of (\d+) ms/.exec(doc);
    expect(interval, 'the paragraph no longer names the interval it converts with').not.toBeNull();
    const btcusd = ASSET_CATALOGUE.find((a) => a.definition.id === 'btcusd')!;
    const measured = btcusd.evidence.meanIntervalMs;
    expect(
      Math.round(measured),
      'the paragraph converts at an interval the catalogue no longer records',
    ).toBe(Number(interval![1]));

    const stated = /about ([\d.]+) minutes at the narrow end and ([\d.]+) hours/.exec(doc);
    expect(stated, 'the paragraph no longer states both ends in market time').not.toBeNull();
    const narrow = Number(/production'` — runs ([\d_]+)/.exec(doc)![1]);
    const wide = Number(/reaches past ([\d_]+) ticks/.exec(doc)![1]);
    const minutes = (narrow * measured) / 60_000;
    const hours = (wide * measured) / 3_600_000;
    // A tenth, not an order of magnitude: PH-24.17 moved these figures by a
    // factor of three to six and the prose covered it for a whole cycle.
    expect(
      Math.abs(minutes - Number(stated![1])) / minutes,
      `the narrow end is ${minutes.toFixed(1)} min at ${measured.toFixed(1)} ms a tick`,
    ).toBeLessThan(0.1);
    expect(
      Math.abs(hours - Number(stated![2])) / hours,
      `the wide end is ${hours.toFixed(2)} h at ${measured.toFixed(1)} ms a tick`,
    ).toBeLessThan(0.1);
  });
});
