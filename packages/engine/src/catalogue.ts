import type { InstrumentSpec } from '@otc/core';
import type { AssetDefinition, CalibrationEvidence } from './asset.js';
import { CALIBRATION_HORIZON_MS, CALIBRATION_REPLICATES, CALIBRATION_SPAN_MS } from './asset.js';
import type { MarketEngineConfig } from './factory.js';
import { personalityConfig } from './personality.js';

/**
 * The targets an asset's personality was authored to hit.
 *
 * Two traits cannot be chosen independently of an asset's rhythm — `clustering`,
 * because cascade depth is an exponent on tail weight, and `volatility`, because
 * depth also changes realised amplitude. Both are solved for by
 * `authorPersonality`, so what is *chosen* is these two targets and what is
 * *recorded* is the traits they produced. `catalogue.test.ts` re-runs the
 * authoring and requires the recorded traits back.
 */
export interface AuthoringTargets {
  readonly excessKurtosis: number;
  /** RMS per-tick magnitude from base volatility and the cascade. */
  readonly tickRms: number;
}

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
  readonly authored: AuthoringTargets;
}

/**
 * Keyring label under which an asset's registration streams were derived.
 *
 * PH-10.1 §5.1: the analytic gate's structure term has no closed form and is
 * estimated by simulation, so the personality solve is exact only with respect
 * to the stream that drove it. Recording the label is what makes a registered
 * asset's tail weight reproducible rather than merely plausible.
 */
export function registrationKeyLabel(id: string): string {
  return `registration-${id}`;
}

function registered(
  definition: AssetDefinition,
  authored: AuthoringTargets,
  logQuantum: number,
  displayPrecision: number,
  measured: {
    predictedExcessKurtosis: number;
    tieRate: number;
    medianSteps: number;
    meanIntervalMs: number;
    logVariancePerMs: number;
  },
): RegisteredAsset {
  return {
    definition,
    authored,
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
      volatilityScale: 1,
    },
  };
}

/**
 * The asset catalogue.
 *
 * Five assets across four families. PH-4 gave them distinct **pace and scale**;
 * PH-10 gave them distinct **rhythm** — the ladder of timescales on which each
 * one's volatility actually moves.
 *
 * ## What differs, and what deliberately does not
 *
 * Only the five rhythm traits were re-authored. `tempoMs`, `burstiness`,
 * `regimeSpread`, `structureSpread` and `durationCoupling` are carried across
 * from PH-4 unchanged, and each asset's tail weight and realised tick amplitude
 * are pinned to their PH-4 values by {@link RegisteredAsset.authored}.
 *
 * That constraint is the point. Shape differentiation could be raised trivially
 * by spreading the assets further apart in amplitude or tail weight, and the
 * resulting number would mean nothing — separating BTC from an index by how far
 * it moves is true by construction. Holding both fixed means any gain came from
 * time structure alone.
 *
 * ## The ladders
 *
 * | Asset  | Depth | Slowest | Fastest | Character                                |
 * | ------ | ----- | ------- | ------- | ---------------------------------------- |
 * | eurusd | 13    | 36 h    | 5.1 s   | Deep and wide; holds a regime a long time |
 * | gbpjpy | 7     | 8 h     | 13.2 s  | Few, widely separated rhythms             |
 * | btcusd | 16    | 30 h    | 2.3 s   | Most timescales; restless regimes         |
 * | spx    | 8     | 44 h    | 30.2 s  | Longest memory, slowest turnover          |
 * | xauusd | 11    | 4 h     | 6.8 s   | Memory that stops inside a session        |
 *
 * Every quantum below was derived, never chosen: it is the 1% quantile of that
 * asset's own 30-second *continuous* return distribution. The realised rate on
 * the published lattice is about half that — see `MEASURED_LATTICE_TIE_RATES` —
 * because a tie is an integer-price event and the calibration measures a
 * continuous proxy for it. Median moves land at 72-85 lattice steps for all five
 * without that being targeted, because the lattice scales with the asset instead
 * of being imposed on it.
 */
export const ASSET_CATALOGUE: readonly RegisteredAsset[] = [
  registered(
    {
      id: 'eurusd',
      family: 'forex',
      displayName: 'EUR/USD',
      referencePrice: 1.085,
      traits: {
        tempoMs: 3_000,
        volatility: 0.000011244199109350982,
        clustering: 0.18311113955405817,
        burstiness: 0.6,
        regimeSpread: 1,
        structureSpread: 1,
        durationCoupling: 0.25,
        cascadeDepth: 13,
        cascadeSpanMs: 36 * 3_600_000,
        cascadeSpacing: 2.33,
        regimeTempo: 1.6,
        arrivalMemoryMs: 240_000,
      },
    },
    { excessKurtosis: 60, tickRms: 0.000013932458128335953 },
    2.7511622644263434e-7,
    7,
    {
      predictedExcessKurtosis: 59.999999999999815,
      tieRate: 0.009409722222222222,
      medianSteps: 74.30361502697028,
      meanIntervalMs: 1379.8191861941425,
      logVariancePerMs: 2.027501e-13,
    },
  ),
  registered(
    {
      id: 'gbpjpy',
      family: 'forex',
      displayName: 'GBP/JPY',
      referencePrice: 193.4,
      traits: {
        tempoMs: 1_850,
        volatility: 0.000031529732929109286,
        clustering: 0.2964497423273288,
        burstiness: 0.62,
        regimeSpread: 1.15,
        structureSpread: 1,
        durationCoupling: 0.25,
        cascadeDepth: 7,
        cascadeSpanMs: 8 * 3_600_000,
        cascadeSpacing: 3.6,
        regimeTempo: 0.55,
        arrivalMemoryMs: 40_000,
      },
    },
    { excessKurtosis: 105, tickRms: 0.00004234061764642874 },
    7.240803723603667e-7,
    4,
    {
      predictedExcessKurtosis: 105.00000000000031,
      tieRate: 0.010011574074074074,
      medianSteps: 85.27008781618775,
      meanIntervalMs: 714.6766515523951,
      logVariancePerMs: 4.684532e-12,
    },
  ),
  registered(
    {
      id: 'btcusd',
      family: 'crypto',
      displayName: 'BTC/USD',
      referencePrice: 68_000,
      traits: {
        tempoMs: 1_100,
        volatility: 0.000060860817520069954,
        clustering: 0.18378985931871766,
        burstiness: 0.78,
        regimeSpread: 1.35,
        structureSpread: 1.0,
        durationCoupling: 0.25,
        cascadeDepth: 16,
        cascadeSpanMs: 30 * 3_600_000,
        cascadeSpacing: 2.05,
        regimeTempo: 0.35,
        arrivalMemoryMs: 18_000,
      },
    },
    { excessKurtosis: 150, tickRms: 0.00007938865808705389 },
    2.089296272947405e-6,
    1,
    {
      predictedExcessKurtosis: 150.0000000000002,
      tieRate: 0.010127314814814815,
      medianSteps: 83.64236012003401,
      meanIntervalMs: 332.9569156063406,
      logVariancePerMs: 4.033068e-11,
    },
  ),
  registered(
    {
      id: 'spx',
      family: 'index',
      displayName: 'S&P 500',
      referencePrice: 5_400,
      traits: {
        tempoMs: 5_450,
        volatility: 0.000007053228844088205,
        clustering: 0.19670722555227743,
        burstiness: 0.45,
        regimeSpread: 0.85,
        structureSpread: 1.35,
        durationCoupling: 0.25,
        cascadeDepth: 8,
        cascadeSpanMs: 44 * 3_600_000,
        cascadeSpacing: 3.4,
        regimeTempo: 2.4,
        arrivalMemoryMs: 420_000,
      },
    },
    { excessKurtosis: 42, tickRms: 0.00000820990287547472 },
    1.0837880316631743e-7,
    4,
    {
      predictedExcessKurtosis: 42.00000000000003,
      tieRate: 0.009930555555555555,
      medianSteps: 71.83103728613499,
      meanIntervalMs: 3352.3021210553543,
      logVariancePerMs: 3.164676e-14,
    },
  ),
  registered(
    {
      id: 'xauusd',
      family: 'commodity',
      displayName: 'Gold',
      referencePrice: 2_380,
      traits: {
        tempoMs: 4_300,
        volatility: 0.00002221311689504042,
        clustering: 0.21480719239432494,
        burstiness: 0.55,
        regimeSpread: 1.25,
        structureSpread: 0.9,
        durationCoupling: 0.25,
        cascadeDepth: 11,
        cascadeSpanMs: 4 * 3_600_000,
        cascadeSpacing: 2.15,
        regimeTempo: 0.9,
        arrivalMemoryMs: 110_000,
      },
    },
    { excessKurtosis: 98, tickRms: 0.00002846808863025055 },
    4.122689022736936e-7,
    4,
    {
      predictedExcessKurtosis: 97.99999999999989,
      tieRate: 0.009907407407407408,
      medianSteps: 79.75170190938478,
      meanIntervalMs: 1969.0617253751434,
      logVariancePerMs: 9.330799e-13,
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
