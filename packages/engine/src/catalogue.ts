import type { InstrumentSpec } from '@otc/core';
import type { AssetDefinition, CalibrationEvidence } from './asset.js';
import { CALIBRATION_HORIZON_MS, CALIBRATION_REPLICATES, CALIBRATION_SPAN_MS } from './asset.js';
import type { MarketEngineConfig } from './factory.js';
import { DEFAULT_TRAITS, personalityConfig } from './personality.js';

/**
 * An asset that has been through registration, with the evidence it produced.
 *
 * Registration is not repeated at startup. It is a deliberate act that produces
 * a lattice and a record of how that lattice was chosen, and the record is what
 * makes the choice auditable later. `catalogue.stat.test.ts` recalibrates every
 * asset here from different streams and fails if the recorded numbers do not
 * reproduce.
 */
export interface RegisteredAsset {
  readonly definition: AssetDefinition;
  readonly instrument: InstrumentSpec;
  readonly evidence: CalibrationEvidence;
}

function registered(
  definition: AssetDefinition,
  logQuantum: number,
  displayPrecision: number,
  measured: {
    predictedExcessKurtosis: number;
    tieRate: number;
    medianSteps: number;
    meanIntervalMs: number;
  },
): RegisteredAsset {
  return {
    definition,
    instrument: {
      id: definition.id,
      family: definition.family,
      logQuantum,
      displayPrecision,
      referencePrice: definition.referencePrice,
    },
    evidence: {
      ...measured,
      logQuantum,
      horizonMs: CALIBRATION_HORIZON_MS,
      simulatedMs: CALIBRATION_SPAN_MS,
      replicates: CALIBRATION_REPLICATES,
      horizons: 86_400,
    },
  };
}

/**
 * The asset catalogue.
 *
 * Five assets across four families, spanning a factor of seven in tick rate and
 * an order of magnitude in volatility. Each personality was checked by the
 * analytic gate before it was simulated — the first crypto draft was rejected at
 * a predicted excess kurtosis of 276.8 against the ceiling of 200, and retuned.
 *
 * Every quantum below was derived, never chosen: it is the 1% quantile of that
 * asset's own 30-second return distribution, so exactly 1% of shortest-horizon
 * contracts settle at the money. Median moves land at 68–85 lattice steps for
 * all five without that being targeted, because the lattice scales with the
 * asset instead of being imposed on it.
 */
export const ASSET_CATALOGUE: readonly RegisteredAsset[] = [
  registered(
    {
      id: 'eurusd',
      family: 'forex',
      displayName: 'EUR/USD',
      referencePrice: 1.085,
      traits: DEFAULT_TRAITS,
    },
    2.5326169207813554e-7,
    7,
    {
      predictedExcessKurtosis: 63.518987927858404,
      tieRate: 0.010277777777777778,
      medianSteps: 76.48014404440633,
      meanIntervalMs: 1073.9656554733094,
    },
  ),
  registered(
    {
      id: 'gbpjpy',
      family: 'forex',
      displayName: 'GBP/JPY',
      referencePrice: 193.4,
      traits: {
        ...DEFAULT_TRAITS,
        tempoMs: 3_200,
        volatility: 1.8e-5,
        clustering: 0.24,
        burstiness: 0.62,
        regimeSpread: 1.15,
      },
    },
    3.7843338539580995e-7,
    5,
    {
      predictedExcessKurtosis: 108.62098096647418,
      tieRate: 0.010127314814814815,
      medianSteps: 80.55631744977373,
      meanIntervalMs: 1310.37944888231,
    },
  ),
  registered(
    {
      id: 'btcusd',
      family: 'crypto',
      displayName: 'BTC/USD',
      referencePrice: 68_000,
      traits: {
        ...DEFAULT_TRAITS,
        tempoMs: 1_100,
        volatility: 6e-5,
        clustering: 0.24,
        burstiness: 0.78,
        regimeSpread: 1.35,
        structureSpread: 1.0,
      },
    },
    2.0482446300221224e-6,
    1,
    {
      predictedExcessKurtosis: 151.62450294348804,
      tieRate: 0.009780092592592592,
      medianSteps: 85.52141866646039,
      meanIntervalMs: 333.7525412899665,
    },
  ),
  registered(
    {
      id: 'spx',
      family: 'index',
      displayName: 'S&P 500',
      referencePrice: 5_400,
      traits: {
        ...DEFAULT_TRAITS,
        tempoMs: 4_200,
        volatility: 9e-6,
        clustering: 0.18,
        burstiness: 0.45,
        regimeSpread: 0.85,
        structureSpread: 1.35,
      },
    },
    2.187954183715396e-7,
    3,
    {
      predictedExcessKurtosis: 44.40447547836519,
      tieRate: 0.009837962962962963,
      medianSteps: 61.729832922906944,
      meanIntervalMs: 2464.4780478899806,
    },
  ),
  registered(
    {
      id: 'xauusd',
      family: 'commodity',
      displayName: 'Gold',
      referencePrice: 2_380,
      traits: {
        ...DEFAULT_TRAITS,
        tempoMs: 3_000,
        volatility: 2.4e-5,
        clustering: 0.23,
        burstiness: 0.55,
        regimeSpread: 1.25,
        structureSpread: 0.9,
      },
    },
    5.273193218642558e-7,
    3,
    {
      predictedExcessKurtosis: 100.48688844255925,
      tieRate: 0.009953703703703704,
      medianSteps: 76.58999319950895,
      meanIntervalMs: 1401.2090834243777,
    },
  ),
];

export function assetById(id: string): RegisteredAsset {
  const found = ASSET_CATALOGUE.find((asset) => asset.definition.id === id);
  if (found === undefined) {
    const known = ASSET_CATALOGUE.map((asset) => asset.definition.id).join(', ');
    throw new RangeError(`Unknown asset ${id}. The catalogue holds: ${known}.`);
  }
  return found;
}

/** The engine configuration for a registered asset. */
export function configFor(asset: RegisteredAsset): MarketEngineConfig {
  return { ...personalityConfig(asset.definition.traits), instrument: asset.instrument };
}
