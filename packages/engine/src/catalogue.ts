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
 * asset's own 30-second *continuous* return distribution. The realised rate on the
 * published lattice is about half that — see `MEASURED_LATTICE_TIE_RATES` — because
 * a tie is an integer-price event and the calibration measures a continuous proxy
 * for it. Median moves land at 68–85 lattice steps for
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
      traits: { ...DEFAULT_TRAITS, tempoMs: 3_000, volatility: 1.1e-5 },
    },
    2.3240308630908917e-7,
    7,
    {
      predictedExcessKurtosis: 63.518987927858404,
      tieRate: 0.009837962962962963,
      medianSteps: 83.40148019893093,
      meanIntervalMs: 1295.1769150704727,
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
        tempoMs: 1_850,
        volatility: 3.2e-5,
        clustering: 0.24,
        burstiness: 0.62,
        regimeSpread: 1.15,
      },
    },
    9.557290322065315e-7,
    4,
    {
      predictedExcessKurtosis: 108.62098096647418,
      tieRate: 0.01019675925925926,
      medianSteps: 74.15800084927021,
      meanIntervalMs: 760.3982703286258,
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
        tempoMs: 5_450,
        volatility: 7e-6,
        clustering: 0.18,
        burstiness: 0.45,
        regimeSpread: 0.85,
        structureSpread: 1.35,
      },
    },
    1.3923488725864352e-7,
    4,
    {
      predictedExcessKurtosis: 44.40447547836519,
      tieRate: 0.010416666666666666,
      medianSteps: 68.61576660010508,
      meanIntervalMs: 3187.2196427166127,
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
        tempoMs: 4_300,
        volatility: 2.2e-5,
        clustering: 0.23,
        burstiness: 0.55,
        regimeSpread: 1.25,
        structureSpread: 0.9,
      },
    },
    3.876151430451391e-7,
    4,
    {
      predictedExcessKurtosis: 100.48688844255925,
      tieRate: 0.01,
      medianSteps: 81.0720992767206,
      meanIntervalMs: 1994.0869781965976,
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
