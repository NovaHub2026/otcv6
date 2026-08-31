import { epochMillis } from '@otc/core';
import { assessEconomics, PAYOUT_PROMOTIONAL, profitabilityThresholdPoints } from '../economics.js';
import { BINARY_HORIZONS, type HorizonSpec } from '../horizons.js';
import type { ObserverDataset } from '../observer.js';
import { sampleOutcomes, type SamplingOptions } from '../outcomes.js';
import {
  benjaminiHochberg,
  binomialProportionTest,
  minimumDetectableEffect,
} from '../statistics.js';
import { buildFeatureFrame } from './frame.js';
import { ATTACK_FAMILIES } from './registry.js';
import { LogisticAttackFamily } from './learned.js';
import { SKIP_BUCKET, type AttackFamily, type FeatureKind } from './types.js';

/**
 * The battery: every family, over every horizon, with out-of-sample discipline
 * and one multiplicity correction over the whole surface.
 */

export interface AttackFinding {
  readonly family: string;
  readonly featureKind: FeatureKind;
  readonly conditioning: string;
  readonly horizon: string;
  readonly bucket: number;
  readonly samples: number;
  readonly ties: number;
  readonly upRate: number;
  readonly edgePoints: number;
  readonly z: number;
  readonly pValue: number;
  /** Survives Benjamini–Hochberg correction across the whole surface. */
  readonly significant: boolean;
  /** Clears the profitability threshold at the tightest payout. */
  readonly material: boolean;
  /** Both. This is what the gate turns on. */
  readonly exploitable: boolean;
  readonly expectedValueAtTightestPayout: number;
}

export interface HorizonSensitivity {
  readonly horizon: string;
  readonly samples: number;
  /** Smallest detectable deviation from a fair coin, in percentage points. */
  readonly minimumDetectableEffectPoints: number;
  /** Whether that sensitivity is finer than the payout threshold it must police. */
  readonly sufficientForPayout: boolean;
}

export interface VerdictCoverage {
  readonly families: number;
  readonly featureKinds: readonly FeatureKind[];
  readonly horizons: number;
  readonly hypothesesTested: number;
  readonly bucketsSkippedForOccupancy: number;
}

export interface Verdict {
  /** No finding is both statistically significant and economically material. */
  readonly clean: boolean;
  readonly findings: readonly AttackFinding[];
  readonly exploitable: readonly AttackFinding[];
  /** Largest |z| among tested findings, whether or not it is exploitable. */
  readonly worst: AttackFinding | null;
  /** Largest |edge| among tested findings. */
  readonly widestEdge: AttackFinding | null;
  readonly sensitivity: readonly HorizonSensitivity[];
  readonly coverage: VerdictCoverage;
  readonly notes: readonly string[];
  readonly elapsedSeconds: number;
}

export interface BatteryOptions {
  /** Fraction of the dataset reserved for fitting. Default 0.4. */
  readonly trainingFraction?: number;
  /** Minimum decided outcomes for a bucket to be tested at all. Default 500. */
  readonly minimumBucketSamples?: number;
  readonly falseDiscoveryRate?: number;
  /** Payout the materiality threshold is measured against. Default 0.99. */
  readonly payout?: number;
  readonly horizons?: readonly HorizonSpec[];
  readonly families?: readonly AttackFamily[];
  readonly sampling?: SamplingOptions;
}

interface BucketTally {
  up: number;
  down: number;
  ties: number;
}

export function defaultFamilies(): AttackFamily[] {
  return [...ATTACK_FAMILIES, new LogisticAttackFamily()];
}

/**
 * The battery as a generator, yielding at each family-horizon boundary.
 *
 * A full run is tens of seconds of uninterrupted synchronous work, which starves
 * everything else in the process — a progress reporter, a health check, a test
 * runner's own worker RPC — and the symptom is an unexplained timeout somewhere
 * unrelated. Expressing the pass as a generator lets the same code be driven
 * synchronously for a small dataset and cooperatively for a large one, with no
 * second implementation to keep in step.
 */
function* batteryCore(
  dataset: ObserverDataset,
  options: BatteryOptions = {},
): Generator<void, Verdict> {
  const trainingFraction = options.trainingFraction ?? 0.4;
  if (!(trainingFraction > 0 && trainingFraction < 1)) {
    throw new RangeError(`trainingFraction must lie in (0, 1), received ${trainingFraction}.`);
  }
  const minimumBucketSamples = options.minimumBucketSamples ?? 500;
  const falseDiscoveryRate = options.falseDiscoveryRate ?? 0.05;
  const payout = options.payout ?? PAYOUT_PROMOTIONAL;
  const horizons = options.horizons ?? BINARY_HORIZONS;
  const families = options.families ?? defaultFamilies();
  const notes: string[] = [];

  const started = process.hrtime.bigint();
  // Rolling features are computed once for the whole dataset and shared by every
  // family and horizon. Recomputing them per family was what limited the battery
  // to a few hundred thousand samples, and therefore to a detection floor
  // coarser than the threshold it exists to police.
  const frame = buildFeatureFrame(dataset);
  const trainingEndIndex = Math.floor(dataset.tickCount * trainingFraction);
  const evaluationStartInstant = dataset.instants[trainingEndIndex]!;
  const warmupMs = evaluationStartInstant - dataset.firstInstant;

  // The threshold an edge must clear to be worth exploiting. At the promotional
  // 99% payout this is 0.25 percentage points; at 85% it is 4.05.
  const materialityPoints = profitabilityThresholdPoints(payout);

  const raw: Omit<AttackFinding, 'significant' | 'exploitable'>[] = [];
  const sensitivity: HorizonSensitivity[] = [];
  let bucketsSkippedForOccupancy = 0;

  // Families whose fit does not depend on the horizon are fitted once.
  for (const family of families) {
    if (family.fit !== undefined && family.horizonDependent !== true) {
      family.fit(frame, trainingEndIndex, horizons[0]!.durationMs);
    }
  }

  for (const horizon of horizons) {
    const sampling = sampleOutcomes(dataset, horizon.durationMs, {
      warmupMs,
      ...options.sampling,
    });
    if (sampling.decided === 0) {
      notes.push(`${horizon.label}: no decided outcomes in the evaluation split; skipped.`);
      continue;
    }
    const mde = minimumDetectableEffect(sampling.decided) * 100;
    sensitivity.push({
      horizon: horizon.label,
      samples: sampling.decided,
      minimumDetectableEffectPoints: mde,
      sufficientForPayout: mde < materialityPoints,
    });

    for (const family of families) {
      if (family.fit !== undefined && family.horizonDependent === true) {
        family.fit(frame, trainingEndIndex, horizon.durationMs);
      }

      const tallies: BucketTally[] = Array.from({ length: family.buckets }, () => ({
        up: 0,
        down: 0,
        ties: 0,
      }));
      let classified = 0;

      for (let s = 0; s < sampling.entryIndices.length; s += 1) {
        const entryIndex = sampling.entryIndices[s]!;
        const entryInstant = epochMillis(sampling.entryInstants[s]!);
        const bucket = family.bucket(frame, entryIndex, entryInstant);
        if (bucket === SKIP_BUCKET) continue;
        if (!Number.isInteger(bucket) || bucket < 0 || bucket >= family.buckets) {
          throw new RangeError(
            `Attack family ${family.name} returned bucket ${bucket}, outside [0, ${family.buckets}).`,
          );
        }
        const tally = tallies[bucket]!;
        const outcome = sampling.outcomes[s]!;
        if (outcome > 0) tally.up += 1;
        else if (outcome < 0) tally.down += 1;
        else tally.ties += 1;
        classified += 1;
      }

      if (classified === 0) {
        notes.push(`${family.name} @ ${horizon.label}: classified no entries; skipped.`);
        continue;
      }

      yield;

      for (let bucket = 0; bucket < family.buckets; bucket += 1) {
        const tally = tallies[bucket]!;
        const decided = tally.up + tally.down;
        if (decided < minimumBucketSamples) {
          bucketsSkippedForOccupancy += 1;
          continue;
        }
        const test = binomialProportionTest(tally.up, decided);
        const economics = assessEconomics(test.proportion, payout);
        raw.push({
          family: family.name,
          featureKind: family.featureKind,
          conditioning: family.conditioning,
          horizon: horizon.label,
          bucket,
          samples: decided,
          ties: tally.ties,
          upRate: test.proportion,
          edgePoints: economics.edgePoints,
          z: test.z,
          pValue: test.pValue,
          material: Math.abs(economics.edgePoints) >= materialityPoints,
          expectedValueAtTightestPayout: economics.expectedValue,
        });
      }
    }
  }

  // One correction over the entire family x horizon x bucket surface. Correcting
  // per family and then taking the worst would reintroduce exactly the
  // multiplicity the correction removes.
  const correction = benjaminiHochberg(
    raw.map((f) => f.pValue),
    falseDiscoveryRate,
  );
  const significantIndices = new Set(correction.rejected);

  const findings: AttackFinding[] = raw.map((f, index) => {
    const significant = significantIndices.has(index);
    return { ...f, significant, exploitable: significant && f.material };
  });

  const exploitable = findings.filter((f) => f.exploitable);
  const worst = findings.reduce<AttackFinding | null>(
    (a, b) => (a === null || Math.abs(b.z) > Math.abs(a.z) ? b : a),
    null,
  );
  const widestEdge = findings.reduce<AttackFinding | null>(
    (a, b) => (a === null || Math.abs(b.edgePoints) > Math.abs(a.edgePoints) ? b : a),
    null,
  );

  if (bucketsSkippedForOccupancy > 0) {
    notes.push(
      `${bucketsSkippedForOccupancy} buckets held fewer than ${minimumBucketSamples} decided ` +
        'outcomes and were not tested. A bucket with a handful of samples cannot support a finding.',
    );
  }
  const insufficient = sensitivity.filter((s) => !s.sufficientForPayout);
  if (insufficient.length > 0) {
    notes.push(
      `Sensitivity is coarser than the ${(payout * 100).toFixed(0)}% payout threshold of ` +
        `${materialityPoints.toFixed(2)}pp at: ${insufficient.map((s) => s.horizon).join(', ')}. ` +
        'A clean verdict at those horizons means "no edge above the stated resolution", not "no edge".',
    );
  }

  return {
    clean: exploitable.length === 0,
    findings,
    exploitable,
    worst,
    widestEdge,
    sensitivity,
    coverage: {
      families: families.length,
      featureKinds: [...new Set(families.map((f) => f.featureKind))].sort(),
      horizons: horizons.length,
      hypothesesTested: raw.length,
      bucketsSkippedForOccupancy,
    },
    notes,
    elapsedSeconds: Number(process.hrtime.bigint() - started) / 1e9,
  };
}

/** Run the full battery synchronously. */
export function runBattery(dataset: ObserverDataset, options: BatteryOptions = {}): Verdict {
  const pass = batteryCore(dataset, options);
  for (;;) {
    const step = pass.next();
    if (step.done === true) return step.value;
  }
}

/**
 * Run the full battery, yielding to the event loop between family-horizon
 * passes. Use this for anything large enough to be worth measuring.
 */
export async function runBatteryAsync(
  dataset: ObserverDataset,
  options: BatteryOptions = {},
): Promise<Verdict> {
  const pass = batteryCore(dataset, options);
  for (;;) {
    const step = pass.next();
    if (step.done === true) return step.value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Human-readable summary of a verdict. */
export function formatVerdict(verdict: Verdict): string {
  const lines: string[] = [];
  lines.push(verdict.clean ? 'VERDICT: clean' : 'VERDICT: EXPLOITABLE');
  lines.push(
    `  ${verdict.coverage.hypothesesTested} hypotheses across ${verdict.coverage.families} families ` +
      `(${verdict.coverage.featureKinds.join(', ')}) and ${verdict.coverage.horizons} horizons ` +
      `in ${verdict.elapsedSeconds.toFixed(1)}s`,
  );
  if (verdict.worst !== null) {
    const w = verdict.worst;
    lines.push(
      `  worst z: ${w.z >= 0 ? '+' : ''}${w.z.toFixed(2)} — ${w.family} bucket ${w.bucket} @ ${w.horizon} ` +
        `(edge ${w.edgePoints >= 0 ? '+' : ''}${w.edgePoints.toFixed(3)}pp, n=${w.samples})`,
    );
  }
  for (const finding of verdict.exploitable.slice(0, 10)) {
    lines.push(
      `  EXPLOITABLE: ${finding.family} [${finding.featureKind}] bucket ${finding.bucket} @ ${finding.horizon} ` +
        `edge ${finding.edgePoints >= 0 ? '+' : ''}${finding.edgePoints.toFixed(3)}pp z=${finding.z.toFixed(2)} ` +
        `EV=${finding.expectedValueAtTightestPayout.toFixed(4)}`,
    );
  }
  if (verdict.exploitable.length > 10) {
    lines.push(`  ... and ${verdict.exploitable.length - 10} more exploitable findings`);
  }
  lines.push('  sensitivity:');
  for (const s of verdict.sensitivity) {
    lines.push(
      `    ${s.horizon.padStart(4)}: n=${String(s.samples).padStart(8)} ` +
        `MDE=${s.minimumDetectableEffectPoints.toFixed(3)}pp ${s.sufficientForPayout ? '' : '(coarser than the payout threshold)'}`,
    );
  }
  for (const note of verdict.notes) lines.push(`  note: ${note}`);
  return lines.join('\n');
}
