import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type RandomSource } from '@otc/core';
import type { MagnitudeContext } from './magnitude.js';
import {
  assertStructureConfig,
  DEFAULT_STRUCTURE,
  STRUCTURE_PHASES,
  StructurePhaseModulator,
  type StructureConfig,
} from './structure.js';

const keyring = MasterKeyring.forTesting('structure-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'structure', purpose, keyEpoch: 0 });

const context = (
  intervalMs: number,
  sequence: number,
  previousMagnitude: number,
): MagnitudeContext => ({
  intervalMs,
  previousMagnitude,
  instant: epochMillis(1_776_000_000_000 + sequence * intervalMs),
  sequence,
});

describe('configuration', () => {
  it('accepts the defaults', () => {
    expect(() => assertStructureConfig(DEFAULT_STRUCTURE)).not.toThrow();
  });

  it.each([
    ['a non-positive multiplier', { multiplier: 0 }],
    ['a non-positive base hazard', { baseHazardPerMs: 0 }],
    ['a non-positive age scale', { ageScaleMs: 0 }],
    ['the wrong number of transitions', { transitions: [1, 0] }],
    ['transitions that sum to zero', { transitions: [0, 0, 0, 0] }],
  ])('rejects %s', (_name, override) => {
    const broken = {
      ...DEFAULT_STRUCTURE,
      coil: { ...DEFAULT_STRUCTURE.coil, ...override },
    } as StructureConfig;
    expect(() => assertStructureConfig(broken)).toThrow(RangeError);
  });
});

describe('the phase chain', () => {
  it('visits every phase', () => {
    const modulator = new StructurePhaseModulator(DEFAULT_STRUCTURE, derive('visits'));
    const seen = new Set<string>();
    for (let i = 1; i <= 300_000; i += 1) {
      modulator.advance(context(1_000, i, 10));
      seen.add(modulator.phase);
    }
    expect([...seen].sort()).toEqual([...STRUCTURE_PHASES].sort());
  });

  it('returns the configured multiplier for the current phase', () => {
    const modulator = new StructurePhaseModulator(DEFAULT_STRUCTURE, derive('multiplier'));
    for (let i = 1; i <= 50_000; i += 1) {
      const before = modulator.phase;
      const multiplier = modulator.advance(context(1_000, i, 10));
      expect(multiplier).toBe(DEFAULT_STRUCTURE[before].multiplier);
    }
  });

  it('accumulates path length from magnitudes, never from signed moves', () => {
    // This is the property that lets the layer survive the mirror test.
    const modulator = new StructurePhaseModulator(DEFAULT_STRUCTURE, derive('path'));
    for (let i = 1; i <= 20; i += 1) modulator.advance(context(1_000, i, 7));
    expect(modulator.diagnostics.pathLength).toBeGreaterThan(0);
    expect(modulator.diagnostics.ageMs).toBeGreaterThan(0);
  });
});

describe('the hazard responds to compression', () => {
  /** Run a fixed number of ticks at a constant magnitude and count transitions. */
  function transitionsAt(previousMagnitude: number, purpose: string): number {
    const modulator = new StructurePhaseModulator(DEFAULT_STRUCTURE, derive(purpose), 'coil');
    let transitions = 0;
    let previous = modulator.phase;
    // Prime the running average at a high rate, so the tight case really is
    // tight relative to what came before.
    for (let i = 1; i <= 4_000; i += 1) modulator.advance(context(1_000, i, 40));
    for (let i = 4_001; i <= 60_000; i += 1) {
      modulator.advance(context(1_000, i, previousMagnitude));
      if (modulator.phase !== previous) {
        transitions += 1;
        previous = modulator.phase;
      }
    }
    return transitions;
  }

  it('a tighter coil leaves sooner than a loose one', () => {
    // A long, tight compression is more likely to resolve. The direction of the
    // resolution is a fresh coin, which is what makes half of them read as false
    // breakouts.
    const tight = transitionsAt(2, 'tight');
    const loose = transitionsAt(60, 'loose');
    expect(tight).toBeGreaterThan(loose);
  });

  it('uses only reflection-invariant inputs', () => {
    // Magnitudes are non-negative by construction, so there is no sign to read.
    // Feeding the same magnitudes must give the same trajectory regardless of
    // what the price did.
    const a = new StructurePhaseModulator(DEFAULT_STRUCTURE, derive('invariant'));
    const b = new StructurePhaseModulator(DEFAULT_STRUCTURE, derive('invariant'));
    for (let i = 1; i <= 5_000; i += 1) {
      expect(a.advance(context(1_000, i, 12))).toBe(b.advance(context(1_000, i, 12)));
    }
    expect(a.phase).toBe(b.phase);
  });
});

describe('phase durations are non-lattice', () => {
  it('does not phase-lock to the candle grid', () => {
    const modulator = new StructurePhaseModulator(DEFAULT_STRUCTURE, derive('lattice'));
    const instants: number[] = [];
    let previous = modulator.phase;
    let instant = 0;
    for (let i = 1; i <= 2_000_000; i += 1) {
      instant += 1_000;
      modulator.advance(context(1_000, i, 10));
      if (modulator.phase !== previous) {
        instants.push(instant);
        previous = modulator.phase;
      }
    }
    expect(instants.length).toBeGreaterThan(500);

    const grid = 60_000;
    const buckets = new Array<number>(10).fill(0);
    for (const t of instants) buckets[Math.floor(((t % grid) / grid) * 10)]! += 1;
    const expected = instants.length / 10;
    let chi = 0;
    for (const count of buckets) {
      const d = count - expected;
      chi += (d * d) / expected;
    }
    expect(chi, `chi2=${chi.toFixed(2)}`).toBeLessThan(27.88);
  });
});

describe('snapshot and restore', () => {
  it('reproduces a continuation exactly', () => {
    const modulator = new StructurePhaseModulator(DEFAULT_STRUCTURE, derive('snap'));
    for (let i = 1; i <= 20_000; i += 1) modulator.advance(context(1_000, i, 10));
    const state = modulator.snapshot();
    const expected = Array.from({ length: 500 }, (_, i) =>
      modulator.advance(context(1_000, i, 10)),
    );

    const restored = new StructurePhaseModulator(DEFAULT_STRUCTURE, derive('snap'));
    for (let i = 1; i <= 20_000; i += 1) restored.advance(context(1_000, i, 10));
    restored.restore(state);
    expect(Array.from({ length: 500 }, (_, i) => restored.advance(context(1_000, i, 10)))).toEqual(
      expected,
    );
  });

  it('rejects an unknown phase in a snapshot', () => {
    const modulator = new StructurePhaseModulator(DEFAULT_STRUCTURE, derive('bad'));
    expect(() =>
      modulator.restore({ phase: 'euphoria', ageMs: 0, pathLength: 0, averagePathRate: 0 }),
    ).toThrow(RangeError);
  });
});
