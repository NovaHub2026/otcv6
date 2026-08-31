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
import { assertPersonalitySafe, personalityConfig, type PersonalityTraits } from './personality.js';
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
  readonly horizonMs: number;
  /** Span of each replicate. */
  readonly simulatedMs: number;
  readonly replicates: number;
  readonly horizons: number;
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
}

/** Stream purposes a calibration run consumes. */
export const CALIBRATION_STREAM_PURPOSES = [
  'cascade',
  'shock',
  'regime',
  'structure',
  'arrival',
  'sign',
] as const;

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
function horizonReturns(
  config: Omit<MarketEngineConfig, 'instrument'>,
  derive: (purpose: string) => RandomSource,
  horizonMs: number,
  simulatedMs: number,
): { returns: number[]; ticks: number } {
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
  }
  return { returns, ticks: sequence };
}

/**
 * Register an asset: validate it, then derive its lattice from its own behaviour.
 *
 * The order matters. Bounds and the analytic kurtosis gate run first and cost
 * microseconds; only a personality that survives both is worth simulating.
 */
export function calibrateAsset(
  definition: AssetDefinition,
  derive: (purpose: string) => RandomSource,
  options: CalibrationOptions = {},
): CalibratedAsset {
  const horizonMs = options.horizonMs ?? CALIBRATION_HORIZON_MS;
  const simulatedMs = options.simulatedMs ?? CALIBRATION_SPAN_MS;
  const targetTieRate = options.targetTieRate ?? TARGET_TIE_RATE;
  if (!(targetTieRate > 0) || targetTieRate >= 1) {
    throw new RangeError(`Target tie rate must be in (0, 1), received ${targetTieRate}.`);
  }

  const config = personalityConfig(definition.traits);
  const gateInstrument: InstrumentSpec = {
    id: definition.id,
    family: definition.family,
    // A provisional lattice: the gate is a property of the volatility layers and
    // does not read the instrument, but the config type carries one.
    logQuantum: 1e-6,
    displayPrecision: 5,
    referencePrice: definition.referencePrice,
  };
  const predicted = assertPersonalitySafe(
    { ...config, instrument: gateInstrument },
    derive('structure-gate'),
  );

  const replicates = options.replicates ?? CALIBRATION_REPLICATES;
  if (!Number.isInteger(replicates) || replicates < 1) {
    throw new RangeError(`Replicates must be a positive integer, received ${replicates}.`);
  }

  const perReplicate = [];
  let totalTicks = 0;
  let totalHorizons = 0;
  const pooled: number[] = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const { returns, ticks } = horizonReturns(
      config,
      (purpose) => derive(`${purpose}-r${replicate}`),
      horizonMs,
      simulatedMs,
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
    pooled.push(...returns);
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

  // The display must never be coarser than the lattice that settles the
  // contract: a trader seeing an unchanged price on a move that settled would be
  // a fairness problem even with INV-009 intact.
  const displayPrecision = Math.ceil(ln(1 / (logQuantum * definition.referencePrice)) / ln(10));

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
      medianSteps: quantile(sorted, 0.5) / logQuantum,
      meanIntervalMs: (simulatedMs * replicates) / ticks,
      horizonMs,
      simulatedMs,
      replicates,
      horizons: totalHorizons,
    },
  };
}
