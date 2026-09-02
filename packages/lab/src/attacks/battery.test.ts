// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
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
import {
  ATTACK_FAMILIES,
  familiesOfKind,
  familyByName,
  SWEPT_CELL_WIDTHS,
  UNCONDITIONAL_FAMILY,
} from './registry.js';
import { normalQuantile } from '../statistics.js';
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
      // One bucket is the unconditional family (a4-01); everything else splits.
      expect(family.buckets).toBeGreaterThanOrEqual(family.name === 'unconditional' ? 1 : 2);
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
    // Two two-bucket families over two horizons, less any bucket that misses
    // the occupancy floor. `second-of-minute` no longer reaches it here: the
    // sweeping stride (a4-02) spreads its entries over all six sixths, which on
    // twenty-two hours of history is under two hundred each.
    expect(verdict.coverage.hypothesesTested).toBeGreaterThanOrEqual(6);
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

  it('tests the whole decided sample as one hypothesis per horizon, through the unconditional family', () => {
    // **Out-of-band audit, a4-01.** The quoted floor is computed from the whole
    // sample; until this family existed no hypothesis was tested at that n, so
    // a uniform edge — the smallest leak — was only ever seen through halves.
    const verdict = runBattery(dataset, {
      ...FAST_OPTIONS,
      families: [UNCONDITIONAL_FAMILY, ...HARNESS_FAMILIES],
    });
    for (const s of verdict.sensitivity) {
      const whole = verdict.findings.filter(
        (f) => f.family === 'unconditional' && f.horizon === s.horizon,
      );
      expect(whole, s.horizon).toHaveLength(1);
      expect(whole[0]!.bucket).toBe(0);
      expect(whole[0]!.samples).toBe(s.samples);
      expect(s.largestBucketSamples).toBe(s.samples);
      expect(s.largestBucketConfirmationSamples).toBe(whole[0]!.confirmationSamples);
    }
  });

  it('reports the gate sensitivity beside the single-test one, and derives it honestly', () => {
    // The gate MDE is the edge at which the largest tested bucket reaches both
    // the first Benjamini-Hochberg rejection over the whole surface and the
    // confirmation threshold, at 50% power. It is re-derived here from the
    // verdict's own counts (a4-01). It is not asserted above the single-test
    // figure: that one is at 80% power, and on a surface this small (a dozen
    // hypotheses, z_BH about 2.8) the two cross — on the calibration surface,
    // where z_BH is about 4, `gateSensitivity.stat.test.ts` measures the gap.
    const verdict = runBattery(dataset, {
      ...FAST_OPTIONS,
      families: [UNCONDITIONAL_FAMILY, ...HARNESS_FAMILIES],
    });
    const m = verdict.coverage.hypothesesTested;
    const zGate = normalQuantile(1 - 0.05 / (2 * m));
    expect(zGate).toBeGreaterThan(1.96);
    for (const s of verdict.sensitivity) {
      expect(s.largestBucketSamples).toBe(s.samples);
      const derived =
        Math.max(
          zGate * Math.sqrt(0.25 / s.largestBucketSamples),
          1.96 * Math.sqrt(0.25 / s.largestBucketConfirmationSamples),
        ) * 100;
      expect(s.gateMinimumDetectableEffectPoints).toBeCloseTo(derived, 10);
      expect(s.gateSufficientForPayout).toBe(s.gateMinimumDetectableEffectPoints < 0.2513);
    }
    expect(formatVerdict(verdict)).toContain('gate MDE=');
  });

  it('separates a bucket that was never visited from one that was under-occupied', () => {
    // **Out-of-band audit, a4-02.** Clock entries at `t0 + k*H` gave
    // `second-of-minute` one phase in six at every horizon of a minute or
    // more, and the verdict reported the other five as "held fewer than 500
    // decided outcomes" — a grid gap described as sample scarcity.
    const lopsided: AttackFamily = {
      name: 'lopsided',
      featureKind: 'translation-invariant',
      conditioning: 'a third bucket it never produces',
      description:
        'Declares three buckets and only ever returns the first two, to exercise the split.',
      buckets: 3,
      bucket: (_frame: FeatureFrame, entryIndex: number) => entryIndex % 2,
    };
    const verdict = runBattery(dataset, { ...FAST_OPTIONS, families: [lopsided] });
    expect(verdict.coverage.bucketsNeverVisited).toBe(FAST_OPTIONS.horizons.length);
    expect(verdict.coverage.bucketsSkippedForOccupancy).toBe(0);
    expect(verdict.notes.join(' ')).toContain('received no entry at all');
    expect(verdict.notes.join(' ')).not.toContain('held fewer than');

    // And the sweeping default stride visits every sixth of the minute at one
    // minute, where the horizon-as-stride default left five of six empty.
    const swept = runBattery(dataset, {
      ...FAST_OPTIONS,
      families: [familyByName('second-of-minute')],
      horizons: [horizonByLabel('1m')],
    });
    expect(swept.coverage.bucketsNeverVisited).toBe(0);
    const aliased = runBattery(dataset, {
      ...FAST_OPTIONS,
      families: [familyByName('second-of-minute')],
      horizons: [horizonByLabel('1m')],
      sampling: { strideMs: 60_000 },
    });
    expect(aliased.coverage.bucketsNeverVisited).toBe(5);
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
