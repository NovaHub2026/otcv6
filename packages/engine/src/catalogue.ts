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
  /**
   * The tail weight the family drew, before the brief retreated from it.
   *
   * **Cycle Audit 7, a3-05.** The brief steps a target down when the solve
   * cannot reach it, and the sampler clamps a draw to what the rhythm can
   * supply; both happened silently, so a registered asset could sit below its
   * family's band with a record that said only what was achieved. Absent on a
   * hand-authored asset; equal to {@link AuthoringTargets.excessKurtosis} when
   * nothing retreated.
   */
  readonly drawnExcessKurtosis?: number;
  /** Retreats the brief took from that draw. Absent on a hand-authored asset. */
  readonly retreats?: number;
  /**
   * The family's floor, present only when the rhythm drawn could not reach it
   * and the target was clamped *below* the band the archetype declares.
   */
  readonly clampedFrom?: number;
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
        tempoMs: 750,
        volatility: 5.622099554675491e-6,
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
    { excessKurtosis: 60, tickRms: 6.966229064167977e-6 },
    2.7511622644263434e-7,
    7,
    {
      predictedExcessKurtosis: 59.999999999999815,
      tieRate: 0.0043751519149970485,
      medianSteps: 83,
      meanIntervalMs: 346.8970712759723,
      logVariancePerMs: 1.6950179127725727e-13,
    },
  ),
  registered(
    {
      id: 'gbpjpy',
      family: 'forex',
      displayName: 'GBP/JPY',
      referencePrice: 193.4,
      traits: {
        tempoMs: 616.6666666666666,
        volatility: 1.8203699794098257e-5,
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
    { excessKurtosis: 105, tickRms: 2.4445366995820653e-5 },
    7.240803723603667e-7,
    4,
    {
      predictedExcessKurtosis: 105.00000000000031,
      tieRate: 0.004039492111994629,
      medianSteps: 104,
      meanIntervalMs: 237.60143550867286,
      logVariancePerMs: 4.6237658905463614e-12,
    },
  ),
  registered(
    {
      id: 'btcusd',
      family: 'crypto',
      displayName: 'BTC/USD',
      referencePrice: 68_000,
      traits: {
        tempoMs: 366.6666666666667,
        volatility: 3.513800937831308e-5,
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
    { excessKurtosis: 150, tickRms: 4.583506311716373e-5 },
    2.089296272947405e-6,
    1,
    {
      predictedExcessKurtosis: 150.0000000000002,
      tieRate: 0.005358982372073104,
      medianSteps: 80,
      meanIntervalMs: 110.70482327076888,
      logVariancePerMs: 4.074938861385614e-11,
    },
  ),
  registered(
    {
      id: 'spx',
      family: 'index',
      displayName: 'S&P 500',
      referencePrice: 5_400,
      traits: {
        tempoMs: 1362.5,
        volatility: 3.5266144220441023e-6,
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
    { excessKurtosis: 42, tickRms: 4.10495143773736e-6 },
    1.0837880316631743e-7,
    4,
    {
      predictedExcessKurtosis: 42.00000000000003,
      tieRate: 0.004548769054481059,
      medianSteps: 73,
      meanIntervalMs: 843.969783797864,
      logVariancePerMs: 2.61101676293238e-14,
    },
  ),
  registered(
    {
      id: 'xauusd',
      family: 'commodity',
      displayName: 'Gold',
      referencePrice: 2_380,
      traits: {
        tempoMs: 1075,
        volatility: 1.110655844752021e-5,
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
    { excessKurtosis: 98, tickRms: 1.4234044315125276e-5 },
    4.122689022736936e-7,
    4,
    {
      predictedExcessKurtosis: 97.99999999999989,
      tieRate: 0.004514045626584256,
      medianSteps: 85,
      meanIntervalMs: 496.07475111573757,
      logVariancePerMs: 7.304501961234015e-13,
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
