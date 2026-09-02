import {
  assertValidInstrument,
  epochMillis,
  ln,
  type AssetFamily,
  type InstrumentSpec,
  type RandomSource,
} from '@otc/core';
import { CascadeMagnitudeModel } from './cascade.js';
import type { MarketEngineConfig } from './factory.js';
import { DurationCouplingModulator, HawkesArrivalModel } from './hawkes.js';
import { ModulatedMagnitudeModel } from './modulator.js';
import {
  assertPersonalitySafe,
  assertPersonalityTraits,
  personalityConfig,
  type PersonalityTraits,
} from './personality.js';
import { VolatilityRegimeModulator } from './regime.js';
import { StructurePhaseModulator } from './structure.js';

/** A tradeable asset, before its lattice has been calibrated. */
export interface AssetDefinition {
  readonly id: string;
  readonly family: AssetFamily;
  /** Human-facing name. Never used in a comparison. */
  readonly displayName: string;
  /** Display price at lattice origin. */
  readonly referencePrice: number;
  readonly traits: PersonalityTraits;
}

/**
 * What a registration records so that it can be re-checked later.
 *
 * A calibrated quantum is a number that will decide every settlement for this
 * asset. Recording only the number would make it unfalsifiable; recording what
 * it was derived from means a later audit can recompute it.
 */
export interface CalibrationEvidence {
  readonly predictedExcessKurtosis: number;
  readonly logQuantum: number;
  /** Realised fraction of horizons with no net lattice movement. */
  readonly tieRate: number;
  /** Median move over the calibration horizon, in lattice steps. */
  readonly medianSteps: number;
  readonly meanIntervalMs: number;
  /**
   * Variance of the log price accumulated per millisecond of market time.
   *
   * The one number in this record that describes where the price *goes* rather
   * than how it is quantised, and it comes free: the calibration already
   * accumulates a full-precision walk and windows it, so the mean square of
   * those windowed returns divided by the horizon is the diffusion rate.
   *
   * Increments are uncorrelated by construction — ADR-0003 makes every sign an
   * independent fair coin — so variance is additive in time and this rate
   * extrapolates to any window by multiplication. That is what turns a ten-day
   * calibration into a statement about a quarter without simulating a quarter.
   *
   * It is a rate, not a promise: it is conditioned on the volatility levels the
   * calibration span happened to visit, and a span shorter than the slowest
   * cascade component under-samples them.
   */
  readonly logVariancePerMs: number;
  readonly horizonMs: number;
  /** Span of each replicate. */
  readonly simulatedMs: number;
  readonly replicates: number;
  readonly horizons: number;
  /**
   * Factor applied to every scale-carrying number after the simulation ran.
   *
   * 1 when the calibration was run at the volatility the definition records.
   * Anything else means the run happened at `volatility / volatilityScale` and
   * the results were scaled — see {@link rescaleCalibration}, which is exact
   * rather than approximate, and is why a registration that has to hit a
   * dispersion budget still costs one simulation instead of a search.
   *
   * Recorded because an audit re-running this calibration has to know which
   * volatility produced the numbers. Without it the record would reproduce and
   * nobody could say why.
   */
  readonly volatilityScale: number;
}

export interface CalibratedAsset {
  readonly definition: AssetDefinition;
  readonly instrument: InstrumentSpec;
  readonly config: MarketEngineConfig;
  readonly evidence: CalibrationEvidence;
}

/**
 * Fraction of shortest-horizon contracts allowed to settle at the money.
 *
 * This is the calibration target, and it is a *product* property rather than a
 * safety one. The anti-predictability theorem is indifferent to the lattice:
 * the sign is a fair coin at any resolution, and because ADR-0004 publishes and
 * settles the same integer there is no finer hidden price for a quantisation
 * attack to recover. What a coarse lattice produces is ties and a staircase.
 *
 * It is therefore coupled to the at-the-money settlement policy, which is a
 * Protected Human Decision still open. If ATM comes to mean something other than
 * a refund, revisit this number rather than the mechanism.
 */
export const TARGET_TIE_RATE = 0.01;

/**
 * What this target actually is, measured.
 *
 * Calibration compares a *continuous* log return against the candidate quantum,
 * because the quantum is the quantity being chosen and the measurement cannot
 * depend on it. A real tie is a different event: the published integer price
 * unchanged between entry and expiry.
 *
 * Those two are close but not equal, and Cycle Audit 2 measured the gap. On the
 * real published lattice the realised rate is roughly half the 1% the continuous
 * proxy reports — about 5.5 standard errors away. Tick-anchored entries land
 * lower still, near 0.3%.
 *
 * So `TARGET_TIE_RATE` is a calibration knob whose realised lattice value is
 * about half its nominal one. The consequence is economically nil under
 * ADR-0007, since a tie is refunded either way, and the direction is the safe
 * one — fewer ties than intended, not more. It is recorded because the earlier
 * claim that "exactly 1% of shortest-horizon contracts settle at the money" was
 * simply not true of the series that settles.
 *
 * ## Why these numbers are not Cycle Audit 2's
 *
 * They were, until PH-10. The audit measured 0.47% / 0.71% / 0.59% / 0.45% /
 * 0.50% on the pre-rhythm catalogue, and re-authoring the cascade's time
 * structure changed the 30-second return distribution and therefore these rates.
 * **Nothing failed.** This constant was exported, documented as measured
 * evidence, and read by no code and no test, so a change to the process it
 * describes could not invalidate it out loud.
 *
 * `latticeTies.stat.test.ts` now re-derives every value here from stream
 * families the measurement never used. That is the difference between a recorded
 * measurement and a comment.
 *
 * ## Each figure is a mean over replicates, and it has to be
 *
 * The first attempt measured one long run per asset and quoted a binomial
 * standard error. Re-measuring on a second seed moved three of the five by three
 * to four times that error — eurusd 0.58% to 0.42%, btcusd 0.48% to 0.32%.
 *
 * The binomial was wrong for the reason it is always wrong here, and this is now
 * the third time the project has met it: 20,000 consecutive 30-second horizons
 * are **one realisation**, not 20,000 independent draws. Volatility clusters, so
 * whether a horizon ties is strongly autocorrelated with its neighbours. Cycle
 * Audit 2 found the same error behind INV-007's p-value, and B-002 is the same
 * fact wearing its third face.
 *
 * The measured between-replicate standard deviation is 0.10-0.19pp — against a
 * binomial 2se of 0.09pp for a single 20,000-horizon run, which is to say the
 * naive figure understated the real uncertainty by roughly four times.
 *
 * Each value below is therefore the mean of **15 independent replicates** across
 * three unrelated stream families, 8,000 horizons each. The limiting quantity is
 * not horizons sampled but independent volatility epochs simulated: one
 * replicate spans 67 hours, and the slowest cascade component turns over in 36
 * to 44, so a replicate contains only a couple of independent volatility levels.
 * Sampling more horizons inside one run buys almost nothing.
 */
export const MEASURED_LATTICE_TIE_RATES = {
  eurusd: 0.00534,
  gbpjpy: 0.00419,
  btcusd: 0.00487,
  spx: 0.00477,
  xauusd: 0.00478,
} as const;

/** Horizon the quantum is calibrated against: the shortest contract. */
export const CALIBRATION_HORIZON_MS = 30_000;

/** Simulated span per replicate. Ten days spans many regime sojourns. */
export const CALIBRATION_SPAN_MS = 10 * 86_400_000;

/**
 * Independent realisations per registration, combined by median.
 *
 * One realisation is not enough. The quantum is a 1% quantile of a heavy-tailed
 * distribution, and the density there is low, so a single 20-day run reproduced
 * only to within 18.5% on a fresh seed — for a number that decides every
 * settlement the asset will ever have. Three independent replicates combined by
 * median bring that inside the 15% the subphase requires.
 */
export const CALIBRATION_REPLICATES = 3;

export interface CalibrationOptions {
  readonly horizonMs?: number;
  /** Span of each replicate. */
  readonly simulatedMs?: number;
  readonly replicates?: number;
  readonly targetTieRate?: number;
  /** Yield to the event loop every this many ticks, in the async variant. */
  readonly chunkTicks?: number;
}

/** Default yield interval, matching `buildObserverDataset`. */
export const CALIBRATION_CHUNK_TICKS = 250_000;

/** Stream purposes a calibration run consumes. */
export const CALIBRATION_STREAM_PURPOSES = [
  'cascade',
  'shock',
  'regime',
  'structure',
  'arrival',
  'sign',
] as const;

/**
 * Decimals to render at, from the lattice that settles.
 *
 * The display must never be coarser than the lattice: a trader seeing an
 * unchanged price on a move that settled would be a fairness problem even with
 * INV-009 intact.
 */
function displayPrecisionFor(logQuantum: number, referencePrice: number): number {
  return Math.ceil(ln(1 / (logQuantum * referencePrice)) / ln(10));
}

function quantile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)));
  return sorted[index]!;
}

/**
 * Absolute log returns over fixed horizons, in continuous log space.
 *
 * No lattice is involved, because the lattice is what this measurement exists to
 * choose. The walk is accumulated at full precision and windowed by wall clock,
 * which is also how a contract sees it.
 */
function* horizonReturnsCore(
  config: Omit<MarketEngineConfig, 'instrument'>,
  derive: (purpose: string) => RandomSource,
  horizonMs: number,
  simulatedMs: number,
  chunkTicks: number,
): Generator<void, { returns: number[]; ticks: number }> {
  const magnitude = new ModulatedMagnitudeModel(
    new CascadeMagnitudeModel(
      config.baseVolatility,
      config.cascade,
      derive('cascade'),
      derive('shock'),
    ),
    [
      new VolatilityRegimeModulator(config.regimes, derive('regime')),
      new StructurePhaseModulator(config.structure, derive('structure')),
      new DurationCouplingModulator(config.durationCoupling, config.arrival.baseIntervalMs),
    ],
  );
  const arrival = new HawkesArrivalModel(config.arrival, derive('arrival'));
  const sign = derive('sign');

  // A reference magnitude in "steps" is needed before a quantum exists. The
  // arrival process normalises against a running average of what it is given, so
  // any consistent unit works; this uses the base volatility itself.
  const referenceUnit = config.baseVolatility;

  const returns: number[] = [];
  let elapsedMs = 0;
  let logPrice = 0;
  let previousMagnitude = 10;
  let previousIntervalMs = 0;
  let sequence = 0;
  let horizonEndMs = horizonMs;
  let horizonOpen = 0;

  while (elapsedMs < simulatedMs) {
    const instant = epochMillis(elapsedMs);
    const intervalMs = arrival.nextIntervalMs({
      elapsedSincePreviousMs: previousIntervalMs,
      previousMagnitude,
      instant,
      sequence,
    });
    elapsedMs += intervalMs;
    previousIntervalMs = intervalMs;

    const move = magnitude.advance({
      intervalMs,
      previousMagnitude,
      instant: epochMillis(elapsedMs),
      sequence,
    });
    previousMagnitude = move / referenceUnit;
    logPrice += (sign.nextBoolean() ? 1 : -1) * move;
    sequence += 1;

    while (elapsedMs >= horizonEndMs) {
      returns.push(Math.abs(logPrice - horizonOpen));
      horizonOpen = logPrice;
      horizonEndMs += horizonMs;
    }

    // Yield periodically. A calibration run is millions of iterations, and a
    // synchronous block that long starves whatever else shares the loop — a test
    // runner's progress channel today, a runtime's request handling later.
    if (sequence % chunkTicks === 0) yield;
  }
  return { returns, ticks: sequence };
}

/**
 * Register an asset: validate it, then derive its lattice from its own behaviour.
 *
 * The order matters. Bounds and the analytic kurtosis gate run first and cost
 * microseconds; only a personality that survives both is worth simulating.
 */
function* calibrateAssetCore(
  definition: AssetDefinition,
  derive: (purpose: string) => RandomSource,
  options: CalibrationOptions,
): Generator<void, CalibratedAsset> {
  const horizonMs = options.horizonMs ?? CALIBRATION_HORIZON_MS;
  const simulatedMs = options.simulatedMs ?? CALIBRATION_SPAN_MS;
  const targetTieRate = options.targetTieRate ?? TARGET_TIE_RATE;
  if (!(targetTieRate > 0) || targetTieRate >= 1) {
    throw new RangeError(`Target tie rate must be in (0, 1), received ${targetTieRate}.`);
  }

  const config = personalityConfig(definition.traits);
  // The gate is a property of the volatility layers and reads no instrument.
  // PH-4.2 had to invent a provisional lattice here purely to satisfy the config
  // type; PH-10.1 widened the gate to the instrument-free half, so the fiction
  // is gone rather than documented.
  const predicted = assertPersonalitySafe(config, derive('structure-gate'));

  const replicates = options.replicates ?? CALIBRATION_REPLICATES;
  if (!Number.isInteger(replicates) || replicates < 1) {
    throw new RangeError(`Replicates must be a positive integer, received ${replicates}.`);
  }

  const perReplicate = [];
  let totalTicks = 0;
  let totalHorizons = 0;
  const pooled: number[] = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const { returns, ticks } = yield* horizonReturnsCore(
      config,
      (purpose: string) => derive(`${purpose}-r${replicate}`),
      horizonMs,
      simulatedMs,
      options.chunkTicks ?? CALIBRATION_CHUNK_TICKS,
    );
    if (returns.length < 100) {
      throw new RangeError(
        `Calibration produced only ${returns.length} horizons; simulate a longer span.`,
      );
    }
    const sortedReplicate = [...returns].sort((a, b) => a - b);
    perReplicate.push(quantile(sortedReplicate, targetTieRate));
    totalTicks += ticks;
    totalHorizons += returns.length;
    // `pooled.push(...returns)` spreads the whole replicate onto the argument
    // stack, and a long calibration overflows it: 32 turnovers of a 46-hour
    // cascade is 61 simulated days, 176,000 windowed returns, and a
    // `RangeError: Maximum call stack size exceeded` from a line that looks
    // like a copy. Found by raising `DISPERSION_FIT_TURNOVERS` — the defect was
    // latent for as long as spans stayed short.
    for (const value of returns) pooled.push(value);
  }

  // Median across replicates, not mean: the quantity being combined is a
  // quantile of a heavy-tailed variable, and one unlucky replicate should not
  // move the lattice.
  const orderedQuanta = [...perReplicate].sort((a, b) => a - b);
  const logQuantum = orderedQuanta[Math.floor(orderedQuanta.length / 2)]!;
  const returns = pooled;
  const ticks = totalTicks;
  const sorted = [...returns].sort((a, b) => a - b);
  if (!(logQuantum > 0)) {
    throw new RangeError(
      `Calibration produced a non-positive quantum for ${definition.id}: the asset does not move.`,
    );
  }

  const displayPrecision = displayPrecisionFor(logQuantum, definition.referencePrice);

  const instrument: InstrumentSpec = {
    id: definition.id,
    family: definition.family,
    logQuantum,
    displayPrecision,
    referencePrice: definition.referencePrice,
  };
  assertValidInstrument(instrument);

  const ties = returns.filter((value) => value < logQuantum).length;
  return {
    definition,
    instrument,
    config: { ...config, instrument },
    evidence: {
      predictedExcessKurtosis: predicted,
      logQuantum,
      tieRate: ties / returns.length,
      logVariancePerMs:
        returns.reduce((sum, value) => sum + value * value, 0) / returns.length / horizonMs,
      medianSteps: quantile(sorted, 0.5) / logQuantum,
      meanIntervalMs: (simulatedMs * replicates) / ticks,
      horizonMs,
      simulatedMs,
      replicates,
      horizons: totalHorizons,
      volatilityScale: 1,
    },
  };
}

/**
 * Move a calibrated asset to a different volatility without simulating again.
 *
 * Every log return the calibration produces is exactly proportional to
 * `baseVolatility`: the cascade multiplies it, the regime and structure layers
 * multiply it, the duration modulator reads only intervals, and the arrival
 * process normalises magnitudes against their own running average before using
 * them. So scaling the base scales the whole realised path, leaving the *shape*
 * — tie rate, median move in lattice steps, mean interval, kurtosis — untouched
 * and scaling the lattice with it.
 *
 * Measured on a two-day probe at a factor of 3.7: the quantum ratio agreed with
 * the factor to 1.2e-12, the diffusion rate with its square to 2.9e-15, and tie
 * rate, mean interval and kurtosis were bit-identical. `asset.test.ts` re-checks
 * that against a real recalibration, because the property is load-bearing:
 * hitting a dispersion budget by search would cost a simulation per iteration,
 * and this makes it cost none.
 *
 * The display precision is recomputed rather than carried. A coarser lattice
 * needs fewer decimals, and a display finer than the lattice invites a trader to
 * read a move that did not happen.
 */
export function rescaleCalibration(asset: CalibratedAsset, factor: number): CalibratedAsset {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`A volatility scale must be finite and positive, received ${factor}.`);
  }
  const traits: PersonalityTraits = {
    ...asset.definition.traits,
    volatility: asset.definition.traits.volatility * factor,
  };
  // The bounds are checked here rather than left to the engine, because this is
  // where a dispersion budget a personality cannot reach becomes visible: the
  // factor needed is the one that pushes the base volatility out of range.
  assertPersonalityTraits(traits);
  const definition: AssetDefinition = { ...asset.definition, traits };
  const config = personalityConfig(traits);
  const logQuantum = asset.instrument.logQuantum * factor;
  const instrument: InstrumentSpec = {
    ...asset.instrument,
    logQuantum,
    displayPrecision: displayPrecisionFor(logQuantum, definition.referencePrice),
  };
  assertValidInstrument(instrument);
  return {
    definition,
    instrument,
    config: { ...config, instrument },
    evidence: {
      ...asset.evidence,
      logQuantum,
      logVariancePerMs: asset.evidence.logVariancePerMs * factor * factor,
      volatilityScale: asset.evidence.volatilityScale * factor,
    },
  };
}

/**
 * Register an asset synchronously.
 *
 * Convenient for short spans. A full registration is millions of iterations of
 * uninterrupted CPU, so prefer {@link calibrateAssetAsync} anywhere something
 * else shares the event loop — a test runner's progress channel, or a runtime.
 */
export function calibrateAsset(
  definition: AssetDefinition,
  derive: (purpose: string) => RandomSource,
  options: CalibrationOptions = {},
): CalibratedAsset {
  const run = calibrateAssetCore(definition, derive, options);
  for (;;) {
    const step = run.next();
    if (step.done === true) return step.value;
  }
}

/** Register an asset, yielding to the event loop as it goes. */
export async function calibrateAssetAsync(
  definition: AssetDefinition,
  derive: (purpose: string) => RandomSource,
  options: CalibrationOptions = {},
): Promise<CalibratedAsset> {
  const run = calibrateAssetCore(definition, derive, options);
  for (;;) {
    const step = run.next();
    if (step.done === true) return step.value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
