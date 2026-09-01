// Invariant evidence: INV-006 (no exploitable directional rules), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type Tick } from '@otc/core';
import { WITHHELD_FAMILY_NAMES } from './attacks/index.js';
import type { TickJournal } from './assurance.js';
import { BINARY_HORIZONS, horizonByLabel } from './horizons.js';
import {
  assertIndependentFamilies,
  assessHorizon,
  DEFAULT_STANDING_CADENCE_MS,
  isStandingRunDue,
  PRODUCT_MARGIN_PP,
  runStandingAssurance,
  StandingAssuranceError,
} from './standing.js';

const GENESIS = 1_776_000_000_000;
const ALL_FAMILIES = [...WITHHELD_FAMILY_NAMES, 'second-of-minute', 'run-length'];

/**
 * A fair random walk on the lattice, seeded.
 *
 * The keyring gives the same stream every run, so every number below is
 * reproducible. A statistical assertion that can fail randomly is a defect.
 */
function walk(ticks: number, seed: string, drift = 0): TickJournal {
  const source = MasterKeyring.forTesting(seed).derive({
    env: 'test',
    asset: 'standing',
    purpose: 'walk',
    keyEpoch: 0,
  });
  const out: Tick[] = [];
  let price = 0;
  for (let index = 0; index < ticks; index += 1) {
    // `drift` biases the coin. At 0 it is fair, which is what the engine
    // guarantees structurally; above 0 it is the leak this run must catch.
    price += source.nextFloat64() < 0.5 + drift ? 1 : -1;
    out.push({
      sequence: index + 1,
      instant: epochMillis(GENESIS + index * 1_000),
      price: logPrice(price),
    });
  }
  return { instrumentId: 'standing', logQuantum: 1e-5, ticks: out };
}

/**
 * A record whose blocks differ from each other: dependence, deliberately.
 *
 * The drift alternates sign every twelfth of the record, so each replicate block
 * has its own up-rate and the block-to-block variance is far above what
 * independence predicts. This is what a design effect is for, and `walk` — an
 * independent fair coin — cannot exercise it.
 */
function blockDrift(ticks: number, seed: string, amplitude: number): TickJournal {
  const source = MasterKeyring.forTesting(seed).derive({
    env: 'test',
    asset: 'standing',
    purpose: 'blocks',
    keyEpoch: 0,
  });
  const blockSize = Math.floor(ticks / 12);
  const out: Tick[] = [];
  let price = 0;
  for (let index = 0; index < ticks; index += 1) {
    const block = Math.floor(index / blockSize);
    const drift = block % 2 === 0 ? amplitude : -amplitude;
    price += source.nextFloat64() < 0.5 + drift ? 1 : -1;
    out.push({
      sequence: index + 1,
      instant: epochMillis(GENESIS + index * 1_000),
      price: logPrice(price),
    });
  }
  return { instrumentId: 'standing', logQuantum: 1e-5, ticks: out };
}

describe('the run refuses a verdict it could not stand behind', () => {
  it('refuses a family set missing a withheld family', () => {
    for (const dropped of WITHHELD_FAMILY_NAMES) {
      const partial = ALL_FAMILIES.filter((name) => name !== dropped);
      expect(() => assertIndependentFamilies(partial)).toThrow(StandingAssuranceError);
    }
  });

  it('refuses the tuning registry alone, however many families it holds', () => {
    // A clean result from the families the engine was shaped to survive is not
    // independent evidence of anything.
    expect(() =>
      assertIndependentFamilies(['second-of-minute', 'run-length', 'minute-of-hour']),
    ).toThrow(StandingAssuranceError);
  });

  it('accepts a set containing every withheld family', () => {
    expect(() => assertIndependentFamilies(ALL_FAMILIES)).not.toThrow();
    expect(() => assertIndependentFamilies([...WITHHELD_FAMILY_NAMES])).not.toThrow();
  });

  it('names what is missing, so an operator can fix it', () => {
    const error = (() => {
      try {
        assertIndependentFamilies(['second-of-minute']);
        return null;
      } catch (thrown) {
        return thrown as Error;
      }
    })();
    expect(error?.message).toContain('wh-arrival-gap');
  });

  it('refuses a history too short to measure', () => {
    expect(() =>
      runStandingAssurance({
        assetId: 'eurusd',
        journal: { instrumentId: 'x', logQuantum: 1e-5, ticks: [] },
        at: GENESIS,
        familyNames: ALL_FAMILIES,
      }),
    ).toThrow(StandingAssuranceError);
  });
});

describe('the floor is an output, not a constant', () => {
  const horizon = horizonByLabel('30s');

  it('is finer with more history', () => {
    const short = assessHorizon(walk(2_000, 'a'), horizon);
    const long = assessHorizon(walk(40_000, 'a'), horizon);
    expect(long.trials).toBeGreaterThan(short.trials);
    expect(long.detectionFloorPp).toBeLessThan(short.detectionFloorPp);
  });

  it('is coarser at a longer horizon on the same history', () => {
    // The same record yields fewer non-overlapping windows at 15 minutes than at
    // 30 seconds, so it can see less. This is PH-11's finding, restated by the
    // measurement itself rather than asserted.
    const journal = walk(40_000, 'a');
    const fast = assessHorizon(journal, horizonByLabel('30s'));
    const slow = assessHorizon(journal, horizonByLabel('15m'));
    expect(slow.trials).toBeLessThan(fast.trials);
    expect(slow.detectionFloorPp).toBeGreaterThan(fast.detectionFloorPp);
  });

  it('is infinite when nothing settled', () => {
    const flat: TickJournal = {
      instrumentId: 'x',
      logQuantum: 1e-5,
      ticks: Array.from({ length: 500 }, (_, i) => ({
        sequence: i + 1,
        instant: epochMillis(GENESIS + i * 1_000),
        price: logPrice(7),
      })),
    };
    const assessed = assessHorizon(flat, horizon);
    expect(assessed.trials).toBe(0);
    expect(assessed.detectionFloorPp).toBe(Number.POSITIVE_INFINITY);
    // No power at all is `undecided`. A record that never moved has not been
    // shown to be fair; it has not been measured.
    expect(assessed.outcome).toBe('undecided');
  });

  it('reads close to 1 on an independent record, which is what independence means', () => {
    const assessed = assessHorizon(walk(40_000, 'a'), horizon);
    expect(assessed.designEffect).toBeGreaterThan(0);
    expect(assessed.effectiveTrials).toBeLessThanOrEqual(assessed.trials);
  });

  it('sees dependence when it is there, and pays for it in the floor', () => {
    // `walk` is an independent fair coin, so its true design effect is ~1 and a
    // planted "assume independence" defect is invisible against it. This record
    // has real block-level heterogeneity — alternating drift — which is exactly
    // what a design effect exists to detect, and it must be paid for with a
    // coarser floor rather than a more confident one.
    const dependent = blockDrift(40_000, 'a', 0.12);
    const assessed = assessHorizon(dependent, horizon);
    expect(assessed.designEffect).toBeGreaterThan(3);
    expect(assessed.effectiveTrials).toBeLessThan(assessed.trials);

    const independent = assessHorizon(walk(40_000, 'a'), horizon);
    expect(assessed.trials).toBeGreaterThan(0);
    // Same amount of history, less information in it.
    expect(assessed.detectionFloorPp).toBeGreaterThan(independent.detectionFloorPp);
  });

  it.each([0, 2, 1.5])('refuses %s replicate blocks', (blocks) => {
    expect(() => assessHorizon(walk(1_000, 'a'), horizon, blocks)).toThrow(StandingAssuranceError);
  });
});

describe('three verdicts, and the third is the one that matters', () => {
  it('reports undecided on a young venue rather than clean', () => {
    // The single most misleading thing this system could say is `clean` from a
    // record with no power: indistinguishable from the same word after a year,
    // and it is the word a counterparty acts on.
    const verdict = runStandingAssurance({
      assetId: 'eurusd',
      journal: walk(600, 'a'),
      at: GENESIS,
      familyNames: ALL_FAMILIES,
    });
    expect(verdict.outcome).toBe('undecided');
    for (const horizon of verdict.horizons) {
      expect(horizon.detectionFloorPp).toBeGreaterThan(PRODUCT_MARGIN_PP);
    }
  });

  it('reports exploitable when the bias clears the floor, at any power', () => {
    // A short, heavily biased record: little power, and an edge large enough to
    // clear even a coarse floor. That is a finding whether or not the sample
    // could have seen a smaller one.
    const assessed = assessHorizon(walk(4_000, 'a', 0.25), horizonByLabel('30s'));
    expect(assessed.observedBiasPp).toBeGreaterThan(assessed.detectionFloorPp);
    expect(assessed.outcome).toBe('exploitable');
  });

  it('takes the worst outcome across horizons', () => {
    const verdict = runStandingAssurance({
      assetId: 'eurusd',
      journal: walk(4_000, 'a', 0.25),
      at: GENESIS,
      familyNames: ALL_FAMILIES,
    });
    // Some horizons will be undecided for want of windows; a venue is not clean
    // because most of it is, and it is not undecided when part of it is
    // exploitable.
    expect(verdict.outcome).toBe('exploitable');
  });

  it('never reports clean on a floor coarser than the product margin', () => {
    for (const ticks of [600, 1_200, 3_000]) {
      const verdict = runStandingAssurance({
        assetId: 'eurusd',
        journal: walk(ticks, 'b'),
        at: GENESIS,
        familyNames: ALL_FAMILIES,
      });
      for (const horizon of verdict.horizons) {
        if (horizon.outcome === 'clean') {
          expect(horizon.detectionFloorPp).toBeLessThanOrEqual(PRODUCT_MARGIN_PP);
        }
      }
    }
  });

  it('states the margin it is judging against', () => {
    // 0.2513pp: the bias that becomes profitable at the 99% promotional payout.
    expect(PRODUCT_MARGIN_PP).toBeCloseTo(0.2513, 3);
  });
});

describe('a verdict is a complete report', () => {
  const verdict = runStandingAssurance({
    assetId: 'eurusd',
    journal: walk(20_000, 'a'),
    at: GENESIS + 500,
    familyNames: ALL_FAMILIES,
  });

  it('names every horizon the product sells', () => {
    expect(verdict.horizons.map((h) => h.horizon)).toEqual(BINARY_HORIZONS.map((h) => h.label));
  });

  it('records what it was built from, so a reader can check the claim', () => {
    expect(verdict.families).toEqual(ALL_FAMILIES);
    for (const withheld of WITHHELD_FAMILY_NAMES) expect(verdict.families).toContain(withheld);
  });

  it('records the coverage it measured', () => {
    expect(verdict.ticks).toBe(20_000);
    expect(verdict.coveredMs).toBe(19_999 * 1_000);
    expect(verdict.at).toBe(GENESIS + 500);
  });

  it('carries a floor on every horizon', () => {
    for (const horizon of verdict.horizons) {
      expect(horizon.detectionFloorPp).toBeGreaterThan(0);
    }
  });
});

describe('the cadence is decided from an injected instant', () => {
  it('is due when nothing has run', () => {
    expect(isStandingRunDue(null, GENESIS)).toBe(true);
  });

  it('is not due before the cadence has elapsed', () => {
    expect(isStandingRunDue(GENESIS, GENESIS + DEFAULT_STANDING_CADENCE_MS - 1)).toBe(false);
  });

  it('is due exactly on the cadence', () => {
    expect(isStandingRunDue(GENESIS, GENESIS + DEFAULT_STANDING_CADENCE_MS)).toBe(true);
  });

  it('is daily', () => {
    expect(DEFAULT_STANDING_CADENCE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it.each([0, -1, Number.NaN])('refuses a cadence of %s', (cadence) => {
    expect(() => isStandingRunDue(GENESIS, GENESIS + 1, cadence)).toThrow(StandingAssuranceError);
  });

  it('refuses an unusable instant rather than guessing', () => {
    expect(() => isStandingRunDue(GENESIS, Number.NaN)).toThrow(StandingAssuranceError);
  });
});
