import { epochMillis, logPrice, MasterKeyring } from '@otc/core';
import { configFor, createMarketEngine, type RegisteredAsset } from '@otc/engine';
import {
  BINARY_HORIZONS,
  designEffect,
  HorizonAccumulator,
  minimumDetectableEffect,
  minimumDetectableEffectUnderDependence,
  profitabilityThresholdPoints,
  twoSidedPValue,
  type HorizonOutcome,
} from '@otc/lab';

/**
 * Directional coverage at every horizon the product sells.
 *
 * ## The question
 *
 * The product offers 30 seconds to 15 minutes. Until PH-11 only the 30-second
 * horizon had ever been policed to the 0.2513 percentage points the 99%
 * promotional payout implies; the rest carried verdicts at whatever floor their
 * sample count happened to reach. That is honest, and it is not a guarantee.
 *
 * Closing it needs about 310,000 decided non-overlapping windows at 15 minutes —
 * roughly nine simulated years per asset. The engine produces 730,000 ticks a
 * second, so that is minutes of compute, not the impossibility B-002's "roughly
 * a hundred times the history" suggested.
 *
 * ## Why it streams
 *
 * At that length an `ObserverDataset` would hold about 2.4 GB per asset.
 * {@link HorizonAccumulator} keeps `O(horizons)` state instead, and one price
 * path tiles into non-overlapping windows at all eight horizons at once.
 *
 * ## Why it is segmented
 *
 * A single pooled rate would come with an error bar assuming independence.
 * PH-11.1 measured that assumption to hold for direction — across *independent
 * runs*. A live venue is one continuous record, so this measures the design
 * effect across **contiguous segments of one market's history**, which is the
 * setting that actually applies.
 *
 * **It is not the more conservative of the two, and this file said it was.**
 * Cycle Audit 4 (Material 3) showed that a component shared by every segment is
 * removed by the sample variance by construction: the estimator reads 1.000
 * while the pooled z carries 11.6× its assumed variance. Sharing across
 * replicates *lowers* the reading.
 *
 * So segmentation licenses the error bar against dependence at lags shorter than
 * a segment, and nothing longer. The run-wide component — the path displacement
 * this file's own `pathBiasZ` column measures — is invisible to it. That the
 * pooled z is nevertheless honest was established separately, across 400
 * genuinely independent realisations, not by this.
 *
 * Segments also buy resolution where PH-11.1 had least: at 100 segments the
 * design effect carries a ±14% relative standard error instead of ±23%.
 *
 * ## What this is not
 *
 * It conditions on nothing. It is the unconditional direction test at a sample
 * size the battery cannot reach, and a clean result here is **not** stronger
 * evidence than a clean battery verdict — a leak that needs conditioning to see
 * will not appear. The two instruments answer different questions.
 */
export interface HorizonCoverageRow {
  readonly horizon: string;
  readonly decided: number;
  readonly ties: number;
  readonly windows: number;
  readonly upRate: number;
  /** Deviation from a fair coin, in percentage points. */
  readonly edgePoints: number;
  readonly z: number;
  readonly pValue: number;
  /**
   * The z this horizon would show from the path's terminal displacement alone.
   *
   * Non-overlapping window returns **telescope**: at every horizon they sum to
   * the same net displacement `D`. Conditioning on `D`, the expected excess of
   * up-windows is `D · E|X| / σ²`, which works through to
   * `z ≈ (D / √V) · (E|X| / σ)` — **the same value at every horizon**, because
   * the horizon dependence cancels.
   *
   * So the eight horizons measured on one price path are close to *one* test
   * rather than eight, and a path that happens to end up displaced looks like a
   * consistent edge at every expiry the product sells.
   *
   * **What it predicts, and what it does not.** The derivation is a first-order
   * projection, so it is reliable for the *sign* of the bias and for its
   * *flatness across horizons* — both of which are strongly borne out — and not
   * for its magnitude. Measured, the observed z runs between 0.8x and 3.3x this
   * value depending on the asset, because σ² is inflated by tail events that
   * carry no proportionate sign information.
   *
   * Read it as: **how strongly this path's displacement biases every horizon in
   * the same direction.** Measured across the catalogue, |pathBiasZ| predicts how
   * consistent the observed signs are — btcusd at 0.85 came back 8/8 the same
   * way, spx at 0.64 came back 6/8, and the assets near 0.15 came back mixed.
   *
   * PH-11.2 needed this. btcusd was positive at all eight horizons; an
   * independent realisation of the same asset flipped all eight negative, and
   * this diagnostic changed sign with them. No normality is assumed: `E|X|` and
   * `σ` are both measured from the windows themselves, which matters at an
   * excess kurtosis of 150.
   */
  readonly pathBiasZ: number;
  readonly designEffect: number;
  readonly designEffectRelativeError: number;
  /** Floor assuming independence, in percentage points. */
  readonly iidFloorPoints: number;
  /** Floor carrying the measured design effect. */
  readonly floorPoints: number;
  /** Whether the honest floor is finer than the payout threshold. */
  readonly sufficientForPayout: boolean;
}

export interface HorizonCoverage {
  readonly asset: string;
  readonly ticks: number;
  readonly simulatedDays: number;
  readonly segments: number;
  readonly payoutThresholdPoints: number;
  /** Net displacement of the whole path, in lattice steps. */
  readonly netDisplacement: number;
  readonly rows: readonly HorizonCoverageRow[];
}

export interface HorizonCoverageOptions {
  readonly asset: RegisteredAsset;
  /** Windows to accumulate at the slowest horizon; sets the run length. */
  readonly targetSlowestWindows: number;
  /** Contiguous segments the run is divided into, for the design effect. */
  readonly segments: number;
  /** Distinguishes this run's streams. */
  readonly keyLabel: string;
  readonly payout?: number;
  readonly onProgress?: (completedSegments: number) => void;
}

const GENESIS = 1_776_000_000_000;
const YIELD_TICKS = 250_000;
const breathe = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

export async function measureHorizonCoverage(
  options: HorizonCoverageOptions,
): Promise<HorizonCoverage> {
  const { asset, targetSlowestWindows, segments, keyLabel } = options;
  if (!Number.isInteger(segments) || segments < 3) {
    throw new RangeError(`Need at least 3 segments for a design effect, received ${segments}.`);
  }
  const perSegment = Math.floor(targetSlowestWindows / segments);
  if (perSegment < 1) {
    throw new RangeError(
      `${targetSlowestWindows} windows across ${segments} segments leaves none per segment.`,
    );
  }

  const keyring = MasterKeyring.forTesting(keyLabel);
  const engine = createMarketEngine({
    config: configFor(asset),
    keyring,
    environment: 'simulation',
    start: { instant: epochMillis(GENESIS), price: logPrice(0) },
  });

  const perSegmentOutcomes: HorizonOutcome[][] = [];
  const startPrice = engine.price;
  let ticks = 0;
  let instant = GENESIS;

  for (let segment = 0; segment < segments; segment += 1) {
    // Each segment continues the same market: same engine, same latent state,
    // no seam. Only the tally is reset, so the segments are contiguous slices of
    // one history rather than independent runs.
    const accumulator = new HorizonAccumulator(BINARY_HORIZONS, instant, engine.price);
    while (accumulator.slowestHorizonWindows < perSegment) {
      const tick = engine.next();
      if (tick === null) break;
      accumulator.observe(tick.instant, tick.price);
      instant = tick.instant;
      ticks += 1;
      // B-010: a synchronous block this long starves the worker's RPC channel.
      if (ticks % YIELD_TICKS === 0) await breathe();
    }
    perSegmentOutcomes.push(accumulator.outcomes());
    options.onProgress?.(segment + 1);
    await breathe();
  }

  const payoutThresholdPoints = profitabilityThresholdPoints(options.payout ?? 0.99);
  const rows: HorizonCoverageRow[] = BINARY_HORIZONS.map((horizon, index) => {
    const perSegment = perSegmentOutcomes.map((outcomes) => outcomes[index]!);
    const decided = perSegment.reduce((sum, o) => sum + o.decided, 0);
    const sumAbs = perSegment.reduce((sum, o) => sum + o.sumAbsoluteReturn, 0);
    const sumSquared = perSegment.reduce((sum, o) => sum + o.sumSquaredReturn, 0);
    const ties = perSegment.reduce((sum, o) => sum + o.ties, 0);
    const windows = perSegment.reduce((sum, o) => sum + o.windows, 0);
    const ups = perSegment.reduce((sum, o) => sum + o.ups, 0);
    const upRate = decided === 0 ? Number.NaN : ups / decided;

    const meanDecided = Math.max(1, Math.round(decided / perSegment.length));
    const effect = designEffect(
      perSegment.map((o) => o.upRate),
      meanDecided,
    );

    // The z-score carries the measured dependence: an effective sample size,
    // not a nominal one. With a design effect of 1 this is the ordinary
    // binomial z, which is the point.
    const effectiveDecided = decided / Math.max(effect.designEffect, 1);
    const z = (upRate - 0.5) / Math.sqrt(0.25 / effectiveDecided);
    const iidFloorPoints = minimumDetectableEffect(decided) * 100;
    const floorPoints = minimumDetectableEffectUnderDependence(decided, effect.designEffect) * 100;

    // z ≈ D · E|X| · √n / V, with E|X| and V measured rather than assumed.
    const netDisplacement = engine.price - startPrice;
    const pathBiasZ =
      windows === 0 || sumSquared === 0
        ? Number.NaN
        : (netDisplacement * sumAbs) / (Math.sqrt(windows) * sumSquared);

    return {
      horizon: horizon.label,
      decided,
      ties,
      windows,
      upRate,
      edgePoints: (upRate - 0.5) * 100,
      z,
      pValue: twoSidedPValue(z),
      pathBiasZ,
      designEffect: effect.designEffect,
      designEffectRelativeError: effect.relativeStandardError,
      iidFloorPoints,
      floorPoints,
      sufficientForPayout: floorPoints < payoutThresholdPoints,
    };
  });

  return {
    asset: asset.definition.id,
    ticks,
    simulatedDays: (instant - GENESIS) / 86_400_000,
    segments,
    payoutThresholdPoints,
    netDisplacement: engine.price - startPrice,
    rows,
  };
}

/** A fixed-width report, for an evidence record. */
export function formatHorizonCoverage(coverage: HorizonCoverage): string {
  const lines = [
    `${coverage.asset}: ${coverage.ticks.toLocaleString()} ticks, ` +
      `${coverage.simulatedDays.toFixed(1)} simulated days (${(coverage.simulatedDays / 365).toFixed(2)} years), ` +
      `${coverage.segments} segments, payout threshold ${coverage.payoutThresholdPoints.toFixed(4)}pp, ` +
      `net displacement ${coverage.netDisplacement.toLocaleString()} steps`,
    '| Horizon | Decided | Up rate | Edge (pp) | z | Path bias z | Design effect | Floor (pp) | Policed |',
    '| ------- | ------- | ------- | --------- | - | ----------- | ------------- | ---------- | ------- |',
  ];
  for (const row of coverage.rows) {
    lines.push(
      `| ${row.horizon} | ${row.decided.toLocaleString()} | ${row.upRate.toFixed(5)} | ` +
        `${row.edgePoints >= 0 ? '+' : ''}${row.edgePoints.toFixed(4)} | ${row.z.toFixed(2)} | ` +
        `${row.pathBiasZ.toFixed(2)} | ` +
        `${row.designEffect.toFixed(2)} ±${(row.designEffectRelativeError * 100).toFixed(0)}% | ` +
        `${row.floorPoints.toFixed(4)} | ${row.sufficientForPayout ? 'yes' : 'no'} |`,
    );
  }
  return lines.join('\n');
}
