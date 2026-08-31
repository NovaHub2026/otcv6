// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import {
  epochMillis,
  logPrice,
  MasterKeyring,
  type InstrumentSpec,
  type RandomSource,
} from '@otc/core';
import {
  CascadeMagnitudeModel,
  DEFAULT_CASCADE,
  DEFAULT_REGIMES,
  DEFAULT_STRUCTURE,
  DEFAULT_DURATION_COUPLING,
  DEFAULT_HAWKES,
  DurationCouplingModulator,
  HawkesArrivalModel,
  MarketEngine,
  ModulatedMagnitudeModel,
  PoissonArrivalModel,
  StructurePhaseModulator,
  VolatilityRegimeModulator,
} from '@otc/engine';
import { buildObserverDataset, formatValidationReport, runValidation } from '@otc/lab';

/**
 * PH-3.1: the first real market, put in front of the instrument built to break it.
 *
 * The engine is unexploitable by construction — increments are a sign-blind
 * magnitude times an independent fair coin, and the mirror test proves the
 * precondition holds in the code. This suite checks that the attack battery
 * agrees, and measures how much realism the volatility cascade alone buys.
 *
 * Some realism metrics are expected to fail at this stage. Recording which is
 * the point: PH-3.2 and PH-3.3 exist to close whatever gap this measures, and a
 * gap that was never measured cannot be closed deliberately.
 */

const instrument: InstrumentSpec = {
  id: 'ph31-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const TICKS = 4_000_000;
const MEAN_INTERVAL_MS = 5_000;

/**
 * Engine configurations, built up layer by layer.
 *
 * Running each level separately is what makes a realism movement attributable to
 * the mechanism that caused it rather than to chance.
 */
export type EngineLevel =
  /** PH-3.1: cascade and Poisson arrivals. */
  | 'cascade'
  /** PH-3.2: plus volatility regime and structure phase. */
  | 'layered'
  /** PH-3.3: plus duration coupling and self-exciting arrivals. */
  | 'full';

function buildEngine(level: EngineLevel, maxTicks = TICKS): MarketEngine {
  const layered = level !== 'cascade';
  const keyring = MasterKeyring.forTesting('ph3-validation');
  const derive = (purpose: string): RandomSource =>
    keyring.derive({ env: 'simulation', asset: instrument.id, purpose, keyEpoch: 0 });

  const cascade = derive('cascade');
  const shock = derive('shock');
  const arrival = derive('arrival');
  const regime = derive('regime');
  const structure = derive('structure');

  // Base volatility chosen so a typical tick moves about ten lattice steps,
  // keeping ties rare and the quote grid far from being a tradeable signal.
  const base = new CascadeMagnitudeModel(1e-5, DEFAULT_CASCADE, cascade, shock);
  const magnitude = layered
    ? new ModulatedMagnitudeModel(base, [
        new VolatilityRegimeModulator(DEFAULT_REGIMES, regime),
        new StructurePhaseModulator(DEFAULT_STRUCTURE, structure),
        ...(level === 'full'
          ? [new DurationCouplingModulator(DEFAULT_DURATION_COUPLING, MEAN_INTERVAL_MS)]
          : []),
      ])
    : base;

  return new MarketEngine({
    instrument,
    magnitude,
    arrival:
      level === 'full'
        ? new HawkesArrivalModel(DEFAULT_HAWKES, arrival)
        : new PoissonArrivalModel(MEAN_INTERVAL_MS, arrival),
    streams: {
      sign: derive('sign'),
      rounding: derive('rounding'),
      models: layered
        ? { cascade, shock, arrival, regime, structure }
        : { cascade, shock, arrival },
    },
    start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
    maxTicks,
  });
}

// Several tests examine the same configuration from different angles.
// Regenerating four million ticks for each was most of this file's runtime, and
// caching also guarantees every test sees the identical stream.
const datasets = new Map<string, Promise<Awaited<ReturnType<typeof buildObserverDataset>>>>();

function datasetFor(level: EngineLevel): Promise<Awaited<ReturnType<typeof buildObserverDataset>>> {
  const cached = datasets.get(level);
  if (cached !== undefined) return cached;
  const built = buildObserverDataset({ source: buildEngine(level), maxTicks: TICKS });
  datasets.set(level, built);
  return built;
}

const reports = new Map<string, Promise<Awaited<ReturnType<typeof runValidation>>>>();

async function reportFor(level: EngineLevel) {
  const cached = reports.get(level);
  if (cached !== undefined) return cached;
  const built = datasetFor(level).then((dataset) => runValidation(dataset));
  reports.set(level, built);
  return built;
}

describe('the cascade engine under full validation', () => {
  it('is unexploitable and its realism gap is measured', async () => {
    const report = await reportFor('cascade');
    console.info(formatValidationReport(report));

    // The architecture guarantees this; the battery is the independent check.
    expect(report.predictability.clean).toBe(true);
    expect(report.predictability.coverage.hypothesesTested).toBeGreaterThan(300);
    expect([...report.predictability.coverage.featureKinds].sort()).toEqual([
      'learned',
      'level-anchored',
      'temporal',
      'translation-invariant',
    ]);

    // The cascade's job: volatility clustering with slow decay.
    const metric = (name: string) => report.realism.metrics.find((m) => m.name === name)!;
    expect(metric('absolute-return-autocorrelation-lag1').pass).toBe(true);
    expect(metric('absolute-return-long-memory').pass).toBe(true);
    expect(metric('volatility-clustering-dominance').pass).toBe(true);
    expect(metric('excess-kurtosis').pass).toBe(true);

    // Sign behaviour must be exactly a fair coin.
    expect(metric('mean-run-length').pass).toBe(true);
    expect(metric('return-autocorrelation-lag1').pass).toBe(true);

    console.info(
      `PH-3.1 realism: ${report.realism.passed}/${report.realism.metrics.length}` +
        (report.realism.failed.length > 0
          ? ` — not yet passing: ${report.realism.failed.join(', ')}`
          : ' — all metrics pass'),
    );
  });

  it('generates far faster than real time', async () => {
    const started = process.hrtime.bigint();
    const dataset = await buildObserverDataset({
      source: buildEngine('full', 1_000_000),
      maxTicks: 1_000_000,
    });
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const simulatedDays = (dataset.lastInstant - dataset.firstInstant) / 86_400_000;
    console.info(
      `engine throughput: ${(1_000_000 / seconds / 1e6).toFixed(2)}M ticks/s — ` +
        `${simulatedDays.toFixed(0)} simulated days in ${seconds.toFixed(1)}s`,
    );
    // The floor encodes the product requirement, not this machine's speed. A
    // hosted market ticks about once per second per asset, so anything above a
    // few thousand ticks per second is already "far faster than real time" by
    // orders of magnitude.
    //
    // It is set well below observed throughput on purpose. Cycle Audit 001 found
    // this assertion failing at 116k ticks/s under v8 coverage instrumentation
    // while the same engine sustains ~800k ticks/s uninstrumented — a test that
    // passes or fails according to how the suite was invoked is a defect, not a
    // flake, and a shared CI runner would have tripped it too.
    const REAL_TIME_MULTIPLE_FLOOR = 20_000;
    expect(1_000_000 / seconds).toBeGreaterThan(REAL_TIME_MULTIPLE_FLOOR);
  });
});

describe('the layered engine: regimes and structure', () => {
  it('is still unexploitable with both layers active', async () => {
    const report = await reportFor('layered');
    console.info(formatValidationReport(report));

    // The layers add episodes; they must add no direction. The structure
    // layer's hazard depends on path length per unit time, which is
    // reflection-invariant, and the mirror test proves the consequence.
    expect(report.predictability.clean).toBe(true);
    expect(report.realism.plausible).toBe(true);
    expect(report.acceptable).toBe(true);
  });

  it('widens the volatility regime range relative to the cascade alone', async () => {
    const plain = await reportFor('cascade');
    const layered = await reportFor('layered');
    const value = (report: typeof plain, name: string) =>
      report.realism.metrics.find((m) => m.name === name)!.value;

    const plainRange = value(plain, 'volatility-regime-range');
    const layeredRange = value(layered, 'volatility-regime-range');
    const plainHeterogeneity = value(plain, 'displacement-heterogeneity');
    const layeredHeterogeneity = value(layered, 'displacement-heterogeneity');
    console.info(
      `volatility regime range: ${plainRange.toFixed(1)} -> ${layeredRange.toFixed(1)}; ` +
        `displacement heterogeneity: ${plainHeterogeneity.toFixed(1)} -> ${layeredHeterogeneity.toFixed(1)}`,
    );
    // Episodes should make quiet and violent periods differ more, which is the
    // whole point of adding them.
    expect(layeredRange).toBeGreaterThan(plainRange);
  });
});

describe('the complete engine: arrivals and duration coupling', () => {
  it('is unexploitable with every layer active', async () => {
    const report = await reportFor('full');
    console.info(formatValidationReport(report));
    expect(report.predictability.clean).toBe(true);
    expect(report.realism.plausible).toBe(true);
    expect(report.acceptable).toBe(true);
  });

  it('thickens intra-bar structure, which is what the arrivals were for', async () => {
    const layered = await reportFor('layered');
    const full = await reportFor('full');
    const value = (report: typeof full, name: string) =>
      report.realism.metrics.find((m) => m.name === name)!.value;

    const before = value(layered, 'two-sided-wick-fraction');
    const after = value(full, 'two-sided-wick-fraction');
    console.info(
      `two-sided wicks: ${before.toFixed(4)} -> ${after.toFixed(4)}; ` +
        `excess kurtosis: ${value(layered, 'excess-kurtosis').toFixed(1)} -> ${value(full, 'excess-kurtosis').toFixed(1)}`,
    );
    // Activity that bursts puts more ticks inside active bars, and wicks come
    // from price moving both ways within a bar.
    expect(after).toBeGreaterThan(before);
    // Tails must stay inside the band the realism battery fixed in PH-2.
    expect(value(full, 'excess-kurtosis')).toBeLessThan(200);
  });
});
