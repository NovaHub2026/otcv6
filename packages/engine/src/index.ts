export { PoissonArrivalModel } from './arrival.js';
export {
  createMarketEngine,
  defaultConfigFor,
  DEFAULT_ENGINE_CONFIG,
  ENGINE_STREAM_PURPOSES,
  type CreateEngineOptions,
  type MarketEngineConfig,
} from './factory.js';
export {
  assertHawkesConfig,
  DEFAULT_DURATION_COUPLING,
  DEFAULT_HAWKES,
  DurationCouplingModulator,
  HawkesArrivalModel,
  type HawkesConfig,
  type HawkesSnapshot,
} from './hawkes.js';
export {
  assertCascadeConfig,
  CascadeMagnitudeModel,
  DEFAULT_CASCADE,
  VolatilityCascade,
  type CascadeConfig,
  type CascadeSnapshot,
} from './cascade.js';
export {
  logUnitsPerRelativeMove,
  MarketEngine,
  type EngineSnapshot,
  type EngineStart,
  type EngineStreams,
  type MarketEngineOptions,
} from './engine.js';
export type { ArrivalModel, MagnitudeContext, MagnitudeModel } from './magnitude.js';
export { ModulatedMagnitudeModel, type Modulator } from './modulator.js';
export {
  assertRegimeConfig,
  DEFAULT_REGIMES,
  VOLATILITY_REGIMES,
  VolatilityRegimeModulator,
  weibullSample,
  type RegimeConfig,
  type RegimeSnapshot,
  type RegimeSpec,
  type VolatilityRegime,
} from './regime.js';
export {
  assertStructureConfig,
  DEFAULT_STRUCTURE,
  STRUCTURE_PHASES,
  StructurePhaseModulator,
  type PhaseSpec,
  type StructureConfig,
  type StructurePhase,
  type StructureSnapshot,
} from './structure.js';
export {
  runMirrorTest,
  SignInvertingStream,
  type MirrorDivergence,
  type MirrorOptions,
  type MirrorResult,
} from './mirror.js';
export {
  assertPersonalitySafe,
  assertPersonalityTraits,
  authorPersonality,
  cascadeInflation,
  cascadeInflationOfClustering,
  cascadeRmsGain,
  cascadeTimescalesMs,
  DEFAULT_TRAITS,
  EXCESS_KURTOSIS_BAND,
  expandPersonality,
  MIN_FASTEST_COMPONENT_TICKS,
  predictedExcessKurtosis,
  regimeInflation,
  solveClustering,
  structureInflation,
  STRUCTURE_INFLATION_STEPS,
  TRAIT_BOUNDS,
  type AuthoredPersonality,
  type PersonalityTraits,
} from './personality.js';
export {
  calibrateAsset,
  calibrateAssetAsync,
  CALIBRATION_CHUNK_TICKS,
  CALIBRATION_HORIZON_MS,
  CALIBRATION_SPAN_MS,
  CALIBRATION_STREAM_PURPOSES,
  TARGET_TIE_RATE,
  type AssetDefinition,
  type CalibratedAsset,
  type CalibrationEvidence,
  type CalibrationOptions,
} from './asset.js';
export { personalityConfig } from './personality.js';
export {
  ASSET_CATALOGUE,
  assetById,
  configFor,
  registrationKeyLabel,
  type AuthoringTargets,
  type RegisteredAsset,
} from './catalogue.js';
