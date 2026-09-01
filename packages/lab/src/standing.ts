import { PAYOUT_PROMOTIONAL, profitabilityThresholdPoints } from './economics.js';
import { designEffect, minimumDetectableEffectUnderDependence } from './dependence.js';
import { BINARY_HORIZONS, type HorizonSpec } from './horizons.js';
import { HorizonAccumulator } from './horizonTally.js';
import { WITHHELD_FAMILY_NAMES } from './attacks/index.js';
import type { TickJournal } from './assurance.js';

/**
 * The assurance verdict as something the venue produces, not something an
 * operator runs.
 *
 * PH-9 made the verdict re-derivable from the published record with no key, and
 * PH-11 gave it power at every horizon the product sells. Both are capabilities.
 * The gap between "we verified this in August" and "this is verified" is the
 * whole of what a counterparty is buying, and a guarantee that needs somebody to
 * remember to run something is a claim about the past.
 */

/** The bias that becomes profitable at the promotional payout: 0.2513pp. */
export const PRODUCT_MARGIN_PP = profitabilityThresholdPoints(PAYOUT_PROMOTIONAL);

/**
 * How often a standing run is due.
 *
 * Daily. The quantity being measured moves on a timescale of days — the
 * volatility process has memory measured in days, which is the whole reason the
 * floor moves at all — so running more often would mostly re-measure the same
 * dependence and report a floor that had not meaningfully changed.
 */
export const DEFAULT_STANDING_CADENCE_MS = 24 * 60 * 60 * 1000;

/**
 * Replicate blocks used to measure dependence.
 *
 * The history is cut into contiguous blocks and the up-rate measured in each.
 * Contiguous rather than interleaved: interleaving would spread each block
 * across the whole record and average the dependence away, which is the one
 * thing this measurement exists to see.
 */
export const DEFAULT_REPLICATE_BLOCKS = 12;

export type StandingOutcome = 'clean' | 'exploitable' | 'undecided';

export interface HorizonStanding {
  readonly horizon: string;
  /** Non-overlapping windows that settled a direction. */
  readonly trials: number;
  readonly upRate: number;
  /** Measured from contiguous blocks of this history, not assumed. */
  readonly designEffect: number;
  readonly effectiveTrials: number;
  /**
   * The smallest bias this history could have detected, in percentage points.
   *
   * Recomputed every run. A standing report quoting a fixed floor is wrong in
   * one direction on its first day and the other on its hundredth.
   */
  readonly detectionFloorPp: number;
  /** |upRate − 0.5|, in percentage points. */
  readonly observedBiasPp: number;
  readonly outcome: StandingOutcome;
}

export interface StandingVerdict {
  readonly assetId: string;
  /** The instant the run was made, from the caller's clock. */
  readonly at: number;
  readonly ticks: number;
  /** Milliseconds of market time the history covers. */
  readonly coveredMs: number;
  readonly horizons: readonly HorizonStanding[];
  /**
   * The worst outcome across horizons.
   *
   * `exploitable` if any horizon is, else `undecided` if any horizon is, else
   * `clean`. A venue is not clean because most of it is.
   */
  readonly outcome: StandingOutcome;
  /** Names of the attack families the verdict was built from. */
  readonly families: readonly string[];
}

export class StandingAssuranceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StandingAssuranceError';
  }
}

/**
 * Refuse a family set that drops any withheld family.
 *
 * PH-9.1 withheld four families from every tuning decision and said why: "their
 * value is entirely that no engine decision has been made with them in view,
 * which means it can be destroyed by using them that way."
 *
 * A standing verdict built only from the families the engine was *shaped to
 * survive* is not independent evidence of anything. That is a constraint on how
 * the thing is operated, which is the kind that erodes silently — so it is made
 * structural here: the runner will not sign its name to such a verdict.
 */
export function assertIndependentFamilies(familyNames: readonly string[]): void {
  const present = new Set(familyNames);
  const missing = WITHHELD_FAMILY_NAMES.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new StandingAssuranceError(
      `A standing verdict cannot be built without the withheld families; missing ` +
        `${missing.join(', ')}. The remaining families are the ones the engine was shaped to ` +
        `survive, so a clean result from them is not independent evidence.`,
    );
  }
}

/** Whether a standing run is due, given when the last one happened. */
export function isStandingRunDue(
  lastRunAt: number | null,
  now: number,
  cadenceMs: number = DEFAULT_STANDING_CADENCE_MS,
): boolean {
  if (!Number.isFinite(cadenceMs) || cadenceMs <= 0) {
    throw new StandingAssuranceError(
      `A standing cadence must be a positive number of milliseconds, got ${cadenceMs}.`,
    );
  }
  if (!Number.isFinite(now)) {
    throw new StandingAssuranceError('A standing run needs a usable instant to decide from.');
  }
  if (lastRunAt === null) return true;
  return now - lastRunAt >= cadenceMs;
}

/** Up-rate over one contiguous slice of the journal, at one horizon. */
function upRateOverSlice(
  ticks: TickJournal['ticks'],
  from: number,
  to: number,
  spec: HorizonSpec,
): { readonly upRate: number; readonly decided: number } {
  const first = ticks[from];
  if (first === undefined || to - from < 2) return { upRate: Number.NaN, decided: 0 };
  const accumulator = new HorizonAccumulator([spec], first.instant, first.price);
  for (let index = from + 1; index < to; index += 1) {
    const tick = ticks[index]!;
    accumulator.observe(tick.instant, tick.price);
  }
  const outcome = accumulator.outcomes()[0]!;
  return { upRate: outcome.upRate, decided: outcome.decided };
}

/**
 * Assess one horizon against the history held.
 *
 * The floor comes out of the measurement rather than out of a constant, which is
 * the whole point: it is a property of the history, and the history grows.
 */
export function assessHorizon(
  journal: TickJournal,
  spec: HorizonSpec,
  blocks: number = DEFAULT_REPLICATE_BLOCKS,
): HorizonStanding {
  if (!Number.isInteger(blocks) || blocks < 3) {
    throw new StandingAssuranceError(
      `Measuring dependence needs at least 3 replicate blocks, got ${blocks}.`,
    );
  }
  const ticks = journal.ticks;
  const whole = upRateOverSlice(ticks, 0, ticks.length, spec);

  // Contiguous blocks, not interleaved: interleaving spreads each block across
  // the whole record and averages the dependence away, which is the one thing
  // this measurement exists to see.
  const size = Math.floor(ticks.length / blocks);
  const proportions: number[] = [];
  let perBlockDecided = 0;
  for (let block = 0; block < blocks && size > 2; block += 1) {
    const slice = upRateOverSlice(ticks, block * size, (block + 1) * size, spec);
    if (Number.isFinite(slice.upRate) && slice.decided > 0) {
      proportions.push(slice.upRate);
      perBlockDecided = Math.max(perBlockDecided, slice.decided);
    }
  }

  let measuredDesignEffect = 1;
  if (proportions.length >= 3 && perBlockDecided > 0) {
    try {
      measuredDesignEffect = designEffect(proportions, perBlockDecided).designEffect;
    } catch {
      // A degenerate measurement — every block at 0 or 1, or too few — is not a
      // licence to assume independence, but there is nothing better to use. It
      // stays at 1 and the trial count is what limits the floor.
      measuredDesignEffect = 1;
    }
  }

  const trials = whole.decided;
  const effectiveTrials = Math.floor(trials / Math.max(measuredDesignEffect, 1));
  let detectionFloorPp = Number.POSITIVE_INFINITY;
  if (effectiveTrials >= 1) {
    detectionFloorPp = minimumDetectableEffectUnderDependence(trials, measuredDesignEffect) * 100;
  }

  const upRate = Number.isFinite(whole.upRate) ? whole.upRate : Number.NaN;
  const observedBiasPp = Number.isFinite(upRate) ? Math.abs(upRate - 0.5) * 100 : Number.NaN;

  return {
    horizon: spec.label,
    trials,
    upRate,
    designEffect: measuredDesignEffect,
    effectiveTrials,
    detectionFloorPp,
    observedBiasPp,
    outcome: classify(observedBiasPp, detectionFloorPp),
  };
}

/**
 * Three outcomes, and `undecided` is the one that had to be added.
 *
 * A young venue has almost no power. Reporting `clean` from it would be the most
 * misleading thing this system could say — indistinguishable from the same word
 * after a year, and it is the word a counterparty acts on. So a horizon whose
 * floor is coarser than the margin the payout implies reports that it cannot
 * see, rather than that there is nothing to see.
 *
 * `exploitable` is reported at any power: an edge large enough to clear a coarse
 * floor is a finding whether or not the sample could have seen a smaller one.
 */
function classify(observedBiasPp: number, detectionFloorPp: number): StandingOutcome {
  if (Number.isFinite(observedBiasPp) && observedBiasPp > detectionFloorPp) return 'exploitable';
  if (!Number.isFinite(detectionFloorPp) || detectionFloorPp > PRODUCT_MARGIN_PP) {
    return 'undecided';
  }
  return 'clean';
}

export interface StandingRunOptions {
  readonly assetId: string;
  readonly journal: TickJournal;
  /** The instant of this run, from the caller's clock. */
  readonly at: number;
  /** Names of the attack families this verdict is built from. */
  readonly familyNames: readonly string[];
  readonly horizons?: readonly HorizonSpec[];
  readonly blocks?: number;
}

/** Produce a standing verdict, or refuse to. */
export function runStandingAssurance(options: StandingRunOptions): StandingVerdict {
  assertIndependentFamilies(options.familyNames);
  const ticks = options.journal.ticks;
  if (ticks.length < 2) {
    throw new StandingAssuranceError(
      'A standing verdict needs at least two ticks of history; there is nothing to measure.',
    );
  }
  const horizons = options.horizons ?? BINARY_HORIZONS;
  const assessed = horizons.map((spec) => assessHorizon(options.journal, spec, options.blocks));

  // The worst across horizons. A venue is not clean because most of it is.
  let outcome: StandingOutcome = 'clean';
  if (assessed.some((h) => h.outcome === 'undecided')) outcome = 'undecided';
  if (assessed.some((h) => h.outcome === 'exploitable')) outcome = 'exploitable';

  return {
    assetId: options.assetId,
    at: options.at,
    ticks: ticks.length,
    coveredMs: ticks[ticks.length - 1]!.instant - ticks[0]!.instant,
    horizons: assessed,
    outcome,
    families: [...options.familyNames],
  };
}
