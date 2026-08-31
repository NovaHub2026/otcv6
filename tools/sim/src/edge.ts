/**
 * A minimal directional-edge estimator.
 *
 * Its only job is to demonstrate that each planted fixture leaks what it claims
 * and that the control does not. The real attack battery — many attack families,
 * multiple-testing control, power curves, minimum detectable effect — is PH-2,
 * and this estimator is deliberately not that. It exists so PH-2 has something
 * whose answers are known to calibrate against.
 *
 * **The look-ahead rule.** An entry at index `i` may use information from
 * `prices[0 .. i-1]` only; the outcome is `prices[i + H]` against `prices[i]`.
 * The tick at the entry index belongs to the outcome and never to the features.
 * Getting this wrong is not a subtle inaccuracy: during PH-1 design a probe that
 * included the entry tick in its forward window reported z-scores above 1000 on
 * a provably unexploitable process.
 */

export interface EdgeAtHorizon {
  readonly horizon: number;
  readonly samples: number;
  readonly ties: number;
  /** P(up), computed over decided (non-tie) outcomes. */
  readonly upProbability: number;
  /** Percentage points above 0.5. */
  readonly edgePoints: number;
  /** Standard error of `upProbability`, treating samples as independent. */
  readonly standardError: number;
  readonly z: number;
}

export interface EdgeReport {
  readonly label: string;
  readonly horizons: readonly EdgeAtHorizon[];
}

/**
 * Unconditional edge: `P(up)` over decided outcomes at each horizon.
 *
 * `stride` selects non-overlapping entries. Overlapping windows are strongly
 * dependent, and treating them as independent inflates significance — the naive
 * i.i.d. confidence interval on overlapping windows is the single easiest way to
 * produce a green gate that means nothing. Default is `stride = horizon`.
 */
export function estimateDirectionalEdge(
  prices: Int32Array,
  horizons: readonly number[],
  label = 'unnamed',
  stride?: number,
): EdgeReport {
  const out: EdgeAtHorizon[] = [];
  for (const horizon of horizons) {
    if (!Number.isInteger(horizon) || horizon <= 0) {
      throw new RangeError(`Horizon must be a positive integer, received ${horizon}.`);
    }
    const step = stride ?? horizon;
    let up = 0;
    let down = 0;
    let ties = 0;
    for (let i = 0; i + horizon < prices.length; i += step) {
      const entry = prices[i]!;
      const expiry = prices[i + horizon]!;
      if (expiry > entry) up += 1;
      else if (expiry < entry) down += 1;
      else ties += 1;
    }
    const decided = up + down;
    const upProbability = decided === 0 ? 0.5 : up / decided;
    const standardError = decided === 0 ? Number.POSITIVE_INFINITY : Math.sqrt(0.25 / decided);
    out.push({
      horizon,
      samples: decided,
      ties,
      upProbability,
      edgePoints: (upProbability - 0.5) * 100,
      standardError,
      z: decided === 0 ? 0 : (upProbability - 0.5) / standardError,
    });
  }
  return { label, horizons: out };
}

export interface ConditionalBucket {
  readonly name: string;
  readonly samples: number;
  readonly upProbability: number;
  readonly edgePoints: number;
  readonly z: number;
}

/**
 * Edge conditioned on a feature computed from strictly past information.
 *
 * `feature(prices, i)` must read `prices[0 .. i-1]` only. It receives the entry
 * index and must not look at it.
 */
export function estimateConditionalEdge(
  prices: Int32Array,
  horizon: number,
  bucketCount: number,
  feature: (prices: Int32Array, entryIndex: number) => number,
  minIndex = 1,
): ConditionalBucket[] {
  const up = new Int32Array(bucketCount);
  const decided = new Int32Array(bucketCount);
  for (let i = minIndex; i + horizon < prices.length; i += horizon) {
    const bucket = feature(prices, i);
    if (!Number.isInteger(bucket) || bucket < 0 || bucket >= bucketCount) continue;
    const entry = prices[i]!;
    const expiry = prices[i + horizon]!;
    if (expiry === entry) continue;
    decided[bucket]! += 1;
    if (expiry > entry) up[bucket]! += 1;
  }
  const out: ConditionalBucket[] = [];
  for (let b = 0; b < bucketCount; b += 1) {
    const n = decided[b]!;
    const p = n === 0 ? 0.5 : up[b]! / n;
    const se = n === 0 ? Number.POSITIVE_INFINITY : Math.sqrt(0.25 / n);
    out.push({
      name: `bucket-${b}`,
      samples: n,
      upProbability: p,
      edgePoints: (p - 0.5) * 100,
      z: n === 0 ? 0 : (p - 0.5) / se,
    });
  }
  return out;
}

export function formatEdgeReport(report: EdgeReport): string {
  const lines = [`${report.label}:`];
  for (const h of report.horizons) {
    lines.push(
      `  H=${String(h.horizon).padStart(4)}  P(up)=${h.upProbability.toFixed(5)}` +
        `  edge=${h.edgePoints >= 0 ? '+' : ''}${h.edgePoints.toFixed(3)}pp` +
        `  n=${String(h.samples).padStart(8)}  ties=${String(h.ties).padStart(7)}` +
        `  z=${h.z >= 0 ? '+' : ''}${h.z.toFixed(2)}`,
    );
  }
  return lines.join('\n');
}
