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
export {
  designEffect,
  minimumDetectableEffectUnderDependence,
  type DesignEffectResult,
} from './dependence.js';
export { BINARY_HORIZONS, horizonByLabel, type HorizonSpec } from './horizons.js';
export { HorizonAccumulator, type HorizonOutcome } from './horizonTally.js';
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
export {
  assetSignature,
  differentiationPValue,
  permutationPValue,
  measureDifferentiation,
  SHAPE_FEATURES,
  SIGNATURE_FEATURES,
  type AssetSignature,
  type DifferentiationResult,
} from './differentiation.js';
export {
  JournalError,
  journalFingerprint,
  journalPriceAt,
  journalSeries,
  readJournal,
  writeJournal,
  type TickJournal,
} from './assurance.js';
export {
  adjustmentCoefficient,
  capacity,
  growthOptimalFraction,
  logGrowthPerEvent,
  ruinProbability,
  simulateRuin,
  type RuinInputs,
  type RuinResult,
} from './ruin.js';
export {
  assertIndependentFamilies,
  assessHorizon,
  DEFAULT_REPLICATE_BLOCKS,
  DEFAULT_STANDING_CADENCE_MS,
  isStandingRunDue,
  PRODUCT_MARGIN_PP,
  runStandingAssurance,
  StandingAssuranceError,
  type HorizonStanding,
  type StandingOutcome,
  type StandingRunOptions,
  type StandingVerdict,
} from './standing.js';
