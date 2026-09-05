export * from './attacks/index.js';
export {
  assessRealism,
  assessRealismAsync,
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
  yieldToLoop,
  type DatasetBuildOptions,
  type ObserverDataset,
  type PublicInstrument,
} from './observer.js';
export {
  defaultStrideMs,
  PHASE_SWEEP_OFFSET_MS,
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
  DEFAULT_STANDING_CADENCE_MS,
  isStandingRunDue,
  PRODUCT_MARGIN_PP,
  runStandingAssurance,
  StandingAssuranceError,
  type HorizonStanding,
  type StandingFinding,
  type StandingOutcome,
  type StandingRunOptions,
  type StandingVerdict,
  composeFamilies,
} from './standing.js';
export { tickGranularity, type GranularityReport } from './granularity.js';
export {
  readServedRecord,
  PUBLIC_INSTRUMENT_FIELDS,
  ServedRecordError,
  SseParser,
  type Discontinuity,
  type ServedClose,
  type ServedGap,
  type ServedRecord,
  type ServedRecordOptions,
  type StopRule,
} from './served/servedRecord.js';
export {
  joinServedRecords,
  seamIndicesOf,
  servedAssurance,
  type ServedAssuranceOptions,
} from './served/servedAssurance.js';
