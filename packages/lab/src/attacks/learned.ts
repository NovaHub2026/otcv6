import { epochMillis, exp, ln, type EpochMillis } from '@otc/core';
import {
  bucketByThresholds,
  phaseWithinMinute,
  priceModulo,
  quantileThresholds,
} from './features.js';
import { RUN_CAP, type FeatureFrame } from './frame.js';
import { SKIP_BUCKET, type AttackFamily } from './types.js';

/**
 * A learned catch-all: regularised logistic regression over engineered features.
 *
 * The hand-written families each test one hypothesis about how a leak might look.
 * This one tests combinations nobody enumerated — an interaction between
 * volatility state and price-cell phase, say, that neither family sees alone.
 *
 * It is deliberately a simple, fully deterministic model rather than a strong
 * learner. PH-9 runs the independent red-team round with stronger models and
 * attack families withheld from all prior tuning, which is only meaningful if
 * some are genuinely reserved.
 *
 * **Trained on the training split, reported out-of-sample only.** A model scored
 * on its own training data will find structure in a fair coin.
 */

const WARMUP = 256;
const FEATURE_COUNT = 12;
// Sized for a twelve-parameter model. More rows and more iterations were
// measured and bought no additional detection, while making the battery too
// slow to run at the sample counts its own sensitivity report demands.
const MAX_TRAINING_SAMPLES = 40_000;
const ITERATIONS = 120;
const LEARNING_RATE = 0.35;
const L2 = 1e-4;

/**
 * Feature vector for an entry. Reads nothing beyond `entryIndex`.
 * Returns null when history is insufficient.
 */
function features(
  frame: FeatureFrame,
  entryIndex: number,
  entryInstant: EpochMillis,
): Float64Array | null {
  if (entryIndex < WARMUP) return null;
  const volatility = frame.volatility[entryIndex]!;
  const efficiency = frame.efficiency[entryIndex]!;
  const position = frame.rangePosition[entryIndex]!;
  if (!Number.isFinite(volatility) || volatility === 0) return null;
  if (!Number.isFinite(efficiency) || !Number.isFinite(position)) return null;

  const scaled = (lag: number): number => {
    // Normalised by the volatility of the same span, so the feature is a
    // z-score rather than a raw magnitude and stays comparable across regimes.
    const change = frame.prices[entryIndex]! - frame.prices[entryIndex - lag]!;
    return change / (volatility * Math.sqrt(lag));
  };

  const signedRun = frame.signedRun[entryIndex]!;
  const phase = phaseWithinMinute(entryInstant) / 60_000;
  const cellPhase = priceModulo(frame.prices[entryIndex]!, 4_000) / 4_000;

  const out = new Float64Array(FEATURE_COUNT);
  out[0] = scaled(1);
  out[1] = scaled(5);
  out[2] = scaled(15);
  out[3] = scaled(30);
  out[4] = scaled(60);
  out[5] = ln(volatility);
  out[6] = efficiency;
  out[7] = position - 0.5;
  out[8] = signedRun / RUN_CAP;
  // Triangle waves rather than sinusoids: the substrate bans non-portable
  // trigonometry, and a triangle carries the same phase information here.
  out[9] = 1 - 2 * Math.abs(2 * phase - 1);
  out[10] = 1 - 2 * Math.abs(2 * cellPhase - 1);
  out[11] = cellPhase - 0.5;
  return out;
}

function logistic(z: number): number {
  // Guarded against overflow at the tails.
  if (z >= 0) return 1 / (1 + exp(-z));
  const e = exp(z);
  return e / (1 + e);
}

export class LogisticAttackFamily implements AttackFamily {
  readonly name = 'learned-logistic';
  readonly featureKind = 'learned' as const;
  readonly conditioning =
    'regularised logistic regression over trailing returns, volatility, efficiency, ' +
    'range position, run length, clock phase and price-cell phase';
  readonly description =
    'A catch-all for combinations no hand-written family enumerates. Trained on the ' +
    'training split and scored out-of-sample only.';
  readonly buckets = 5;
  readonly horizonDependent = true;

  #weights: Float64Array = new Float64Array(FEATURE_COUNT);
  #bias = 0;
  #mean = new Float64Array(FEATURE_COUNT);
  #scale = new Float64Array(FEATURE_COUNT).fill(1);
  #thresholds: number[] = [];
  #fitted = false;

  fit(frame: FeatureFrame, trainingEndIndex: number, horizonMs: number): void {
    this.#fitted = false;
    const rows: Float64Array[] = [];
    const labels: number[] = [];

    const stride = Math.max(1, Math.floor((trainingEndIndex - WARMUP) / MAX_TRAINING_SAMPLES));
    for (let i = WARMUP; i <= trainingEndIndex; i += stride) {
      const entryInstant = epochMillis(frame.instants[i]!);
      const expiryInstant = entryInstant + horizonMs;
      // The target must resolve inside the training span, or the model would be
      // learning from data it is later scored on.
      if (expiryInstant > frame.instants[trainingEndIndex]!) break;
      const row = features(frame, i, entryInstant);
      if (row === null) continue;
      const expiry = frame.dataset.priceAt(epochMillis(expiryInstant));
      if (expiry === null) continue;
      const outcome = expiry.price - frame.prices[i]!;
      if (outcome === 0) continue;
      rows.push(row);
      labels.push(outcome > 0 ? 1 : 0);
    }

    if (rows.length < 2_000) return;

    // Standardise using training statistics only.
    for (let f = 0; f < FEATURE_COUNT; f += 1) {
      let mean = 0;
      for (const row of rows) mean += row[f]!;
      mean /= rows.length;
      let variance = 0;
      for (const row of rows) {
        const d = row[f]! - mean;
        variance += d * d;
      }
      variance /= rows.length;
      this.#mean[f] = mean;
      this.#scale[f] = variance > 0 ? Math.sqrt(variance) : 1;
    }

    const weights = new Float64Array(FEATURE_COUNT);
    let bias = 0;
    const n = rows.length;
    const gradient = new Float64Array(FEATURE_COUNT);

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      gradient.fill(0);
      let biasGradient = 0;
      for (let r = 0; r < n; r += 1) {
        const row = rows[r]!;
        let z = bias;
        for (let f = 0; f < FEATURE_COUNT; f += 1) {
          z += weights[f]! * ((row[f]! - this.#mean[f]!) / this.#scale[f]!);
        }
        const error = logistic(z) - labels[r]!;
        biasGradient += error;
        for (let f = 0; f < FEATURE_COUNT; f += 1) {
          gradient[f]! += error * ((row[f]! - this.#mean[f]!) / this.#scale[f]!);
        }
      }
      const step = LEARNING_RATE / n;
      bias -= step * biasGradient;
      for (let f = 0; f < FEATURE_COUNT; f += 1) {
        weights[f] = weights[f]! - step * gradient[f]! - LEARNING_RATE * L2 * weights[f]!;
      }
    }

    this.#weights = weights;
    this.#bias = bias;

    // Bucket boundaries are quantiles of the TRAINING predictions, so the
    // evaluation split never influences where the boundaries fall.
    const scores: number[] = [];
    for (const row of rows) scores.push(this.#score(row));
    this.#thresholds = quantileThresholds(scores, this.buckets);
    this.#fitted = this.#thresholds.length === this.buckets - 1;
  }

  #score(row: Float64Array): number {
    let z = this.#bias;
    for (let f = 0; f < FEATURE_COUNT; f += 1) {
      z += this.#weights[f]! * ((row[f]! - this.#mean[f]!) / this.#scale[f]!);
    }
    return z;
  }

  bucket(frame: FeatureFrame, entryIndex: number, entryInstant: EpochMillis): number {
    if (!this.#fitted) return SKIP_BUCKET;
    const row = features(frame, entryIndex, entryInstant);
    if (row === null) return SKIP_BUCKET;
    return bucketByThresholds(this.#score(row), this.#thresholds);
  }

  /** Exposed for tests: whether a usable model was obtained. */
  get fitted(): boolean {
    return this.#fitted;
  }
}
