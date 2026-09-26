import { VolatilityFloorModulator } from './floor.js';
import {
  assertValidInstrument,
  epochMillis,
  ln,
  type AssetFamily,
  type InstrumentSpec,
  type RandomSource,
} from '@otc/core';
import { yieldToLoop } from '@otc/core';
import { CascadeMagnitudeModel } from './cascade.js';
import type { MarketEngineConfig } from './factory.js';
import { DurationCouplingModulator, HawkesArrivalModel } from './hawkes.js';
import { ModulatedMagnitudeModel, type Modulator } from './modulator.js';
import {
  assertPersonalitySafe,
  assertPersonalityTraits,
  personalityConfig,
  type PersonalityTraits,
} from './personality.js';
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
  /**
   * The at-the-money rate this lattice actually produces at the shortest
   * horizon, measured on the published series rather than on continuous
   * returns (PH-37). This is the number {@link MAX_REFUND_RATE} bounds.
   */
  readonly realisedRefundRate: number;
  /** How much coarser than the quantile's own lattice the chosen one is. */
  readonly refundLatticeFactor: number;
  /** Median move over the calibration horizon, in lattice steps. */
  readonly medianSteps: number;
  readonly meanIntervalMs: number;
  /**
   * Variance of the log price accumulated per millisecond of market time.
   *
   * The one number in this record that describes where the price *goes* rather
   * than how it is quantised, and it comes free: the calibration already
   * accumulates a full-precision walk and windows it, so the mean square of
   * those windowed returns divided by the horizon is the diffusion rate.
   *
   * Increments are uncorrelated by construction — ADR-0003 makes every sign an
   * independent fair coin — so variance is additive in time and this rate
   * extrapolates to any window by multiplication. That is what turns a ten-day
   * calibration into a statement about a quarter without simulating a quarter.
   *
   * It is a rate, not a promise: it is conditioned on the volatility levels the
   * calibration span happened to visit, and a span shorter than the slowest
   * cascade component under-samples them.
   */
  readonly logVariancePerMs: number;
  readonly horizonMs: number;
  /** Span of each replicate. */
  readonly simulatedMs: number;
  readonly replicates: number;
  readonly horizons: number;
  /**
   * Factor applied to every scale-carrying number after the simulation ran.
   *
   * 1 when the calibration was run at the volatility the definition records.
   * Anything else means the run happened at `volatility / volatilityScale` and
   * the results were scaled — see {@link rescaleCalibration}, which is exact
   * rather than approximate, and is why a registration that has to hit a
   * dispersion budget still costs one simulation instead of a search.
   *
   * Recorded because an audit re-running this calibration has to know which
   * volatility produced the numbers. Without it the record would reproduce and
   * nobody could say why.
   */
  readonly volatilityScale: number;
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

/**
 * The most at-the-money contracts a lattice may produce at the shortest
 * horizon, measured on the series that settles.
 *
 * **PH-37, and it is the Human Owner's number.** {@link TARGET_TIE_RATE} is a
 * quantile of *continuous* returns and is now only where the search starts;
 * what a lattice is chosen by is this, the realised rate — the published
 * integer unchanged between entry and expiry — because that is what a refund
 * costs (ADR-0007).
 *
 * The reason the number moved at all is texture rather than economics. At the
 * 1% proxy the catalogue published a price one to two orders of magnitude finer
 * than the instruments it is named for — EUR/USD 27 times finer than a pipette,
 * NU 320 times finer than a cent — so **the price moved on 93–99% of ticks**,
 * jaggedly, where a real EUR/USD tape leaves 45.8% of its ticks unchanged. The
 * Human Owner, watching it, said the market looked volatile when it was not.
 *
 * Anchoring each asset to its real instrument's increment was measured and
 * rejected: it is not uniform. It leaves PBR and NU — an 18-dollar and a
 * 14-dollar stock on a one-cent lattice — refunding 26% and 45% of
 * thirty-second contracts. A ceiling is uniform, and the texture each asset
 * gets under it is whatever its own volatility allows.
 */
export const MAX_REFUND_RATE = 0.05;

/**
 * How much coarser than the starting quantum the search may go, in steps.
 *
 * Geometric, because what the eye reads is the ratio of a typical step to the
 * lattice. Measured across the thirty, the chosen factor lands between 4 and 32.
 */
export const REFUND_CANDIDATE_FACTORS: readonly number[] = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/**
 * Thirty-second horizons the refund measurement runs over.
 *
 * At 8,000 windows the standard error on a 5% rate is 0.24 points, which is
 * finer than the gap between two neighbouring candidate factors produces.
 */
export const REFUND_FIT_HORIZONS = 8_000;

/**
 * What this target actually is, measured.
 *
 * Calibration compares a *continuous* log return against the candidate quantum,
 * because the quantum is the quantity being chosen and the measurement cannot
 * depend on it. A real tie is a different event: the published integer price
 * unchanged between entry and expiry.
 *
 * Those two are close but not equal, and Cycle Audit 2 measured the gap. On the
 * real published lattice the realised rate is roughly half the 1% the continuous
 * proxy reports — about 5.5 standard errors away. Tick-anchored entries land
 * lower still, near 0.3%.
 *
 * So `TARGET_TIE_RATE` is a calibration knob whose realised lattice value is
 * about half its nominal one. The consequence is economically nil under
 * ADR-0007, since a tie is refunded either way, and the direction is the safe
 * one — fewer ties than intended, not more. It is recorded because the earlier
 * claim that "exactly 1% of shortest-horizon contracts settle at the money" was
 * simply not true of the series that settles.
 *
 * ## Why these numbers are not Cycle Audit 2's
 *
 * They were, until PH-10. The audit measured 0.47% / 0.71% / 0.59% / 0.45% /
 * 0.50% on the pre-rhythm catalogue, and re-authoring the cascade's time
 * structure changed the 30-second return distribution and therefore these rates.
 * **Nothing failed.** This constant was exported, documented as measured
 * evidence, and read by no code and no test, so a change to the process it
 * describes could not invalidate it out loud.
 *
 * `latticeTies.stat.test.ts` now re-derives every value here from stream
 * families the measurement never used. That is the difference between a recorded
 * measurement and a comment.
 *
 * ## Each figure is a mean over replicates, and it has to be
 *
 * The first attempt measured one long run per asset and quoted a binomial
 * standard error. Re-measuring on a second seed moved three of the five by three
 * to four times that error — eurusd 0.58% to 0.42%, btcusd 0.48% to 0.32%.
 *
 * The binomial was wrong for the reason it is always wrong here, and this is now
 * the third time the project has met it: 20,000 consecutive 30-second horizons
 * are **one realisation**, not 20,000 independent draws. Volatility clusters, so
 * whether a horizon ties is strongly autocorrelated with its neighbours. Cycle
 * Audit 2 found the same error behind INV-007's p-value, and B-002 is the same
 * fact wearing its third face.
 *
 * The measured between-replicate standard deviation is 0.10-0.19pp — measured
 * when these rates were around 0.4%, and **four times too small for today's**
 * (Cycle Audit 13, a1-4): at 3.5-4.8% an auditor measured 0.7-0.8pp per
 * replicate, so a figure quoted here to four significant figures is worth about
 * one. The band the tie test enforces is computed from each run's own replicates,
 * not from this sentence. Against a
 * binomial 2se of 0.09pp for a single 20,000-horizon run, which is to say the
 * naive figure understated the real uncertainty by roughly four times.
 *
 * Each value below is therefore a mean over replicates. **These values are
 * PH-26.3's**: twelve replicates of 8,000 horizons per asset, produced by
 * `npm run evidence:ties` — `tools/sim/src/tieRateEvidence.ts`, the verifying
 * test's own procedure — on `ties-verify-<asset>-<n>` for all thirty assets of
 * the catalogue, on 2026-09-04. The limiting quantity is not horizons sampled
 * but independent volatility epochs simulated: one replicate spans 67 hours —
 * a horizon count, so a tempo change does not move it — and the slowest
 * cascade components turn over in a day or two, so a replicate contains only a
 * handful of independent volatility levels. Sampling more horizons inside one
 * run buys almost nothing.
 *
 * The verifying test, `latticeTies.stat.test.ts`, measures a stratified sample
 * of these on `ties-fresh-<asset>-<n>` — a family the recording never touched —
 * so a pass means the rate is a property of the process at these parameters
 * and not of the twelve seeds it was read from (Cycle Audit 8, a5, closed
 * that way for the five; PH-26.3 keeps it for the thirty). Every one of the
 * thirty sits below {@link MAX_REFUND_RATE}, which since PH-37 is what a
 * lattice is chosen by — the 1% nominal quantile is only where that search
 * starts, because a tie is an integer-price event and the quantile measures a
 * continuous proxy for it.
 *
 * **Re-measured on 2026-09-23 (PH-37.2)**: **3.45% to 4.77%, mean 3.96%**, and
 * that is the headline of the phase rather than a side effect of it. The
 * lattices were between 6 and 356 times finer than the instruments the assets
 * are named for, so the price moved on 93–99% of ticks and the market looked
 * volatile when it was not. They are ×12 or ×16 coarser now, chosen per asset
 * as the coarsest that clears a 5% ceiling by the standard error of its own
 * measurement, and what that buys is the staircase: the price rests and then
 * steps, the way a real tape does.
 *
 * A tie is refunded (ADR-0007), so this is the refund rate a broker sees, and
 * it is the cost the Human Owner chose with the measured table in front of
 * them: three to five contracts in a hundred at thirty seconds, against three
 * in a thousand. The previous values are history — PH-26.3's 0.42%–0.53%,
 * PH-34's 0.085%–0.267% at 1.7× the real instrument, PH-35's 0.167%–0.435%
 * back at its level — and every one of them was a lattice kept rather than
 * chosen.
 */
export const MEASURED_LATTICE_TIE_RATES = {
  'eurusd-otc': 0.0353,
  'gbpusd-otc': 0.04305,
  'usdjpy-otc': 0.04273,
  'audusd-otc': 0.04504,
  'usdchf-otc': 0.03852,
  'eurgbp-otc': 0.04079,
  'gbpjpy-otc': 0.03867,
  'eurjpy-otc': 0.04768,
  'aapl-otc': 0.03447,
  'msft-otc': 0.03857,
  'nvda-otc': 0.03683,
  'tsla-otc': 0.04305,
  'meta-otc': 0.03939,
  'amzn-otc': 0.03948,
  'pbr-otc': 0.04142,
  'nu-otc': 0.04215,
  'btcusdt-otc': 0.03782,
  'ethusdt-otc': 0.04343,
  'bnbusdt-otc': 0.03499,
  'solusdt-otc': 0.03991,
  'xrpusdt-otc': 0.04053,
  'dogeusdt-otc': 0.03969,
  'mmx-idx-otc': 0.03735,
  'cgx-idx-otc': 0.03603,
  'aix-idx-otc': 0.03587,
  'tcx-idx-otc': 0.03886,
  'scx-idx-otc': 0.04005,
  'gmx-idx-otc': 0.03809,
  'evx-idx-otc': 0.04235,
  'brx-idx-otc': 0.03601,
} as const;

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
  /** Ceiling on the realised at-the-money rate; defaults to {@link MAX_REFUND_RATE}. */
  readonly maxRefundRate?: number;
  /** Horizons the refund measurement runs over; defaults to {@link REFUND_FIT_HORIZONS}. */
  readonly refundHorizons?: number;
  /** Yield to the event loop every this many ticks, in the async variant. */
  readonly chunkTicks?: number;
}

/** Default yield interval, matching `buildObserverDataset`. */
export const CALIBRATION_CHUNK_TICKS = 250_000;

/** Stream purposes a calibration run consumes. */
export const CALIBRATION_STREAM_PURPOSES = [
  'cascade',
  'shock',
  'regime',
  'structure',
  'arrival',
  'sign',
] as const;

/**
 * Decimals to render at, from the lattice that settles.
 *
 * The display must never be coarser than the lattice: a trader seeing an
 * unchanged price on a move that settled would be a fairness problem even with
 * INV-009 intact.
 *
 * Floored at zero. **Cycle Audit 7, a3-07.** A lattice step of ten display
 * units or more — a large reference price on a coarse quantum — made this
 * negative, and a legal asset was refused after its whole calibration with a
 * message about display precision. Zero decimals is the honest answer there:
 * the lattice moves in whole units, and so does the screen.
 */
function displayPrecisionFor(logQuantum: number, referencePrice: number): number {
  return Math.max(0, Math.ceil(ln(1 / (logQuantum * referencePrice)) / ln(10)));
}

/**
 * The magnitude the first tick of a calibration is told preceded it, in units
 * of the base volatility.
 *
 * No quantum exists yet, so `previousMagnitude` cannot be in lattice steps; the
 * walk normalises every later magnitude by the base volatility instead, and
 * this seeds the arrival process's running average at the same ten the engine's
 * `referenceMagnitude` starts from. Only the first tick sees it.
 */
const CALIBRATION_INITIAL_MAGNITUDE = 10;

/**
 * Fewest windowed returns a replicate may contribute.
 *
 * The quantum is a 1% quantile, so a replicate with fewer than a hundred
 * horizons has no observation in the tail it is meant to measure and would
 * return its smallest return as the lattice.
 */
const MIN_HORIZONS_PER_REPLICATE = 100;

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
/**
 * The realised at-the-money rate of each candidate lattice, on one walk.
 *
 * **What a refund actually is.** The calibration's own returns are continuous,
 * and a tie is not: it is the *published integer* unchanged between entry and
 * expiry, on a price that moves by `floor(|move| / quantum + u)` with `u`
 * uniform — the stochastic rounding ADR-0004 quantises the magnitude with. Half
 * a quantum of movement is one step half the time and none the other half, so
 * the realised rate and the continuous quantile differ by about a factor of two
 * and neither predicts the other well enough to choose a lattice by.
 *
 * **Why every candidate can share one walk.** Before PH-37.1 it could not: the
 * arrival process was excited by the floored step count, so each quantum
 * produced a different tape — 1.00 ticks a second against 0.74 across a factor
 * of 27 on EUR/USD. The layers above see the magnitude now, so the walk is the
 * same market whatever it is published on, and the candidates differ only in
 * where they round. They share the rounding draw too, which is faithful for
 * each of them and leaves the comparison between them almost noiseless.
 */
function* realisedTieRatesCore(
  config: Omit<MarketEngineConfig, 'instrument'>,
  derive: (purpose: string) => RandomSource,
  horizonMs: number,
  horizons: number,
  quantum: number,
  factors: readonly number[],
  chunkTicks: number,
): Generator<void, readonly number[]> {
  // The engine's own stack, floor included. **The floor is why this had to be
  // built here rather than borrowed from `horizonReturnsCore`:** that helper
  // omits it, so the market it measures is quieter in its calm stretches than
  // the one the engine runs, and a quieter market ties more. Measured against
  // `evidence:ties` on the first build, the fit read about 1.3 points high on
  // every asset, which is texture given away. (That `horizonReturnsCore` is
  // missing the floor is a finding about the *quantile* too, and a larger one:
  // it is recorded in the decision log rather than fixed here, because moving
  // it moves every asset's volatility.)
  const inner = new CascadeMagnitudeModel(
    config.baseVolatility,
    config.cascade,
    derive('refund-cascade'),
    derive('refund-shock'),
  );
  const regime = new VolatilityRegimeModulator(config.regimes, derive('refund-regime'));
  const structure = new StructurePhaseModulator(config.structure, derive('refund-structure'));
  const modulators: Modulator[] = [
    regime,
    structure,
    new DurationCouplingModulator(config.durationCoupling, config.arrival.baseIntervalMs),
  ];
  if (config.volatilityFloor !== null) {
    modulators.push(
      new VolatilityFloorModulator(config.volatilityFloor, {
        regimeLevel: () => regime.levelInForce,
        cascadeProduct: () => inner.cascade.current(),
        structureMultiplier: () => structure.multiplierInForce,
      }),
    );
  }
  const magnitude = new ModulatedMagnitudeModel(inner, modulators);
  // The regime drives the arrival rate too, exactly as `createMarketEngine`
  // wires it: half of what a regime does is more ticks (PH-34, and a quarter of
  // it since PH-37.1). Without this the fit measured a market whose agitated
  // stretches were quieter than the engine's — the second layer this helper had
  // to stop omitting, after the floor, and the one that kept EUR/GBP's lattice
  // above the ceiling on the independent verification.
  const arrival = new HawkesArrivalModel(config.arrival, derive('refund-arrival'), regime);
  const sign = derive('refund-sign');
  const rounding = derive('refund-rounding');
  const referenceUnit = config.baseVolatility;

  const quanta = factors.map((factor) => quantum * factor);
  const prices = new Float64Array(quanta.length);
  const entries = new Float64Array(quanta.length);
  const ties = new Array<number>(quanta.length).fill(0);

  let elapsedMs = 0;
  let previousMagnitude = CALIBRATION_INITIAL_MAGNITUDE;
  let previousIntervalMs = 0;
  let sequence = 0;
  let horizonEndMs = horizonMs;
  let settled = 0;
  const simulatedMs = horizonMs * horizons;

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
    const direction = sign.nextBoolean() ? 1 : -1;
    const u = rounding.nextFloat64();
    for (let k = 0; k < quanta.length; k += 1) {
      prices[k]! += direction * Math.floor(move / quanta[k]! + u);
    }
    sequence += 1;

    while (elapsedMs >= horizonEndMs) {
      // The window that just closed settles against where it opened, and the
      // next one opens on the price that closed it — entry and expiry on the
      // published series, which is what `settle()` compares (ADR-0004).
      if (settled > 0) {
        for (let k = 0; k < quanta.length; k += 1) {
          if (prices[k] === entries[k]) ties[k]! += 1;
        }
      }
      for (let k = 0; k < quanta.length; k += 1) entries[k] = prices[k]!;
      settled += 1;
      horizonEndMs += horizonMs;
    }
    if (sequence % chunkTicks === 0) yield;
  }
  const windows = Math.max(1, settled - 1);
  return ties.map((count) => count / windows);
}

function* horizonReturnsCore(
  config: Omit<MarketEngineConfig, 'instrument'>,
  derive: (purpose: string) => RandomSource,
  horizonMs: number,
  simulatedMs: number,
  chunkTicks: number,
): Generator<void, { returns: number[]; ticks: number }> {
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
  let previousMagnitude = CALIBRATION_INITIAL_MAGNITUDE;
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

    // Yield periodically. A calibration run is millions of iterations, and a
    // synchronous block that long starves whatever else shares the loop — a test
    // runner's progress channel today, a runtime's request handling later.
    if (sequence % chunkTicks === 0) yield;
  }
  return { returns, ticks: sequence };
}

/**
 * Register an asset: validate it, then derive its lattice from its own behaviour.
 *
 * The order matters. Bounds and the analytic kurtosis gate run first and cost
 * microseconds; only a personality that survives both is worth simulating.
 */
function* calibrateAssetCore(
  definition: AssetDefinition,
  derive: (purpose: string) => RandomSource,
  options: CalibrationOptions,
): Generator<void, CalibratedAsset> {
  const horizonMs = options.horizonMs ?? CALIBRATION_HORIZON_MS;
  const simulatedMs = options.simulatedMs ?? CALIBRATION_SPAN_MS;
  const targetTieRate = options.targetTieRate ?? TARGET_TIE_RATE;
  if (!(targetTieRate > 0) || targetTieRate >= 1) {
    throw new RangeError(`Target tie rate must be in (0, 1), received ${targetTieRate}.`);
  }

  const config = personalityConfig(definition.traits);
  // The gate is a property of the volatility layers and reads no instrument.
  // PH-4.2 had to invent a provisional lattice here purely to satisfy the config
  // type; PH-10.1 widened the gate to the instrument-free half, so the fiction
  // is gone rather than documented.
  const predicted = assertPersonalitySafe(config, derive('structure-gate'));

  const replicates = options.replicates ?? CALIBRATION_REPLICATES;
  if (!Number.isInteger(replicates) || replicates < 1) {
    throw new RangeError(`Replicates must be a positive integer, received ${replicates}.`);
  }

  const perReplicate = [];
  let totalTicks = 0;
  let totalHorizons = 0;
  const pooled: number[] = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const { returns, ticks } = yield* horizonReturnsCore(
      config,
      (purpose: string) => derive(`${purpose}-r${replicate}`),
      horizonMs,
      simulatedMs,
      options.chunkTicks ?? CALIBRATION_CHUNK_TICKS,
    );
    if (returns.length < MIN_HORIZONS_PER_REPLICATE) {
      throw new RangeError(
        `Calibration produced only ${returns.length} horizons; simulate a longer span.`,
      );
    }
    const sortedReplicate = [...returns].sort((a, b) => a - b);
    perReplicate.push(quantile(sortedReplicate, targetTieRate));
    totalTicks += ticks;
    totalHorizons += returns.length;
    // `pooled.push(...returns)` spreads the whole replicate onto the argument
    // stack, and a long calibration overflows it: 32 turnovers of a 46-hour
    // cascade is 61 simulated days, 176,000 windowed returns, and a
    // `RangeError: Maximum call stack size exceeded` from a line that looks
    // like a copy. Found by raising `DISPERSION_FIT_TURNOVERS` — the defect was
    // latent for as long as spans stayed short.
    for (const value of returns) pooled.push(value);
  }

  // Median across replicates, not mean: the quantity being combined is a
  // quantile of a heavy-tailed variable, and one unlucky replicate should not
  // move the lattice.
  const orderedQuanta = [...perReplicate].sort((a, b) => a - b);
  const startingQuantum = orderedQuanta[Math.floor(orderedQuanta.length / 2)]!;
  const returns = pooled;
  const ticks = totalTicks;
  const sorted = [...returns].sort((a, b) => a - b);
  if (!(startingQuantum > 0)) {
    throw new RangeError(
      `Calibration produced a non-positive quantum for ${definition.id}: the asset does not move.`,
    );
  }

  // **The lattice is chosen by what it refunds, measured (PH-37).** The
  // quantile above is where the search starts; the lattice is the coarsest
  // candidate whose *realised* at-the-money rate stays at or below the ceiling,
  // because that is the number the ceiling is about and the quantile is not.
  // Coarsest, not nearest: what the ceiling buys is the staircase, and every
  // step below it is texture given away for refunds nobody asked to avoid.
  const maxRefundRate = options.maxRefundRate ?? MAX_REFUND_RATE;
  if (!(maxRefundRate > 0) || maxRefundRate >= 1) {
    throw new RangeError(`Max refund rate must be in (0, 1), received ${maxRefundRate}.`);
  }
  const factors = REFUND_CANDIDATE_FACTORS;
  // **One walk was not enough, and the measurement says why.** At 8,000
  // horizons a walk covers 66 hours, and the slowest cascade component of a
  // catalogue asset turns over in about 41: one and a half turnovers, so what
  // the fit measured was largely which state that component happened to sit in.
  // Verified against `evidence:ties` — twelve replicates on a stream family the
  // calibration never uses — GBP/USD chose its lattice on 4.44% and settles
  // 1.73%, which left it three steps finer than the ceiling allows, and the
  // texture this phase exists for is exactly what those steps are.
  //
  // So the fit runs the calibration's own replicate count, each on its own
  // streams, and averages. It is the same trade the quantile above already
  // makes, for the same reason.
  const refundHorizons = options.refundHorizons ?? REFUND_FIT_HORIZONS;
  const perReplicateRates: number[][] = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    perReplicateRates.push([
      ...(yield* realisedTieRatesCore(
        config,
        (purpose: string) => derive(`${purpose}-r${replicate}`),
        horizonMs,
        refundHorizons,
        startingQuantum,
        factors,
        options.chunkTicks ?? CALIBRATION_CHUNK_TICKS,
      )),
    ]);
  }
  // **The ceiling is honoured with the measurement's own error, not at its
  // point estimate.** With the fit measuring the engine's real stack it lands
  // *on* the ceiling, and half of a distribution centred on a ceiling is above
  // it: verified against `evidence:ties`, five of the thirty came back at
  // 5.00%–5.30% where 5% is the bound. A ceiling something crosses is not a
  // ceiling, so a candidate has to clear it by the standard error of its own
  // replicates — which is self-calibrating: a noisy asset is held further back
  // than a quiet one, and no constant has to be guessed.
  const realised: readonly number[] = factors.map((_, k) => {
    const rates = perReplicateRates.map((row) => row[k]!);
    const mean = rates.reduce((sum, r) => sum + r, 0) / rates.length;
    if (rates.length < 2) return mean;
    const variance =
      rates.reduce((sum, r) => sum + (r - mean) * (r - mean), 0) / (rates.length - 1);
    return mean + Math.sqrt(variance / rates.length);
  });
  let chosen = 0;
  for (let k = 0; k < factors.length; k += 1) {
    if (realised[k]! <= maxRefundRate) chosen = k;
  }
  // The finest candidate is the quantile's own lattice. If even that refunds
  // past the ceiling the asset cannot honour it at this horizon — it moves too
  // little between entry and expiry — and the right answer is to say so rather
  // than to publish a lattice finer than the calibration can measure.
  if (realised[0]! > maxRefundRate) {
    throw new RangeError(
      `${definition.id} settles ${(realised[0]! * 100).toFixed(2)}% of its ` +
        `${horizonMs / 1000}s contracts at the money on the finest lattice its own returns ` +
        `support, past the ${(maxRefundRate * 100).toFixed(1)}% ceiling. Nothing coarser can ` +
        `help: this asset does not move far enough at that horizon.`,
    );
  }
  const logQuantum = startingQuantum * factors[chosen]!;
  // What is recorded is the rate itself; the error was the margin the choice
  // was made with, not a property of the market.
  const realisedRefundRate =
    perReplicateRates.reduce((sum, row) => sum + row[chosen]!, 0) / perReplicateRates.length;

  const displayPrecision = displayPrecisionFor(logQuantum, definition.referencePrice);

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
      realisedRefundRate,
      refundLatticeFactor: factors[chosen]!,
      logVariancePerMs:
        returns.reduce((sum, value) => sum + value * value, 0) / returns.length / horizonMs,
      medianSteps: quantile(sorted, 0.5) / logQuantum,
      meanIntervalMs: (simulatedMs * replicates) / ticks,
      horizonMs,
      simulatedMs,
      replicates,
      horizons: totalHorizons,
      volatilityScale: 1,
    },
  };
}

/**
 * Move a calibrated asset to a different volatility without simulating again.
 *
 * Every log return the calibration produces is exactly proportional to
 * `baseVolatility`: the cascade multiplies it, the regime and structure layers
 * multiply it, the duration modulator reads only intervals, and the arrival
 * process normalises magnitudes against their own running average before using
 * them. So scaling the base scales the whole realised path, leaving the *shape*
 * — tie rate, median move in lattice steps, mean interval, kurtosis — untouched
 * and scaling the lattice with it.
 *
 * Measured on a two-day probe at a factor of 3.7: the quantum ratio agreed with
 * the factor to 1.2e-12, the diffusion rate with its square to 2.9e-15, and tie
 * rate, mean interval and kurtosis were bit-identical. `asset.test.ts` re-checks
 * that against a real recalibration, because the property is load-bearing:
 * hitting a dispersion budget by search would cost a simulation per iteration,
 * and this makes it cost none.
 *
 * The display precision is recomputed rather than carried. A coarser lattice
 * needs fewer decimals, and a display finer than the lattice invites a trader to
 * read a move that did not happen.
 */
export function rescaleCalibration(asset: CalibratedAsset, factor: number): CalibratedAsset {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`A volatility scale must be finite and positive, received ${factor}.`);
  }
  const traits: PersonalityTraits = {
    ...asset.definition.traits,
    volatility: asset.definition.traits.volatility * factor,
  };
  // The bounds are checked here rather than left to the engine, because this is
  // where a dispersion budget a personality cannot reach becomes visible: the
  // factor needed is the one that pushes the base volatility out of range.
  assertPersonalityTraits(traits);
  const definition: AssetDefinition = { ...asset.definition, traits };
  const config = personalityConfig(traits);
  const logQuantum = asset.instrument.logQuantum * factor;
  const instrument: InstrumentSpec = {
    ...asset.instrument,
    logQuantum,
    displayPrecision: displayPrecisionFor(logQuantum, definition.referencePrice),
  };
  assertValidInstrument(instrument);
  return {
    definition,
    instrument,
    config: { ...config, instrument },
    evidence: {
      ...asset.evidence,
      logQuantum,
      logVariancePerMs: asset.evidence.logVariancePerMs * factor * factor,
      volatilityScale: asset.evidence.volatilityScale * factor,
    },
  };
}

/**
 * Register an asset synchronously.
 *
 * Convenient for short spans. A full registration is millions of iterations of
 * uninterrupted CPU, so prefer {@link calibrateAssetAsync} anywhere something
 * else shares the event loop — a test runner's progress channel, or a runtime.
 */
export function calibrateAsset(
  definition: AssetDefinition,
  derive: (purpose: string) => RandomSource,
  options: CalibrationOptions = {},
): CalibratedAsset {
  const run = calibrateAssetCore(definition, derive, options);
  for (;;) {
    const step = run.next();
    if (step.done === true) return step.value;
  }
}

/** Register an asset, yielding to the event loop as it goes. */
export async function calibrateAssetAsync(
  definition: AssetDefinition,
  derive: (purpose: string) => RandomSource,
  options: CalibrationOptions = {},
): Promise<CalibratedAsset> {
  const run = calibrateAssetCore(definition, derive, options);
  for (;;) {
    const step = run.next();
    if (step.done === true) return step.value;
    await yieldToLoop();
  }
}
