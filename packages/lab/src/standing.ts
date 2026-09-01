import type { Tick } from '@otc/core';
import { runBatteryAsync, type BatteryOptions, type Verdict } from './attacks/battery.js';
import {
  ATTACK_FAMILIES,
  withheldFamilies,
  WITHHELD_FAMILY_NAMES,
  type WithheldOptions,
} from './attacks/index.js';
import type { AttackFamily } from './attacks/types.js';
import { PAYOUT_PROMOTIONAL, profitabilityThresholdPoints } from './economics.js';
import { datasetFromTicks, type PublicInstrument } from './observer.js';
import type { HorizonSpec } from './horizons.js';

/**
 * The assurance verdict as something the venue produces, not something an
 * operator runs.
 *
 * ## What this was, and why it was wrong
 *
 * **Cycle Audit 5, CA5-06.** The first version took a list of family *names*,
 * compared them against a constant, and then derived its verdict from a single
 * statistic none of those families computes: the unconditional up-rate per
 * horizon. No `AttackFamily` was constructed anywhere in the call graph.
 *
 * An auditor built a record whose direction is the Thue–Morse parity of the
 * hour — fully predictable, every contract at every horizon won with certainty —
 * and it reported **`clean`**, because the up-rate is 0.5 by construction. The
 * module's own docstring claimed the independence constraint was "made
 * structural here". What was enforced was that a caller typed four strings.
 *
 * It also computed its own detection floor from `designEffect`, which measures
 * between-block variance against a common-`p` null. Fixed block heterogeneity
 * therefore read as dependence: a record paying an observer +10.5% per trade was
 * reported `undecided` with a floor inflated 27-fold **by the leak's own
 * structure** (CA5-07). `dependence.ts`'s own docstring forbids that use.
 *
 * ## What it is now
 *
 * It runs the battery. `runBatteryAsync` with the withheld families, against a
 * real observer dataset built from the published record — and the detection
 * floor is the battery's own `minimumDetectableEffectPoints`, which is the
 * instrument PH-11 built and validated for exactly this.
 *
 * The lesson from removing the old floor is the one this project keeps
 * relearning: a number that reads as a guarantee and is computed by the wrong
 * instrument is worse than no number, because it invites reliance.
 *
 * ## What `clean` means, and what it does not
 *
 * **Cycle Audit 6, CA6-04.** An auditor keyed the direction of each 60-second
 * block to a bit of `splitmix32(blockIndex)` — public arithmetic anyone can
 * recompute — and this function returned `clean` on a record paying an observer
 * **+1.4% per trade**, 3.8 times the threshold it exports as
 * {@link PRODUCT_MARGIN_PP}. Every temporal family conditioned on the clock's
 * *phase*; none on the clock's **identity**. Three families now do
 * (`block-index-digest-*`), and `blockIdentity.stat.test.ts` runs that exact
 * record and requires `exploitable`.
 *
 * The general limit survives the fix and is stated here rather than left to be
 * discovered again: **a battery tests the hypotheses it contains.** `clean` means
 * *no hypothesis in this family set fired at this power* — never *there is no
 * leak*. An adversary may key on any public function of the record, and no finite
 * battery enumerates them all.
 *
 * What does carry an unconditional claim is the engine itself: ADR-0003 makes
 * every sign an independent fair coin drawn from a stream the magnitude process
 * cannot observe, so `P(up) = P(down)` exactly, under every public conditioning,
 * whether or not a family for it exists. The battery is evidence that the
 * implementation matches the theorem; it is not the source of the guarantee.
 */

/** The bias that becomes profitable at the promotional payout: 0.2513pp. */
export const PRODUCT_MARGIN_PP = profitabilityThresholdPoints(PAYOUT_PROMOTIONAL);

/**
 * How often a standing run is due.
 *
 * Daily. The quantity being measured moves on a timescale of days — the
 * volatility process has memory measured in days — so running more often would
 * mostly re-measure the same history and report a floor that had not changed.
 */
export const DEFAULT_STANDING_CADENCE_MS = 24 * 60 * 60 * 1000;

export type StandingOutcome = 'clean' | 'exploitable' | 'undecided';

export interface HorizonStanding {
  readonly horizon: string;
  /** Non-overlapping windows the battery tested at this horizon. */
  readonly samples: number;
  /**
   * The smallest bias this history could have detected, in percentage points.
   *
   * The battery's own figure. Recomputed every run from the history actually
   * held, because it is a property of that history and the history grows.
   */
  readonly detectionFloorPp: number;
  /** Whether that floor is finer than the margin the battery's payout implies. */
  readonly sufficientForPayout: boolean;
  /**
   * Whether that floor is finer than **the product's** margin.
   *
   * **Cycle Audit 6, A6-03.** `classifyStanding` read `sufficientForPayout`,
   * which the battery computes against whatever payout its caller handed it —
   * and `PAYOUT_TYPICAL = 0.85` is a payout this repository ships. Measured: 33
   * hours of a fair walk, judged at 0.85, reported **clean** with a detection
   * floor of 4.040pp, sixteen times coarser than the 0.2513pp margin
   * {@link PRODUCT_MARGIN_PP} exports — under the same word a year of history
   * would earn.
   *
   * `PRODUCT_MARGIN_PP` was defined in this module, exported, asserted in one
   * test for its numeric value, and read by nothing. It is read here now.
   */
  readonly sufficientForProductMargin: boolean;
}

/** A finding the battery judged both significant and economically material. */
export interface StandingFinding {
  readonly family: string;
  readonly horizon: string;
  readonly edgePoints: number;
  readonly z: number;
}

export interface StandingVerdict {
  readonly assetId: string;
  /** The instant the run was made, from the caller's clock. */
  readonly at: number;
  readonly ticks: number;
  /** Milliseconds of market time the history covers. */
  readonly coveredMs: number;
  readonly outcome: StandingOutcome;
  /**
   * Families that were actually constructed and run.
   *
   * Read off the family objects, not off what the caller asked for. A verdict
   * that named families it did not run is the defect this module was rewritten
   * to remove.
   */
  readonly families: readonly string[];
  /** Withheld families that could not be built, and are therefore untested. */
  readonly withheldUnavailable: readonly string[];
  readonly hypothesesTested: number;
  readonly horizons: readonly HorizonStanding[];
  readonly exploitable: readonly StandingFinding[];
  readonly worstZ: number | null;
  readonly elapsedSeconds: number;
  readonly notes: readonly string[];
}

export class StandingAssuranceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StandingAssuranceError';
  }
}

/**
 * Refuse a family set that drops a withheld family it could have run.
 *
 * PH-9.1 withheld four families from every tuning decision and said why: "their
 * value is entirely that no engine decision has been made with them in view,
 * which means it can be destroyed by using them that way."
 *
 * This now inspects the **families themselves**, not a list of strings a caller
 * supplied. A verdict built only from the families the engine was shaped to
 * survive is not independent evidence of anything, and the runner will not sign
 * its name to one.
 */
export function assertIndependentFamilies(
  families: readonly AttackFamily[],
  available: readonly string[],
): void {
  const present = new Set(families.map((family) => family.name));
  const missing = available.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new StandingAssuranceError(
      `A standing verdict cannot be built without the withheld families it could have run; ` +
        `missing ${missing.join(', ')}. The remaining families are the ones the engine was ` +
        `shaped to survive, so a clean result from them is not independent evidence.`,
    );
  }
}

/**
 * The family set a standing run is made from, and the refusal that guards it.
 *
 * **Cycle Audit 6, A6-05.** A refusal used to live at this point, written as
 * `assertIndependentFamilies(withheld, [...built])` — where `available` was
 * derived from `families`, so `missing` was always empty and no input to
 * `runStandingAssurance` could make it throw. An auditor deleted the call and
 * the whole laboratory suite stayed green.
 *
 * It is gone rather than moved, and that is the honest answer. Composition here
 * is `[...ATTACK_FAMILIES, ...withheld]`: it cannot lose a family, so a check
 * that it did not is decoration, and decoration in a guardrail is worse than
 * nothing because it is cited as evidence. What actually protects the verdict is
 * the rule that a withheld family which could not be **built** forces
 * `undecided` (`classifyStanding`), and that rule is tested.
 *
 * `assertIndependentFamilies` stays exported for a caller that assembles its own
 * family set, where the two lists are genuinely independent and the refusal can
 * genuinely fire.
 */
export function composeFamilies(withheld: readonly AttackFamily[]): readonly AttackFamily[] {
  return [...ATTACK_FAMILIES, ...withheld];
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
  // **Cycle Audit 5, CA5-09.** `lastRunAt` was unvalidated, and `NaN - x >= c`
  // is false — so a corrupted stored timestamp meant "never due", forever,
  // silently. That is the failure this module exists to prevent, reached
  // through a bad field rather than through forgetfulness.
  if (lastRunAt !== null && !Number.isFinite(lastRunAt)) {
    throw new StandingAssuranceError(
      `The recorded time of the last standing run is unusable (${lastRunAt}). Refusing to ` +
        `decide: an unknown last run is not a recent one.`,
    );
  }
  if (lastRunAt === null) return true;
  return now - lastRunAt >= cadenceMs;
}

export interface StandingRunOptions {
  readonly assetId: string;
  readonly instrument: PublicInstrument;
  /** The published record. Instants and integer prices, nothing else. */
  readonly ticks: readonly Tick[];
  /** The instant of this run, from the caller's clock. */
  readonly at: number;
  /**
   * Inputs that make the remaining withheld families constructible.
   *
   * `seamIndices` comes from the record's own recorded discontinuities;
   * `reference` is another asset's series. Families whose inputs are absent are
   * not built, are named in {@link StandingVerdict.withheldUnavailable}, and
   * prevent a `clean` verdict — a partial independence claim is not the same
   * claim.
   */
  readonly withheld?: WithheldOptions;
  readonly horizons?: readonly HorizonSpec[];
  readonly battery?: BatteryOptions;
}

/** Produce a standing verdict, or refuse to. */
export async function runStandingAssurance(options: StandingRunOptions): Promise<StandingVerdict> {
  if (!Number.isFinite(options.at)) {
    // The verdict is published with this stamp on it.
    throw new StandingAssuranceError(
      `A standing verdict needs a usable instant, got ${options.at}.`,
    );
  }
  const ticks = options.ticks;
  if (ticks.length < 2) {
    throw new StandingAssuranceError(
      'A standing verdict needs at least two ticks of history; there is nothing to measure.',
    );
  }

  // **The full battery, not only the withheld families.**
  //
  // The first version of this fix ran the withheld four alone, reasoning that
  // independence from tuning was the point. Measured, and wrong: not one of
  // them conditions on wall-clock phase, so on a record whose direction is the
  // Thue-Morse parity of the hour they returned 88 hypotheses, **zero**
  // exploitable, worst z = −1.15. The families that catch a clock-keyed leak —
  // second-of-minute, minute-of-hour, position on the horizon grid — are in the
  // main registry.
  //
  // So the withheld families are what makes the verdict *independent evidence*,
  // and the registry is what gives it *coverage*. A standing run needs both, and
  // running either alone produces a confident answer to a question it did not
  // ask.
  const withheld = withheldFamilies(options.withheld ?? {});
  const built = new Set(withheld.map((family) => family.name));
  const unavailable = WITHHELD_FAMILY_NAMES.filter((name) => !built.has(name));
  const families = composeFamilies(withheld);

  const dataset = datasetFromTicks(options.instrument, ticks);
  const verdict: Verdict = await runBatteryAsync(dataset, {
    ...options.battery,
    families,
    ...(options.horizons === undefined ? {} : { horizons: options.horizons }),
  });

  const horizons: HorizonStanding[] = verdict.sensitivity.map((sensitivity) => ({
    horizon: sensitivity.horizon,
    samples: sensitivity.samples,
    detectionFloorPp: sensitivity.minimumDetectableEffectPoints,
    sufficientForPayout: sensitivity.sufficientForPayout,
    sufficientForProductMargin: sensitivity.minimumDetectableEffectPoints < PRODUCT_MARGIN_PP,
  }));

  return {
    assetId: options.assetId,
    at: options.at,
    ticks: ticks.length,
    coveredMs: ticks[ticks.length - 1]!.instant - ticks[0]!.instant,
    outcome: classifyStanding(verdict, horizons, unavailable),
    families: families.map((family) => family.name).sort(),
    withheldUnavailable: unavailable,
    hypothesesTested: verdict.coverage.hypothesesTested,
    horizons,
    exploitable: verdict.exploitable.map((finding) => ({
      family: finding.family,
      horizon: finding.horizon,
      edgePoints: finding.edgePoints,
      z: finding.z,
    })),
    worstZ: verdict.worst?.z ?? null,
    elapsedSeconds: verdict.elapsedSeconds,
    notes: verdict.notes,
  };
}

/**
 * Three outcomes, and `undecided` is the one that makes the other two honest.
 *
 * Exported so each of its rules can be tested on its own. They mask each other
 * end to end — a record short enough to lack power is also short enough that
 * nothing else fires — and `clean` needs more history than any unit test can
 * hold, so the composed function can only ever be observed saying `undecided`.
 * Cycle Audit 5 found seven assertions that passed for that kind of reason.
 *
 * A young venue has almost no power. Reporting `clean` from it would be the most
 * misleading thing this system could say — indistinguishable from the same word
 * after a year, and it is the word a counterparty acts on. So a run whose
 * detection floor is coarser than the margin the payout implies reports that it
 * cannot see, rather than that there is nothing to see.
 *
 * `exploitable` is reported at any power: an edge the battery judged both
 * significant and material is a finding whether or not the sample could have
 * seen a smaller one.
 *
 * A withheld family that could not be built also forces `undecided`. Four
 * families were withheld from tuning; a clean result from two of them is a
 * weaker claim, and reporting it under the same word would overstate it.
 */
export function classifyStanding(
  verdict: { readonly clean: boolean; readonly exploitable: { readonly length: number } },
  horizons: readonly HorizonStanding[],
  unavailable: readonly string[],
): StandingOutcome {
  if (verdict.exploitable.length > 0) return 'exploitable';
  if (unavailable.length > 0) return 'undecided';
  if (horizons.length === 0) return 'undecided';
  // The **product's** margin, not the battery caller's payout. A caller that
  // hands the battery a 0.85 payout is asking a different question, and the
  // answer to it must not be published under this word (A6-03).
  if (horizons.some((horizon) => !horizon.sufficientForProductMargin)) return 'undecided';
  return verdict.clean ? 'clean' : 'undecided';
}
