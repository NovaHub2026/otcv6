export * from './attacks/index.js';
export {
  assessRealism,
  formatRealismReport,
  type RealismMetric,
  type RealismOptions,
  type RealismReport,
} from './realism.js';
export {
  formatValidationReport,
  runValidation,
  type ValidationOptions,
  type ValidationReport,
} from './report.js';
export {
  assessEconomics,
  breakevenWinRate,
  expectedValuePerTrade,
  PAYOUT_PROMOTIONAL,
  PAYOUT_TYPICAL,
  profitabilityRatio,
  profitabilityThresholdPoints,
  STANDARD_PAYOUTS,
  type EconomicAssessment,
} from './economics.js';
export { BINARY_HORIZONS, horizonByLabel, type HorizonSpec } from './horizons.js';
export {
  aggregatorFor,
  buildObserverDataset,
  datasetFromTicks,
  toPublicInstrument,
  type DatasetBuildOptions,
  type ObserverDataset,
  type PublicInstrument,
} from './observer.js';
export {
  sampleOutcomes,
  upRate,
  type EntryMode,
  type Outcome,
  type OutcomeSampling,
  type SamplingOptions,
  type SamplingSkips,
} from './outcomes.js';
export {
  benjaminiHochberg,
  binomialProportionTest,
  minimumDetectableEffect,
  movingBlockBootstrap,
  normalCdf,
  normalQuantile,
  samplesForEffect,
  twoSidedPValue,
  type BenjaminiHochbergResult,
  type BootstrapResult,
  type ProportionTest,
} from './statistics.js';
