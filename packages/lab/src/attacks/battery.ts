import { epochMillis } from '@otc/core';
import { assessEconomics, PAYOUT_PROMOTIONAL, profitabilityThresholdPoints } from '../economics.js';
import { BINARY_HORIZONS, type HorizonSpec } from '../horizons.js';
import { yieldToLoop, type ObserverDataset } from '../observer.js';
import { sampleOutcomes, type SamplingOptions } from '../outcomes.js';
import {
  benjaminiHochberg,
  binomialProportionTest,
  minimumDetectableEffect,
  normalQuantile,
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
  /** Reproduces on a held-out confirmation split, with the same sign. */
  readonly confirmed: boolean;
  /** Edge measured on the confirmation split, in percentage points. */
  readonly confirmationEdgePoints: number;
  readonly confirmationSamples: number;
  /** Significant, material AND confirmed. This is what the gate turns on. */
  readonly exploitable: boolean;
  readonly expectedValueAtTightestPayout: number;
}

export interface HorizonSensitivity {
  readonly horizon: string;
  readonly samples: number;
  /**
   * Smallest detectable deviation from a fair coin, in percentage points, for
   * **one** test of the whole decided sample at α = 0.05 and 80% power.
   *
   * This is the classical figure, and it is not the gate's. The gate corrects
   * over the whole hypothesis surface, requires the finding to reproduce on a
   * held-out split, and tests buckets rather than the whole sample; see
   * {@link gateMinimumDetectableEffectPoints} for what it can actually see.
   */
  readonly minimumDetectableEffectPoints: number;
  /** Whether that single-test sensitivity is finer than the payout threshold. */
  readonly sufficientForPayout: boolean;
  /**
   * The edge at which the largest bucket tested at this horizon reaches **both**
   * the Benjamini–Hochberg threshold over this run's whole surface and the
   * confirmation threshold on its held-out split — at 50% power, in percentage
   * points. This is the smallest edge the gate could have turned on.
   *
   * **Out-of-band audit, a4-01.** The quoted figure above is for a test the
   * battery did not run. Over ~750 hypotheses the first BH rejection needs
   * `|z| ≥ Φ⁻¹(1 − q/2m) ≈ 3.99`, the largest bucket any conditioning family
   * offers is about half the sample, and confirmation needs `|z| > 1.96` on a
   * quarter of the data — so a coin re-signed at a realised 0.23pp at 30 s,
   * "detectable" by the single-test figure, produced no significant 30-second
   * hypothesis at all. Computed as
   * `max(z_BH·√(0.25/n_bucket), 1.96·√(0.25/n_confirmation))`, with `n_bucket`
   * the largest occupancy actually tested here and `n_confirmation` that
   * bucket's confirmation occupancy; infinite when nothing at this horizon
   * could have been confirmed. It is a 50%-power point where the figure above
   * is an 80%-power one, so on a small surface (few hypotheses, `z_BH` near 2)
   * the two can cross; on the calibration surface `z_BH ≈ 4` and the gate
   * figure is well above the single-test one.
   */
  readonly gateMinimumDetectableEffectPoints: number;
  /** Whether the gate figure is finer than the payout threshold. */
  readonly gateSufficientForPayout: boolean;
  /** Occupancy of the largest bucket actually tested at this horizon. */
  readonly largestBucketSamples: number;
  /** That bucket's occupancy on the confirmation split. */
  readonly largestBucketConfirmationSamples: number;
}

export interface VerdictCoverage {
  readonly families: number;
  readonly featureKinds: readonly FeatureKind[];
  readonly horizons: number;
  readonly hypothesesTested: number;
  /** Buckets that received entries, but fewer decided ones than the floor. */
  readonly bucketsSkippedForOccupancy: number;
  /**
   * Buckets that received no entry at all — a gap in the sampling grid or a
   * bucket the family never produces, not sample scarcity.
   *
   * **Out-of-band audit, a4-02.** These were counted with the under-occupied
   * buckets, so a verdict described a family that had never been given a
   * phase to test as one that lacked samples for it.
   */
  readonly bucketsNeverVisited: number;
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
  /**
   * Fraction of the dataset at which evaluation ends and confirmation begins.
   * Default 0.75, giving a 40/35/25 training/evaluation/confirmation split.
   */
  readonly confirmationFraction?: number;
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

/** What a horizon's sensitivity is computed from, gathered while its buckets run. */
interface HorizonPower {
  readonly label: string;
  readonly decided: number;
  largestBucket: number;
  largestBucketConfirmation: number;
}

/**
 * The z a finding must reach on its confirmation split, with the same sign, to
 * count as reproduced: a two-sided 5% test on its own terms.
 */
const CONFIRMATION_Z = 1.96;

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
  const confirmationFraction = options.confirmationFraction ?? 0.75;
  if (!(confirmationFraction > trainingFraction && confirmationFraction < 1)) {
    throw new RangeError(
      `confirmationFraction must lie in (trainingFraction, 1), received ${confirmationFraction}.`,
    );
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

  // A held-out confirmation split.
  //
  // Benjamini-Hochberg controls the false discovery rate at q, which means a
  // clean market produces a spurious finding on roughly q of all runs. Measured
  // directly: a provably symmetric Gaussian walk yielded one "exploitable"
  // finding out of 564 hypotheses. A gate that fires on one run in twenty of a
  // healthy engine is a gate the project learns to ignore.
  //
  // A real leak reproduces on fresh data; a false discovery does not. Requiring
  // both cuts the false-positive rate by more than an order of magnitude while
  // costing almost nothing in power against a genuine edge.
  const confirmationStartIndex = Math.floor(dataset.tickCount * confirmationFraction);
  const confirmationStartInstant = dataset.instants[confirmationStartIndex]!;
  const confirmationWarmupMs = confirmationStartInstant - dataset.firstInstant;

  // The threshold an edge must clear to be worth exploiting. At the promotional
  // 99% payout this is 0.25 percentage points; at 85% it is 4.05.
  const materialityPoints = profitabilityThresholdPoints(payout);

  const raw: Omit<AttackFinding, 'significant' | 'exploitable'>[] = [];
  const power: HorizonPower[] = [];
  let bucketsSkippedForOccupancy = 0;
  let bucketsNeverVisited = 0;
  // A bucket needs this many decided confirmation outcomes to be confirmable.
  const minimumConfirmationSamples = Math.max(50, minimumBucketSamples / 4);

  // Families whose fit does not depend on the horizon are fitted once.
  for (const family of families) {
    if (family.fit !== undefined && family.horizonDependent !== true) {
      family.fit(frame, trainingEndIndex, horizons[0]!.durationMs);
    }
  }

  for (const horizon of horizons) {
    const sampling = sampleOutcomes(dataset, horizon.durationMs, {
      warmupMs,
      endInstant: epochMillis(confirmationStartInstant),
      ...options.sampling,
    });
    const confirmation = sampleOutcomes(dataset, horizon.durationMs, {
      warmupMs: confirmationWarmupMs,
      ...options.sampling,
    });
    if (sampling.decided === 0) {
      notes.push(`${horizon.label}: no decided outcomes in the evaluation split; skipped.`);
      continue;
    }
    const horizonPower: HorizonPower = {
      label: horizon.label,
      decided: sampling.decided,
      largestBucket: 0,
      largestBucketConfirmation: 0,
    };
    power.push(horizonPower);

    for (const family of families) {
      if (family.fit !== undefined && family.horizonDependent === true) {
        family.fit(frame, trainingEndIndex, horizon.durationMs);
      }

      const tally = (source: typeof sampling): { tallies: BucketTally[]; classified: number } => {
        const tallies: BucketTally[] = Array.from({ length: family.buckets }, () => ({
          up: 0,
          down: 0,
          ties: 0,
        }));
        let classified = 0;
        for (let s = 0; s < source.entryIndices.length; s += 1) {
          const entryIndex = source.entryIndices[s]!;
          const entryInstant = epochMillis(source.entryInstants[s]!);
          const bucket = family.bucket(frame, entryIndex, entryInstant);
          if (bucket === SKIP_BUCKET) continue;
          if (!Number.isInteger(bucket) || bucket < 0 || bucket >= family.buckets) {
            throw new RangeError(
              `Attack family ${family.name} returned bucket ${bucket}, outside [0, ${family.buckets}).`,
            );
          }
          const entry = tallies[bucket]!;
          const outcome = source.outcomes[s]!;
          if (outcome > 0) entry.up += 1;
          else if (outcome < 0) entry.down += 1;
          else entry.ties += 1;
          classified += 1;
        }
        return { tallies, classified };
      };

      const { tallies, classified } = tally(sampling);
      const { tallies: confirmationTallies } = tally(confirmation);

      if (classified === 0) {
        notes.push(`${family.name} @ ${horizon.label}: classified no entries; skipped.`);
        continue;
      }

      yield;

      for (let bucket = 0; bucket < family.buckets; bucket += 1) {
        const tallyEntry = tallies[bucket]!;
        const decided = tallyEntry.up + tallyEntry.down;
        if (decided + tallyEntry.ties === 0) {
          bucketsNeverVisited += 1;
          continue;
        }
        if (decided < minimumBucketSamples) {
          bucketsSkippedForOccupancy += 1;
          continue;
        }
        const test = binomialProportionTest(tallyEntry.up, decided);
        const economics = assessEconomics(test.proportion, payout);

        const confirmEntry = confirmationTallies[bucket]!;
        const confirmDecided = confirmEntry.up + confirmEntry.down;
        const confirmTest =
          confirmDecided > 0 ? binomialProportionTest(confirmEntry.up, confirmDecided) : null;
        const confirmEdge = confirmTest === null ? 0 : (confirmTest.proportion - 0.5) * 100;
        // Reproduces means: same direction, and significant on its own terms.
        const confirmed =
          confirmTest !== null &&
          confirmDecided >= minimumConfirmationSamples &&
          Math.sign(confirmEdge) === Math.sign(economics.edgePoints) &&
          Math.abs(confirmTest.z) > CONFIRMATION_Z;

        if (decided > horizonPower.largestBucket) {
          horizonPower.largestBucket = decided;
          horizonPower.largestBucketConfirmation = confirmDecided;
        }

        raw.push({
          family: family.name,
          featureKind: family.featureKind,
          conditioning: family.conditioning,
          horizon: horizon.label,
          bucket,
          samples: decided,
          ties: tallyEntry.ties,
          upRate: test.proportion,
          edgePoints: economics.edgePoints,
          z: test.z,
          pValue: test.pValue,
          material: Math.abs(economics.edgePoints) >= materialityPoints,
          confirmed,
          confirmationEdgePoints: confirmEdge,
          confirmationSamples: confirmDecided,
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
    return { ...f, significant, exploitable: significant && f.material && f.confirmed };
  });

  // The gate's own sensitivity, which needs the size of the surface it was
  // corrected over — so it is computed once every horizon has run (a4-01).
  const zGate =
    raw.length === 0 ? Number.NaN : normalQuantile(1 - falseDiscoveryRate / (2 * raw.length));
  const sensitivity: HorizonSensitivity[] = power.map((h) => {
    const mde = minimumDetectableEffect(h.decided) * 100;
    const confirmable =
      h.largestBucket > 0 && h.largestBucketConfirmation >= minimumConfirmationSamples;
    const gate = confirmable
      ? Math.max(
          zGate * Math.sqrt(0.25 / h.largestBucket),
          CONFIRMATION_Z * Math.sqrt(0.25 / h.largestBucketConfirmation),
        ) * 100
      : Number.POSITIVE_INFINITY;
    return {
      horizon: h.label,
      samples: h.decided,
      minimumDetectableEffectPoints: mde,
      sufficientForPayout: mde < materialityPoints,
      gateMinimumDetectableEffectPoints: gate,
      gateSufficientForPayout: gate < materialityPoints,
      largestBucketSamples: h.largestBucket,
      largestBucketConfirmationSamples: h.largestBucketConfirmation,
    };
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
  if (bucketsNeverVisited > 0) {
    notes.push(
      `${bucketsNeverVisited} buckets received no entry at all and were not tested. That is a ` +
        'gap in what was sampled, not a shortage of samples: the family never saw that condition.',
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
  const gateInsufficient = sensitivity.filter((s) => !s.gateSufficientForPayout);
  if (gateInsufficient.length > 0) {
    notes.push(
      `The gate itself — one correction over ${raw.length} hypotheses, plus confirmation — ` +
        `could not have turned on an edge below ${materialityPoints.toFixed(2)}pp at: ` +
        `${gateInsufficient.map((s) => s.horizon).join(', ')}. The single-test floor is not the gate's.`,
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
      bucketsNeverVisited,
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
    await yieldToLoop();
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
        `(edge ${w.edgePoints >= 0 ? '+' : ''}${w.edgePoints.toFixed(3)}pp, n=${w.samples}, ` +
        `confirmation edge ${w.confirmationEdgePoints >= 0 ? '+' : ''}${w.confirmationEdgePoints.toFixed(3)}pp)`,
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
  lines.push(
    '  sensitivity: MDE is one test of the full sample at 80% power; gate MDE is the edge at ' +
      'which the largest tested bucket (n_eval/n_confirmation) reaches the corrected and ' +
      'confirmation thresholds, at 50% power',
  );
  for (const s of verdict.sensitivity) {
    const gate = Number.isFinite(s.gateMinimumDetectableEffectPoints)
      ? `${s.gateMinimumDetectableEffectPoints.toFixed(3)}pp`
      : 'unconfirmable';
    lines.push(
      `    ${s.horizon.padStart(4)}: n=${String(s.samples).padStart(8)} ` +
        `MDE=${s.minimumDetectableEffectPoints.toFixed(3)}pp${s.sufficientForPayout ? '' : ' (coarser than the payout threshold)'} ` +
        `| gate MDE=${gate} at n=${s.largestBucketSamples}/${s.largestBucketConfirmationSamples}` +
        `${s.gateSufficientForPayout ? '' : ' (coarser than the payout threshold)'}`,
    );
  }
  for (const note of verdict.notes) lines.push(`  note: ${note}`);
  return lines.join('\n');
}
