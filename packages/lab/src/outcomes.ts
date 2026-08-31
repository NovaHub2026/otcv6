import { compare, epochMillis, type DurationMillis, type EpochMillis } from '@otc/core';
import type { ObserverDataset } from './observer.js';

/**
 * Sampling binary-contract outcomes at wall-clock horizons.
 *
 * A contract opened at instant `t` expires at `t + horizon`. The price at each
 * end is the last tick at or before that instant — deterministic, identical for
 * every observer, reproducible from the record.
 *
 * **The look-ahead rule.** At the moment of entry the observer knows every tick
 * up to and including the one that sets the entry price. A feature may therefore
 * read `prices[0 .. entryIndex]` inclusive. The outcome depends only on the
 * expiry price, which is strictly later. Anything that reads past `entryIndex`
 * is looking into its own answer — the bug that made a PH-1 design probe report
 * z-scores above 1000 on a provably unexploitable process.
 */

export type Outcome = -1 | 0 | 1;

export type EntryMode =
  /** Entries on a regular wall-clock grid, as a systematic trader would place them. */
  | 'clock'
  /** Entries at tick instants. Conditions on "a tick just happened". */
  | 'tick';

export interface SamplingOptions {
  /**
   * Minimum gap between consecutive entries. Defaults to the horizon, which
   * makes samples non-overlapping and therefore approximately independent.
   */
  readonly strideMs?: number;
  readonly entryMode?: EntryMode;
  /** Ignore the first span of history so features have something to read. */
  readonly warmupMs?: number;
  /**
   * Latest instant a contract may expire at. Used to confine sampling to a
   * temporal split without copying the dataset.
   */
  readonly endInstant?: EpochMillis;
  /** Upper bound on samples. Reported when it binds. */
  readonly maxSamples?: number;
}

export interface SamplingSkips {
  /** Entry fell before any tick existed. */
  readonly beforeFirstTick: number;
  /** Expiry fell beyond the end of the dataset. */
  readonly beyondLastTick: number;
  /** Capped by `maxSamples`. */
  readonly overCap: number;
}

export interface OutcomeSampling {
  readonly horizonMs: DurationMillis;
  readonly strideMs: number;
  readonly entryMode: EntryMode;
  /**
   * True when entries are closer together than the horizon. Consumers must not
   * apply an i.i.d. interval to overlapping samples; the flag exists so they
   * cannot do it unknowingly.
   */
  readonly overlapping: boolean;
  readonly entryIndices: Int32Array;
  readonly entryInstants: Float64Array;
  readonly outcomes: Int8Array;
  readonly up: number;
  readonly down: number;
  readonly ties: number;
  /** Non-tie outcomes; ties are void and refunded, so they decide nothing. */
  readonly decided: number;
  readonly skipped: SamplingSkips;
}

export function sampleOutcomes(
  dataset: ObserverDataset,
  horizonMs: DurationMillis,
  options: SamplingOptions = {},
): OutcomeSampling {
  if (!Number.isFinite(horizonMs) || horizonMs <= 0) {
    throw new RangeError(`Horizon must be positive, received ${horizonMs}.`);
  }
  const strideMs = options.strideMs ?? horizonMs;
  if (!Number.isFinite(strideMs) || strideMs <= 0) {
    throw new RangeError(`Stride must be positive, received ${strideMs}.`);
  }
  const entryMode = options.entryMode ?? 'clock';
  const warmupMs = options.warmupMs ?? 0;
  if (warmupMs < 0) throw new RangeError(`Warm-up must be non-negative, received ${warmupMs}.`);
  const maxSamples = options.maxSamples ?? Number.POSITIVE_INFINITY;

  const entryIndices: number[] = [];
  const entryInstants: number[] = [];
  const outcomes: number[] = [];
  const skipped: { beforeFirstTick: number; beyondLastTick: number; overCap: number } = {
    beforeFirstTick: 0,
    beyondLastTick: 0,
    overCap: 0,
  };
  let up = 0;
  let down = 0;
  let ties = 0;

  const first = dataset.firstInstant;
  const last = Math.min(dataset.lastInstant, options.endInstant ?? dataset.lastInstant);

  const record = (entryInstant: EpochMillis): boolean => {
    const entry = dataset.priceAt(entryInstant);
    if (entry === null) {
      skipped.beforeFirstTick += 1;
      return true;
    }
    const expiryInstant = entryInstant + horizonMs;
    if (expiryInstant > last) {
      skipped.beyondLastTick += 1;
      return false; // everything later also expires beyond the data
    }
    if (entryIndices.length >= maxSamples) {
      skipped.overCap += 1;
      return true;
    }
    const expiry = dataset.priceAt(epochMillis(expiryInstant));
    /* c8 ignore next 4 -- expiry is inside the range, so a price always exists */
    if (expiry === null) {
      skipped.beyondLastTick += 1;
      return true;
    }
    const outcome = compare(expiry.price, entry.price);
    entryIndices.push(entry.index);
    entryInstants.push(entryInstant);
    outcomes.push(outcome);
    if (outcome > 0) up += 1;
    else if (outcome < 0) down += 1;
    else ties += 1;
    return true;
  };

  if (entryMode === 'clock') {
    for (let instant = first + warmupMs; instant <= last; instant += strideMs) {
      if (!record(epochMillis(instant))) break;
    }
  } else {
    let previousInstant = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < dataset.tickCount; i += 1) {
      const instant = dataset.instants[i]!;
      if (instant < first + warmupMs) continue;
      if (instant - previousInstant < strideMs) continue;
      previousInstant = instant;
      if (!record(epochMillis(instant))) break;
    }
  }

  return {
    horizonMs,
    strideMs,
    entryMode,
    overlapping: strideMs < horizonMs,
    entryIndices: Int32Array.from(entryIndices),
    entryInstants: Float64Array.from(entryInstants),
    outcomes: Int8Array.from(outcomes),
    up,
    down,
    ties,
    decided: up + down,
    skipped,
  };
}

/** Win rate over decided outcomes. Ties are void, so they decide nothing. */
export function upRate(sampling: OutcomeSampling): number {
  return sampling.decided === 0 ? 0.5 : sampling.up / sampling.decided;
}
