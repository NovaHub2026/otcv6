import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type InstrumentSpec } from '@otc/core';
import { fixtureByName } from '@otc/fixtures';
import { PAYOUT_PROMOTIONAL, profitabilityThresholdPoints } from '../economics.js';
import { horizonByLabel } from '../horizons.js';
import { datasetFromTicks, type ObserverDataset } from '../observer.js';
import { auditLookAhead } from './audit.js';
import { defaultFamilies, formatVerdict, runBattery } from './battery.js';
import { buildFeatureFrame, type FeatureFrame } from './frame.js';
import { LogisticAttackFamily } from './learned.js';
import { ATTACK_FAMILIES, familiesOfKind, familyByName, SWEPT_CELL_WIDTHS } from './registry.js';
import { FEATURE_KINDS, SKIP_BUCKET, type AttackFamily } from './types.js';

const instrument: InstrumentSpec = {
  id: 'batt-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

function controlDataset(ticks: number): ObserverDataset {
  const source = fixtureByName('symmetricControl').create({
    instrument,
    keyring: MasterKeyring.forTesting('battery-spec'),
    env: 'test',
    ticks,
    startInstant: epochMillis(1_776_000_000_000),
    meanIntervalMs: 1_000,
    strength: 0,
  });
  const list = [];
  for (;;) {
    const tick = source.next();
    if (tick === null) break;
    list.push(tick);
  }
  return datasetFromTicks(instrument, list);
}

const dataset = controlDataset(80_000);

describe('registry coverage', () => {
  it('covers every feature kind', () => {
    // The question "what does this battery not condition on?" must be
    // answerable by reading the registry.
    const families = defaultFamilies();
    const kinds = new Set(families.map((f) => f.featureKind));
    for (const kind of FEATURE_KINDS) {
      expect(kinds.has(kind), `missing ${kind}`).toBe(true);
    }
  });

  it('includes level-anchored families, which conventional batteries omit', () => {
    const level = familiesOfKind('level-anchored');
    expect(level.length).toBeGreaterThanOrEqual(SWEPT_CELL_WIDTHS.length + 1);
    expect(level.map((f) => f.name)).toContain('absolute-price-level');
    expect(level.map((f) => f.name)).toContain('price-modulo-4000');
  });

  it('gives every family a name, a description and a stated conditioning', () => {
    for (const family of defaultFamilies()) {
      expect(family.name.length).toBeGreaterThan(3);
      expect(family.description.length).toBeGreaterThan(20);
      expect(family.conditioning.length).toBeGreaterThan(10);
      expect(family.buckets).toBeGreaterThanOrEqual(2);
    }
  });

  it('has unique family names', () => {
    const names = defaultFamilies().map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('rejects an unknown family name', () => {
    expect(() => familyByName('nope')).toThrow(RangeError);
    expect(familyByName('previous-move').featureKind).toBe('translation-invariant');
  });
});

describe('no family looks ahead', () => {
  it('every registered family gives the same bucket without the future', () => {
    const offenders = auditLookAhead(ATTACK_FAMILIES, dataset);
    expect(offenders).toEqual([]);
  });

  it('the learned family gives the same bucket without the future', () => {
    const learned = new LogisticAttackFamily();
    learned.fit(buildFeatureFrame(dataset), Math.floor(dataset.tickCount * 0.4), 60_000);
    expect(learned.fitted).toBe(true);
    expect(auditLookAhead([learned], dataset)).toEqual([]);
  });

  it('the audit catches a deliberately peeking family', () => {
    // Without this the audit could be vacuous: a check that never fails proves
    // nothing about the checks that pass.
    const peeking: AttackFamily = {
      name: 'peeking',
      featureKind: 'translation-invariant',
      conditioning: 'the next tick, which it must not see',
      description: 'Deliberately looks one tick into the future, to prove the audit works.',
      buckets: 2,
      bucket: (frame: FeatureFrame, entryIndex: number) => {
        if (entryIndex + 1 >= frame.prices.length) return SKIP_BUCKET;
        return frame.prices[entryIndex + 1]! > frame.prices[entryIndex]! ? 1 : 0;
      },
    };
    const offenders = auditLookAhead([peeking], dataset);
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders[0]!.family).toBe('peeking');
  });
});

// Harness behaviour is tested against a small, cheap family set: the point is
// the harness, not the families, and the learned family alone costs seconds.
const HARNESS_FAMILIES = [
  familyByName('previous-move'),
  familyByName('second-of-minute'),
  familyByName('price-modulo-4000'),
];
const HARNESS_OPTIONS = { families: HARNESS_FAMILIES, minimumBucketSamples: 200 };

/**
 * A two-horizon subset.
 *
 * These tests exercise the harness's bookkeeping — splitting, occupancy,
 * correction, verdict assembly — none of which depends on how many horizons
 * run. The full eight-horizon sweep belongs to the statistical calibration
 * suite, and running it here took nearly three seconds: fine alone, a timeout
 * under a parallel suite. A unit test that fails only under load erodes the gate
 * it belongs to.
 */
const FAST_OPTIONS = {
  ...HARNESS_OPTIONS,
  horizons: [horizonByLabel('30s'), horizonByLabel('1m')],
};

describe('the verdict', () => {
  it('is clean on the control', () => {
    const verdict = runBattery(dataset, FAST_OPTIONS);
    expect(verdict.clean).toBe(true);
    expect(verdict.exploitable).toEqual([]);
    // Three families over two horizons, less the buckets that miss the
    // occupancy floor.
    expect(verdict.coverage.hypothesesTested).toBeGreaterThanOrEqual(8);
  });

  it('reports sensitivity per horizon, computed from the sample count', () => {
    const verdict = runBattery(dataset, FAST_OPTIONS);
    expect(verdict.sensitivity.length).toBeGreaterThan(0);
    for (const s of verdict.sensitivity) {
      expect(s.minimumDetectableEffectPoints).toBeGreaterThan(0);
      expect(s.samples).toBeGreaterThan(0);
    }
    // Shorter horizons yield more independent samples, so a finer floor.
    const first = verdict.sensitivity[0]!;
    const last = verdict.sensitivity[verdict.sensitivity.length - 1]!;
    expect(first.minimumDetectableEffectPoints).toBeLessThan(last.minimumDetectableEffectPoints);
  });

  it('separates statistical significance from economic materiality', () => {
    const verdict = runBattery(dataset, { ...FAST_OPTIONS, payout: PAYOUT_PROMOTIONAL });
    const threshold = profitabilityThresholdPoints(PAYOUT_PROMOTIONAL);
    expect(threshold).toBeCloseTo(0.2513, 4);
    let materialSeen = 0;
    for (const finding of verdict.findings) {
      expect(finding.material).toBe(Math.abs(finding.edgePoints) >= threshold);
      expect(finding.exploitable).toBe(
        finding.significant && finding.material && finding.confirmed,
      );
      if (finding.material) materialSeen += 1;
    }
    // On a fair market, findings that clear the economic threshold by chance are
    // expected and harmless: none of them survives the correction.
    expect(materialSeen).toBeGreaterThan(0);
    expect(verdict.exploitable).toEqual([]);
  });

  it('gates on the intersection, not on significance alone', () => {
    // At a payout of 1.0 the breakeven is exactly 0.5, so every finding is
    // material and the gate reduces to statistical significance.
    const strict = runBattery(dataset, { ...FAST_OPTIONS, payout: 1 });
    for (const finding of strict.findings) {
      expect(finding.material).toBe(true);
      expect(finding.exploitable).toBe(finding.significant && finding.confirmed);
    }
  });

  it('skips under-occupied buckets rather than testing them', () => {
    const verdict = runBattery(dataset, {
      ...FAST_OPTIONS,
      minimumBucketSamples: 1_000_000,
    });
    expect(verdict.coverage.hypothesesTested).toBe(0);
    expect(verdict.coverage.bucketsSkippedForOccupancy).toBeGreaterThan(0);
    expect(verdict.notes.join(' ')).toContain('were not tested');
  });

  it('rejects an invalid training fraction', () => {
    expect(() => runBattery(dataset, { ...FAST_OPTIONS, trainingFraction: 0 })).toThrow(RangeError);
    expect(() => runBattery(dataset, { ...FAST_OPTIONS, trainingFraction: 1 })).toThrow(RangeError);
  });

  it('rejects a family returning an out-of-range bucket', () => {
    const broken: AttackFamily = {
      name: 'broken',
      featureKind: 'translation-invariant',
      conditioning: 'nothing coherent',
      description: 'Returns a bucket outside its declared range, which must not be tolerated.',
      buckets: 2,
      bucket: () => 7,
    };
    expect(() => runBattery(dataset, { families: [broken] })).toThrow(RangeError);
  });

  it('formats a readable summary', () => {
    const text = formatVerdict(runBattery(dataset, FAST_OPTIONS));
    expect(text).toContain('VERDICT:');
    expect(text).toContain('sensitivity:');
    expect(text).toContain('hypotheses across');
  });
});

describe('out-of-sample discipline', () => {
  it('evaluates only after the training split', () => {
    const trainingFraction = 0.4;
    const verdict = runBattery(dataset, { ...FAST_OPTIONS, trainingFraction });
    // Every horizon's sample count must be consistent with the evaluation span
    // alone, not the whole dataset.
    const evaluationMs =
      dataset.lastInstant - dataset.instants[Math.floor(dataset.tickCount * trainingFraction)]!;
    for (const s of verdict.sensitivity) {
      const horizonMs = horizonByLabel(s.horizon).durationMs;
      expect(s.samples, s.horizon).toBeLessThanOrEqual(Math.ceil(evaluationMs / horizonMs) + 1);
    }
  });

  it('a family fitted on training data still classifies evaluation entries', () => {
    const quantileFamily = familyByName('volatility-state');
    const frame = buildFeatureFrame(dataset);
    quantileFamily.fit!(frame, Math.floor(dataset.tickCount * 0.4), 60_000);
    const instant = epochMillis(dataset.instants[dataset.tickCount - 100]!);
    const bucket = quantileFamily.bucket(frame, dataset.tickCount - 100, instant);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(quantileFamily.buckets);
  });
});
